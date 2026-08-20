/**
 * Deterministic restart tests for the durable Sol operation model (items #1/#3).
 *
 * Proves:
 *  - the EXACT wake intent (resultStatus, repositoryName, iteration, message, deadline,
 *    retry budgets) survives a controller restart and is NOT reconstructed/guessed
 *    (COMPLETED stays COMPLETED, never INITIAL);
 *  - within-deadline restart resumes waiting without a duplicate/resubmitted wake;
 *  - a restart after the first timeout performs exactly one permitted retry and cannot
 *    be made to grant additional retries across repeated restarts;
 *  - BUSY backpressure budget is persisted and bounded across restarts, with a run
 *    never stuck in SOL_REVIEWING forever merely because wakes were BUSY.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { SqliteSolOperationStore } from "../src/browser/sol-operation-store.js";
import { BrowserManager, BUSY_MAX_RETRIES, BUSY_RETRY_MS } from "../src/browser/browser-manager.js";
import { LoopService } from "../src/loop/loop-service.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import type { RepositoryRecord, SolWakeResultStatus } from "@orca/shared";

type Services = {
  dbCtx: DatabaseContext;
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  runStore: RunStore;
  wakeStore: SolWakeStore;
  solStore: SqliteSolOperationStore;
  browser: BrowserManager;
  loop: LoopService;
  mockDriver: MockBrowserDriver;
  repoId: string;
};

function buildServices(tempDir: string): Services {
  const dbPath = path.join(tempDir, "test.sqlite");
  const dbCtx = initDatabase(dbPath);
  const repoStore = new RepositoryStore(dbCtx.db);
  const dispatchStore = new DispatchStore(dbCtx.db);
  const runStore = new RunStore(dbCtx.db);
  const wakeStore = new SolWakeStore(dbCtx.db);
  const solStore = new SqliteSolOperationStore(dbCtx.db);
  const mockDriver = new MockBrowserDriver();
  const fakeExecutor = new FakeExecutorAdapter({ durationMs: 10 });
  const browser = new BrowserManager({ dataDir: tempDir, driver: mockDriver, wakeStore, solOperationStore: solStore, solTimeoutMs: 600000 });
  const executorService = new ExecutorService({
    repoStore, dispatchStore, executorStore: { getActiveRun: () => null, updateStatus: () => {}, create: () => {} } as any, dataDir: tempDir, windowsAdapter: fakeExecutor as any
  });
  const loop = new LoopService({ repoStore, dispatchStore, runStore, browserManager: browser, executorService: executorService as any, solControlStore: undefined });
  wireSolStalled(browser, runStore);
  const repoId = "repo-solop";
  const repo: RepositoryRecord = {
    id: repoId, displayName: "SolOp Repo", githubRemote: "https://example.com/r.git", localPath: os.tmpdir(),
    environment: "windows", wslDistribution: null, executorCli: "fake", executorModel: "m",
    solConversationUrl: "https://chatgpt.com/c/solop", maxIterations: 5, maxRuntimeMinutes: 480,
    enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  repoStore.create(repo);
  return { dbCtx, repoStore, dispatchStore, runStore, wakeStore, solStore, browser, loop, mockDriver, repoId };
}

/** Simulate a controller restart: fresh BrowserManager + LoopService over the SAME db file. */
function restart(svc: Services, tempDir: string): Services {
  try { svc.dbCtx.close(); } catch {}
  const dbPath = path.join(tempDir, "test.sqlite");
  const dbCtx = initDatabase(dbPath);
  const repoStore = new RepositoryStore(dbCtx.db);
  const dispatchStore = new DispatchStore(dbCtx.db);
  const runStore = new RunStore(dbCtx.db);
  const wakeStore = new SolWakeStore(dbCtx.db);
  const solStore = new SqliteSolOperationStore(dbCtx.db);
  const mockDriver = new MockBrowserDriver();
  const fakeExecutor = new FakeExecutorAdapter({ durationMs: 10 });
  const browser = new BrowserManager({ dataDir: tempDir, driver: mockDriver, wakeStore, solOperationStore: solStore, solTimeoutMs: 600000 });
  const executorService = new ExecutorService({
    repoStore, dispatchStore, executorStore: { getActiveRun: () => null, updateStatus: () => {}, create: () => {} } as any, dataDir: tempDir, windowsAdapter: fakeExecutor as any
  });
  const loop = new LoopService({ repoStore, dispatchStore, runStore, browserManager: browser, executorService: executorService as any, solControlStore: undefined });
  wireSolStalled(browser, runStore);
  return { dbCtx, repoStore, dispatchStore, runStore, wakeStore, solStore, browser, loop, mockDriver, repoId: svc.repoId };
}

