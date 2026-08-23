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
import type { RepositoryRecord } from "@orca/shared";

const REPO_ID = "repo-stall";

function makeRepo(): RepositoryRecord {
  return {
    id: REPO_ID,
    displayName: "Stall Closure Repo",
    githubRemote: "https://example.com/r.git",
    localPath: os.tmpdir(),
    environment: "windows",
    wslDistribution: null,
    executorCli: "fake-generic-cli",
    executorModel: "m",
    solConversationUrl: "https://chatgpt.com/c/stall",
    maxIterations: 10,
    maxRuntimeMinutes: 480,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Change 024: Sol control closure of stalled campaigns", () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-stall-"));
    dbCtx = initDatabase(path.join(tempDir, "test.sqlite"));
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);
    solControlStore = new SolControlStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    repoStore.create(makeRepo());
    mockDriver = new MockBrowserDriver();
    fakeExecutor = new FakeExecutorAdapter({ durationMs: 20 });
    browser = new BrowserManager({
      dataDir: tempDir,
      driver: mockDriver,
      wakeStore: wakeStore as any,
      solTimeoutMs: 60000,
    });
    const execService = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore: {
        getActiveRun: () => null,
        updateStatus: () => {},
        create: () => {},
      } as any,
      dataDir: tempDir,
      windowsAdapter: fakeExecutor as any,
    });
    loop = new LoopService({
      repoStore,
      dispatchStore,
      runStore,
      browserManager: browser,
      executorService: execService as any,
      solControlStore,
    });
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Start a run through the real loop, then force it into SOL_STALLED. */
  async function startAndStallRun(goal: string): Promise<string> {
    const run = await loop.startRun(REPO_ID, { goal });
    expect(run.status).toBe("SOL_REVIEWING");
    runStore.updateStatus(run.id, "SOL_STALLED", {
      lastError: "Sol operation timed out (test stall)",
      finishedAt: new Date().toISOString(),
    });
    expect(runStore.get(run.id)?.status).toBe("SOL_STALLED");
    // getActiveRun must never surface SOL_STALLED (unchanged semantics).
    expect(runStore.getActiveRun(REPO_ID)).toBeNull();
    return run.id;
  }

  function seedControl(
    overrides: Partial<
      Parameters<typeof solControlStore.create>[0]
    > & { id: string },
  ): string {
    solControlStore.create({
      id: overrides.id,
      repositoryId: overrides.repositoryId ?? REPO_ID,
      runId: overrides.runId ?? "unknown-run",
      controlId: overrides.id,
      decision: overrides.decision ?? "GOAL_COMPLETE",
      iteration: overrides.iteration ?? 0,
      commitSha: "c".repeat(40),
      relatedDispatchId: overrides.relatedDispatchId ?? null,
      status: "detected",
      rejectionReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return overrides.id;
  }

  it("matching GOAL_COMPLETE closes the latest SOL_STALLED run and consumes the control", async () => {
    const runId = await startAndStallRun("stalled closure");
    const pagesBefore = mockDriver.history.size;
    const cid = seedControl({
      id: "ctrl-stall-goal",
      runId,
      iteration: 0,
      relatedDispatchId: null,
    });

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", runId);

    expect(solControlStore.get(cid)?.status).toBe("consumed");
    const closed = runStore.get(runId)!;
    expect(closed.status).toBe("GOAL_COMPLETE");
    expect(closed.finishedAt).toBeTruthy();
    expect(closed.drainReason).toBeNull();
    // Still excluded from active ownership; no actor resurrection.
    expect(runStore.getActiveRun(REPO_ID)).toBeNull();
    expect(mockDriver.history.size).toBe(pagesBefore);
    expect(fakeExecutor.lastContext).toBeNull();
    expect(fakeExecutor.lastSpawned).toBeNull();
  });

  it("BLOCKED and NEEDS_HUMAN also close the stalled run", async () => {
    for (const decision of ["BLOCKED", "NEEDS_HUMAN"] as const) {
      const runId = await startAndStallRun(`stalled ${decision}`);
      const cid = seedControl({
        id: `ctrl-stall-${decision}`,
        runId,
        iteration: 0,
        relatedDispatchId: null,
        decision,
      });

      await loop.onControlDetected(REPO_ID, cid, decision, runId);

      expect(solControlStore.get(cid)?.status).toBe("consumed");
      expect(runStore.get(runId)?.status).toBe(decision);
      // Stall-time finishedAt is preserved for non-GOAL_COMPLETE decisions.
      expect(runStore.get(runId)?.finishedAt).toBeTruthy();
      expect(runStore.getActiveRun(REPO_ID)).toBeNull();
      expect(fakeExecutor.lastContext).toBeNull();
    }
  });

  it("PAUSED is rejected and the run stays SOL_STALLED; executor pause is never invoked", async () => {
    const runId = await startAndStallRun("stalled pause");
    let pauseInvoked = false;
    (loop as any).executorService.pauseRun = async () => {
      pauseInvoked = true;
    };
    const cid = seedControl({
      id: "ctrl-stall-pause",
      runId,
      iteration: 0,
      relatedDispatchId: null,
      decision: "PAUSED",
    });

    await loop.onControlDetected(REPO_ID, cid, "PAUSED", runId);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(solControlStore.get(cid)?.rejectionReason).toContain(
      "SOL_STALLED_PAUSE_UNSUPPORTED",
    );
    expect(runStore.get(runId)?.status).toBe("SOL_STALLED");
    expect(pauseInvoked).toBe(false);
  });

  it("a newer active campaign prevents old-stalled-run closure", async () => {
    const oldRunId = await startAndStallRun("old stalled campaign");
    // A newer campaign starts while the old one stays stalled.
    const newRun = await loop.startRun(REPO_ID, { goal: "newer campaign" });
    expect(newRun.status).toBe("SOL_REVIEWING");
    expect(runStore.get(oldRunId)?.status).toBe("SOL_STALLED");

    const cid = seedControl({
      id: "ctrl-old-stall-goal",
      runId: oldRunId,
      iteration: 0,
      relatedDispatchId: null,
    });

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", oldRunId);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(solControlStore.get(cid)?.rejectionReason).toContain(
      `does not match active run ${newRun.id}`,
    );
    expect(runStore.get(oldRunId)?.status).toBe("SOL_STALLED");
    expect(runStore.get(newRun.id)?.status).toBe("SOL_REVIEWING");
  });

  it("a control referencing a non-latest stalled run is rejected (latest exact match only)", async () => {
    const olderStalledId = await startAndStallRun("older stalled");
    const latestStalledId = await startAndStallRun("latest stalled");
    expect(latestStalledId).not.toBe(olderStalledId);

    const cid = seedControl({
      id: "ctrl-older-stall",
      runId: olderStalledId,
      iteration: 0,
      relatedDispatchId: null,
    });

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", olderStalledId);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(solControlStore.get(cid)?.rejectionReason).toContain(
      "no active run for repository",
    );
    expect(runStore.get(olderStalledId)?.status).toBe("SOL_STALLED");
    expect(runStore.get(latestStalledId)?.status).toBe("SOL_STALLED");
  });

  it("wrong iteration is rejected on the stalled path", async () => {
    const runId = await startAndStallRun("stalled wrong iter");
    const cid = seedControl({
      id: "ctrl-stall-wrongiter",
      runId,
      iteration: 7,
      relatedDispatchId: null,
    });

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", runId);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(solControlStore.get(cid)?.rejectionReason).toContain(
      "does not match expected Sol iteration 0",
    );
    expect(runStore.get(runId)?.status).toBe("SOL_STALLED");
  });

  it("wrong relatedDispatchId is rejected on the stalled path", async () => {
    const runId = await startAndStallRun("stalled wrong dispatch");
    if (!dispatchStore.get("disp-stalled-x")) {
      dispatchStore.create({
        id: "disp-stalled-x",
        dispatchId: "disp-stalled-x",
        repositoryId: REPO_ID,
        runId,
        iteration: 1,
        commitSha: "a".repeat(40),
        baseSha: "b".repeat(40),
        changePath: "p",
        goal: "g",
        instructionsVersion: 1,
        schemaVersion: 1,
        type: "dispatch",
        status: "detected",
        rejectionReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    runStore.updateStatus(runId, "SOL_STALLED", {
      activeDispatchId: "disp-stalled-x",
    });
    const cid = seedControl({
      id: "ctrl-stall-wrongdisp",
      runId,
      iteration: 0,
      relatedDispatchId: "disp-something-else",
    });

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", runId);

    expect(solControlStore.get(cid)?.status).toBe("rejected");
    expect(solControlStore.get(cid)?.rejectionReason).toContain(
      "does not match active dispatch disp-stalled-x",
    );
    expect(runStore.get(runId)?.status).toBe("SOL_STALLED");
  });

  it("duplicate delivery remains idempotent after stalled closure", async () => {
    const runId = await startAndStallRun("stalled duplicate");
    const cid = seedControl({
      id: "ctrl-stall-dup",
      runId,
      iteration: 0,
      relatedDispatchId: null,
    });

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", runId);
    expect(runStore.get(runId)?.status).toBe("GOAL_COMPLETE");
    expect(solControlStore.get(cid)?.status).toBe("consumed");

    await loop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", runId);

    expect(solControlStore.get(cid)?.status).toBe("consumed");
    expect(runStore.get(runId)?.status).toBe("GOAL_COMPLETE");
    expect(fakeExecutor.lastContext).toBeNull();
  });

  it("closure publishes a durable audit event identifying the stalled target", async () => {
    const events: any[] = [];
    const auditedLoop = new LoopService({
      repoStore,
      dispatchStore,
      runStore,
      browserManager: browser,
      executorService: (loop as any).executorService,
      solControlStore,
      eventPublisher: (event) => events.push(event),
    });
    const run = await auditedLoop.startRun(REPO_ID, { goal: "audited" });
    runStore.updateStatus(run.id, "SOL_STALLED", {
      lastError: "stall",
      finishedAt: new Date().toISOString(),
    });
    const cid = seedControl({
      id: "ctrl-stall-audit",
      runId: run.id,
      iteration: 0,
      relatedDispatchId: null,
    });

    await auditedLoop.onControlDetected(REPO_ID, cid, "GOAL_COMPLETE", run.id);

    const applied = events.find((e) => e.type === "loop.control_applied");
    expect(applied).toBeTruthy();
    expect(applied.data.controlId).toBe(cid);
    expect(applied.data.runId).toBe(run.id);
    expect(applied.data.decision).toBe("GOAL_COMPLETE");
    expect(applied.data.targetWasStalled).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "loop.state_changed" &&
          e.data.loopState === "GOAL_COMPLETE",
      ),
    ).toBe(true);
  });

  it("releaseTerminalTimers clears wall-clock and busy timers when a run stalls", async () => {
    const run = await loop.startRun(REPO_ID, { goal: "timer hygiene" });
    // Wall-clock timer armed by startRun.
    expect((loop as any).wallClockTimers.has(REPO_ID)).toBe(true);
    runStore.updateStatus(run.id, "SOL_STALLED", {
      lastError: "stall",
      finishedAt: new Date().toISOString(),
    });
    loop.releaseTerminalTimers(REPO_ID);
    expect((loop as any).wallClockTimers.has(REPO_ID)).toBe(false);
    expect((loop as any).busyRetryTimers.has(REPO_ID)).toBe(false);
  });
});
