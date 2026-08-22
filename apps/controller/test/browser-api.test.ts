import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("Browser REST Endpoints (Task 5)", () => {
  let tempDir: string;
  let appInstance: AppInstance;
  let mockDriver: MockBrowserDriver;
  // Change 023: deterministic external setup-Chrome launcher seam.
  const fakeSetupLauncher = {
    spawned: [] as { exe: string; profile: string; url: string }[],
    spawn(exe: string, profile: string, url: string) {
      this.spawned.push({ exe, profile, url });
      const pid = 8000 + this.spawned.length;
      return {
        pid,
        exit: new Promise<{ code: number | null }>((resolve) =>
          setTimeout(() => resolve({ code: 0 }), 30000),
        ),
      };
    },
    async close() {},
    isRunning() {
      return false;
    },
  };

  const mockRepo: RepositoryRecord = {
    id: "repo-browser-api",
    displayName: "Browser API Repo",
    githubRemote: "https://github.com/quantdale/browser-api.git",
    enabled: true,
    localPath: "D:\\Projects\\BrowserApi",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl:
      "https://chatgpt.com/c/67b5883a-3333-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  };

  const mockDispatch: DispatchRecord = {
    id: "disp-browser-api-1",
    dispatchId: "disp-browser-api-1",
    repositoryId: "repo-browser-api",
    runId: "run-browser-api-1",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/004-playwright-sol-bridge",
    goal: "API browser test",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "consumed",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-browser-api-test-"));
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
    });

    mockDriver = new MockBrowserDriver();

    appInstance = await buildApp(config, {
      browserDriver: mockDriver,
      // Change 023: deterministic external setup-Chrome seams (no machine deps).
      discoverSystemChrome: async () => ({
        status: "FOUND",
        executablePath: "C:\\fake\\chrome.exe",
        version: "142.0.7444.60",
        source: "test",
      }),
      setupLauncher: fakeSetupLauncher,
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
      maxRuntimeMinutes: mockRepo.maxRuntimeMinutes,
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

  it("5.T1 GET /api/browser/status returns current browser status", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/browser/status",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.browser).toBeDefined();
    expect(body.browser.isRunning).toBe(false);
  });

  it("5.T2 POST /api/browser/setup/open and /close manage setup mode", async () => {
    const openRes = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/browser/setup/open",
    });
    expect(openRes.statusCode).toBe(200);
    expect(openRes.json().status).toBe("opened");

    const closeRes = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/browser/setup/close",
    });
    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json().status).toBe("closed");
  });

  it("5.T3 POST /api/repositories/:id/wake submits wake message", async () => {
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${mockRepo.id}/wake`,
      payload: {
        dispatchId: mockDispatch.id,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.wake).toBeDefined();
    expect(body.wake.status).toBe("submitted");
    expect(body.wake.conversationUrl).toBe(mockRepo.solConversationUrl);
  });
});