/** Wire the Sol-stalled handler so durable operations can actually move the run to SOL_STALLED. */
function wireSolStalled(browser: BrowserManager, runStore: RunStore): void {
  browser.setSolStalledHandler((_repoId, runId, msg) => {
    try {
      const r = runStore.get(runId);
      if (r && r.status !== "SOL_STALLED") {
        runStore.updateStatus(runId, "SOL_STALLED", { lastError: msg, finishedAt: new Date().toISOString() });
      }
    } catch {}
  });
}

function setRunReviewing(svc: Services, runId: string): void {
  svc.runStore.updateStatus(runId, "SOL_REVIEWING");
}

describe("Sol operation restart durability (item #1)", () => {
  let tempDir: string;
  let svc: Services;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-solop-"));
    svc = buildServices(tempDir);
  });
  afterEach(() => {
    try { svc.dbCtx.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("persisted INITIAL wake reconstructs as INITIAL (never guessed)", async () => {
    const run = await svc.loop.startRun(svc.repoId, { goal: "init" });
    setRunReviewing(svc, run.id);

    const restarted = restart(svc, tempDir);
    await restarted.browser.rehydrateFromStore(restarted.runStore as any, { repoIds: [svc.repoId] });

    const op = restarted.solStore.get(svc.repoId)!;
    expect(op).toBeTruthy();
    expect(op.resultStatus).toBe("INITIAL");
    expect(op.repositoryName).toBe("SolOp Repo");
    expect(op.iteration).toBe(0);
    // No resubmit occurred (within deadline): single wake, original submittedAt.
    const wakes = restarted.wakeStore.getByRepository(svc.repoId);
    expect(wakes.length).toBe(1);
    expect(wakes[0]!.status).toBe("submitted");
  });

  it("post-executor COMPLETED wake reconstructs as COMPLETED, never INITIAL", async () => {
    const run = await svc.loop.startRun(svc.repoId, { goal: "completed" });
    // Overwrite the intent with a COMPLETED wake for the same run (simulates executor turn done).
    await svc.browser.submitSolWake(svc.repoId, {
      runId: run.id, iteration: 1, dispatchId: null, resultStatus: "COMPLETED",
      conversationUrl: "https://chatgpt.com/c/solop", repositoryName: "SolOp Repo"
    });
    setRunReviewing(svc, run.id);

    const restarted = restart(svc, tempDir);
    await restarted.browser.rehydrateFromStore(restarted.runStore as any, { repoIds: [svc.repoId] });

    const op = restarted.solStore.get(svc.repoId)!;
    expect(op.resultStatus).toBe("COMPLETED");
    expect(op.iteration).toBe(1);
    expect(op.dispatchId).toBe(null);
    expect(op.message).toMatch(/COMPLETED/);
  });

  it.each(["BLOCKED", "NEEDS_HUMAN", "FAILED"] as SolWakeResultStatus[])(
    "resultStatus %s survives restart exactly",
    async (status) => {
      const run = await svc.loop.startRun(svc.repoId, { goal: String(status) });
      await svc.browser.submitSolWake(svc.repoId, {
        runId: run.id, iteration: 2, dispatchId: null, resultStatus: status as SolWakeResultStatus,
        conversationUrl: "https://chatgpt.com/c/solop", repositoryName: "SolOp Repo"
      });
      setRunReviewing(svc, run.id);

      const restarted = restart(svc, tempDir);
      await restarted.browser.rehydrateFromStore(restarted.runStore as any, { repoIds: [svc.repoId] });
      expect(restarted.solStore.get(svc.repoId)!.resultStatus).toBe(status);
    }
  );

  it("restart before timeout resumes waiting without resubmitting the wake", async () => {
    const run = await svc.loop.startRun(svc.repoId, { goal: "before-timeout" });
    setRunReviewing(svc, run.id);
    const before = svc.wakeStore.getByRepository(svc.repoId)[0]!.submittedAt!;

    const restarted = restart(svc, tempDir);
    await restarted.browser.rehydrateFromStore(restarted.runStore as any, { repoIds: [svc.repoId] });

    const after = restarted.wakeStore.getByRepository(svc.repoId)[0]!.submittedAt!;
    expect(after).toBe(before); // no new submit
    expect(restarted.wakeStore.getByRepository(svc.repoId).length).toBe(1);
    const op = restarted.solStore.get(svc.repoId)!;
    expect(op.deadline).toBeGreaterThan(Date.now()); // still within original deadline
  });

  it("restart after first timeout performs exactly one retry, never more", async () => {
    const run = await svc.loop.startRun(svc.repoId, { goal: "after-timeout" });
    setRunReviewing(svc, run.id);
    // Simulate the first deadline having passed with no transition, before restart.
    svc.solStore.update(svc.repoId, { deadline: Date.now() - 1000, timeoutRetryCount: 0 });

    const restarted = restart(svc, tempDir);
    await restarted.browser.rehydrateFromStore(restarted.runStore as any, { repoIds: [svc.repoId] });

    const op = restarted.solStore.get(svc.repoId)!;
    expect(op.timeoutRetryCount).toBe(1); // exactly one retry performed
    expect(op.deadline).toBeGreaterThan(Date.now()); // new deadline armed

    // A second restart must NOT grant another retry (budget already consumed).
    const again = restart(restarted, tempDir);
    await again.browser.rehydrateFromStore(again.runStore as any, { repoIds: [svc.repoId] });
    expect(again.solStore.get(svc.repoId)!.timeoutRetryCount).toBe(1);
  });

  it("repeated restarts cannot grant additional retries; exhausted -> SOL_STALLED", async () => {
    const run = await svc.loop.startRun(svc.repoId, { goal: "stalled" });
    setRunReviewing(svc, run.id);
    // Both deadlines effectively passed, budget already spent.
    svc.solStore.update(svc.repoId, { deadline: Date.now() - 1000, timeoutRetryCount: 1 });

    const restarted = restart(svc, tempDir);
    await restarted.browser.rehydrateFromStore(restarted.runStore as any, { repoIds: [svc.repoId] });

    expect(restarted.solStore.get(svc.repoId)!.status).toBe("stalled");
    expect(restarted.runStore.get(run.id)!.status).toBe("SOL_STALLED");

    // Another restart still cannot increment the budget.
    const again = restart(restarted, tempDir);
    await again.browser.rehydrateFromStore(again.runStore as any, { repoIds: [svc.repoId] });
    expect(again.solStore.get(svc.repoId)!.timeoutRetryCount).toBe(1);
  });
});

describe("BUSY backpressure restart safety (item #3)", () => {
  let tempDir: string;
  let svc: Services;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-busy-"));
    svc = buildServices(tempDir);
    svc.mockDriver.forceBusy = true;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    try { svc.dbCtx.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it("BUSY retry budget is persisted and bounded across restarts; run never stuck forever", async () => {
    // Create an active run in SOL_REVIEWING and a BUSY wake directly (no faked loop busy timer yet).
    const runId = (await import("node:crypto")).randomUUID();
    const now = new Date().toISOString();
    svc.runStore.create({
      id: runId, repositoryId: svc.repoId, goal: "busy", status: "SOL_REVIEWING",
      currentIteration: 0, maxIterations: 5, activeDispatchId: null, lastError: null,
      startedAt: now, finishedAt: null, createdAt: now, updatedAt: now, drainReason: null
    });

    const wake = await svc.browser.submitSolWake(svc.repoId, {
      runId, iteration: 0, dispatchId: null, resultStatus: "INITIAL",
      conversationUrl: "https://chatgpt.com/c/solop", repositoryName: "SolOp Repo"
    });
    expect(wake.status).toBe("busy");
    expect(svc.solStore.get(svc.repoId)!.busyRetryCount).toBe(1);

    // Restart: budget preserved (not reset to 0).
    const r1 = restart(svc, tempDir);
    r1.mockDriver.forceBusy = true;
    await r1.browser.rehydrateFromStore(r1.runStore as any, { repoIds: [svc.repoId] });
    r1.loop.rehydrateBusyBackpressure();
    expect(r1.solStore.get(svc.repoId)!.busyRetryCount).toBe(1);

    // Drive the durable BUSY retry schedule forward. Each advance fires exactly one pending retry.
    for (let i = 0; i < BUSY_MAX_RETRIES; i++) {
      await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS + 1);
    }

    // Budget reached the cap and the run is SOL_STALLED (not stuck in SOL_REVIEWING).
    const finalCount = r1.solStore.get(svc.repoId)!.busyRetryCount;
    expect(finalCount).toBeLessThanOrEqual(BUSY_MAX_RETRIES);
    expect(r1.runStore.get(runId)!.status).toBe("SOL_STALLED");

    // Another restart cannot grant additional retries.
    const r2 = restart(r1, tempDir);
    r2.mockDriver.forceBusy = true;
    await r2.browser.rehydrateFromStore(r2.runStore as any, { repoIds: [svc.repoId] });
    r2.loop.rehydrateBusyBackpressure();
    expect(r2.solStore.get(svc.repoId)!.busyRetryCount).toBe(finalCount);
  });
});
