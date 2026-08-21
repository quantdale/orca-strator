/**
 * R16 / Change 017 task 5.3 — Real campaign-level controls qualification for
 * SWARM and DAG strategy actors (real deterministic child-process workers,
 * production buildApp lifecycle).
 *
 * Every control is driven ONLY through the normal campaign seams:
 *   - `app.fastify.inject` on the runs/campaign control routes
 *     (POST /api/repositories/:id/runs/{start,pause,resume,stop},
 *     POST /api/repositories/:id/campaigns/:runId/{swarm,dag}/start),
 *   - public LoopService control methods where no HTTP route exists today
 *     (`loopService.emergencyKill`, `loopService.checkWallClockCeiling` — the
 *     same ceiling mechanic as real-runtime-controls.test.ts),
 *   - the production lifecycle seam (`app.fastify.close()` + rebuild via
 *     `buildApp` on the same dbPath/dataDir) for restart recovery.
 * The per-strategy control endpoints and direct SwarmExecutionService /
 * DagExecutionService control calls are never used.
 *
 * Runs under the `test:real` tier. Deterministic workers come from
 * ORCA_SWARM_TEST_HARNESS (fixtures/swarm-worker-harness.mjs) with
 * ORCA_SWARM_HARNESS_SLOW_MS slow mode. No inference, no fixed sleeps: every
 * wait polls durable state.
 *
 * ============================================================================
 * PRODUCTION BUGS THIS QUALIFICATION CAUGHT (all four FIXED in Change 017).
 * Each was reproduced against the initial Change 017 working tree and fixed
 * centrally before these scenarios were enabled.
 *
 * BUG-017-DISPATCH-PERSISTENCE (FIXED) — DispatchStore dropped
 *   `strategy`/`executionPlan`. Fix: migration 22 adds dispatches.strategy +
 *   execution_plan_json; DispatchStore round-trips them; the watcher copies
 *   them from the parsed marker so resolveStrategy() sees the real selection.
 *
 * BUG-017-MANUAL-START-SINGLE-AGENT (FIXED) — manual strategy start routes
 *   passed a null dispatch so coordinator.start resolved SINGLE_AGENT.
 *   Fix: start() takes an explicit strategy parameter and /swarm/start and
 *   /dag/start pass "SWARM"/"DAG".
 *
 * BUG-017-COMPLETION-BRIDGE (FIXED) — strategy completion never reached the
 *   loop because no code invoked hooks.onCompleted. Fix: executeRecord invokes
 *   it for every terminal status and failStrategy for FAILED, both
 *   teardown-guarded, so applyIterationCompletion runs and Sol handoff happens.
 *
 * BUG-017-PUBLISH-MANIFEST-ENOENT (FIXED) — publishToRemote wrote
 *   `.orca/results/<id>.json` without creating the directory first, so a
 *   repository whose first-ever iteration is a strategy dispatch got a BLOCKED
 *   publish (ENOENT). Fix: recursive mkdir before the manifest write.
 *
 * BUG-017-DAG-RESUME-STALE-DEPENDENCY-SKIP (FIXED) — on RESUME, executeRecord's
 *   dependency gate consulted stale pre-pause result records: a pending
 *   dependency whose last stored result was not COMPLETED caused its dependent
 *   to be recorded SKIPPED_DEPENDENCY permanently. Fix: the launch loop now
 *   waits for any dependency still in `pending` instead of consulting its
 *   stored result; SCENARIO 6 proves pause/resume reaches COMPLETED.
 * ============================================================================
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type {
  DispatchExecutionPlan,
  ExecutionStrategy,
  RepositoryRecord,
  RunRecord,
  WorkPacket,
} from "@orca/shared";

const HARNESS_PATH = path.resolve(__dirname, "fixtures", "swarm-worker-harness.mjs");
const oldHarness = process.env.ORCA_SWARM_TEST_HARNESS;
if (!oldHarness) process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
afterAll(() => {
  if (oldHarness === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
  else process.env.ORCA_SWARM_TEST_HARNESS = oldHarness;
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Condition-based wait polling durable state only. */
async function waitFor(fn: () => boolean, timeoutMs: number, everyMs = 150): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start <= timeoutMs) {
    try {
      if (fn()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(everyMs);
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms${lastError ? ` (last error: ${String(lastError)})` : ""}`
  );
}

/** Assert an invariant keeps holding for a bounded observation window. */
async function expectStable(fn: () => void, windowMs: number, everyMs = 250): Promise<void> {
  const end = Date.now() + windowMs;
  while (Date.now() < end) {
    fn();
    await sleep(everyMs);
  }
}

function makeBareAndClone(tempDir: string, label: string) {
  const bareDir = path.join(tempDir, `${label}-remote.git`);
  const cloneDir = path.join(tempDir, `${label}-clone`);
  fs.mkdirSync(bareDir, { recursive: true });
  fs.mkdirSync(cloneDir, { recursive: true });
  git(bareDir, ["init", "--bare", "-b", "main"]);
  git(cloneDir, ["init", "-b", "main"]);
  git(cloneDir, ["config", "user.email", "orca-strategy-controls@example.com"]);
  git(cloneDir, ["config", "user.name", "Orca Strategy Controls"]);
  git(cloneDir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(cloneDir, "README.md"), `# Strategy controls fixture ${label}\n`);
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", "initial"]);
  git(cloneDir, ["remote", "add", "origin", bareDir]);
  git(cloneDir, ["push", "-u", "origin", "main"]);
  return { bareDir, cloneDir };
}

/** Create the repository through the app seam and return its durable record. */
function createRepo(app: AppInstance, data: { bareDir: string; cloneDir: string }, name: string): RepositoryRecord {
  return app.repositoryService.createRepository({
    displayName: name,
    githubRemote: data.bareDir,
    localPath: data.cloneDir,
    environment: "windows",
    wslDistribution: null,
    executorCli: "orca-swarm-test-harness",
    executorModel: "deterministic-test-model",
    solConversationUrl: "https://chatgpt.com/c/strategy-controls-test",
    maxIterations: 5,
    maxRuntimeMinutes: 480,
    enabled: true
  });
}

/**
 * Pre-create a durable work packet for iteration 1. The campaign starts at
 * currentIteration 0; the dispatch advances it to 1 before the strategy
 * validates packet/iteration correlation, so packets are created against a
 * run view pinned to iteration 1 (the iteration the marker authorizes).
 */
function createPacket(
  app: AppInstance,
  repo: RepositoryRecord,
  run: RunRecord,
  workstream: string,
  dependencies: string[] = []
): WorkPacket {
  return app.workPacketService.create(repo, { ...run, currentIteration: 1 }, {
    workstream,
    goal: `Implement ${workstream}`,
    allowedPaths: [`${workstream}.txt`],
    dependencies,
    executor: {
      role: "PRIMARY",
      executorCli: repo.executorCli,
      model: repo.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT"
    }
  });
}

/**
 * Push an isolated `.orca/dispatch/<id>.json` marker commit to the remote.
 * When `strategy` is omitted the marker is a legacy V1 dispatch (resolves to
 * SINGLE_AGENT, no execution plan) — exactly the shape the autonomous loop
 * still executes correctly today.
 */
function pushStrategyDispatch(
  cloneDir: string,
  opts: {
    runId: string;
    goal: string;
    strategy?: ExecutionStrategy;
    executionPlan?: DispatchExecutionPlan;
  }
): string {
  const dispatchId = `disp-${(opts.strategy ?? "legacy").toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
  const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
  const marker: Record<string, unknown> = {
    schemaVersion: 1,
    type: "dispatch",
    runId: opts.runId,
    dispatchId,
    iteration: 1,
    createdAt: new Date().toISOString(),
    baseSha,
    changePath: "openspec/changes/017-strategy-controls",
    goal: opts.goal,
    instructionsVersion: 1
  };
  if (opts.strategy) {
    marker.strategy = opts.strategy;
    marker.executionPlan = opts.executionPlan ?? {};
  }
  fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
  fs.writeFileSync(path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`), JSON.stringify(marker, null, 2));
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
  git(cloneDir, ["push", "origin", "main"]);
  return dispatchId;
}

