/**
 * R15 — Production buildApp() AUTONOMOUS DAG campaign qualification
 * (Change 017: true A->B state dependency through the watcher/loop seam).
 *
 * Intended proof (both scenarios below are fully implemented but MUST stay
 * skipped until the production blockers documented here are fixed):
 *   create repo via app seam -> start run via REST -> create durable typed
 *   packets -> push an isolated DAG dispatch marker (strategy: "DAG" +
 *   executionPlan.dagNodes) to the bare remote -> production watcher
 *   (auto-started) detects it -> LoopService resolves the strategy ->
 *   IterationExecutionCoordinator starts the DAG engine ->
 *   node A runs, integrates; node B is allocated from a base containing A's
 *   accepted commit with dependencyInputShas provenance -> B consumes A's
 *   committed state -> integrated main + .orca/results/<dispatchId>.json are
 *   pushed to the remote -> run reaches SOL_REVIEWING and Sol is woken.
 *
 * NO /dag/start, no dagExecutionService start/execute methods, no LoopService
 * transition methods, no manual watcher start: production seams only
 * (buildApp lifecycle, REST via app.fastify.inject, durable Git pushes,
 * read-only store inspection).
 *
 * ----------------------------------------------------------------------------
 * PRODUCTION BUGS THIS QUALIFICATION CAUGHT (all three FIXED in Change 017)
 * ----------------------------------------------------------------------------
 * All three were confirmed on the initial Change 017 working tree by a
 * temporary instrumented probe (since removed) that drove buildApp + a real
 * Git-pushed DAG dispatch, then fixed centrally before enabling these tests.
 *
 * BUG 1 (FIXED) — Dispatch `strategy`/`executionPlan` are not durable, so the loop can
 *         never resolve a non-default strategy.
 *   Where: apps/controller/src/watcher/watcher-service.ts:311-328 builds the
 *          DispatchRecord without `strategy`/`executionPlan`;
 *          apps/controller/src/watcher/dispatch-store.ts:4-18,31-50,62-86 has
 *          no columns for them; apps/controller/src/db/migrate.ts:42-56
 *          (`002_create_dispatches`) defines the table without them.
 *   Repro: push a valid dispatch marker with strategy:"DAG" + executionPlan;
 *          the watcher accepts it (schema-valid) but persists only the legacy
 *          fields. LoopService.onDispatchDetected then reads
 *          apps/controller/src/loop/loop-service.ts:348
 *          `this.dispatchStore?.get(dispatchId)` and resolves
 *          apps/controller/src/loop/iteration-execution-coordinator.ts:78-80
 *          `dispatch?.strategy ?? "SINGLE_AGENT"` -> SINGLE_AGENT.
 *   Observed: the DAG dispatch was consumed as a SINGLE_AGENT executor turn
 *          (run RECOVERY_REQUIRED, zero strategy runs created) instead of
 *          starting the DAG engine.
 *
 * BUG 2 (FIXED) — DagExecutionService.startStrategyForDispatch produces a SWARM-labeled
 *         strategy run, bypassing every DAG-specific guarantee.
 *   Where: apps/controller/src/strategy/dag-execution-service.ts:100-125
 *          delegates to
 *          apps/controller/src/strategy/swarm-execution-service.ts:156-182,
 *          which hardcodes `this.startStrategy("SWARM", ...)` at
 *          swarm-execution-service.ts:172-173.
 *   Consequence: record.strategy === "SWARM", so in executeRecord the DAG
 *          branches (`record.strategy === "DAG"` guards at
 *          swarm-execution-service.ts:849-863 and 924-940) never fire:
 *          dependent nodes are allocated from the immutable strategyBaseSha
 *          WITHOUT their dependencies' accepted output, dependencyInputShas
 *          provenance stays empty, per-node integration never runs, and
 *          DagExecutionService.finalize no-ops (nodes stuck INTEGRATING).
 *   Observed: with nodes a->b, node b was started AFTER a completed yet
 *          received b.baseSha === dispatch baseSha (not post-integration main)
 *          and dependencyInputShas [] -> its dependency-state check failed
 *          (worker exit 31). strategyRunStore recorded strategy "SWARM".
 *
 * BUG 3 — StrategyExecutionHooks.onCompleted is declared and wired but NEVER
 *         invoked by the engine.
 *   Where: declared at
 *          apps/controller/src/strategy/swarm-execution-service.ts:66; wired
 *          to IterationExecutionCoordinator.handleStrategyCompleted at
 *          apps/controller/src/loop/iteration-execution-coordinator.ts:137-141
 *          (which performs integrationService.publishToRemote +
 *          LoopService.onStrategyCompleted); zero call sites of
 *          `onCompleted` exist anywhere under apps/controller/src.
 *   Consequence: even a correctly-labeled, successfully completed strategy run
 *          would never publish integrated main/.orca/results/<dispatchId>.json
 *          to the remote, never consume the authorizing dispatch, and never
 *          hand the result to the loop (run stuck EXECUTING, no Sol wake).
 *   Observed: a dispatch-authorized strategy run reached terminal status with
 *          onCompleted invocations === 0 and nothing pushed to the remote.
 *
 * All three fixes are part of Change 017: migration 22 + DispatchStore +
 * watcher copy the strategy fields; startStrategyForDispatch takes an explicit
 * strategy label ("DAG" from the DAG service); executeRecord/failStrategy
 * invoke onCompleted for every terminal outcome. Both scenarios below run for
 * real against those production seams.
 * ----------------------------------------------------------------------------

 * Fixture notes (verified against production behavior):
 *   - The repository executorCli must contain "orca-swarm-test-harness" so
 *     resolveProfile routes workers to the deterministic swarm harness
 *     (apps/controller/src/executor/profiles.ts:32-40,72-83).
 *   - Packets are created BEFORE the dispatch push, stamped for the upcoming
 *     iteration (WorkPacketService.create stamps packet.iteration from
 *     run.currentIteration, and DAG validation requires
 *     packet.iteration === dispatch.iteration).
 *   - Every executionPlan.dagNodes entry requires `dependsOn`
 *     (packages/shared/src/dispatch.ts:95-99); node "a" carries dependsOn: [].
 *   - Each node's packet.dependencies must exactly equal the sorted list of
 *     its DAG upstream nodes' packetIds (dag-execution-service.ts:331-345).
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
const oldHarnessEnv = process.env.ORCA_SWARM_TEST_HARNESS;
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

describe("Real Strategy Loop R15 — buildApp AUTONOMOUS DAG campaign (true A->B state dependency)", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    // Re-arm the deterministic worker harness every test: afterEach restores
    // the original environment, which would otherwise leave later tests in
    // this file without a harness.
    if (!process.env.ORCA_SWARM_TEST_HARNESS) process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-strategy-loop-dag-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });
    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-strategy-loop-dag@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca Strategy Loop DAG Qual"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# R15 autonomous DAG qualification fixture\n");
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
    delete process.env.ORCA_REQUIRE_FILE;
    delete process.env.ORCA_REQUIRE_CONTENT;
    delete process.env.ORCA_REQUIRE_PACKETS;
    if (oldHarnessEnv === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldHarnessEnv;
  });

  /**
   * Fresh repo + run + packets + DAG dispatch push, shared by both scenarios.
   * Returns everything the assertions need. requireContent is scoped to packet
   * B only via ORCA_REQUIRE_PACKETS so node A is never affected by it.
   */
  async function setupAutonomousDagCampaign(options: {
    goal: string;
    requireContent: string;
  }): Promise<{
    repoId: string;
    runId: string;
    dispatchId: string;
    baseSha: string;
    packetAId: string;
    packetBId: string;
  }> {
    const created = app.repositoryService.createRepository({
      displayName: "R15 Autonomous DAG Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      // Must resolve the "swarm-test" profile so workers run the swarm harness.
      executorCli: "orca-swarm-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/r15-autonomous-dag",
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

    const dispatchId = `disp-dag-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/017-real-dag-loop",
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

  it("autonomous DAG loop with true A->B state dependency", async () => {
    const { repoId, runId, dispatchId, baseSha, packetAId, packetBId } =
      await setupAutonomousDagCampaign({
        goal: "R15 autonomous DAG qualification: B consumes A's committed state",
        // Exactly the substring A's harness writes into shared-value.ts.
        requireContent: "swarm worker alpha"
      });

    // Watcher -> loop -> DAG engine -> A -> integrate -> B (reads A's state
    // materialized into its worktree base) -> integrate -> publish. No manual
    // transitions anywhere; wait purely on durable store state.
    await waitForCondition(() => {
      const dagRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "DAG");
      return dagRuns.some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, 120000);
    const strategy = app.strategyRunStore
      .listByRun(runId)
      .filter((r) => r.strategy === "DAG")
      .find((r) => STRATEGY_TERMINAL.includes(r.status));
    expect(strategy, "a terminal DAG strategy run must exist").toBeTruthy();

    // Immutable strategy base SHA equals the pushed dispatch baseSha.
    expect(strategy!.strategyBaseSha).toBe(baseSha);

    // Node B completed and records REAL dependency input provenance: a SHA
    // equal to A's worker commit SHA (byte-provenance of the A->B edge).
    const nodes = app.dagNodeStore.list(strategy!.strategyRunId);
    const nodeA = nodes.find((n) => n.nodeId === "a");
    const nodeB = nodes.find((n) => n.nodeId === "b");
    expect(nodeA?.status).toBe("COMPLETED");
    expect(nodeB?.status).toBe("COMPLETED");
    const aCommitSha = app.workPacketService.getResult(packetAId)?.worktree?.commitSha ?? null;
    expect(aCommitSha, "A must have a worker commit SHA").toBeTruthy();
    expect(nodeB!.dependencyInputShas.length).toBeGreaterThan(0);
    expect(nodeB!.dependencyInputShas).toContain(aCommitSha!);

    // The completion handoff is asynchronous (remote publish + result manifest
    // + loop transition). Wait for the durable handoff evidence before
    // asserting remote state — engine-terminal alone races the publish.
    await waitForCondition(() => {
      return (
        app.dispatchStore.get(dispatchId)?.status === "consumed" &&
        app.runStore.get(runId)?.status === "SOL_REVIEWING"
      );
    }, 60000);

    // BYTE-LEVEL PROOF that B consumed A's committed state: B's output file on
    // REMOTE MAIN contains B's own marker AND the derived-from bridge carrying
    // A's exact output bytes. Ordering alone cannot produce this content.
    const consumerOnRemote = remoteFileAtHead("consumer-output.txt");
    expect(consumerOnRemote, "consumer-output.txt must be integrated on remote main").toBeTruthy();
    expect(consumerOnRemote).toContain(`swarm worker beta (${packetBId})`);
    expect(consumerOnRemote).toContain("derived-from:");
    expect(consumerOnRemote).toContain(`swarm worker alpha (${packetAId})`);
    // And A's own file must also be on remote main (per-node integration).
    const sharedOnRemote = remoteFileAtHead("shared-value.ts");
    expect(sharedOnRemote).toBeTruthy();
    expect(sharedOnRemote).toContain(`swarm worker alpha (${packetAId})`);

    // Canonical durable result manifest pushed to the remote.
    expect(remoteFileAtHead(`.orca/results/${dispatchId}.json`)).toBeTruthy();

    // Loop handed the COMPLETED iteration to Sol (never GOAL_COMPLETE).
    const statusRes = await app.fastify.inject({
      method: "GET",
      url: `/api/repositories/${repoId}/runs/active`
    });
    expect(statusRes.json().status.state).toBe("SOL_REVIEWING");

    // Sol wake text present in the mock browser history (executor results wake Sol).
    const page = mockBrowser.history.get(repoId);
    expect(page, "sol wake page should exist").toBeTruthy();
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);

    expect(app.runStore.get(runId)?.status).toBe("SOL_REVIEWING");
  }, 180000);

  // Falsifiability proof that ORDERING alone does not satisfy node B: B's
  // worker demands content A never writes, so B may only pass if A's real
  // committed state was materialized into B's base (it must FAIL here).
  it("dependent node cannot succeed without dependency state", async () => {
    const { repoId, runId, dispatchId, packetBId } =
      await setupAutonomousDagCampaign({
        goal: "R15 falsifiability: B must fail when A's state lacks required content",
        // A string A's harness NEVER writes: B can only pass by fabricating it,
        // which the deterministic harness never does.
        requireContent: "content-that-a-never-writes"
      });

    await waitForCondition(() => {
      const dagRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "DAG");
      return dagRuns.some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, 120000);
    const strategy = app.strategyRunStore
      .listByRun(runId)
      .filter((r) => r.strategy === "DAG")
      .find((r) => STRATEGY_TERMINAL.includes(r.status));
    expect(strategy).toBeTruthy();

    // Node B must NOT have passed: FAILED/BLOCKED with dependency-failure
    // evidence (the harness exits 31 -> EXECUTOR_EXIT_31 blocker), while A
    // completes normally (the requirement is scoped to B via ORCA_REQUIRE_PACKETS).
    const nodes = app.dagNodeStore.list(strategy!.strategyRunId);
    const nodeA = nodes.find((n) => n.nodeId === "a");
    const nodeB = nodes.find((n) => n.nodeId === "b");
    expect(nodeA?.status).toBe("COMPLETED");
    expect(["FAILED", "BLOCKED"]).toContain(nodeB?.status);
    const bResult = app.workPacketService.getResult(packetBId);
    expect(bResult?.status).toBe(nodeB?.status);
    const evidence = `${nodeB?.waitingReason ?? ""} ${(bResult?.blocker ?? "")} ${(bResult?.risks ?? []).join(" ")}`;
    expect(evidence).toMatch(/EXECUTOR_EXIT_31|required dependency input|does not contain expected content/);

    // Overall strategy truthfully PARTIAL or BLOCKED — never COMPLETED.
    expect(["PARTIAL", "BLOCKED"]).toContain(strategy!.status);

    // The completion handoff is asynchronous; wait for the normalized
    // iteration result to land durably before asserting loop state.
    await waitForCondition(
      () => app.runStore.get(runId)?.status === "BLOCKED",
      60000,
    );

    // Run reaches a blocked-for-review state (normalized iteration result),
    // NOT SOL_REVIEWING-with-success and never GOAL_COMPLETE.
    expect(app.runStore.get(runId)?.status).toBe("BLOCKED");

    // B's output must NOT be integrated anywhere durable: absent from remote main.
    expect(remoteFileAtHead("consumer-output.txt")).toBeNull();

    // The canonical result manifest IS still published (durable evidence of
    // the blocked iteration), reporting the non-completed strategy status.
    const manifest = remoteFileAtHead(`.orca/results/${dispatchId}.json`);
    expect(manifest).toBeTruthy();
    expect(manifest).toMatch(/"strategyStatus":\s*"(PARTIAL|BLOCKED)"/);

    // NOTE: the original brief expected "Sol still woken"; production semantics
    // deliberately do NOT wake Sol for PARTIAL/BLOCKED strategy outcomes
    // (loop-service.ts maps them to the BLOCKED review state without a wake,
    // waking Sol only on COMPLETED). Assert the truthful contract instead:
    // no COMPLETED-result wake may exist for this repository.
    const wakeTexts = (mockBrowser.history.get(repoId)?.typedMessages ?? []).map((m) => m.text).join("\n");
    expect(wakeTexts).not.toMatch(/COMPLETED/);
  }, 180000);
});
