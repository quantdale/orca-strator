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
  let fakeSetupLauncher: any;

  const mockRepo1: RepositoryRecord = {
    id: "repo-browser-1",
    displayName: "Browser Repo 1",
    githubRemote: "https://github.com/quantdale/repo1.git",

    enabled: true,
    localPath: "D:\\Projects\\Repo1",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl:
      "https://chatgpt.com/c/67b5883a-1111-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  };

  const mockRepo2: RepositoryRecord = {
    id: "repo-browser-2",
    displayName: "Browser Repo 2",
    githubRemote: "https://github.com/quantdale/repo2.git",
    enabled: true,
    localPath: "D:\\Projects\\Repo2",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl:
      "https://chatgpt.com/c/67b5883a-2222-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
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
    updatedAt: "2026-08-19T12:00:00.000Z",
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

    // Change 023: deterministic fake discovery + external launcher so the
    // INTERACTIVE_SETUP flow never depends on machine Chrome or Playwright.
    fakeSetupLauncher = {
      spawned: [] as { exe: string; profile: string; url: string }[],
      exitCallbacks: [] as (() => void)[],
      spawn(exe: string, profile: string, url: string) {
        this.spawned.push({ exe, profile, url });
        const pid = 7000 + this.spawned.length;
        (this.spawned[this.spawned.length - 1] as any).pid = pid;
        return {
          pid,
          exit: new Promise<{ code: number | null }>((resolve) =>
            this.exitCallbacks.push(() => resolve({ code: 0 })),
          ),
        };
      },
      async close() {},
      isRunning() {
        return (
          this.spawned.length > 0 &&
          this.exitCallbacks.length < this.spawned.length
        );
      },
    };

    browserManager = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore,
      discoverSystemChrome: async () => ({
        status: "FOUND",
        executablePath: "C:\\fake\\chrome.exe",
        version: "142.0.7444.60",
        source: "test",
      }),
      setupLauncher: fakeSetupLauncher,
    });
  });

  afterEach(async () => {
    await browserManager.close();
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("6.T1 openSetupBrowser spawns ordinary Chrome externally (no automation driver), locks profile, close releases", async () => {
    await browserManager.openSetupBrowser();

    // Change 023: the Playwright/automation driver is NEVER used for setup.
    expect(mockDriver.launchCalls).toHaveLength(0);
    expect(mockDriver.isRunning()).toBe(false);
    const launcher = fakeSetupLauncher as any;
    expect(launcher.spawned).toHaveLength(1);
    expect(launcher.spawned[0].url).toBe("https://chatgpt.com/auth/login");
    expect(launcher.spawned[0].profile).toBe(
      path.join(tempDir, "browser", "profile"),
    );

    const status = browserManager.getStatus();
    expect(status.isSetupOpen).toBe(true);
    expect(status.setupLauncherKind).toBe("external-chrome");
    expect(status.setupPid).toBe(launcher.spawned[0].pid as number);
    expect(status.lockHolderPid).toBe(launcher.spawned[0].pid as number);

    await browserManager.closeSetupBrowser();
    expect(browserManager.getStatus().isSetupOpen).toBe(false);
    expect(mockDriver.isRunning()).toBe(false);
  });

  it("6.T2 submitSolWake formats message, types into composer, and records submitted status", async () => {
    const wake = await browserManager.submitSolWake(mockRepo1.id, {
      runId: mockDispatch1.runId,
      iteration: mockDispatch1.iteration,
      dispatchId: mockDispatch1.id,
      resultStatus: "COMPLETED",
      conversationUrl: mockRepo1.solConversationUrl,
      repositoryName: mockRepo1.displayName,
    });

    expect(wake.status).toBe("submitted");
    expect(wake.submittedAt).not.toBeNull();

    // The page is closed after the wake (L); inspect the persistent history.
    const page = mockDriver.history.get(mockRepo1.id);
    expect(page).toBeDefined();
    expect(page?.typedMessages.length).toBeGreaterThan(0);
    expect(page?.typedMessages[0].text).toContain(
      "Orca-Strator executor turn completed",
    );
    expect(page?.clickedSelectors.length).toBeGreaterThan(0);

    const persisted = wakeStore.get(wake.id);
    expect(persisted?.status).toBe("submitted");
  });

  it("6.T3 two repositories each get a dedicated page and wake during multiplexing", async () => {
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
      updatedAt: "2026-08-19T12:00:00.000Z",
    };
    dispatchStore.create(mockDispatch2);

    const wake1 = await browserManager.submitSolWake(mockRepo1.id, {
      runId: mockDispatch1.runId,
      iteration: 1,
      dispatchId: mockDispatch1.id,
      resultStatus: "COMPLETED",
      conversationUrl: mockRepo1.solConversationUrl,
      repositoryName: mockRepo1.displayName,
    });

    const wake2 = await browserManager.submitSolWake(mockRepo2.id, {
      runId: mockDispatch2.runId,
      iteration: 1,
      dispatchId: mockDispatch2.id,
      resultStatus: "COMPLETED",
      conversationUrl: mockRepo2.solConversationUrl,
      repositoryName: mockRepo2.displayName,
    });

    // Each repository is opened on its own page with its own conversation URL.
    expect(wake1.status).toBe("submitted");
    expect(wake2.status).toBe("submitted");
    expect(mockDriver.history.get(mockRepo1.id)?.currentUrl).toBe(
      mockRepo1.solConversationUrl,
    );
    expect(mockDriver.history.get(mockRepo2.id)?.currentUrl).toBe(
      mockRepo2.solConversationUrl,
    );
  });
});
