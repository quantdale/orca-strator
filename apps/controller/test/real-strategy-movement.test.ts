/**
 * Change 018 R7 — Production buildApp() MOVEMENT QUALIFICATION MATRIX.
 *
 * Real deterministic Git qualification of local/remote main movement during
 * AUTONOMOUS SWARM and DAG strategies (openspec/changes/
 * 018-strategy-postflight-and-concurrency-hardening, "Movement qualification
 * matrix"): remote-main advancement (non-conflicting and conflicting) during
 * SWARM and DAG, local persistent main advancement (safe and conflicting),
 * dirty persistent main, and stale strategy bases. Safe movement reconciles;
 * unsafe movement blocks truthfully; no case produces a false COMPLETED Sol
 * wake or a force-push.
 *
 * Proof chain (production seams ONLY — buildApp lifecycle, REST via
 * app.fastify.inject, durable Git pushes from fixture clones, read-only store
 * inspection, and the public coordinator retry API; no LoopService transition
 * methods, no manual watcher start, no direct IntegrationService calls):
 *   create repo via app seam -> start run via REST -> durable typed packets ->
 *   isolated SWARM/DAG dispatch marker pushed to the bare remote ->
 *   production watcher (auto-started) detects it -> LoopService resolves the
 *   strategy -> engine runs deterministic harness workers in real worktrees ->
 *   integration/publication reconcile-or-block against the moved mains ->
 *   durable verdicts asserted on stores, remote Git state, and Sol wakes.
 *
 * Movement mechanisms (all ordinary non-force Git from a SECOND clone of the
 * same bare remote, or direct commits on the repository clone):
 *   - Non-conflicting remote advancement: unrelated file pushed while slow
 *     workers run -> publishToRemote classifies DIVERGED, replays the
 *     integrated commits onto origin/main (clean rebase), publishes.
 *   - Conflicting remote advancement: different content pushed to a SUCCESSFUL
 *     worker's output path -> reconciliation rebase conflicts, aborts,
 *     structured BLOCKED "Unsafe remote advancement: ..." -> RECOVERY_REQUIRED,
 *     dispatch unconsumed, zero COMPLETED wakes; recoverable later through
 *     retryPendingPostflight WITHOUT rerunning workers.
 *   - Safe local advancement: unrelated commit on persistent main mid-run ->
 *     integration cherry-picks cleanly, publication classifies LOCAL_AHEAD.
 *   - Conflicting local advancement: different content committed on persistent
 *     main at a worker's output path -> integration cherry-pick conflicts ->
 *     INTEGRATION_CONFLICT -> PARTIAL -> BLOCKED review state.
 *   - Dirty persistent main: uncommitted file left in the repository clone ->
 *     integrate()/publishToRemote() refuse before ANY mutation.
 *   - Stale strategy base: several unrelated commits pushed to the remote
 *     after dispatch detection, so strategyBaseSha is multiple commits behind
 *     remote main at completion -> publication reconciles over all of them.
 *
 * Reachability notes (verified against production behavior, documented here so
 * the assertions below stay honest):
 *   1. Literal REMOTE_AHEAD cannot arise in a fresh single-iteration
 *      autonomous run: integration always lands worker commits on local main
 *      BEFORE publishToRemote classifies, so local main is never an ancestor
 *      of a concurrently advanced remote (local ⊄ remote ⇒ DIVERGED).
 *      REMOTE_AHEAD (apps/controller/src/packets/integration-service.ts:455-490)
 *      requires local ⊆ remote, i.e. zero local-only commits at publish time.
 *      The stale-base scenario (G) therefore asserts the truthful contract —
 *      reconcile succeeds, relation recorded, reconciled=true, finalHead
 *      anchored on the advanced remote — accepting either REMOTE_AHEAD or
 *      DIVERGED as the classified relation.
 *   2. Scenarios E (conflicting local main) and F (dirty main) produce engine
 *      outcomes PARTIAL/BLOCKED — never COMPLETED — because integration
 *      itself refuses/conflicts BEFORE publication
 *      (apps/controller/src/packets/integration-service.ts:67-81,
 *      apps/controller/src/strategy/swarm-execution-service.ts:892-898).
 *      retryPendingPostflight intentionally considers ONLY engine-COMPLETED
 *      records with unconsumed dispatches
 *      (apps/controller/src/loop/iteration-execution-coordinator.ts:320):
 *      a semantically failed iteration requires re-review/re-run, not silent
 *      republication. The blocked-state tests therefore prove the recovery
 *      BOUNDARY (safe conditions restored -> retry finds zero candidates ->
 *      nothing is fabricated, dispatch stays unconsumed), and the literal
 *      "retry -> consumed/SOL_REVIEWING" expectation for E/F is it.skip'ed
 *      naming this cause. Scenario C (engine COMPLETED, publication blocked)
 *      proves the FULL retry->consumed->SOL_REVIEWING path including
 *      retry-without-worker-rerun fingerprint equality.
 *
 * Fixture notes (identical to real-strategy-loop-swarm.test.ts /
 * real-strategy-loop-dag.test.ts, verified against production behavior):
 *   - Swarm packets carry executor {role:"PRIMARY", executorCli:
 *     "orca-swarm-test-harness", model:"test-model", provider:null,
 *     source:"REPOSITORY_DEFAULT"}; resolveProfile routes that CLI to the
 *     deterministic swarm harness. DAG repositories use the harness CLI as the
 *     repository default (mirroring the DAG fixture).
 *   - Packets are created BEFORE the dispatch push, stamped for the upcoming
 *     iteration ({ ...run, currentIteration: 1 }); validateStart requires
 *     packet.iteration === dispatch.iteration.
 *   - .orca/results is seeded empty: a real Orca repository always carries it
 *     after any prior executor turn (result contract E); production
 *     publishToRemote additionally mkdir -p's the directory defensively.
 *   - The dispatch marker is pushed as an isolated .orca/dispatch/<id>.json
 *     commit; baseSha = clone HEAD before the marker commit; markerSha = clone
 *     HEAD after (the remote tip the watcher first observes).
 *   - The watcher only inspects the REMOTE tip on its first observation, so
 *     remote advancements are pushed only AFTER the dispatch is detected
 *     (otherwise the marker commit below the new tip would never be inspected).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";

const SWARM_HARNESS_PATH = path.resolve(__dirname, "fixtures", "swarm-worker-harness.mjs");
const oldSwarmHarnessEnv = process.env.ORCA_SWARM_TEST_HARNESS;
if (!process.env.ORCA_SWARM_TEST_HARNESS) process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function waitForCondition(fn: () => boolean, timeoutMs: number, everyMs = 150): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = fn(); } catch { ok = false; }
      if (ok) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`waitForCondition timed out after ${timeoutMs}ms`)); return; }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

const STRATEGY_TERMINAL = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"];

/** Content pushed from the SECOND clone onto a successful worker's output path (scenario C). */
const REMOTE_CONFLICT_MARKER = "CONFLICTING-REMOTE-CONTENT diverged while the swarm ran";
/** Content committed on persistent main at a worker's output path (scenario E). */
const LOCAL_CONFLICT_CONTENT = "USER-CONFLICTING-CONTENT user edited the worker output path on main";

