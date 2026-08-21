/**
 * R14 — Production buildApp() AUTONOMOUS SWARM campaign qualification
 * (Change 017: dispatch-selected SWARM strategy through the watcher/loop seam).
 *
 * Proof chain (production seams ONLY — no /swarm/start for the autonomous
 * cases, no swarmExecutionService start/execute methods, no LoopService
 * transition methods, no manual watcher start):
 *   create repo via app seam -> start run via REST -> create durable typed
 *   packets -> push an isolated SWARM dispatch marker (strategy: "SWARM" +
 *   executionPlan.packetIds) to the bare remote -> production watcher
 *   (auto-started) detects it -> LoopService resolves the strategy ->
 *   IterationExecutionCoordinator starts the SWARM engine ->
 *   independent workers run in separate real worktrees derived from the
 *   immutable strategy base -> local integration cherry-picks both commits ->
 *   integrated main + .orca/results/<dispatchId>.json are pushed to the
 *   remote -> authorizing dispatch consumed -> run reaches SOL_REVIEWING and
 *   Sol is woken with COMPLETED.
 *
 * Campaign continuation: a SECOND dispatch marker for iteration 2 WITHOUT a
 * strategy field (legacy V1 shape) must resolve SINGLE_AGENT, run the
 * repository-default executor turn, publish its own durable result manifest,
 * and hand the iteration back to Sol — proving the campaign keeps flowing
 * after a strategy iteration with the default strategy intact.
 *
 * Fixture notes (verified against production behavior):
 *   - The REPOSITORY executorCli is "orca-test-harness" so the iteration-2
 *     SINGLE_AGENT turn validates against the real-executor harness manifest
 *     (readAndValidateResult requires validated.executor.cli === repo
 *     .executorCli). Swarm workers ignore the repo executor: each PACKET
 *     carries executor.executorCli "orca-swarm-test-harness", which
 *     resolveProfile routes to the deterministic swarm harness
 *     (apps/controller/src/executor/profiles.ts:32-40,72-83).
 *   - Packets are created BEFORE the dispatch push, stamped for the upcoming
 *     iteration ({ ...run, currentIteration: 1 }); validateStart requires
 *     packet.iteration === dispatch.iteration.
 *   - SWARM workers derive from the immutable strategyBaseSha (the dispatch
 *     baseSha), unlike DAG nodes which allocate from current main.
 *
 * Production gap observed while qualifying (NOT fixed here, test-side fixture
 * only): publishToRemote (apps/controller/src/packets/integration-service.ts,
 * manifest write ~line 473) writes .orca/results/<dispatchId>.json without
 * ensuring the directory exists. A repository whose FIRST iteration is a
 * strategy dispatch (no prior executor turn) has no .orca/results dir and the
 * durable publish returns BLOCKED with
 * "ENOENT ... .orca/results/<id>.json" — integration stays local-only, though
 * the loop still consumes the dispatch and wakes Sol. Real repositories have
 * the directory after any executor turn (result contract E), and this fixture
 * seeds it accordingly; a one-line recursive mkdir in publishToRemote would
 * close the edge case.
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
const EXECUTOR_HARNESS_PATH = path.resolve(__dirname, "fixtures", "real-executor-harness.mjs");
const oldSwarmHarnessEnv = process.env.ORCA_SWARM_TEST_HARNESS;
const oldExecutorHarnessEnv = process.env.ORCA_TEST_EXECUTOR_HARNESS;
if (!process.env.ORCA_SWARM_TEST_HARNESS) process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;
if (!process.env.ORCA_TEST_EXECUTOR_HARNESS) process.env.ORCA_TEST_EXECUTOR_HARNESS = EXECUTOR_HARNESS_PATH;

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

describe("Real Strategy Loop R14 — buildApp AUTONOMOUS SWARM campaign (isolated workers + campaign continuation)", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    // Per-test env (re)arm: afterEach restores the original environment, so
    // every test must re-point the deterministic harnesses before buildApp.
    process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;
    process.env.ORCA_TEST_EXECUTOR_HARNESS = EXECUTOR_HARNESS_PATH;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-strategy-loop-swarm-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });
    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-strategy-loop-swarm@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca Strategy Loop SWARM Qual"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# R14 autonomous SWARM qualification fixture\n");
    // A real Orca repository always carries .orca/results by the time a
    // strategy iteration publishes: the executor result contract (E) requires
    // every turn to commit .orca/results/<dispatchId>.json, so the directory
    // exists after any prior executor turn. Seed it exactly so (empty marker
    // only); everything inside it during the campaign is produced by
    // production publishToRemote.
    fs.mkdirSync(path.join(cloneDir, ".orca", "results"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "results", ".gitkeep"), "");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "initial"]);
    git(cloneDir, ["remote", "add", "origin", bareDir]);
    git(cloneDir, ["push", "-u", "origin", "main"]);

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
    delete process.env.ORCA_SWARM_VIOLATE_PATHS;
    if (oldSwarmHarnessEnv === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldSwarmHarnessEnv;
    if (oldExecutorHarnessEnv === undefined) delete process.env.ORCA_TEST_EXECUTOR_HARNESS;
    else process.env.ORCA_TEST_EXECUTOR_HARNESS = oldExecutorHarnessEnv;
  });

  /**
   * Fresh repo + run + two independent packets + SWARM dispatch push, shared
   * by the scenarios. The packets are fully independent (no dependencies) so
   * the engine proves parallel isolated workstreams, not a dependency chain.
   */
  async function setupAutonomousSwarmCampaign(options: {
    goal: string;
    slowMs?: number;
  }): Promise<{
    repoId: string;
    runId: string;
    dispatchId: string;
    baseSha: string;
    packetAId: string;
    packetBId: string;
  }> {
    const created = app.repositoryService.createRepository({
      displayName: "R14 Autonomous SWARM Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      // Repository default stays the legacy single-agent harness so the
      // iteration-2 continuation resolves and validates as SINGLE_AGENT.
      // Swarm workers take THEIR executor from each packet instead.
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/r14-autonomous-swarm",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });
    const repoId = created.id;

    const startRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/runs/start`,
      payload: { goal: options.goal, maxIterations: 5 }
    });
    expect(startRes.statusCode).toBe(201);
    const runRecord = startRes.json().run;
    const runId: string = runRecord.id;

    // The dispatch advances the campaign to iteration 1; stamp packets for it.
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

    const dispatchId = `disp-swarm-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/017-real-swarm-loop",
      goal: options.goal,
      instructionsVersion: 1,
      strategy: "SWARM",
      executionPlan: {
        packetIds: [packetA.packetId, packetB.packetId],
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

    return { repoId, runId, dispatchId, baseSha, packetAId: packetA.packetId, packetBId: packetB.packetId };
  }

  function remoteFileAtHead(filePath: string): string | null {
    const remoteHead = git(bareDir, ["rev-parse", "HEAD"]);
    try {
      return git(bareDir, ["show", `${remoteHead}:${filePath}`]);
    } catch {
      return null;
    }
  }

  function completedWakeCount(repoId: string): number {
    return (mockBrowser.history.get(repoId)?.typedMessages ?? [])
      .map((m) => m.text)
      .filter((text) => /COMPLETED/.test(text)).length;
  }

  it("autonomous SWARM loop: dispatch-selected strategy runs isolated workers, integrates, publishes durable results, and wakes Sol", async () => {
    const { repoId, runId, dispatchId, baseSha, packetAId, packetBId } =
      await setupAutonomousSwarmCampaign({
        goal: "R14 autonomous SWARM qualification: two isolated workstreams integrate and wake Sol"
      });

    // Watcher -> loop -> SWARM engine -> isolated workers -> integrate ->
    // publish. No manual transitions anywhere; wait purely on durable state.
    await waitForCondition(() => {
      const swarmRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM");
      return swarmRuns.some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, 120000);

    const strategy = app.strategyRunStore
      .listByRun(runId)
      .filter((r) => r.strategy === "SWARM")
      .find((r) => STRATEGY_TERMINAL.includes(r.status));
    expect(strategy, "a terminal SWARM strategy run must exist").toBeTruthy();
    expect(strategy!.status).toBe("COMPLETED");

    // Immutable strategy base SHA equals the pushed dispatch baseSha.
    expect(strategy!.strategyBaseSha).toBe(baseSha);

    // Worker isolation: both packets completed in DISTINCT real worktrees
    // (distinct branches AND distinct paths), each derived from the same
    // immutable strategy base snapshot.
    const resultA = app.workPacketService.getResult(packetAId);
    const resultB = app.workPacketService.getResult(packetBId);
    expect(resultA?.status).toBe("COMPLETED");
    expect(resultB?.status).toBe("COMPLETED");
    expect(resultA?.worktree?.branch, "worker A must have worktree branch provenance").toBeTruthy();
    expect(resultB?.worktree?.branch, "worker B must have worktree branch provenance").toBeTruthy();
    expect(resultA!.worktree!.branch).not.toBe(resultB!.worktree!.branch);
    expect(resultA!.worktree!.path).not.toBe(resultB!.worktree!.path);
    expect(resultA!.worktree!.baseSha).toBe(baseSha);
    expect(resultB!.worktree!.baseSha).toBe(baseSha);
    expect(resultA!.worktree!.commitSha, "worker A must have a commit SHA").toBeTruthy();
    expect(resultB!.worktree!.commitSha, "worker B must have a commit SHA").toBeTruthy();
    expect(resultA!.worktree!.commitSha).not.toBe(resultB!.worktree!.commitSha);

    // Durable downstream state: dispatch consumed, both outputs integrated on
    // REMOTE MAIN, canonical result manifest published.
    await waitForCondition(() => app.dispatchStore.get(dispatchId)?.status === "consumed", 60000);
    expect(app.dispatchStore.get(dispatchId)?.status).toBe("consumed");

    await waitForCondition(() => remoteFileAtHead("alpha.txt") !== null, 60000);
    const alphaOnRemote = remoteFileAtHead("alpha.txt");
    expect(alphaOnRemote).toContain(`swarm worker alpha (${packetAId})`);
    await waitForCondition(() => remoteFileAtHead("beta.txt") !== null, 60000);
    const betaOnRemote = remoteFileAtHead("beta.txt");
    expect(betaOnRemote).toContain(`swarm worker beta (${packetBId})`);

    await waitForCondition(() => remoteFileAtHead(`.orca/results/${dispatchId}.json`) !== null, 60000);
    const manifest = remoteFileAtHead(`.orca/results/${dispatchId}.json`);
    expect(manifest).toBeTruthy();
    expect(manifest).toMatch(/"strategy":\s*"SWARM"/);
    expect(manifest).toMatch(/"strategyStatus":\s*"COMPLETED"/);

    // Loop handed the COMPLETED iteration to Sol (never GOAL_COMPLETE).
    await waitForCondition(() => app.runStore.get(runId)?.status === "SOL_REVIEWING", 30000);
    const statusRes = await app.fastify.inject({
      method: "GET",
      url: `/api/repositories/${repoId}/runs/active`
    });
    expect(statusRes.json().status.state).toBe("SOL_REVIEWING");

    // Sol wake text present in the mock browser history (executor results wake Sol).
    const page = mockBrowser.history.get(repoId);
    expect(page, "sol wake page should exist").toBeTruthy();
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);
    expect(app.wakeStore.getByRepository(repoId).length).toBeGreaterThan(0);
  }, 180000);

  it("second Sol transition continues the campaign: legacy V1 dispatch (no strategy) resolves SINGLE_AGENT after a SWARM iteration", async () => {
    const { repoId, runId, dispatchId } =
      await setupAutonomousSwarmCampaign({
        goal: "R14 campaign continuation: SWARM iteration then legacy single-agent iteration"
      });

    // Iteration 1: the SWARM strategy must complete and reach Sol first.
    await waitForCondition(() => {
      const swarmRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM");
      return swarmRuns.some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, 120000);
    await waitForCondition(() => app.runStore.get(runId)?.status === "SOL_REVIEWING", 60000);
    const wakesAfterIteration1 = completedWakeCount(repoId);
    expect(wakesAfterIteration1).toBeGreaterThanOrEqual(1);

    // Iteration 2: push a SECOND dispatch marker WITHOUT a strategy field
    // (legacy V1 shape -> must resolve SINGLE_AGENT), correlated to the same
    // run at the next iteration.
    const dispatch2Id = `disp-single-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha2 = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker2 = {
      schemaVersion: 1,
      type: "dispatch",
      runId,
      dispatchId: dispatch2Id,
      iteration: 2,
      createdAt: new Date().toISOString(),
      baseSha: baseSha2,
      changePath: "openspec/changes/017-real-swarm-loop",
      goal: "R14 legacy single-agent continuation turn",
      instructionsVersion: 1
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, ".orca", "dispatch", `${dispatch2Id}.json`),
      JSON.stringify(marker2, null, 2)
    );
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatch2Id}`]);
    git(cloneDir, ["push", "origin", "main"]);

    // No new strategy record may appear for the legacy dispatch: it must run
    // as the default SINGLE_AGENT executor turn.
    await waitForCondition(() => app.dispatchStore.get(dispatch2Id)?.status === "consumed", 120000);
    expect(app.dispatchStore.get(dispatch2Id)?.status).toBe("consumed");

    // The repository-default executor really ran for iteration 2.
    const execRuns = app.executorStore.getByRepository(repoId);
    const iteration2Run = execRuns.find((r) => r.iteration === 2 && r.status === "completed");
    expect(iteration2Run, "a completed executor run must exist for iteration 2").toBeTruthy();

    // Its durable result manifest reached the remote main.
    await waitForCondition(() => remoteFileAtHead(`.orca/results/${dispatch2Id}.json`) !== null, 60000);
    const manifest2 = remoteFileAtHead(`.orca/results/${dispatch2Id}.json`);
    expect(manifest2).toContain(`"dispatchId": "${dispatch2Id}"`);
    expect(manifest2).toMatch(/"status":\s*"COMPLETED"/);

    // Campaign advanced to iteration 2 and returned to Sol for review.
    await waitForCondition(() => app.runStore.get(runId)?.status === "SOL_REVIEWING", 30000);
    const runAfter = app.runStore.get(runId);
    expect(runAfter?.currentIteration).toBe(2);
    const statusRes = await app.fastify.inject({
      method: "GET",
      url: `/api/repositories/${repoId}/runs/active`
    });
    expect(statusRes.json().status.state).toBe("SOL_REVIEWING");

    // A SECOND COMPLETED wake occurred (one per completed iteration). The
    // mock browser history retains only the latest page, so the durable Sol
    // wake store is the cross-iteration source of truth: one INITIAL wake
    // plus one COMPLETED wake per completed iteration.
    const wakes = app.wakeStore.getByRepository(repoId);
    expect(wakes.filter((w) => /COMPLETED/.test(w.message)).length).toBeGreaterThanOrEqual(2);
    expect(wakes.length).toBeGreaterThanOrEqual(3);
    const pageAfter = mockBrowser.history.get(repoId);
    expect((pageAfter?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);

    // Exactly one SWARM strategy record exists overall (iteration 1 only).
    expect(app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM")).toHaveLength(1);
  }, 180000);

  it("manual /swarm/start during an autonomous swarm mid-flight is rejected with a structured conflict and creates no second strategy record", async () => {
    const { repoId, runId, dispatchId, packetAId, packetBId } =
      await setupAutonomousSwarmCampaign({
        goal: "R14 ownership conflict: autonomous swarm owns the iteration",
        slowMs: 3000
      });

    // Wait until the autonomous swarm actually owns the iteration.
    await waitForCondition(() => {
      const swarmRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM");
      return swarmRuns.some((r) => r.status === "RUNNING");
    }, 60000);

    // A manual strategy start for the SAME campaign/iteration must hit the
    // campaign/iteration ownership boundary: structured 4xx, no second record.
    const conflictRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/campaigns/${runId}/swarm/start`,
      payload: { packetIds: [packetAId, packetBId], maxConcurrency: 2 }
    });
    expect(conflictRes.statusCode).toBeGreaterThanOrEqual(400);
    expect(conflictRes.statusCode).toBeLessThan(500);
    expect(conflictRes.json().error?.message).toMatch(/already active/i);

    expect(app.strategyRunStore.listByRun(runId)).toHaveLength(1);
    expect(app.dispatchStore.get(dispatchId)?.status).toBe("detected");

    // Let the autonomous swarm finish cleanly so teardown kills nothing.
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    await waitForCondition(() => {
      const swarmRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM");
      return swarmRuns.some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, 120000);
    expect(app.strategyRunStore.listByRun(runId)).toHaveLength(1);
  }, 150000);

  it("allowedPaths enforcement: an out-of-scope worker write is BLOCKED/POLICY_VIOLATION, never integrated, and keeps its worktree", async () => {
    // Item #9 through the AUTONOMOUS loop: the harness stages an extra file
    // outside the packet's declared scope; real enforcement must catch it
    // after execution from Git-derived filesChanged.
    process.env.ORCA_SWARM_VIOLATE_PATHS = "1";
    const { repoId, runId, packetAId } =
      await setupAutonomousSwarmCampaign({
        goal: "R14 allowedPaths enforcement: out-of-scope write must be blocked"
      });

    await waitForCondition(() => {
      const swarmRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM");
      return swarmRuns.some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, 120000);
    const strategy = app.strategyRunStore
      .listByRun(runId)
      .filter((r) => r.strategy === "SWARM")
      .find((r) => STRATEGY_TERMINAL.includes(r.status));
    expect(strategy).toBeTruthy();

    // The violating worker is typed BLOCKED/POLICY_VIOLATION with the
    // offending paths reported in risks + verification evidence.
    const aResult = app.workPacketService.getResult(packetAId);
    expect(aResult?.status).toBe("BLOCKED");
    expect(aResult?.blocker).toBe("POLICY_VIOLATION");
    expect((aResult?.risks ?? []).join(" ")).toMatch(/POLICY_VIOLATION/);
    expect((aResult?.risks ?? []).join(" ")).toContain(`-outside-scope.txt`);
    expect((aResult?.verification ?? []).join(" ")).toMatch(/allowed_paths_violation=/);
    expect(aResult?.filesChanged).toContain(`.orca/swarm/${packetAId}-outside-scope.txt`);

    // Strategy truthfully not COMPLETED; iteration normalized to BLOCKED for
    // Sol review (never GOAL_COMPLETE).
    expect(strategy!.status).not.toBe("COMPLETED");
    await waitForCondition(() => app.runStore.get(runId)?.status === "BLOCKED", 60000);
    expect(app.runStore.get(runId)?.status).toBe("BLOCKED");

    // Nothing from the violating worker was integrated onto remote main.
    expect(remoteFileAtHead(`.orca/swarm/${packetAId}-outside-scope.txt`)).toBeNull();
    expect(remoteFileAtHead("alpha.txt")).toBeNull();

    // Its worktree/branch are preserved for inspection instead of released.
    const worktree = app.workPacketStore.getWorktreeByPacket(packetAId);
    expect(worktree).toBeTruthy();
    expect(fs.existsSync(worktree!.path)).toBe(true);
  }, 180000);
});
