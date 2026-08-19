import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import type { RepositoryRecord } from "@orca/shared";

describe("Run REST Endpoints (Task 5)", () => {
  let tempDir: string;
  let appInstance: AppInstance;
  let mockDriver: MockBrowserDriver;

  const mockRepo: RepositoryRecord = {
    id: "repo-run-api",
    displayName: "Run API Repo",
    githubRemote: "https://github.com/quantdale/run-api.git",
    localPath: "D:\\Projects\\RunApi",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-6666-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-run-api-test-"));
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

  it("5.T1 GET /api/repositories/:id/runs/active returns initial IDLE status", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/runs/active`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status.state).toBe("IDLE");
    expect(body.status.activeRun).toBeNull();
  });

  it("5.T2 POST /api/repositories/:id/runs/start creates run and transitions state", async () => {
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/start`,
      payload: {
        goal: "Build autonomous feature",
        maxIterations: 10
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.run.goal).toBe("Build autonomous feature");
    expect(body.run.status).toBe("SOL_REVIEWING");

    const statusRes = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/runs/active`
    });
    expect(statusRes.json().status.state).toBe("SOL_REVIEWING");
    expect(statusRes.json().status.activeActor).toBe("SOL");
  });

  it("5.T3 POST /api/repositories/:id/runs/pause and /resume work", async () => {
    await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/start`,
      payload: {
        goal: "Control run"
      }
    });

    const pauseRes = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/pause`
    });
    expect(pauseRes.statusCode).toBe(200);
    expect(pauseRes.json().status).toBe("paused");

    const resumeRes = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/resume`
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(resumeRes.json().status).toBe("resumed");
  });

  it("5.T4 POST /api/repositories/:id/runs/stop stops active run", async () => {
    await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/start`,
      payload: {
        goal: "Stop run"
      }
    });

    const stopRes = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/runs/stop`
    });
    expect(stopRes.statusCode).toBe(200);
    expect(stopRes.json().status).toBe("stopped");

    const statusRes = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${mockRepo.id}/runs/active`
    });
    // Fix #4: Stop is graceful – while Sol is active, Orca enters DRAINING and
    // shows it truthfully until the Sol boundary (next dispatch/control) arrives.
    expect(statusRes.json().status.state).toBe("DRAINING");
  });
});
