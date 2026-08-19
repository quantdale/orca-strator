import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("Watcher REST Endpoints (Task 5)", () => {
  let tempDir: string;
  let appInstance: AppInstance;

  const mockRepo: RepositoryRecord = {
    id: "repo-watcher-api",
    displayName: "Watcher API Repo",
    githubRemote: "https://github.com/quantdale/watcher-test.git",
    localPath: "D:\\Projects\\WatcherTest",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  const mockDispatch: DispatchRecord = {
    id: "disp-api-01",
    dispatchId: "disp-api-01",
    repositoryId: "repo-watcher-api",
    runId: "run-01",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/002-repository-watch-dispatch",
    goal: "API test goal",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "detected",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-watcher-api-test-"));
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      logLevel: "silent"
    });
    appInstance = await buildApp(config);
    const created = appInstance.repositoryService.createRepository({
      displayName: mockRepo.displayName,
      githubRemote: mockRepo.githubRemote,
      localPath: mockRepo.localPath,
      environment: mockRepo.environment,
      wslDistribution: mockRepo.wslDistribution,
      executorCli: mockRepo.executorCli,
      executorModel: mockRepo.executorModel,
      solConversationUrl: mockRepo.solConversationUrl,
      maxIterations: mockRepo.maxIterations,
      maxRuntimeMinutes: mockRepo.maxRuntimeMinutes
    });
    mockRepo.id = created.id;
    mockDispatch.repositoryId = created.id;
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("5.T1 GET /api/repositories/:id/watcher returns watcher status", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/watcher`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.watcher).toBeDefined();
    expect(body.watcher.repositoryId).toBe(mockRepo.id);
    expect(body.watcher.isWatching).toBeDefined();
  });

  it("5.T2 GET /api/repositories/:id/dispatches returns dispatches list", async () => {
    appInstance.dispatchStore.create(mockDispatch);

    const res = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/dispatches`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dispatches).toHaveLength(1);
    expect(body.dispatches[0].id).toBe("disp-api-01");
    expect(body.dispatches[0].status).toBe("detected");
  });

  it("5.T3 returns 404 REPOSITORY_NOT_FOUND for unknown repository ID", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/repositories/non-existent/watcher"
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("REPOSITORY_NOT_FOUND");
  });
});
