import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("Browser Manager & Sol Wake Integration (Task 6)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let wakeStore: SolWakeStore;
  let mockDriver: MockBrowserDriver;
  let browserManager: BrowserManager;

  const mockRepo1: RepositoryRecord = {
    id: "repo-browser-1",
    displayName: "Browser Repo 1",
    githubRemote: "https://github.com/quantdale/repo1.git",
    localPath: "D:\\Projects\\Repo1",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-1111-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  const mockRepo2: RepositoryRecord = {
    id: "repo-browser-2",
    displayName: "Browser Repo 2",
    githubRemote: "https://github.com/quantdale/repo2.git",
    localPath: "D:\\Projects\\Repo2",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-2222-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  const mockDispatch1: DispatchRecord = {
    id: "disp-wake-int-1",
    dispatchId: "disp-wake-int-1",
    repositoryId: "repo-browser-1",
    runId: "run-int-1",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/004-playwright-sol-bridge",
    goal: "Integration wake test 1",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "consumed",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-browser-int-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    mockDriver = new MockBrowserDriver();

    repoStore.create(mockRepo1);
    repoStore.create(mockRepo2);
    dispatchStore.create(mockDispatch1);

    browserManager = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore
    });
  });

  afterEach(async () => {
    await browserManager.close();
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("6.T1 openSetupBrowser launches headed browser and locks profile, close releases lock", async () => {
    await browserManager.openSetupBrowser();
    expect(mockDriver.isRunning()).toBe(true);
    expect(mockDriver.headless).toBe(false);

    const status = browserManager.getStatus();
    expect(status.isSetupOpen).toBe(true);
    expect(status.lockHolderPid).toBe(process.pid);

    await browserManager.closeSetupBrowser();
    expect(mockDriver.isRunning()).toBe(false);
    expect(browserManager.getStatus().isSetupOpen).toBe(false);
  });

  it("6.T2 submitSolWake formats message, types into composer, and records submitted status", async () => {
    const wake = await browserManager.submitSolWake(mockRepo1.id, {
      runId: mockDispatch1.runId,
      iteration: mockDispatch1.iteration,
      dispatchId: mockDispatch1.id,
      resultStatus: "COMPLETED",
      conversationUrl: mockRepo1.solConversationUrl,
      repositoryName: mockRepo1.displayName
    });

    expect(wake.status).toBe("submitted");
    expect(wake.submittedAt).not.toBeNull();
    expect(mockDriver.isRunning()).toBe(true);

    const page = mockDriver.pages.get(mockRepo1.id);
    expect(page).toBeDefined();
    expect(page?.typedMessages.length).toBeGreaterThan(0);
    expect(page?.typedMessages[0].text).toContain("Orca-Strator executor turn completed");
    expect(page?.clickedSelectors.length).toBeGreaterThan(0);

    const persisted = wakeStore.get(wake.id);
    expect(persisted?.status).toBe("submitted");
  });

  it("6.T3 two repositories multiplex on the same browser context with separate pages", async () => {
    const mockDispatch2: DispatchRecord = {
      id: "disp-wake-int-2",
      dispatchId: "disp-wake-int-2",
      repositoryId: mockRepo2.id,
      runId: "run-int-2",
      iteration: 1,
      commitSha: "1123456789abcdef0123456789abcdef01234567",
      baseSha: "2123456789abcdef0123456789abcdef01234567",
      changePath: "openspec/changes/004-playwright-sol-bridge",
      goal: "Integration wake test 2",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "consumed",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    dispatchStore.create(mockDispatch2);

    await browserManager.submitSolWake(mockRepo1.id, {
      runId: mockDispatch1.runId,
      iteration: 1,
      dispatchId: mockDispatch1.id,
      resultStatus: "COMPLETED",
      conversationUrl: mockRepo1.solConversationUrl,
      repositoryName: mockRepo1.displayName
    });

    await browserManager.submitSolWake(mockRepo2.id, {
      runId: mockDispatch2.runId,
      iteration: 1,
      dispatchId: mockDispatch2.id,
      resultStatus: "COMPLETED",
      conversationUrl: mockRepo2.solConversationUrl,
      repositoryName: mockRepo2.displayName
    });

    expect(mockDriver.activePageCount()).toBe(2);
    expect(mockDriver.pages.get(mockRepo1.id)?.currentUrl).toBe(mockRepo1.solConversationUrl);
    expect(mockDriver.pages.get(mockRepo2.id)?.currentUrl).toBe(mockRepo2.solConversationUrl);
  });
});