async function startCampaign(app: AppInstance, repoId: string, goal: string): Promise<RunRecord> {
  const res = await app.fastify.inject({
    method: "POST",
    url: `/api/repositories/${repoId}/runs/start`,
    payload: { goal, maxIterations: 5 }
  });
  expect(res.statusCode).toBe(201);
  return res.json().run;
}

function activeState(app: AppInstance, repoId: string): string {
  return app.loopService.getStatus(repoId).state;
}

function activeStrategy(app: AppInstance, runId: string) {
  return app.strategyRunStore.getActiveForRun(runId);
}

/** Durable-state snapshot used to diagnose strategy startup failures. */
function diagnose(app: AppInstance, repoId: string, runId: string, dispatchId: string | null): string {
  let state = "unknown";
  try { state = app.loopService.getStatus(repoId).state; } catch {}
  const run = app.runStore.get(runId);
  const dispatch = dispatchId ? app.dispatchStore.get(dispatchId) : null;
  const strategies = app.strategyRunStore.listByRun(runId).map(
    (record) => `${record.strategy}/${record.status}/${record.controlState}`
  );
  return JSON.stringify({
    state,
    runStatus: run?.status,
    runLastError: run?.lastError,
    activeDispatchId: run?.activeDispatchId,
    currentIteration: run?.currentIteration,
    dispatchStatus: dispatch?.status ?? null,
    rejectionReason: dispatch?.rejectionReason ?? null,
    strategies
  });
}

/**
 * Wait for a strategy to reach a terminal status (fetched by ID — terminal
 * statuses are excluded from the store's "active" query); dump durable state
 * on timeout.
 */
async function waitForStrategyTerminal(
  app: AppInstance,
  repoId: string,
  runId: string,
  dispatchId: string | null,
  strategyRunId: string,
  statuses: string[],
  timeoutMs: number
): Promise<string> {
  try {
    await waitFor(() => statuses.includes(app.strategyRunStore.get(strategyRunId)?.status ?? ""), timeoutMs);
  } catch {
    throw new Error(
      `strategy ${strategyRunId} never reached ${statuses.join("/")} within ${timeoutMs}ms; diagnostics: ${diagnose(app, repoId, runId, dispatchId)}`
    );
  }
  return app.strategyRunStore.get(strategyRunId)?.status ?? "unknown";
}

/**
 * Let the strategy engine finish its in-flight work before the DB closes:
 * teardown kills live workers via coordinator.shutdown, and their result
 * persistence must land while the database is still open.
 */