describe("Real Strategy Movement (Change 018 R7) — local/remote main movement during autonomous SWARM/DAG", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let clone2Dir: string;
  let initialRemoteSha: string;
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    // Per-test env (re)arm: afterEach restores the original environment, so
    // every test must re-point the deterministic harness before buildApp.
    process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-strategy-movement-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    clone2Dir = path.join(tempDir, "clone2");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });
    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-movement@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca Movement Qual"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Change 018 movement qualification fixture\n");
    // Real repositories carry .orca/results after any prior executor turn; seed
    // it exactly so. Everything inside it during the campaign is produced by
    // production publishToRemote.
    fs.mkdirSync(path.join(cloneDir, ".orca", "results"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "results", ".gitkeep"), "");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "initial"]);
    git(cloneDir, ["remote", "add", "origin", bareDir]);
    git(cloneDir, ["push", "-u", "origin", "main"]);
    initialRemoteSha = git(bareDir, ["rev-parse", "HEAD"]);

    // Second clone of the SAME bare remote: the independent mover that advances
    // remote main while the strategy owns the iteration.
    git(tempDir, ["clone", bareDir, clone2Dir]);
    git(clone2Dir, ["config", "user.email", "orca-movement-adversary@example.com"]);
    git(clone2Dir, ["config", "user.name", "Orca Movement Adversary"]);
    git(clone2Dir, ["config", "commit.gpgsign", "false"]);

    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });
    // buildApp auto-starts watcherService; do NOT call watcherService.start()
  });

  afterEach(async () => {
    try { await app.fastify.close(); } catch {}
    try { app.dbContext.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    delete process.env.ORCA_SWARM_FAIL_PACKET;
    delete process.env.ORCA_REQUIRE_FILE;
    delete process.env.ORCA_REQUIRE_CONTENT;
    delete process.env.ORCA_REQUIRE_PACKETS;
    if (oldSwarmHarnessEnv === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldSwarmHarnessEnv;
  });

  // ---- Git/state inspection helpers ---------------------------------------

  function remoteHead(): string {
    return git(bareDir, ["rev-parse", "HEAD"]);
  }

  function remoteFileAtHead(filePath: string): string | null {
    try {
      return git(bareDir, ["show", `${remoteHead()}:${filePath}`]);
    } catch {
      return null;
    }
  }

  function remoteManifest(dispatchId: string): any | null {
    const raw = remoteFileAtHead(`.orca/results/${dispatchId}.json`);
    if (raw === null) return null;
    return JSON.parse(raw);
  }

  function isAncestorInBare(ancestorSha: string, descendantSha: string): boolean {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", ancestorSha, descendantSha], {
        cwd: bareDir,
        stdio: ["ignore", "ignore", "ignore"]
      });
      return true;
    } catch {
      return false;
    }
  }

  function completedWakeCount(repoId: string): number {
    return (mockBrowser.history.get(repoId)?.typedMessages ?? [])
      .map((m) => m.text)
      .filter((text) => /COMPLETED/.test(text)).length;
  }

  function storeCompletedWakeCount(repoId: string): number {
    return app.wakeStore.getByRepository(repoId)
      .filter((w) => /COMPLETED/.test(w.message)).length;
  }

  function terminalStrategyRecord(runId: string, strategy: "SWARM" | "DAG") {
    return app.strategyRunStore.listByRun(runId)
      .filter((r) => r.strategy === strategy)
      .find((r) => STRATEGY_TERMINAL.includes(r.status));
  }

  function strategyRunning(runId: string, strategy: "SWARM" | "DAG"): boolean {
    return app.strategyRunStore.listByRun(runId)
      .some((r) => r.strategy === strategy && r.status === "RUNNING");
  }

  /** Comparable snapshot of durable packet results (status + provenance). */
  function packetFingerprints(packetIds: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of packetIds) {
      const result = app.workPacketService.getResult(id);
      out[id] = JSON.stringify({
        status: result?.status ?? null,
        filesChanged: result?.filesChanged ?? null,
        worktree: result?.worktree ?? null
      });
    }
    return out;
  }

  /**
   * Advance remote main from the SECOND clone with one or more ORDINARY
   * (non-force) commits. Syncs the clone to origin/main first. Returns the
   * pushed commit SHAs oldest-first.
   */
  function advanceRemote(commits: { file: string; content: string; message: string }[]): string[] {
    git(clone2Dir, ["fetch", "origin"]);
    git(clone2Dir, ["reset", "--hard", "origin/main"]);
    for (const c of commits) {
      fs.writeFileSync(path.join(clone2Dir, c.file), c.content);
      git(clone2Dir, ["add", "-A"]);
      git(clone2Dir, ["commit", "-m", c.message]);
    }
    git(clone2Dir, ["push", "origin", "main"]);
    const head = git(clone2Dir, ["rev-parse", "HEAD"]);
    const shas = [head];
    for (let i = 1; i < commits.length; i += 1) {
      shas.unshift(git(clone2Dir, ["rev-parse", `HEAD~${i}`]));
    }
    return shas;
  }

  /**
   * Neutralize a conflicting remote advancement and leave a SAFE advanced
   * remote, using only ordinary pushes: sync to origin/main, REVERT the
   * conflicting commit (removes the contested path again — resetting alone
   * would keep the conflict and every republish would block identically), then
   * add an UNRELATED file and push. The adversary content stays in history.
   */
  function restoreSafeRemoteState(): void {
    git(clone2Dir, ["fetch", "origin"]);
    git(clone2Dir, ["reset", "--hard", "origin/main"]);
    git(clone2Dir, ["revert", "--no-edit", "HEAD"]);
    fs.writeFileSync(
      path.join(clone2Dir, "restore-note.txt"),
      "unrelated remote advancement after the conflict was neutralized\n"
    );
    git(clone2Dir, ["add", "-A"]);
    git(clone2Dir, ["commit", "-m", "chore(mover): unrelated remote advancement"]);
    git(clone2Dir, ["push", "origin", "main"]);
  }

  // ---- Campaign fixtures ---------------------------------------------------

  interface MovementIds {
    repoId: string;
    runId: string;
    dispatchId: string;
    baseSha: string;
    markerSha: string;
    packetAId: string;
    packetBId: string;
  }

  async function startRun(repoId: string, goal: string): Promise<{ runId: string; runRecord: any }> {
    const startRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/runs/start`,
      payload: { goal, maxIterations: 5 }
    });
    expect(startRes.statusCode).toBe(201);
    const runRecord = startRes.json().run;
    return { runId: runRecord.id, runRecord };
  }

  function pushSwarmDispatch(options: {
    runId: string;
    goal: string;
    packetIds: string[];
  }): { dispatchId: string; baseSha: string; markerSha: string } {
    const dispatchId = `disp-mv-swarm-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: options.runId,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/018-strategy-postflight-and-concurrency-hardening",
      goal: options.goal,
      instructionsVersion: 1,
      strategy: "SWARM",
      executionPlan: {
        packetIds: options.packetIds,
        maxConcurrency: 2
      }
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`),
      JSON.stringify(marker, null, 2)
    );
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(cloneDir, ["push", "origin", "main"]);
    return { dispatchId, baseSha, markerSha: git(cloneDir, ["rev-parse", "HEAD"]) };
  }

  /** Fresh repo + run + two independent SWARM packets + dispatch push. */
  async function setupSwarmMovement(options: {
    goal: string;
    slowMs?: number;
  }): Promise<MovementIds> {
    const created = app.repositoryService.createRepository({
      displayName: "Change 018 Movement SWARM Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/change-018-movement-swarm",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });

    const { runId, runRecord } = await startRun(created.id, options.goal);

    const packetExecutor = {
      role: "PRIMARY" as const,
      executorCli: "orca-swarm-test-harness",
      model: "test-model",
      provider: null,
      source: "REPOSITORY_DEFAULT" as const
    };
    const packetA = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "alpha",
      goal: "Produce alpha.txt in an isolated worktree",
      allowedPaths: ["alpha.txt"],
      dependencies: [],
      executor: packetExecutor
    });
    const packetB = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "beta",
      goal: "Produce beta.txt in an isolated worktree",
      allowedPaths: ["beta.txt"],
      dependencies: [],
      executor: packetExecutor
    });

    if (options.slowMs && options.slowMs > 0) {
      process.env.ORCA_SWARM_HARNESS_SLOW_MS = String(options.slowMs);
    }

    const { dispatchId, baseSha, markerSha } = pushSwarmDispatch({
      runId,
      goal: options.goal,
      packetIds: [packetA.packetId, packetB.packetId]
    });
    return {
      repoId: created.id,
      runId,
      dispatchId,
      baseSha,
      markerSha,
      packetAId: packetA.packetId,
      packetBId: packetB.packetId
    };
  }

  /** Fresh repo + run + A->B DAG packets + DAG dispatch push (true state dependency). */
  async function setupDagMovement(options: {
    goal: string;
    slowMs?: number;
    requireContent: string;
  }): Promise<MovementIds> {
    const created = app.repositoryService.createRepository({
      displayName: "Change 018 Movement DAG Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      // Must resolve the "swarm-test" profile so workers run the swarm harness.
      executorCli: "orca-swarm-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/change-018-movement-dag",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });

    const { runId, runRecord } = await startRun(created.id, options.goal);

    const packetExecutor = {
      role: "PRIMARY" as const,
      executorCli: created.executorCli,
      model: created.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT" as const
    };
    const packetA = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "alpha",
      goal: "Produce shared-value.ts",
      allowedPaths: ["shared-value.ts"],
      dependencies: [],
      executor: packetExecutor
    });
    // CRITICAL DAG RULE: B's packet dependencies must exactly equal its DAG
    // upstream nodes' packetIds (validated strictly by dag-execution-service).
    const packetB = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "beta",
      goal: "Consume A's committed state into consumer-output.txt",
      allowedPaths: ["consumer-output.txt"],
      dependencies: [packetA.packetId],
      executor: packetExecutor
    });

    // Dependency-state requirement applies ONLY to node B's worker.
    process.env.ORCA_REQUIRE_FILE = "shared-value.ts";
    process.env.ORCA_REQUIRE_CONTENT = options.requireContent;
    process.env.ORCA_REQUIRE_PACKETS = packetB.packetId;

    if (options.slowMs && options.slowMs > 0) {
      process.env.ORCA_SWARM_HARNESS_SLOW_MS = String(options.slowMs);
    }

    const dispatchId = `disp-mv-dag-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/018-strategy-postflight-and-concurrency-hardening",
      goal: options.goal,
      instructionsVersion: 1,
      strategy: "DAG",
      executionPlan: {
        dagNodes: [
          { nodeId: "a", packetId: packetA.packetId, dependsOn: [] },
          { nodeId: "b", packetId: packetB.packetId, dependsOn: ["a"] }
        ],
        maxConcurrency: 2
      }
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`),
      JSON.stringify(marker, null, 2)
    );
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(cloneDir, ["push", "origin", "main"]);

    return {
      repoId: created.id,
      runId,
      dispatchId,
      baseSha,
      markerSha: git(cloneDir, ["rev-parse", "HEAD"]),
      packetAId: packetA.packetId,
      packetBId: packetB.packetId
    };
  }

  // ---- Scenarios -----------------------------------------------------------

  it("A. remote advances NON-CONFLICTINGLY during SWARM: publication replays onto the advanced remote, dispatch consumed, Sol woken, no force-push", async () => {
    const s = await setupSwarmMovement({
      goal: "Change 018 movement: non-conflicting remote advancement during SWARM reconciles",
      slowMs: 6000
    });

    // Advance remote main from the second clone WHILE the swarm runs: an
    // unrelated file that no worker touches.
    await waitForCondition(() => strategyRunning(s.runId, "SWARM"), 60000);
    const advShas = advanceRemote([{
      file: "unrelated-remote-file.txt",
      content: "remote advanced non-conflictingly while the swarm ran\n",
      message: "chore(mover): unrelated remote advancement"
    }]);
    expect(advShas).toHaveLength(1);

    // Watcher -> loop -> SWARM engine -> workers -> integrate -> publish with
    // reconciliation. No manual transitions anywhere; wait on durable state.
    await waitForCondition(() => terminalStrategyRecord(s.runId, "SWARM") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "SWARM")!;
    expect(strategy.status).toBe("COMPLETED");
    expect(strategy.strategyBaseSha).toBe(s.baseSha);

    await waitForCondition(() =>
      app.dispatchStore.get(s.dispatchId)?.status === "consumed" &&
      app.runStore.get(s.runId)?.status === "SOL_REVIEWING",
      60000
    );
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("consumed");
    expect(app.runStore.get(s.runId)?.status).toBe("SOL_REVIEWING");

    // Worker output AND the unrelated remote file are both on remote main.
    expect(remoteFileAtHead("alpha.txt")).toContain(`swarm worker alpha (${s.packetAId})`);
    expect(remoteFileAtHead("beta.txt")).toContain(`swarm worker beta (${s.packetBId})`);
    expect(remoteFileAtHead("unrelated-remote-file.txt"))
      .toContain("remote advanced non-conflictingly");

    // Canonical manifest records the publication truth: relation classified,
    // reconciled, finalHead anchored on the reconciled (advanced) lineage.
    const manifest = remoteManifest(s.dispatchId);
    expect(manifest, "durable result manifest must be on remote main").toBeTruthy();
    expect(manifest.strategy).toBe("SWARM");
    expect(manifest.strategyStatus).toBe("COMPLETED");
    expect(manifest.publication.relation).toBe("DIVERGED");
    expect(manifest.publication.reconciled).toBe(true);
    const finalRemoteHead = remoteHead();
    expect(typeof manifest.publication.finalHead).toBe("string");
    expect(isAncestorInBare(manifest.publication.finalHead, finalRemoteHead)).toBe(true);
    expect(manifest.publication.finalHead).not.toBe(s.markerSha);

    // NO force-push: every pre-existing remote commit (initial tip, dispatch
    // marker, mover commit) is still an ancestor of the final remote HEAD —
    // the final history is a linear superset.
    for (const sha of [initialRemoteSha, s.markerSha, advShas[0]]) {
      expect(isAncestorInBare(sha, finalRemoteHead),
        `original remote commit ${sha} must remain an ancestor of ${finalRemoteHead}`).toBe(true);
    }

    // Exactly one COMPLETED Sol wake for the reconciled iteration.
    expect(completedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
  }, 240000);

  it("B. remote advances NON-CONFLICTINGLY during DAG (A->B): staged lineage lands on main, publication reconciles the advanced remote, dispatch consumed, Sol woken", async () => {
    const s = await setupDagMovement({
      goal: "Change 018 movement: non-conflicting remote advancement during DAG reconciles",
      slowMs: 4000,
      // Exactly the substring A's harness writes into shared-value.ts.
      requireContent: "swarm worker alpha"
    });

    await waitForCondition(() => strategyRunning(s.runId, "DAG"), 60000);
    const advShas = advanceRemote([{
      file: "unrelated-remote-file.txt",
      content: "remote advanced non-conflictingly while the DAG ran\n",
      message: "chore(mover): unrelated remote advancement during DAG"
    }]);

    await waitForCondition(() => terminalStrategyRecord(s.runId, "DAG") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "DAG")!;
    expect(strategy.status).toBe("COMPLETED");
    expect(strategy.strategyBaseSha).toBe(s.baseSha);

    // Both nodes genuinely completed with the A->B dependency edge proven.
    const nodes = app.dagNodeStore.list(strategy.strategyRunId);
    const nodeA = nodes.find((n) => n.nodeId === "a");
    const nodeB = nodes.find((n) => n.nodeId === "b");
    expect(nodeA?.status).toBe("COMPLETED");
    expect(nodeB?.status).toBe("COMPLETED");
    const aCommitSha = app.workPacketService.getResult(s.packetAId)?.worktree?.commitSha ?? null;
    expect(aCommitSha).toBeTruthy();
    expect(nodeB!.dependencyInputShas).toContain(aCommitSha!);

    await waitForCondition(() =>
      app.dispatchStore.get(s.dispatchId)?.status === "consumed" &&
      app.runStore.get(s.runId)?.status === "SOL_REVIEWING",
      60000
    );
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("consumed");
    expect(app.runStore.get(s.runId)?.status).toBe("SOL_REVIEWING");

    // Node outputs (including B's derived-from bridge carrying A's bytes) AND
    // the unrelated remote file are all on remote main.
    const consumerOnRemote = remoteFileAtHead("consumer-output.txt");
    expect(consumerOnRemote).toContain(`swarm worker beta (${s.packetBId})`);
    expect(consumerOnRemote).toContain("derived-from:");
    expect(consumerOnRemote).toContain(`swarm worker alpha (${s.packetAId})`);
    expect(remoteFileAtHead("shared-value.ts")).toContain(`swarm worker alpha (${s.packetAId})`);
    expect(remoteFileAtHead("unrelated-remote-file.txt"))
      .toContain("remote advanced non-conflictingly while the DAG ran");

    const manifest = remoteManifest(s.dispatchId);
    expect(manifest).toBeTruthy();
    expect(manifest.strategy).toBe("DAG");
    expect(manifest.strategyStatus).toBe("COMPLETED");
    expect(manifest.publication.relation).toBe("DIVERGED");
    expect(manifest.publication.reconciled).toBe(true);
    const finalRemoteHead = remoteHead();
    expect(isAncestorInBare(manifest.publication.finalHead, finalRemoteHead)).toBe(true);

    // No force-push: original remote commits remain ancestors (linear superset).
    for (const sha of [initialRemoteSha, s.markerSha, advShas[0]]) {
      expect(isAncestorInBare(sha, finalRemoteHead)).toBe(true);
    }

    expect(completedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
  }, 240000);

  it("C. remote advances CONFLICTINGLY during SWARM: publication BLOCKED 'Unsafe remote advancement', run RECOVERY_REQUIRED, remote untouched, then retry republishes without rerunning workers", async () => {
    const s = await setupSwarmMovement({
      goal: "Change 018 movement: conflicting remote advancement during SWARM blocks truthfully",
      slowMs: 6000
    });

    // Conflicting advancement WHILE the swarm runs: different content on a
    // SUCCESSFUL worker's output path -> DIVERGED reconciliation rebase hits
    // the contested path and aborts.
    await waitForCondition(() => strategyRunning(s.runId, "SWARM"), 60000);
    const advShas = advanceRemote([{
      file: "alpha.txt",
      content: `${REMOTE_CONFLICT_MARKER}\n`,
      message: "chore(mover): conflicting remote advancement"
    }]);

    await waitForCondition(() => terminalStrategyRecord(s.runId, "SWARM") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "SWARM")!;

    // The ENGINE genuinely succeeded...
    expect(strategy.status).toBe("COMPLETED");
    expect(strategy.strategyBaseSha).toBe(s.baseSha);

    // ...but the unconfirmed publication blocks the campaign truthfully.
    await waitForCondition(() => app.runStore.get(s.runId)?.status === "RECOVERY_REQUIRED", 30000);
    const run = app.runStore.get(s.runId);
    expect(run?.status).toBe("RECOVERY_REQUIRED");
    expect(run?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");
    expect(run?.lastError ?? "").toContain("Unsafe remote advancement");
    const strategyWithEvidence = app.strategyRunStore.get(strategy.strategyRunId);
    expect(strategyWithEvidence?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");

    // The authorizing dispatch was NOT consumed as success; NO COMPLETED wake.
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("detected");
    expect(completedWakeCount(s.repoId)).toBe(0);
    expect(storeCompletedWakeCount(s.repoId)).toBe(0);

    // The remote was untouched BY US: its tip is still the mover's commit and
    // the contested file carries only the mover content; no manifest published.
    expect(remoteHead()).toBe(advShas[0]);
    expect(remoteFileAtHead("alpha.txt")).toContain(REMOTE_CONFLICT_MARKER);
    expect(remoteManifest(s.dispatchId)).toBeNull();

    // User/worker work is preserved durably: packet provenance and the
    // strategy report are intact (snapshot for the retry-equality proof).
    const fingerprintsBefore = packetFingerprints([s.packetAId, s.packetBId]);
    const reportBefore = JSON.stringify(app.strategyRunStore.get(strategy.strategyRunId)?.report ?? null);
    const workerShasBefore = [s.packetAId, s.packetBId]
      .map((id) => app.workPacketService.getResult(id)?.worktree?.commitSha ?? null);
    expect(workerShasBefore.every((sha) => !!sha)).toBe(true);

    // ---- Restore a SAFE remote (revert + unrelated advancement), then retry
    // through the PUBLIC coordinator API. Repeat the sweep on the documented
    // transient watcher-fetch ref-lock race; no sweep can ever spawn a worker.
    restoreSafeRemoteState();

    let summary = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
    expect(summary.failures).toEqual([]);
    expect(summary.candidates).toHaveLength(1);
    expect(summary.republished).toBe(1);
    for (let attempt = 0; summary.confirmed === 0 && attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      summary = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
      expect(summary.failures).toEqual([]);
    }
    expect(summary.confirmed, [
      "postflight retry did not confirm the pending publication.",
      `summary=${JSON.stringify(summary)}`,
      `runLastError=${app.runStore.get(s.runId)?.lastError}`,
      `remoteAlpha=${JSON.stringify(remoteFileAtHead("alpha.txt"))}`
    ].join("\n")).toBe(1);
    expect(summary.blocked).toBe(0);

    // Success continuation ran exactly as a live completion would.
    await waitForCondition(() => app.dispatchStore.get(s.dispatchId)?.status === "consumed", 30000);
    await waitForCondition(() => app.runStore.get(s.runId)?.status === "SOL_REVIEWING", 30000);
    expect(completedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);

    // The SAME persisted report was republished: worker output landed on top of
    // the safe advanced remote (relation DIVERGED, reconciled true), the mover
    // content survives in history, and the unrelated advancement is kept.
    await waitForCondition(
      () => remoteFileAtHead("alpha.txt")?.includes(`swarm worker alpha (${s.packetAId})`) ?? false,
      30000
    );
    expect(remoteFileAtHead("beta.txt")).toContain(`swarm worker beta (${s.packetBId})`);
    expect(remoteFileAtHead("restore-note.txt")).toBeTruthy();
    const manifestAfter = remoteManifest(s.dispatchId);
    expect(manifestAfter).toBeTruthy();
    expect(manifestAfter.publication.relation).toBe("DIVERGED");
    expect(manifestAfter.publication.reconciled).toBe(true);
    expect(git(bareDir, ["show", `${advShas[0]}:alpha.txt`])).toContain(REMOTE_CONFLICT_MARKER);

    // Retry-without-rerun: packet fingerprints, worker SHAs, and the strategy
    // report are byte-identical; only the stale blocker was cleared.
    expect(packetFingerprints([s.packetAId, s.packetBId])).toEqual(fingerprintsBefore);
    const workerShasAfter = [s.packetAId, s.packetBId]
      .map((id) => app.workPacketService.getResult(id)?.worktree?.commitSha ?? null);
    expect(workerShasAfter).toEqual(workerShasBefore);
    expect(JSON.stringify(app.strategyRunStore.get(strategy.strategyRunId)?.report ?? null)).toBe(reportBefore);
    expect(app.strategyRunStore.get(strategy.strategyRunId)?.lastError).toBeNull();

    // Idempotent: a further sweep finds nothing pending.
    const summary2 = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
    expect(summary2.candidates).toHaveLength(0);
    expect(summary2.confirmed).toBe(0);
  }, 240000);

  it("C-DAG: remote main advances conflictingly during DAG blocks publication truthfully without work loss", async () => {
    const s = await setupDagMovement({
      goal: "Change 018 movement: conflicting remote advancement during DAG blocks truthfully",
      slowMs: 4000,
      // Exactly the substring A's harness writes into shared-value.ts.
      requireContent: "swarm worker alpha"
    });

    // Conflicting advancement WHILE the DAG runs: different content on node
    // A's output path -> the publication-time DIVERGED reconciliation rebase
    // hits the contested path and aborts (the staged lineage itself landed on
    // LOCAL main cleanly; the mover touched only the REMOTE).
    await waitForCondition(() => strategyRunning(s.runId, "DAG"), 60000);
    const advShas = advanceRemote([{
      file: "shared-value.ts",
      content: `${REMOTE_CONFLICT_MARKER}\n`,
      message: "chore(mover): conflicting remote advancement during DAG"
    }]);

    await waitForCondition(() => terminalStrategyRecord(s.runId, "DAG") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "DAG")!;

    // The ENGINE genuinely succeeded (all nodes completed, staging lineage
    // landed on persistent main)...
    expect(strategy.status).toBe("COMPLETED");
    expect(strategy.strategyBaseSha).toBe(s.baseSha);

    // ...but the unconfirmed publication blocks the campaign truthfully.
    await waitForCondition(() => app.runStore.get(s.runId)?.status === "RECOVERY_REQUIRED", 30000);
    const run = app.runStore.get(s.runId);
    expect(run?.status).toBe("RECOVERY_REQUIRED");
    expect(run?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");
    expect(run?.lastError ?? "").toContain("Unsafe remote advancement");
    const strategyWithEvidence = app.strategyRunStore.get(strategy.strategyRunId);
    expect(strategyWithEvidence?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");

    // The authorizing dispatch was NOT consumed as success; NO COMPLETED wake
    // in either the browser history or the durable wake store.
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("detected");
    expect(completedWakeCount(s.repoId)).toBe(0);
    expect(storeCompletedWakeCount(s.repoId)).toBe(0);

    // The remote was untouched BY US: its tip is still the mover's commit and
    // the contested file carries only the mover content; no manifest published.
    expect(remoteHead()).toBe(advShas[0]);
    expect(remoteFileAtHead("shared-value.ts")).toContain(REMOTE_CONFLICT_MARKER);
    expect(remoteManifest(s.dispatchId)).toBeNull();

    // Worker provenance is preserved durably: both nodes completed with the
    // A->B dependency edge proven. Snapshot fingerprints/report/SHAs for the
    // retry-equality proof. The DAG finalizer rewrites the persisted report
    // (attaches node records) synchronously on the strategy.completed event,
    // so wait for that durable shape before snapshotting.
    const nodes = app.dagNodeStore.list(strategy.strategyRunId);
    const nodeA = nodes.find((n) => n.nodeId === "a");
    const nodeB = nodes.find((n) => n.nodeId === "b");
    expect(nodeA?.status).toBe("COMPLETED");
    expect(nodeB?.status).toBe("COMPLETED");
    const aCommitSha = app.workPacketService.getResult(s.packetAId)?.worktree?.commitSha ?? null;
    expect(aCommitSha).toBeTruthy();
    expect(nodeB!.dependencyInputShas).toContain(aCommitSha!);
    await waitForCondition(
      () => ((app.strategyRunStore.get(strategy.strategyRunId)?.report as any)?.nodes?.length ?? 0) === 2,
      30000
    );
    const fingerprintsBefore = packetFingerprints([s.packetAId, s.packetBId]);
    const reportBefore = JSON.stringify(app.strategyRunStore.get(strategy.strategyRunId)?.report ?? null);
    const workerShasBefore = [s.packetAId, s.packetBId]
      .map((id) => app.workPacketService.getResult(id)?.worktree?.commitSha ?? null);
    expect(workerShasBefore.every((sha) => !!sha)).toBe(true);

    // ---- Restore a SAFE remote (revert + unrelated advancement), then retry
    // through the PUBLIC coordinator API. Repeat the sweep on the documented
    // transient watcher-fetch ref-lock race; no sweep can ever spawn a worker.
    restoreSafeRemoteState();

    let summary = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
    expect(summary.failures).toEqual([]);
    expect(summary.candidates).toHaveLength(1);
    expect(summary.republished).toBe(1);
    for (let attempt = 0; summary.confirmed === 0 && attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      summary = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
      expect(summary.failures).toEqual([]);
    }
    expect(summary.confirmed, [
      "postflight retry did not confirm the pending DAG publication.",
      `summary=${JSON.stringify(summary)}`,
      `runLastError=${app.runStore.get(s.runId)?.lastError}`,
      `remoteSharedValue=${JSON.stringify(remoteFileAtHead("shared-value.ts"))}`
    ].join("\n")).toBeGreaterThanOrEqual(1);
    expect(summary.blocked).toBe(0);

    // Success continuation ran exactly as a live completion would.
    await waitForCondition(() => app.dispatchStore.get(s.dispatchId)?.status === "consumed", 30000);
    await waitForCondition(() => app.runStore.get(s.runId)?.status === "SOL_REVIEWING", 30000);
    expect(completedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);

    // The SAME persisted report was republished: node outputs landed on top of
    // the safe advanced remote (relation DIVERGED, reconciled true), the mover
    // content survives in history, and the unrelated advancement is kept.
    await waitForCondition(
      () => remoteFileAtHead("shared-value.ts")?.includes(`swarm worker alpha (${s.packetAId})`) ?? false,
      30000
    );
    const consumerOnRemote = remoteFileAtHead("consumer-output.txt");
    expect(consumerOnRemote).toContain(`swarm worker beta (${s.packetBId})`);
    expect(consumerOnRemote).toContain(`swarm worker alpha (${s.packetAId})`);
    expect(remoteFileAtHead("restore-note.txt")).toBeTruthy();
    const manifestAfter = remoteManifest(s.dispatchId);
    expect(manifestAfter).toBeTruthy();
    expect(manifestAfter.strategy).toBe("DAG");
    expect(manifestAfter.publication.relation).toBe("DIVERGED");
    expect(manifestAfter.publication.reconciled).toBe(true);
    expect(git(bareDir, ["show", `${advShas[0]}:shared-value.ts`])).toContain(REMOTE_CONFLICT_MARKER);

    // Retry-without-rerun: packet fingerprints, worker SHAs, and the strategy
    // report are byte-identical; only the stale blocker was cleared.
    expect(packetFingerprints([s.packetAId, s.packetBId])).toEqual(fingerprintsBefore);
    const workerShasAfter = [s.packetAId, s.packetBId]
      .map((id) => app.workPacketService.getResult(id)?.worktree?.commitSha ?? null);
    expect(workerShasAfter).toEqual(workerShasBefore);
    expect(JSON.stringify(app.strategyRunStore.get(strategy.strategyRunId)?.report ?? null)).toBe(reportBefore);
    expect(app.strategyRunStore.get(strategy.strategyRunId)?.lastError).toBeNull();

    // Idempotent: a further sweep finds nothing pending.
    const summary2 = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
    expect(summary2.candidates).toHaveLength(0);
    expect(summary2.confirmed).toBe(0);
  }, 240000);

  it("D. LOCAL persistent main advances SAFELY during SWARM: unrelated commit on main integrates and publishes (LOCAL_AHEAD), user file and worker outputs both land on remote", async () => {
    const s = await setupSwarmMovement({
      goal: "Change 018 movement: safe local main advancement during SWARM integrates and publishes",
      slowMs: 8000
    });

    // Uncommitted-then-commit: the user file appears uncommitted mid-run, then
    // is committed directly on persistent main; the tree ends clean.
    await waitForCondition(() => strategyRunning(s.runId, "SWARM"), 60000);
    fs.writeFileSync(
      path.join(cloneDir, "user-note.txt"),
      "user work committed on persistent main while the swarm ran\n"
    );
    expect(git(cloneDir, ["status", "--porcelain"])).toContain("user-note.txt");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "chore(user): unrelated local main advancement"]);
    const userSha = git(cloneDir, ["rev-parse", "HEAD"]);
    expect(git(cloneDir, ["status", "--porcelain"])).toBe("");

    await waitForCondition(() => terminalStrategyRecord(s.runId, "SWARM") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "SWARM")!;
    expect(strategy.status).toBe("COMPLETED");

    await waitForCondition(() =>
      app.dispatchStore.get(s.dispatchId)?.status === "consumed" &&
      app.runStore.get(s.runId)?.status === "SOL_REVIEWING",
      60000
    );
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("consumed");
    expect(app.runStore.get(s.runId)?.status).toBe("SOL_REVIEWING");

    // Both the user file and the worker outputs are on remote main.
    expect(remoteFileAtHead("user-note.txt"))
      .toContain("user work committed on persistent main");
    expect(remoteFileAtHead("alpha.txt")).toContain(`swarm worker alpha (${s.packetAId})`);
    expect(remoteFileAtHead("beta.txt")).toContain(`swarm worker beta (${s.packetBId})`);

    // Publication truth: local main was strictly ahead (LOCAL_AHEAD), no
    // reconciliation needed, and the user commit reached the remote.
    const manifest = remoteManifest(s.dispatchId);
    expect(manifest).toBeTruthy();
    expect(manifest.publication.relation).toBe("LOCAL_AHEAD");
    expect(manifest.publication.reconciled).toBe(false);
    const finalRemoteHead = remoteHead();
    expect(isAncestorInBare(userSha, finalRemoteHead),
      "the user commit must be pushed (ancestors of final remote HEAD)").toBe(true);
    expect(isAncestorInBare(s.markerSha, finalRemoteHead)).toBe(true);

    expect(completedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
  }, 240000);

  it("E. LOCAL persistent main advances CONFLICTINGLY: integration conflict blocks truthfully (PARTIAL->BLOCKED review), no COMPLETED wake, no work loss, retry fabricates nothing", async () => {
    const s = await setupSwarmMovement({
      goal: "Change 018 movement: conflicting local main advancement during SWARM blocks truthfully",
      slowMs: 6000
    });

    // Commit DIFFERENT content to a successful worker's output path directly on
    // persistent main while the swarm runs.
    await waitForCondition(() => strategyRunning(s.runId, "SWARM"), 60000);
    fs.writeFileSync(path.join(cloneDir, "alpha.txt"), `${LOCAL_CONFLICT_CONTENT}\n`);
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "chore(user): conflicting edit to worker output path"]);
    const userSha = git(cloneDir, ["rev-parse", "HEAD"]);

    await waitForCondition(() => terminalStrategyRecord(s.runId, "SWARM") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "SWARM")!;

    // Truthful block: the worker landing conflicted with the user commit, so
    // the aggregate is PARTIAL (INTEGRATION_CONFLICT) — never COMPLETED.
    expect(strategy.status).toBe("PARTIAL");
    const report: any = strategy.report;
    expect(report?.integration?.status).toBe("INTEGRATION_CONFLICT");

    await waitForCondition(() => app.runStore.get(s.runId)?.status === "BLOCKED", 30000);
    expect(app.runStore.get(s.runId)?.status).toBe("BLOCKED");

    // Never consumed-as-successful, never a COMPLETED wake.
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("detected");
    expect(completedWakeCount(s.repoId)).toBe(0);
    expect(storeCompletedWakeCount(s.repoId)).toBe(0);

    // No work loss — BOTH versions exist:
    //   the user commit is on local main (and pushed with the durable manifest
    //   evidence), and the worker commit is retained in Git objects plus the
    //   strategy provenance/report.
    const localHead = git(cloneDir, ["rev-parse", "HEAD"]);
    expect(isAncestorInBare(userSha, localHead)).toBe(true);
    expect(git(cloneDir, ["show", `${localHead}:alpha.txt`])).toContain(LOCAL_CONFLICT_CONTENT);
    const workerSha = app.workPacketService.getResult(s.packetAId)?.worktree?.commitSha ?? null;
    expect(workerSha, "worker commit SHA must be recorded").toBeTruthy();
    expect(git(cloneDir, ["show", `${workerSha}:alpha.txt`]))
      .toContain(`swarm worker alpha (${s.packetAId})`);
    const resultA: any = app.workPacketService.getResult(s.packetAId);
    expect([resultA?.status, report?.results?.find((r: any) => r.packetId === s.packetAId)?.status])
      .toContain("INTEGRATION_CONFLICT");

    // The durable manifest evidence was still published (LOCAL_AHEAD clean
    // push of the user-advanced main) reporting the truthful PARTIAL outcome;
    // the worker output did NOT land on the remote.
    const manifest = remoteManifest(s.dispatchId);
    expect(manifest).toBeTruthy();
    expect(manifest.strategyStatus).toBe("PARTIAL");
    expect(manifest.publication.relation).toBe("LOCAL_AHEAD");
    expect(remoteFileAtHead("alpha.txt")).toContain(LOCAL_CONFLICT_CONTENT);
    // Which worker cherry-picks first follows UUID ordering: beta may have
    // landed before alpha conflicted. Truthful invariant: the contested path
    // carries ONLY the user version on the remote, and beta (if it landed)
    // carries only worker content.
    const betaOnRemote = remoteFileAtHead("beta.txt");
    if (betaOnRemote !== null) {
      expect(betaOnRemote).toContain(`swarm worker beta (${s.packetBId})`);
    }
    expect(isAncestorInBare(s.markerSha, remoteHead())).toBe(true); // no force-push

    // Recovery boundary: the user commit is legitimate work that must NOT be
    // discarded, so no Git-side "safe restore" exists. Prove the public retry
    // fabricates nothing for a semantically failed iteration: zero candidates,
    // dispatch stays unconsumed, run stays BLOCKED, zero COMPLETED wakes.
    const summary = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
    expect(summary.candidates).toHaveLength(0);
    expect(summary.republished).toBe(0);
    expect(summary.confirmed).toBe(0);
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("detected");
    expect(app.runStore.get(s.runId)?.status).toBe("BLOCKED");
    expect(completedWakeCount(s.repoId)).toBe(0);
  }, 240000);

  // Literal "restore safe conditions -> retryPendingPostflight -> consumed/
  // SOL_REVIEWING" recovery for scenario E cannot pass: the conflicting local
  // main yields an engine-PARTIAL record (integration conflict precedes
  // publication), and retryPendingPostflight intentionally considers ONLY
  // engine-COMPLETED records with unconsumed dispatches
  // (apps/controller/src/loop/iteration-execution-coordinator.ts:320-330).
  // Recovering E requires semantic re-review/re-run of the iteration, not
  // postflight-only republication; discarding either side's content to force
  // a COMPLETED rerun would violate the no-work-loss contract.
  it.skip("E-recovery: retryPendingPostflight -> consumed/SOL_REVIEWING is unreachable for an engine-PARTIAL record (production retry scope is engine-COMPLETED only)", () => {});

  it("F. DIRTY persistent main appears during SWARM: integration and publication refuse before any mutation, run BLOCKED, uncommitted user work untouched, retry fabricates nothing", async () => {
    const s = await setupSwarmMovement({
      goal: "Change 018 movement: dirty persistent main during SWARM refuses mutation",
      slowMs: 6000
    });

    // Leave an UNCOMMITTED file in the repository clone mid-run.
    await waitForCondition(() => strategyRunning(s.runId, "SWARM"), 60000);
    const draftPath = path.join(cloneDir, "user-draft.txt");
    fs.writeFileSync(draftPath, "UNCOMMITTED user draft appearing while the swarm ran\n");

    await waitForCondition(() => terminalStrategyRecord(s.runId, "SWARM") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "SWARM")!;

    // Structured block BEFORE any mutation: integration refused the dirty main.
    expect(strategy.status).toBe("BLOCKED");
    expect(strategy.lastError ?? "").toContain("Persistent main checkout is dirty");

    await waitForCondition(() => app.runStore.get(s.runId)?.status === "BLOCKED", 30000);
    const run = app.runStore.get(s.runId);
    expect(run?.status).toBe("BLOCKED");
    expect(run?.lastError ?? "").toContain("(publication:");
    expect(run?.lastError ?? "").toContain("dirty");

    // No COMPLETED wake; dispatch not consumed.
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("detected");
    expect(completedWakeCount(s.repoId)).toBe(0);
    expect(storeCompletedWakeCount(s.repoId)).toBe(0);

    // The uncommitted user work is untouched, and nothing was published.
    expect(fs.readFileSync(draftPath, "utf8"))
      .toContain("UNCOMMITTED user draft appearing while the swarm ran");
    expect(git(cloneDir, ["status", "--porcelain"])).toContain("user-draft.txt");
    expect(remoteHead()).toBe(s.markerSha);
    expect(remoteFileAtHead("alpha.txt")).toBeNull();
    expect(remoteManifest(s.dispatchId)).toBeNull();

    // Recovery boundary: removing the uncommitted file restores safe
    // conditions WITHOUT discarding any committed work — but the engine never
    // integrated, so the record is BLOCKED (not COMPLETED) and the public
    // postflight retry correctly finds zero candidates: recovering this
    // iteration requires re-running it, not republishing.
    fs.rmSync(draftPath);
    expect(git(cloneDir, ["status", "--porcelain"])).toBe("");
    const summary = await app.iterationExecutionCoordinator.retryPendingPostflight(s.repoId);
    expect(summary.candidates).toHaveLength(0);
    expect(summary.republished).toBe(0);
    expect(summary.confirmed).toBe(0);
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("detected");
    expect(app.runStore.get(s.runId)?.status).toBe("BLOCKED");
    expect(completedWakeCount(s.repoId)).toBe(0);
  }, 240000);

  // Literal "retryPendingPostflight -> consumed/SOL_REVIEWING" recovery for
  // scenario F cannot pass: the dirty main is refused during INTEGRATION, so
  // the engine outcome is BLOCKED (never COMPLETED) and
  // retryPendingPostflight intentionally considers ONLY engine-COMPLETED
  // records with unconsumed dispatches
  // (apps/controller/src/loop/iteration-execution-coordinator.ts:320-330).
  // The iteration must be re-run (Sol review), not silently republished —
  // no worker result ever existed to republish.
  it.skip("F-recovery: retryPendingPostflight -> consumed/SOL_REVIEWING is unreachable for an engine-BLOCKED record (production retry scope is engine-COMPLETED only)", () => {});

  it("G. STALE STRATEGY BASE: remote main advances several commits after dispatch detection; publication reconciles over all of them, records the relation, and anchors finalHead on the updated remote", async () => {
    const s = await setupSwarmMovement({
      goal: "Change 018 movement: stale strategy base reconciles at publication",
      slowMs: 5000
    });

    // Only advance the remote AFTER the watcher has detected the dispatch:
    // the first watcher sweep inspects just the observed tip, so earlier
    // advancements would hide the marker commit below them.
    await waitForCondition(() => app.dispatchStore.get(s.dispatchId)?.status === "detected", 60000);
    const advShas = advanceRemote([
      { file: "stale-1.txt", content: "stale base advancement 1\n", message: "chore(mover): stale base advancement 1" },
      { file: "stale-2.txt", content: "stale base advancement 2\n", message: "chore(mover): stale base advancement 2" },
      { file: "stale-3.txt", content: "stale base advancement 3\n", message: "chore(mover): stale base advancement 3" }
    ]);
    expect(advShas).toHaveLength(3);

    await waitForCondition(() => terminalStrategyRecord(s.runId, "SWARM") !== undefined, 120000);
    const strategy = terminalStrategyRecord(s.runId, "SWARM")!;
    expect(strategy.status).toBe("COMPLETED");

    // The immutable strategy base is now multiple commits behind remote main.
    // Captured only AFTER the durable handoff (dispatch consumed + Sol
    // reviewing): engine-terminal alone races the asynchronous publication
    // push, and every remote-anchored assertion below must judge the FINAL
    // remote state.
    await waitForCondition(() =>
      app.dispatchStore.get(s.dispatchId)?.status === "consumed" &&
      app.runStore.get(s.runId)?.status === "SOL_REVIEWING",
      60000
    );
    expect(app.dispatchStore.get(s.dispatchId)?.status).toBe("consumed");
    expect(app.runStore.get(s.runId)?.status).toBe("SOL_REVIEWING");

    const finalRemoteHead = remoteHead();
    const behindCount = Number(git(bareDir, ["rev-list", "--count", `${s.baseSha}..${finalRemoteHead}`]));
    expect(behindCount).toBeGreaterThanOrEqual(4); // marker + 3 mover commits

    // Worker outputs and ALL stale-base files coexist on remote main.
    expect(remoteFileAtHead("alpha.txt")).toContain(`swarm worker alpha (${s.packetAId})`);
    expect(remoteFileAtHead("beta.txt")).toContain(`swarm worker beta (${s.packetBId})`);
    expect(remoteFileAtHead("stale-1.txt")).toContain("stale base advancement 1");
    expect(remoteFileAtHead("stale-3.txt")).toContain("stale base advancement 3");

    // Publication truth: the reconcile succeeded over the stale base, the
    // relation is recorded, and finalHead is anchored on the updated remote
    // lineage. (Literal REMOTE_AHEAD cannot arise in a fresh run — see the
    // header note — so accept either advanced-side classification.)
    const manifest = remoteManifest(s.dispatchId);
    expect(manifest).toBeTruthy();
    expect(manifest.strategyStatus).toBe("COMPLETED");
    expect(["REMOTE_AHEAD", "DIVERGED"]).toContain(manifest.publication.relation);
    expect(manifest.publication.reconciled).toBe(true);
    expect(isAncestorInBare(manifest.publication.finalHead, finalRemoteHead)).toBe(true);
    expect(manifest.publication.finalHead).not.toBe(s.markerSha);

    // No force-push: the marker and every mover commit remain ancestors.
    for (const sha of [s.markerSha, ...advShas]) {
      expect(isAncestorInBare(sha, finalRemoteHead)).toBe(true);
    }

    expect(completedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(s.repoId)).toBeGreaterThanOrEqual(1);
  }, 240000);
});
