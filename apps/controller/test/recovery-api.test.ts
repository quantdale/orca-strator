import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type { RepositoryRecord, RunRecord } from "@orca/shared";

describe("Recovery REST API (Task 3)", () => {
  let tempDir: string;
  let appInstance: AppInstance;
  let mockDriver: MockBrowserDriver;

  const mockRepo: RepositoryRecord = {
    id: "repo-recovery-api",
    displayName: "Recovery API Repo",
    githubRemote: "https://github.com/quantdale/recovery.git",
    localPath: "D:\\Projects\\Recovery",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-8888-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-rec-api-test-"));
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent"
    });

    mockDriver = new MockBrowserDriver();

    appInstance = await buildApp(config, {
      browserDriver: mockDriver
    });

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
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("3.T1 POST /api/repositories/:id/runs/recover with action stop finishes run", async () => {
    const runRecord: RunRecord = {
      id: "run-rec-1",
      repositoryId: mockRepo.id,
      goal: "Recoverable goal",
      status: "RECOVERY_REQUIRED",
      currentIteration: 1,
      maxIterations: 10,
      activeDispatchId: null,
      lastError: "Crash detected",
      startedAt: "2026-08-19T12:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    appInstance.runStore.create(runRecord);

    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/recover`,
      payload: { action: "stop" }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.status).toBe("STOPPED");
  });

  it("3.T2 POST /api/repositories/:id/runs/recover with action complete finishes run as GOAL_COMPLETE", async () => {
    const runRecord: RunRecord = {
      id: "run-rec-2",
      repositoryId: mockRepo.id,
      goal: "Completed goal",
      status: "RECOVERY_REQUIRED",
      currentIteration: 1,
      maxIterations: 10,
      activeDispatchId: null,
      lastError: "Crash detected",
      startedAt: "2026-08-19T12:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    appInstance.runStore.create(runRecord);

    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/recover`,
      payload: { action: "complete" }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.status).toBe("GOAL_COMPLETE");
  });

  it("3.T3 POST /api/repositories/:id/runs/recover with action retry resumes loop", async () => {
    const runRecord: RunRecord = {
      id: "run-rec-3",
      repositoryId: mockRepo.id,
      goal: "Retried goal",
      status: "RECOVERY_REQUIRED",
      currentIteration: 1,
      maxIterations: 10,
      activeDispatchId: null,
      lastError: "Crash detected",
      startedAt: "2026-08-19T12:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    appInstance.runStore.create(runRecord);

    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/recover`,
      payload: { action: "retry" }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.status).toBe("SOL_REVIEWING");
  });
});
