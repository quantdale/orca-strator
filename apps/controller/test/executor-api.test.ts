import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("Executor REST Endpoints (Task 5)", () => {
  let tempDir: string;
  let appInstance: AppInstance;

  const mockRepo: RepositoryRecord = {
    id: "repo-exec-api",
    displayName: "Executor API Repo",
    githubRemote: "https://github.com/quantdale/exec-api.git",
    localPath: "D:\\Projects\\ExecApi",
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
    id: "disp-exec-api-01",
    dispatchId: "disp-exec-api-01",
    repositoryId: "repo-exec-api",
    runId: "run-exec-api-01",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/003-headless-executor-runtime",
    goal: "API executor test",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "detected",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-exec-api-test-"));
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
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
    appInstance.dispatchStore.create(mockDispatch);
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("5.T1 GET /api/repositories/:id/executor returns executor status", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/executor`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.executor).toBeDefined();
    expect(body.executor.repositoryId).toBe(mockRepo.id);
    expect(body.executor.isRunning).toBe(false);
  });

  it("5.T2 GET /api/repositories/:id/executor/logs returns logs array", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/executor/logs`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it("5.T3 POST /api/repositories/:id/executor/pause returns paused status", async () => {
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/executor/pause`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("paused");
  });

  it("5.T4 POST /api/repositories/:id/executor/kill returns killed status", async () => {
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/executor/kill`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("killed");
  });
});