async function settleEngine(app: AppInstance | null): Promise<void> {
  if (!app) return;
  try {
    await waitFor(() => app.strategyRunStore.listRecoverable().length === 0, 15000, 200);
  } catch {}
}

describe("R16 real campaign-level strategy controls (SWARM)", () => {
  let tempDir: string;
  let data: { bareDir: string; cloneDir: string };
  let mockBrowser: MockBrowserDriver;
  let app: AppInstance | null;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-strategy-controls-"));
    data = makeBareAndClone(tempDir, "swarm");
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });
  });

  afterEach(async () => {
    // Slow mode off first so any late worker spawn finishes fast.
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    delete process.env.ORCA_SWARM_FAIL_PACKET;
    try {
      // Production shutdown seam: stops watcher, routes KILL to any active
      // strategy actor (coordinator.shutdown), closes browser pages.
      await app?.fastify.close();
    } catch {}
    await settleEngine(app); // engine result writes must land before DB close
    try { app?.dbContext.close(); } catch {}
    app = null;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows file locks can outlive a killed child; retry once, then give
      // up (the OS temp dir is cleaned periodically).
      await sleep(1500);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("SCENARIO 1: campaign pause/resume continues the SAME swarm strategy to COMPLETED and hands off to Sol", async () => {
    // Regression gate for BUG-017-DISPATCH-PERSISTENCE (dispatch must reach
    // the engine with its strategy/executionPlan intact) and
    // BUG-017-COMPLETION-BRIDGE (COMPLETED must reach onStrategyCompleted so
    // the wake + SOL_REVIEWING handoff happens).
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "2500";
    const repo = createRepo(app!, data, "Swarm PauseResume");
    const run = await startCampaign(app!, repo.id, "pause resume swarm qualification");
    const first = createPacket(app!, repo, run, "swarm-pause-alpha");
    const second = createPacket(app!, repo, run, "swarm-pause-beta");
    const remoteBaseSha = git(data.bareDir, ["rev-parse", "refs/heads/main"]);
    const dispatchId = pushStrategyDispatch(data.cloneDir, {
      runId: run.id,
      goal: "pause resume swarm qualification",
      strategy: "SWARM",
      executionPlan: { packetIds: [first.packetId, second.packetId], maxConcurrency: 1 }
    });

    await waitFor(() => activeState(app!, repo.id) === "EXECUTING", 30000);
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RUNNING", 30000);
    await waitFor(
      () => [first.packetId, second.packetId].some((id) => app!.workPacketService.get(id)?.status === "RUNNING"),
      20000
    );
    const strategyRunId = activeStrategy(app!, run.id)!.strategyRunId;
    const wakesBeforePause = app!.wakeStore.getByRepository(repo.id).length;

    // Campaign pause through the runs route.
    const pauseRes = await app!.fastify.inject({ method: "POST", url: `/api/repositories/${repo.id}/runs/pause` });
    expect(pauseRes.statusCode).toBe(200);
    expect(activeState(app!, repo.id)).toBe("PAUSED");
    // Workers stop per qualified semantics; isolated worktrees are preserved.
    await waitFor(() => activeStrategy(app!, run.id)?.status === "PAUSED", 20000);
    const pausedWorktrees = [first, second]
      .map((packet) => app!.workPacketStore.getWorktreeByPacket(packet.packetId))
      .filter((worktree): worktree is NonNullable<typeof worktree> => Boolean(worktree));
    expect(pausedWorktrees.length).toBeGreaterThan(0);
    for (const worktree of pausedWorktrees) {
      expect(worktree.status).toBe("ACTIVE");
      expect(fs.existsSync(worktree.path)).toBe(true);
    }

    // Resume continues the SAME strategy run / campaign / iteration.
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    const resumeRes = await app!.fastify.inject({ method: "POST", url: `/api/repositories/${repo.id}/runs/resume` });
    expect(resumeRes.statusCode).toBe(200);
    expect(activeState(app!, repo.id)).toBe("EXECUTING");
    expect(activeStrategy(app!, run.id)?.strategyRunId).toBe(strategyRunId);

    await waitForStrategyTerminal(app!, repo.id, run.id, dispatchId, strategyRunId, ["COMPLETED"], 60000);
    expect(app!.runStore.get(run.id)?.currentIteration).toBe(1);
    // Completion must hand off to Sol: wake + SOL_REVIEWING (never GOAL_COMPLETE).
    await waitFor(() => activeState(app!, repo.id) === "SOL_REVIEWING", 30000);
    const wakes = app!.wakeStore.getByRepository(repo.id);
    expect(wakes.length).toBeGreaterThan(wakesBeforePause);
    expect(wakes.some((wake) => /Result status: COMPLETED/.test(wake.message))).toBe(true);
    const page = mockBrowser.history.get(repo.id);
    expect((page?.typedMessages ?? []).map((message) => message.text).join("\n")).toMatch(/COMPLETED/);
    expect(app!.dispatchStore.get(dispatchId)?.status).toBe("consumed");
    // Remote durability (BUG-017-PUBLISH-MANIFEST-ENOENT, fixed): integrated
    // main + result manifest must actually reach the bare remote.
    expect(git(data.bareDir, ["rev-parse", "refs/heads/main"])).not.toBe(remoteBaseSha);
  }, 180000);

  it("SCENARIO 2: campaign stop drains the swarm gracefully, terminates the campaign STOPPED, and never hands off to Sol", async () => {
    // Regression gate for BUG-017-DISPATCH-PERSISTENCE +
    // BUG-017-COMPLETION-BRIDGE: the drain must terminate the campaign STOPPED
    // at the strategy boundary (applyIterationCompletion) with zero Sol wakes.
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "2500";
    const repo = createRepo(app!, data, "Swarm Stop");
    const run = await startCampaign(app!, repo.id, "graceful stop swarm qualification");
    const first = createPacket(app!, repo, run, "swarm-stop-alpha");
    const second = createPacket(app!, repo, run, "swarm-stop-beta");
    const dispatchId = pushStrategyDispatch(data.cloneDir, {
      runId: run.id,
      goal: "graceful stop swarm qualification",
      strategy: "SWARM",
      executionPlan: { packetIds: [first.packetId, second.packetId], maxConcurrency: 1 }
    });

    await waitFor(() => activeState(app!, repo.id) === "EXECUTING", 30000);
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RUNNING", 30000);
    await waitFor(
      () => [first.packetId, second.packetId].some((id) => app!.workPacketService.get(id)?.status === "RUNNING"),
      20000
    );
    const wakesBefore = app!.wakeStore.getByRepository(repo.id).length;

    // Campaign stop through the runs route: graceful drain, no kill.
    const stopRes = await app!.fastify.inject({ method: "POST", url: `/api/repositories/${repo.id}/runs/stop` });
    expect(stopRes.statusCode).toBe(200);
    expect(activeState(app!, repo.id)).toBe("DRAINING");
    expect(app!.runStore.get(run.id)?.drainReason).toBe("USER_STOP");

    // The live worker drains naturally (not killed); the queued sibling is cancelled.
    const stoppedStrategyRunId = activeStrategy(app!, run.id)!.strategyRunId;
    await waitForStrategyTerminal(app!, repo.id, run.id, dispatchId, stoppedStrategyRunId, ["CANCELLED", "PARTIAL", "COMPLETED"], 45000);
    expect(app!.strategyRunStore.get(stoppedStrategyRunId)?.status).toBe("CANCELLED");
    const results = [first, second].map((packet) => app!.workPacketService.getResult(packet.packetId)?.status);
    expect(results.sort()).toEqual(["CANCELLED", "COMPLETED"]);

    // Drain terminates the campaign at the boundary without any Sol handoff.
    // NOTE: loopService.getStatus() collapses terminal STOPPED runs to IDLE,
    // so assert the durable run record here.
    try {
      await waitFor(() => app!.runStore.get(run.id)?.status === "STOPPED", 30000);
    } catch (error) {
      throw new Error(
        `campaign never reached STOPPED after swarm drain; ${String(error)}; diagnostics: ${diagnose(app!, repo.id, run.id, dispatchId)}`
      );
    }
    expect(app!.wakeStore.getByRepository(repo.id).length - wakesBefore).toBe(0);
    // No further state transitions after the terminal boundary.
    await expectStable(() => {
      expect(app!.runStore.get(run.id)?.status).toBe("STOPPED");
      expect(activeState(app!, repo.id)).toBe("IDLE");
    }, 2500);
  }, 150000);

  it("SCENARIO 3: emergency kill terminates workers and preserves worktrees; manual strategy takeover is rejected while the actor is active", async () => {
    // Live ownership-conflict proof: while the autonomous swarm owns the
    // iteration, the manual /swarm/start route must answer a structured 4xx
    // STRATEGY_ACTIVE conflict and never spawn a second actor. Kill semantics:
    // worker child processes terminated, worktrees preserved, campaign left in
    // RECOVERY_REQUIRED with no Sol wake.
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "4000";
    const repo = createRepo(app!, data, "Swarm Kill");
    const run = await startCampaign(app!, repo.id, "emergency kill swarm qualification");
    const packet = createPacket(app!, repo, run, "swarm-kill-alpha");
    pushStrategyDispatch(data.cloneDir, {
      runId: run.id,
      goal: "emergency kill swarm qualification",
      strategy: "SWARM",
      executionPlan: { packetIds: [packet.packetId], maxConcurrency: 1 }
    });

    await waitFor(() => activeState(app!, repo.id) === "EXECUTING", 30000);
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RUNNING", 30000);
    await waitFor(() => app!.workPacketService.get(packet.packetId)?.status === "RUNNING", 20000);

    // Ownership-conflict rejection through the campaign seam: while the
    // autonomous swarm owns the iteration, the manual strategy start route
    // must be rejected with a structured 4xx conflict and must not spawn a
    // second strategy actor.
    const conflictRes = await app!.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/campaigns/${run.id}/swarm/start`,
      payload: { packetIds: [packet.packetId] }
    });
    expect(conflictRes.statusCode).toBe(400);
    expect(conflictRes.json().error?.code).toBe("BAD_REQUEST");
    expect(conflictRes.json().error?.message).toMatch(/already active/i);
    expect(app!.strategyRunStore.listByRun(run.id)).toHaveLength(1);

    const wakesBefore = app!.wakeStore.getByRepository(repo.id).length;

    // Emergency kill via the public LoopService control method (no HTTP route).
    await app!.loopService.emergencyKill(repo.id);
    expect(activeState(app!, repo.id)).toBe("RECOVERY_REQUIRED");

    // Worker child processes terminated: the strategy reaches a terminal
    // recovery status and the packet never completes.
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RECOVERY_REQUIRED", 30000);
    const result = app!.workPacketService.getResult(packet.packetId);
    expect(result && result.status !== "COMPLETED").toBe(true);

    // Worktrees preserved for recovery (not released/cleaned).
    const worktree = app!.workPacketStore.getWorktreeByPacket(packet.packetId);
    expect(worktree?.status).toBe("ACTIVE");
    expect(fs.existsSync(worktree!.path)).toBe(true);

    // No Sol wake after the kill, and no further progress.
    expect(app!.wakeStore.getByRepository(repo.id).length - wakesBefore).toBe(0);
    await expectStable(() => {
      expect(activeState(app!, repo.id)).toBe("RECOVERY_REQUIRED");
      expect(activeStrategy(app!, run.id)?.status).toBe("RECOVERY_REQUIRED");
      expect(app!.strategyRunStore.listByRun(run.id)).toHaveLength(1);
    }, 2500);
  }, 150000);

  it("SCENARIO 4: wall-clock ceiling drains the swarm and terminates the campaign CEILING_REACHED without a Sol handoff", async () => {
    // Regression gate for BUG-017-DISPATCH-PERSISTENCE +
    // BUG-017-COMPLETION-BRIDGE at the ceiling boundary: the ceiling must
    // drain the strategy actor and terminate the campaign CEILING_REACHED
    // (applyIterationCompletion) with zero Sol wakes.
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "3000";
    const repo = createRepo(app!, data, "Swarm Ceiling");
    const run = await startCampaign(app!, repo.id, "wall clock ceiling swarm qualification");
    const packet = createPacket(app!, repo, run, "swarm-ceiling-alpha");
    const dispatchId = pushStrategyDispatch(data.cloneDir, {
      runId: run.id,
      goal: "wall clock ceiling swarm qualification",
      strategy: "SWARM",
      executionPlan: { packetIds: [packet.packetId], maxConcurrency: 1 }
    });

    await waitFor(() => activeState(app!, repo.id) === "EXECUTING", 30000);
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RUNNING", 30000);
    await waitFor(() => app!.workPacketService.get(packet.packetId)?.status === "RUNNING", 20000);
    const wakesBefore = app!.wakeStore.getByRepository(repo.id).length;

    // Force the smallest workable ceiling exactly like
    // real-runtime-controls.test.ts: backdate started_at, then evaluate the
    // ceiling synchronously through the public LoopService seam.
    const active = app!.runStore.getActiveRun(repo.id)!;
    app!.dbContext.db
      .prepare("UPDATE runs SET started_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(), active.id);
    const crossed = app!.loopService.checkWallClockCeiling(repo.id);
    expect(crossed).toBe(true);
    expect(activeState(app!, repo.id)).toBe("DRAINING");
    expect(app!.runStore.get(run.id)?.drainReason).toBe("WALL_CLOCK_CEILING");

    // The ceiling drains (does not kill) the strategy actor at its boundary.
    const ceilingStrategyRunId = activeStrategy(app!, run.id)!.strategyRunId;
    await waitForStrategyTerminal(app!, repo.id, run.id, dispatchId, ceilingStrategyRunId, ["CANCELLED", "PARTIAL", "COMPLETED"], 45000);
    expect(app!.strategyRunStore.get(ceilingStrategyRunId)?.status).toBe("CANCELLED");

    // Terminal ceiling state, no next Sol handoff, no further transitions.
    await waitFor(() => activeState(app!, repo.id) === "CEILING_REACHED", 30000);
    expect(app!.wakeStore.getByRepository(repo.id).length - wakesBefore).toBe(0);
    // The authorizing dispatch is consumed at the drain boundary (no Sol
    // handoff follows — asserted by the zero-wake delta above).
    expect(app!.dispatchStore.get(dispatchId)?.status).toBe("consumed");
    await expectStable(() => expect(activeState(app!, repo.id)).toBe("CEILING_REACHED"), 2500);
  }, 150000);

  it("SCENARIO 5: controller restart mid-swarm reconstructs RECOVERY_REQUIRED deterministically without duplicate workers", async () => {
    // This scenario seeds the durable mid-run state directly — the same
    // established pattern as real-swarm.test.ts "reconciles a persisted
    // running strategy after restart" (deterministic: no live children racing
    // teardown) — and then exercises ONLY production lifecycle seams:
    // fastify.close() (coordinator.shutdown KILL marking) -> dbContext.close()
    // -> buildApp on the SAME dbPath/dataDir -> startup recoverAll.
    const repo = createRepo(app!, data, "Swarm Restart");
    const run = await startCampaign(app!, repo.id, "restart recovery swarm qualification");
    const packet = createPacket(app!, repo, run, "swarm-restart-alpha");

    // Durable mid-run state: iteration 1 EXECUTING with a RUNNING swarm actor
    // that owns an allocated, isolated worktree.
    app!.runStore.updateStatus(run.id, "EXECUTING", { currentIteration: 1 });
    const baseSha = git(data.cloneDir, ["rev-parse", "HEAD"]);
    const worktree = await app!.worktreeIsolationService.allocate(repo, packet, baseSha);
    app!.workPacketService.updateStatus(packet.packetId, "RUNNING");
    const now = new Date().toISOString();
    const strategyRunId = `strategy-restart-${crypto.randomUUID().slice(0, 8)}`;
    app!.strategyRunStore.create({
      schemaVersion: 1,
      strategyRunId,
      repositoryId: repo.id,
      campaignId: run.id,
      runId: run.id,
      iteration: 1,
      strategy: "SWARM",
      status: "RUNNING",
      maxConcurrency: 1,
      packetIds: [packet.packetId],
      controlState: "NONE",
      dispatchId: null,
      strategyBaseSha: baseSha,
      startedAt: now,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now
    });
    expect(fs.existsSync(worktree.path)).toBe(true);

    // Kill the controller through the production lifecycle seam (no graceful
    // campaign stop was issued). Wait until the engine-visible durable state
    // settled before closing the DB so teardown stays deterministic.
    const closingApp = app!;
    await closingApp.fastify.close();
    closingApp.dbContext.close();
    app = null;

    // Rebuild the whole controller on the SAME dbPath/dataDir. The startup
    // reconciler + dagExecutionService.recoverAll() must reconstruct the
    // interrupted strategy deterministically.
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });

    await waitFor(() => activeState(app!, repo.id) === "RECOVERY_REQUIRED", 30000);
    const strategies = app!.strategyRunStore.listByRun(run.id);
    expect(strategies).toHaveLength(1);
    expect(strategies[0]!.strategyRunId).toBe(strategyRunId);
    expect(strategies[0]!.status).toBe("RECOVERY_REQUIRED");
    expect(strategies[0]!.strategy).toBe("SWARM");
    expect(app!.runStore.get(run.id)?.status).toBe("RECOVERY_REQUIRED");

    // No duplicate workers spawn: the packet never re-runs and the strategy
    // count for the run stays 1 over an observation window.
    const result = app!.workPacketService.getResult(packet.packetId);
    expect(result && result.status !== "COMPLETED").toBe(true);
    // Worktree preserved across the restart for recovery/inspection.
    const worktreeAfter = app!.workPacketStore.getWorktreeByPacket(packet.packetId);
    expect(worktreeAfter).toBeTruthy();
    expect(fs.existsSync(worktreeAfter!.path)).toBe(true);
    await expectStable(() => {
      expect(app!.strategyRunStore.listByRun(run.id)).toHaveLength(1);
      expect(app!.workPacketService.getResult(packet.packetId)?.status).not.toBe("RUNNING");
      expect(activeState(app!, repo.id)).toBe("RECOVERY_REQUIRED");
    }, 3000);
  }, 150000);

  it("SCENARIO 9: manual strategy start is rejected with a structured 4xx ownership conflict at the campaign seam", async () => {
    // Ownership boundary qualification that does not need a live strategy
    // actor: with the campaign waiting on Sol (no dispatched strategy
    // authorized yet), both manual strategy start routes must reject with a
    // structured 4xx conflict (StrategyConflictError mapped to BadRequestError
    // by the routes) and must not create any strategy actor.
    //
    // NOTE: the stronger STRATEGY_ACTIVE variant of this probe (manual start
    // while an autonomous swarm owns the iteration) runs live inside
    // SCENARIO 3.
    const repo = createRepo(app!, data, "Swarm Conflict");
    const run = await startCampaign(app!, repo.id, "ownership conflict qualification");
    const packet = createPacket(app!, repo, run, "swarm-conflict-alpha");

    // The campaign is SOL_REVIEWING (initial wake) with no activeDispatchId.
    expect(activeState(app!, repo.id)).toBe("SOL_REVIEWING");

    const swarmRes = await app!.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/campaigns/${run.id}/swarm/start`,
      payload: { packetIds: [packet.packetId] }
    });
    expect(swarmRes.statusCode).toBe(400);
    expect(swarmRes.json().error?.code).toBe("BAD_REQUEST");
    expect(swarmRes.json().error?.message).toMatch(/authorizing dispatch/i);

    const dagRes = await app!.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repo.id}/campaigns/${run.id}/dag/start`,
      payload: { nodes: [{ nodeId: "node-a", packetId: packet.packetId, dependsOn: [] }] }
    });
    expect(dagRes.statusCode).toBe(400);
    expect(dagRes.json().error?.code).toBe("BAD_REQUEST");
    expect(dagRes.json().error?.message).toMatch(/authorizing dispatch/i);

    // No strategy actor was created and the campaign was not disturbed.
    expect(app!.strategyRunStore.listByRun(run.id)).toHaveLength(0);
    expect(activeState(app!, repo.id)).toBe("SOL_REVIEWING");
  }, 60000);
});

describe("R16 real campaign-level strategy controls (DAG)", () => {
  let tempDir: string;
  let data: { bareDir: string; cloneDir: string };
  let mockBrowser: MockBrowserDriver;
  let app: AppInstance | null;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-dag-controls-"));
    data = makeBareAndClone(tempDir, "dag");
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });
  });

  afterEach(async () => {
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    delete process.env.ORCA_SWARM_FAIL_PACKET;
    try {
      await app?.fastify.close();
    } catch {}
    await settleEngine(app); // engine result writes must land before DB close
    try { app?.dbContext.close(); } catch {}
    app = null;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows file locks can outlive a killed child; retry once, then give
      // up (the OS temp dir is cleaned periodically).
      await sleep(1500);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("SCENARIO 6: DAG campaign pause/resume continues the SAME strategy to COMPLETED and hands off to Sol", async () => {
    // Regression gate for DAG resume correctness: on RESUME, control() re-queues
    // every non-COMPLETED packet, and executeRecord's dependency gate must WAIT
    // for a dependency that is itself pending re-execution instead of skipping
    // the dependent via its stale pre-pause result record (dependents sort by
    // random UUIDs, so ordering cannot be relied on).
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "2500";
    const repo = createRepo(app!, data, "Dag PauseResume");
    const run = await startCampaign(app!, repo.id, "dag pause resume qualification");
    const alpha = createPacket(app!, repo, run, "dag-alpha");
    const beta = createPacket(app!, repo, run, "dag-beta", [alpha.packetId]);
    const dispatchId = pushStrategyDispatch(data.cloneDir, {
      runId: run.id,
      goal: "dag pause resume qualification",
      strategy: "DAG",
      executionPlan: {
        dagNodes: [
          { nodeId: "node-a", packetId: alpha.packetId, dependsOn: [] },
          { nodeId: "node-b", packetId: beta.packetId, dependsOn: ["node-a"] }
        ],
        maxConcurrency: 1
      }
    });

    await waitFor(() => activeState(app!, repo.id) === "EXECUTING", 30000);
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RUNNING", 30000);
    const strategyRunId = activeStrategy(app!, run.id)!.strategyRunId;
    await waitFor(() => {
      return app!.dagNodeStore.list(strategyRunId).some((node) => node.status === "RUNNING");
    }, 25000);
    const wakesBefore = app!.wakeStore.getByRepository(repo.id).length;

    const pauseRes = await app!.fastify.inject({ method: "POST", url: `/api/repositories/${repo.id}/runs/pause` });
    expect(pauseRes.statusCode).toBe(200);
    expect(activeState(app!, repo.id)).toBe("PAUSED");
    await waitFor(() => activeStrategy(app!, run.id)?.status === "PAUSED", 20000);
    const worktree = app!.workPacketStore.getWorktreeByPacket(alpha.packetId);
    expect(worktree?.status).toBe("ACTIVE");
    expect(fs.existsSync(worktree!.path)).toBe(true);

    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    const resumeRes = await app!.fastify.inject({ method: "POST", url: `/api/repositories/${repo.id}/runs/resume` });
    expect(resumeRes.statusCode).toBe(200);
    expect(activeState(app!, repo.id)).toBe("EXECUTING");
    expect(activeStrategy(app!, run.id)?.strategyRunId).toBe(strategyRunId);

    await waitForStrategyTerminal(app!, repo.id, run.id, dispatchId, strategyRunId, ["COMPLETED"], 90000);
    // True DAG dependency state: B derived from A's integrated output.
    expect(app!.workPacketService.getResult(beta.packetId)?.status).toBe("COMPLETED");
    await waitFor(() => activeState(app!, repo.id) === "SOL_REVIEWING", 30000);
    const wakes = app!.wakeStore.getByRepository(repo.id);
    expect(wakes.length).toBeGreaterThan(wakesBefore);
    expect(wakes.some((wake) => /Result status: COMPLETED/.test(wake.message))).toBe(true);
    const page = mockBrowser.history.get(repo.id);
    expect((page?.typedMessages ?? []).map((message) => message.text).join("\n")).toMatch(/COMPLETED/);
  }, 240000);

  it("SCENARIO 7: DAG emergency kill blocks nodes, preserves worktrees, and requires recovery", async () => {
    // Kill semantics on a true A->B dependency DAG: the running node is
    // blocked, the waiting dependency never becomes runnable, worktrees are
    // preserved, and the campaign lands in RECOVERY_REQUIRED with no Sol wake.
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "8000";
    const repo = createRepo(app!, data, "Dag Kill");
    const run = await startCampaign(app!, repo.id, "dag emergency kill qualification");
    const alpha = createPacket(app!, repo, run, "dag-alpha");
    const beta = createPacket(app!, repo, run, "dag-beta", [alpha.packetId]);
    pushStrategyDispatch(data.cloneDir, {
      runId: run.id,
      goal: "dag emergency kill qualification",
      strategy: "DAG",
      executionPlan: {
        dagNodes: [
          { nodeId: "node-a", packetId: alpha.packetId, dependsOn: [] },
          { nodeId: "node-b", packetId: beta.packetId, dependsOn: ["node-a"] }
        ],
        maxConcurrency: 1
      }
    });

    await waitFor(() => activeState(app!, repo.id) === "EXECUTING", 30000);
    await waitFor(() => activeStrategy(app!, run.id)?.status === "RUNNING", 30000);
    const strategyRunId = activeStrategy(app!, run.id)!.strategyRunId;
    // Wait until node A's runner actually exists (packet RUNNING is set right
    // before the worker spawns) so the kill cannot land in the allocation
    // window where the worker has no child process yet.
    await waitFor(() => app!.workPacketService.get(alpha.packetId)?.status === "RUNNING", 25000);
    const wakesBefore = app!.wakeStore.getByRepository(repo.id).length;

    await app!.loopService.emergencyKill(repo.id);
    expect(activeState(app!, repo.id)).toBe("RECOVERY_REQUIRED");

    await waitFor(() => activeStrategy(app!, run.id)?.status === "RECOVERY_REQUIRED", 30000);
    // Nodes must not report success: the running node is blocked, the waiting
    // dependency never becomes runnable.
    const nodes = app!.dagNodeStore.list(strategyRunId);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.status).not.toBe("COMPLETED");
    }
    expect(app!.workPacketService.getResult(alpha.packetId)?.status).not.toBe("COMPLETED");
    expect(app!.workPacketService.getResult(beta.packetId)?.status).not.toBe("COMPLETED");

    // Worktrees preserved for recovery.
    const worktree = app!.workPacketStore.getWorktreeByPacket(alpha.packetId);
    expect(worktree?.status).toBe("ACTIVE");
    expect(fs.existsSync(worktree!.path)).toBe(true);

    expect(app!.wakeStore.getByRepository(repo.id).length - wakesBefore).toBe(0);
    await expectStable(() => {
      expect(activeState(app!, repo.id)).toBe("RECOVERY_REQUIRED");
      expect(activeStrategy(app!, run.id)?.status).toBe("RECOVERY_REQUIRED");
      expect(app!.strategyRunStore.listByRun(run.id)).toHaveLength(1);
    }, 2500);
  }, 150000);

  it("SCENARIO 8: controller restart mid-DAG reconstructs RECOVERY_REQUIRED deterministically without duplicate workers", async () => {
    // Same seeding rationale as SCENARIO 5: durable mid-run DAG state is
    // seeded directly (deterministic, no live children) and the production
    // lifecycle seams — fastify.close() -> dbContext.close() -> buildApp on
    // the SAME dbPath/dataDir -> startup recoverAll — do the rest.
    const repo = createRepo(app!, data, "Dag Restart");
    const run = await startCampaign(app!, repo.id, "dag restart recovery qualification");
    const alpha = createPacket(app!, repo, run, "dag-alpha");
    const beta = createPacket(app!, repo, run, "dag-beta", [alpha.packetId]);

    app!.runStore.updateStatus(run.id, "EXECUTING", { currentIteration: 1 });
    const baseSha = git(data.cloneDir, ["rev-parse", "HEAD"]);
    const worktree = await app!.worktreeIsolationService.allocate(repo, alpha, baseSha);
    app!.workPacketService.updateStatus(alpha.packetId, "RUNNING");
    const now = new Date().toISOString();
    const strategyRunId = `strategy-dag-restart-${crypto.randomUUID().slice(0, 8)}`;
    app!.strategyRunStore.create({
      schemaVersion: 1,
      strategyRunId,
      repositoryId: repo.id,
      campaignId: run.id,
      runId: run.id,
      iteration: 1,
      strategy: "DAG",
      status: "RUNNING",
      maxConcurrency: 1,
      packetIds: [alpha.packetId, beta.packetId],
      controlState: "NONE",
      dispatchId: null,
      strategyBaseSha: baseSha,
      startedAt: now,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now
    });
    const nodeBudget = alpha.budget;
    app!.dagNodeStore.create({
      schemaVersion: 1,
      strategyRunId,
      nodeId: "node-a",
      packetId: alpha.packetId,
      dependsOn: [],
      dependencyInputShas: [],
      status: "RUNNING",
      budget: nodeBudget,
      attempt: 1,
      maxRetries: nodeBudget.maxRetries,
      waitingReason: null,
      startedAt: now,
      finishedAt: null,
      resultId: null,
      createdAt: now,
      updatedAt: now
    });
    app!.dagNodeStore.create({
      schemaVersion: 1,
      strategyRunId,
      nodeId: "node-b",
      packetId: beta.packetId,
      dependsOn: ["node-a"],
      dependencyInputShas: [],
      status: "WAITING_DEPENDENCY",
      budget: beta.budget,
      attempt: 0,
      maxRetries: beta.budget.maxRetries,
      waitingReason: "Waiting for explicit DAG dependencies.",
      startedAt: null,
      finishedAt: null,
      resultId: null,
      createdAt: now,
      updatedAt: now
    });
    expect(fs.existsSync(worktree.path)).toBe(true);

    const closingApp = app!;
    await closingApp.fastify.close();
    closingApp.dbContext.close();
    app = null;

    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });

    await waitFor(() => activeState(app!, repo.id) === "RECOVERY_REQUIRED", 30000);
    const strategies = app!.strategyRunStore.listByRun(run.id);
    expect(strategies).toHaveLength(1);
    expect(strategies[0]!.strategyRunId).toBe(strategyRunId);
    expect(strategies[0]!.status).toBe("RECOVERY_REQUIRED");
    expect(strategies[0]!.strategy).toBe("DAG");
    expect(app!.runStore.get(run.id)?.status).toBe("RECOVERY_REQUIRED");

    // Neither node may resurrect as a worker after the restart; recoverAll
    // marks every non-completed node BLOCKED.
    const nodes = app!.dagNodeStore.list(strategyRunId);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.status).toBe("BLOCKED");
    }
    expect(app!.workPacketService.getResult(alpha.packetId)?.status).not.toBe("COMPLETED");
    expect(app!.workPacketService.getResult(beta.packetId)?.status).not.toBe("COMPLETED");
    const worktreeAfter = app!.workPacketStore.getWorktreeByPacket(alpha.packetId);
    expect(worktreeAfter).toBeTruthy();
    expect(fs.existsSync(worktreeAfter!.path)).toBe(true);
    await expectStable(() => {
      expect(app!.strategyRunStore.listByRun(run.id)).toHaveLength(1);
      expect(app!.workPacketService.getResult(beta.packetId)?.status).not.toBe("RUNNING");
      expect(activeState(app!, repo.id)).toBe("RECOVERY_REQUIRED");
    }, 3000);
  }, 150000);
});
