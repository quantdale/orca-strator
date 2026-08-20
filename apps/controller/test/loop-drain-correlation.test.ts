import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { SolControlStore } from "../src/watcher/sol-control-store.js";
import { LoopService } from "../src/loop/loop-service.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

function makeRepo(): RepositoryRecord {
  return {
    id: "repo-drain",
    displayName: "Drain Repo",
    githubRemote: "https://example.com/r.git",
    localPath: os.tmpdir(),
    environment: "windows",
    wslDistribution: null,
    executorCli: "fake-generic-cli",
    executorModel: "m",
    solConversationUrl: "https://chatgpt.com/c/drain",
    maxIterations: 10,
    maxRuntimeMinutes: 480,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeDispatch(overrides: Partial<DispatchRecord> & { id: string }): DispatchRecord {
  return {
    dispatchId: overrides.id,
    repositoryId: overrides.repositoryId ?? "repo-drain",
    runId: overrides.runId ?? "run-1",
    iteration: overrides.iteration ?? 1,
    commitSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    changePath: "openspec/changes/009",
    goal: "g",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: overrides.status ?? "detected",
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as DispatchRecord;
}

describe("LoopService drain + correlation (#1,#2,#16)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let runStore: RunStore;
  let solControlStore: SolControlStore;
  let wakeStore: SolWakeStore;
  let loop: LoopService;
  let browser: BrowserManager;
  let mockDriver: MockBrowserDriver;
  let fakeExecutor: FakeExecutorAdapter;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-drain-"));
    dbCtx = initDatabase(path.join(tempDir, "test.sqlite"));
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);
    solControlStore = new SolControlStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    repoStore.create(makeRepo());
    mockDriver = new MockBrowserDriver();
    fakeExecutor = new FakeExecutorAdapter({ durationMs: 20 });
    browser = new BrowserManager({ dataDir: tempDir, driver: mockDriver, wakeStore: wakeStore as any, solTimeoutMs: 60000 });
    const execService = new ExecutorService({ repoStore, dispatchStore, executorStore: { getActiveRun: () => null, updateStatus: () => {}, create: () => {} } as any, dataDir: tempDir, windowsAdapter: fakeExecutor as any });
    loop = new LoopService({ repoStore, dispatchStore, runStore, browserManager: browser, executorService: execService as any, solControlStore });
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Stop during SOL_REVIEWING -> Sol sends dispatch -> STOPPED without launching executor", async () => {
    const run = await loop.startRun("repo-drain", { goal: "stop drain" });
    expect(run.status).toBe("SOL_REVIEWING");
    await loop.stopRun("repo-drain");
    expect(loop.getStatus("repo-drain").state).toBe("DRAINING");
    // Sol sends valid next dispatch: iteration = currentIteration+1
    const disp = makeDispatch({ id: "disp-stop-1", runId: run.id, iteration: run.currentIteration + 1 });
    dispatchStore.create(disp);
    await loop.onDispatchDetected("repo-drain", disp.id);
    expect(dispatchStore.get(disp.id)?.status).toBe("consumed");
    expect(loop.getStatus("repo-drain").state).toBe("IDLE"); // STOPPED collapsed to IDLE
    expect(runStore.get(run.id)?.status).toBe("STOPPED");
    expect(fakeExecutor.lastSpawned).toBeNull?.() ?? expect(fakeExecutor.lastContext).toBeNull();
  });

  it("Wall-clock ceiling during SOL_REVIEWING -> dispatch -> CEILING_REACHED", async () => {
    const run = await loop.startRun("repo-drain", { goal: "ceiling drain" });
    // Force wall-clock ceiling state
    runStore.updateStatus(run.id, "DRAINING", { drainReason: "WALL_CLOCK_CEILING" });
    (loop as any).ceilingPending.add("repo-drain");
    const disp = makeDispatch({ id: "disp-ceil-1", runId: run.id, iteration: run.currentIteration + 1 });
    dispatchStore.create(disp);
    await loop.onDispatchDetected("repo-drain", disp.id);
    expect(runStore.get(run.id)?.status).toBe("CEILING_REACHED");
  });

  it("stale dispatch from old runId does not launch executor nor close Sol operation", async () => {
    const run1 = await loop.startRun("repo-drain", { goal: "first" });
    // Simulate a second run after first completed (use direct DB to avoid state machine for test brevity)
    // Instead test within same run: old runId mismatch
    const stale = makeDispatch({ id: "disp-stale", runId: "old-run-id", iteration: 1 });
    dispatchStore.create(stale);
    // active run is run1; stale has wrong runId so should be rejected
    await loop.onDispatchDetected("repo-drain", stale.id);
    expect(dispatchStore.get(stale.id)?.status).toBe("detected"); // not consumed
    expect(loop.getStatus("repo-drain").state).toBe("SOL_REVIEWING");
  });

  it("future iteration dispatch is rejected", async () => {
    const run = await loop.startRun("repo-drain", { goal: "future iter" });
    const future = makeDispatch({ id: "disp-future", runId: run.id, iteration: 99 });
    dispatchStore.create(future);
    await loop.onDispatchDetected("repo-drain", future.id);
    expect(dispatchStore.get(future.id)?.status).toBe("detected");
  });

  it("Stop during slow wake submission does not overwrite DRAINING with SOL_REVIEWING (race #16)", async () => {
    // Use a slow mock driver to create a race window: submitSolWake is async
    class SlowDriver extends MockBrowserDriver {
      override async openPage(id: string, url: string) {
        await new Promise((r) => setTimeout(r, 80));
        return super.openPage(id, url);
      }
    }
    const slowDriver = new SlowDriver();
    const slowBrowser = new BrowserManager({ dataDir: tempDir, driver: slowDriver, wakeStore: wakeStore as any, solTimeoutMs: 60000 });
    const slowLoop = new LoopService({ repoStore, dispatchStore, runStore, browserManager: slowBrowser, executorService: new ExecutorService({ repoStore, dispatchStore, executorStore: { getActiveRun: () => null, updateStatus: () => {}, create: () => {} } as any, dataDir: tempDir, windowsAdapter: fakeExecutor as any }), solControlStore });
    const run2 = await slowLoop.startRun("repo-drain", { goal: "race" });
    // Start a wake in background then immediately stop
    const wakePromise = (slowLoop as any).submitSolWakeForRun("repo-drain", runStore.get(run2.id)!, "INITIAL");
    await slowLoop.stopRun("repo-drain");
    await wakePromise;
    // Final state must respect Stop priority: DRAINING, not SOL_REVIEWING
    expect(["DRAINING", "STOPPED", "IDLE"].includes(slowLoop.getStatus("repo-drain").state)).toBe(true);
    expect(slowLoop.getStatus("repo-drain").state).not.toBe("SOL_REVIEWING");
  });

  function seedControl(overrides: Partial<Parameters<typeof solControlStore.create>[0]> & { id: string }): string {
    const controlId = overrides.id;
    solControlStore.create({
      id: controlId,
      repositoryId: "repo-drain",
      runId: overrides.runId ?? "run-1",
      controlId,
      decision: overrides.decision ?? "GOAL_COMPLETE",
      iteration: overrides.iteration ?? 1,
      commitSha: "c".repeat(40),
      relatedDispatchId: overrides.relatedDispatchId ?? null,
      status: "detected",
      rejectionReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return controlId;
  }

  function ensureDispatch(did: string): void {
    if (dispatchStore.get(did)) return;
    dispatchStore.create({
      id: did, dispatchId: did, repositoryId: "repo-drain", runId: "run-1",
      iteration: 1, commitSha: "a".repeat(40), baseSha: "b".repeat(40),
      changePath: "p", goal: "g", instructionsVersion: 1, schemaVersion: 1,
      type: "dispatch", status: "detected", rejectionReason: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
  }

  function setRunReviewing(runId: string, currentIteration: number, activeDispatchId: string | null): void {
    if (activeDispatchId) ensureDispatch(activeDispatchId);
    const run = runStore.get(runId)!;
    runStore.updateStatus(runId, "SOL_REVIEWING", {
      currentIteration,
      activeDispatchId,
      drainReason: run.drainReason
    });
  }

  it("valid Sol control (matching run/iteration/dispatch) is consumed and applied", async () => {
    const run = await loop.startRun("repo-drain", { goal: "valid control" });
    setRunReviewing(run.id, 1, "disp-x");
    const cid = seedControl({ id: "ctrl-valid", runId: run.id, iteration: 1, relatedDispatchId: "disp-x", decision: "GOAL_COMPLETE" });

    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", run.id);

    expect(solControlStore.get(cid)?.status).toBe("consumed");
    expect(runStore.get(run.id)?.status).toBe("GOAL_COMPLETE");
  });

  it("previous-iteration GOAL_COMPLETE is rejected (stale) and does not change run state", async () => {
    const run = await loop.startRun("repo-drain", { goal: "prev iter" });
    setRunReviewing(run.id, 1, "disp-x");
    const cid = seedControl({ id: "ctrl-prev", runId: run.id, iteration: 0, relatedDispatchId: "disp-x" });

    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", run.id);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(runStore.get(run.id)?.status).toBe("SOL_REVIEWING");
  });

  it("future-iteration control is rejected and does not change run state", async () => {
    const run = await loop.startRun("repo-drain", { goal: "future iter" });
    setRunReviewing(run.id, 1, "disp-x");
    const cid = seedControl({ id: "ctrl-future", runId: run.id, iteration: 99, relatedDispatchId: "disp-x" });

    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", run.id);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(runStore.get(run.id)?.status).toBe("SOL_REVIEWING");
  });

  it("control for a different run is rejected (wrong runId)", async () => {
    const run = await loop.startRun("repo-drain", { goal: "wrong run" });
    setRunReviewing(run.id, 1, "disp-x");
    const cid = seedControl({ id: "ctrl-wrongrun", runId: "some-other-run", iteration: 1, relatedDispatchId: "disp-x" });

    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", "some-other-run");

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(runStore.get(run.id)?.status).toBe("SOL_REVIEWING");
  });

  it("control with wrong relatedDispatchId is rejected", async () => {
    const run = await loop.startRun("repo-drain", { goal: "wrong dispatch" });
    setRunReviewing(run.id, 1, "disp-x");
    const cid = seedControl({ id: "ctrl-wrongdisp", runId: run.id, iteration: 1, relatedDispatchId: "disp-other" });

    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", run.id);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(runStore.get(run.id)?.status).toBe("SOL_REVIEWING");
  });

  it("duplicated control is a no-op: already-consumed control is not re-applied", async () => {
    const run = await loop.startRun("repo-drain", { goal: "dup control" });
    setRunReviewing(run.id, 1, "disp-x");
    const cid = seedControl({ id: "ctrl-dup", runId: run.id, iteration: 1, relatedDispatchId: "disp-x" });

    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", run.id);
    expect(solControlStore.get(cid)?.status).toBe("consumed");
    expect(runStore.get(run.id)?.status).toBe("GOAL_COMPLETE");

    // Second delivery must not re-apply (e.g., must not resurrect/alter state).
    await loop.onControlDetected("repo-drain", cid, "GOAL_COMPLETE", run.id);
    expect(solControlStore.get(cid)?.status).toBe("consumed");
  });
});
