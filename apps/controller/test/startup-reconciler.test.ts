import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { StartupReconciler } from "../src/loop/startup-reconciler.js";
import { LoopService } from "../src/loop/loop-service.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type { RepositoryRecord, RunRecord } from "@orca/shared";

describe("StartupReconciler (Task 2)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let runStore: RunStore;
  let reconciler: StartupReconciler;

  const mockRepo: RepositoryRecord = {
    id: "repo-reconcile-1",
    displayName: "Reconcile Repo",
    githubRemote: "https://github.com/quantdale/reconcile.git",
    localPath: "D:\\Projects\\Reconcile",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-7777-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-reconcile-test-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);
    const dispatchStore = new DispatchStore(dbCtx.db);
    const executorStore = new ExecutorStore(dbCtx.db);
    const wakeStore = new SolWakeStore(dbCtx.db);

    repoStore.create(mockRepo);

    const executorService = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir
    });

    const browserManager = new BrowserManager({
      dataDir: tempDir,
      driver: new MockBrowserDriver(),
      wakeStore
    });

    const loopService = new LoopService({
      repoStore,
      runStore,
      executorService,
      browserManager
    });

    reconciler = new StartupReconciler(repoStore, runStore, loopService);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("2.T1 reconciles orphaned EXECUTING run into RECOVERY_REQUIRED on startup", async () => {
    const orphanedRun: RunRecord = {
      id: "run-orphaned-1",
      repositoryId: mockRepo.id,
      goal: "Interrupted task",
      status: "EXECUTING",
      currentIteration: 2,
      maxIterations: 20,
      activeDispatchId: null,
      lastError: null,
      startedAt: "2026-08-19T12:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    runStore.create(orphanedRun);

    const result = await reconciler.reconcile();
    expect(result.reconciledCount).toBe(1);
    expect(result.recoveryRequiredCount).toBe(1);

    const updated = runStore.get("run-orphaned-1");
    expect(updated?.status).toBe("RECOVERY_REQUIRED");
    expect(updated?.lastError).toContain("Controller process restarted");
  });

  it("2.T2 leaves SOL_REVIEWING runs intact for ongoing watcher polling", async () => {
    const activeRun: RunRecord = {
      id: "run-reviewing-1",
      repositoryId: mockRepo.id,
      goal: "Awaiting review",
      status: "SOL_REVIEWING",
      currentIteration: 1,
      maxIterations: 20,
      activeDispatchId: null,
      lastError: null,
      startedAt: "2026-08-19T12:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    runStore.create(activeRun);

    const result = await reconciler.reconcile();
    expect(result.reconciledCount).toBe(1);
    expect(result.recoveryRequiredCount).toBe(0);

    const updated = runStore.get("run-reviewing-1");
    expect(updated?.status).toBe("SOL_REVIEWING");
  });
});
