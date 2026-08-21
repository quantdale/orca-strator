/**
 * Change 018 task 4.4 — Production SHUTDOWN/RESTART qualification WITHOUT
 * caller-side settling (SWARM + DAG, real deterministic child-process workers,
 * production buildApp lifecycle).
 *
 * The contract under qualification: since Change 018 R5, `app.fastify.close()`
 * alone is a genuine async shutdown — it stops admissions, routes KILL to every
 * active strategy actor, awaits child termination + engine settlement within a
 * bounded grace, persists recovery durably, and settles in-flight completion
 * callbacks BEFORE close resolves. Therefore the test does EXACTLY:
 *
 *   await app.fastify.close();
 *   app.dbContext.close();
 *
 * — no settleEngine-style polling, no extra waits beyond close resolving — and
 * then rebuilds `buildApp` on the SAME dbPath/dataDir. Any engine write that
 * lands after the DB close would surface as an unhandled error and fail this
 * vitest file; a false COMPLETED would surface in the durable assertions.
 *
 * Proof chain per scenario (production seams ONLY):
 *   create repo via app seam -> start run via REST -> create durable typed
 *   packets -> push an isolated dispatch marker (strategy + executionPlan) to
 *   the bare remote -> production watcher detects it -> engine starts slow
 *   workers (ORCA_SWARM_HARNESS_SLOW_MS=3000) -> once the strategy is RUNNING
 *   with live workers, production shutdown fires IMMEDIATELY -> rebuild on the
 *   same storage -> startup reconciler + recoverAll reconstruct the interrupted
 *   iteration deterministically:
 *     - run RECOVERY_REQUIRED;
 *     - exactly ONE strategy record, RECOVERY_REQUIRED (no duplicates, no
 *       resurrected workers over a ~3s observation window);
 *     - isolated worktree directories still exist for recovery;
 *     - packet results show NO false COMPLETED;
 *     - ZERO COMPLETED Sol wakes in total (wake store + browser history);
 *     - no unhandled DB-closed errors (vitest would fail the file).
 *
 * Scenario S additionally proves the rebuilt controller is fully functional
 * after recovery (admissions re-opened, autonomous loop intact): a brand-new
 * repository + run + SWARM dispatch driven through the production seams to
 * COMPLETED / SOL_REVIEWING with a real COMPLETED Sol wake on the REBUILT
 * instance.
 *
 * Fixture style is cloned from real-strategy-loop-swarm.test.ts /
 * real-strategy-loop-dag.test.ts: bare+clone Git pairs, MockBrowserDriver,
 * harness env save/restore with beforeEach re-arm, packets created against a
 * shallow `{ ...run, currentIteration: 1 }` view (the dispatch advances the
 * campaign to iteration 1 before the engine validates packet/iteration
 * correlation), dispatch markers pushed as isolated commits carrying
 * `strategy` + `executionPlan`. No fixed sleeps: every wait polls durable
 * state; stability windows assert absences.
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
import type {
  DispatchExecutionPlan,
  RepositoryRecord,
  RunRecord,
} from "@orca/shared";

const SWARM_HARNESS_PATH = path.resolve(__dirname, "fixtures", "swarm-worker-harness.mjs");
const oldHarnessEnv = process.env.ORCA_SWARM_TEST_HARNESS;
if (!process.env.ORCA_SWARM_TEST_HARNESS) process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Condition-based wait polling durable state only. */
async function waitForCondition(fn: () => boolean, timeoutMs: number, everyMs = 150): Promise<void> {
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
    `waitForCondition timed out after ${timeoutMs}ms${lastError ? ` (last error: ${String(lastError)})` : ""}`
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

/** Fresh bare remote + working clone with one seeded commit, pushed. */
function makeRepoPair(tempDir: string, label: string): { bareDir: string; cloneDir: string } {
  const bareDir = path.join(tempDir, `${label}-remote.git`);
  const cloneDir = path.join(tempDir, `${label}-clone`);
  fs.mkdirSync(bareDir, { recursive: true });
  fs.mkdirSync(cloneDir, { recursive: true });
  git(bareDir, ["init", "--bare", "-b", "main"]);
  git(cloneDir, ["init", "-b", "main"]);
  git(cloneDir, ["config", "user.email", `orca-shutdown-restart-${label}@example.com`]);
  git(cloneDir, ["config", "user.name", `Orca Shutdown Restart ${label}`]);
  git(cloneDir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(cloneDir, "README.md"), `# Shutdown/restart fixture ${label}\n`);
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", "initial"]);
  git(cloneDir, ["remote", "add", "origin", bareDir]);
  git(cloneDir, ["push", "-u", "origin", "main"]);
  return { bareDir, cloneDir };
}

describe("Change 018 task 4.4 — production shutdown/restart without caller-side settling (SWARM + DAG)", () => {
  let tempDir: string;
  let dbPath: string;
  let data: { bareDir: string; cloneDir: string };
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    // Per-test env (re)arm: afterEach restores the original environment, so
    // every test must re-point the deterministic harness before buildApp.
    process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-shutdown-restart-"));
    dbPath = path.join(tempDir, "test.sqlite");
    data = makeRepoPair(tempDir, "primary");

    const config = loadConfig({
      dbPath,
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
    delete process.env.ORCA_SWARM_WAIT_FILE;
    delete process.env.ORCA_SWARM_FAIL_PACKET;
    if (oldHarnessEnv === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldHarnessEnv;
  });

  /**
   * Fresh repo + run + two packets + dispatch-marker push for the requested
   * strategy, mirroring the real-strategy-loop-* fixtures. Slow mode is armed
   * BEFORE the push so the spawned workers run slowly enough for a live
   * mid-run shutdown.
   */
  async function setupMidRunCampaign(options: {
    label: string;
    goal: string;
    strategy: "SWARM" | "DAG";
  }): Promise<{
    repo: RepositoryRecord;
    run: RunRecord;
    dispatchId: string;
    baseSha: string;
    packetAId: string;
    packetBId: string;
  }> {
    const created = app.repositoryService.createRepository({
      displayName: `Shutdown Restart ${options.label}`,
      githubRemote: data.bareDir,
      localPath: data.cloneDir,
      environment: "windows",
      wslDistribution: null,
      // Routes workers to the deterministic swarm harness via resolveProfile.
      executorCli: "orca-swarm-test-harness",
      executorModel: "test-model",
      solConversationUrl: `https://chatgpt.com/c/shutdown-restart-${options.label.toLowerCase()}`,
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });

    const startRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${created.id}/runs/start`,
      payload: { goal: options.goal, maxIterations: 5 }
    });
    expect(startRes.statusCode).toBe(201);
    const run = startRes.json().run;

    // The dispatch advances the campaign to iteration 1; stamp packets for it.
    const packetExecutor = {
      role: "PRIMARY" as const,
      executorCli: created.executorCli,
      model: created.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT" as const
    };
    const packetA = app.workPacketService.create(created, { ...run, currentIteration: 1 }, {
      workstream: "alpha",
      goal: "Produce alpha.txt in an isolated worktree",
      allowedPaths: ["alpha.txt"],
      dependencies: [],
      executor: packetExecutor
    });
    // CRITICAL DAG RULE: B's packet dependencies equal its DAG upstream packetIds.
    const packetB = app.workPacketService.create(created, { ...run, currentIteration: 1 }, {
      workstream: "beta",
      goal: options.strategy === "DAG"
        ? "Consume A's committed state into beta.txt"
        : "Produce beta.txt in an isolated worktree",
      allowedPaths: ["beta.txt"],
      dependencies: options.strategy === "DAG" ? [packetA.packetId] : [],
      executor: packetExecutor
    });

    // Slow workers so the shutdown lands mid-run with LIVE children.
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "3000";

    const dispatchId = `disp-${options.strategy.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(data.cloneDir, ["rev-parse", "HEAD"]);
    const executionPlan: DispatchExecutionPlan = options.strategy === "DAG"
      ? {
          dagNodes: [
            { nodeId: "a", packetId: packetA.packetId, dependsOn: [] },
            { nodeId: "b", packetId: packetB.packetId, dependsOn: ["a"] }
          ],
          maxConcurrency: 2
        }
      : { packetIds: [packetA.packetId, packetB.packetId], maxConcurrency: 2 };
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: run.id,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/018-shutdown-restart",
      goal: options.goal,
      instructionsVersion: 1,
      strategy: options.strategy,
      executionPlan
    };
    fs.mkdirSync(path.join(data.cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(data.cloneDir, ".orca", "dispatch", `${dispatchId}.json`),
      JSON.stringify(marker, null, 2)
    );
    git(data.cloneDir, ["add", "-A"]);
    git(data.cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(data.cloneDir, ["push", "origin", "main"]);

    return {
      repo: created,
      run,
      dispatchId,
      baseSha,
      packetAId: packetA.packetId,
      packetBId: packetB.packetId
    };
  }

  /**
   * Wait until the dispatched strategy actor is RUNNING and every listed
   * packet is live (RUNNING => its worktree row exists). SWARM passes both
   * packets (maxConcurrency 2); DAG passes only node A (B waits on A).
   */
  async function waitForLiveStrategy(runId: string, packetIds: string[]): Promise<string> {
    await waitForCondition(() => {
      return app.strategyRunStore.listByRun(runId).some((record) => record.status === "RUNNING");
    }, 60000);
    const strategyRunId = app.strategyRunStore.getActiveForRun(runId)!.strategyRunId;
    await waitForCondition(() => {
      return packetIds.every((id) => app.workPacketService.get(id)?.status === "RUNNING");
    }, 45000);
    return strategyRunId;
  }

  function completedWakeExists(repoId: string): boolean {
    const stored = app.wakeStore.getByRepository(repoId).some((wake) => /COMPLETED/.test(wake.message));
    const typed = (mockBrowser.history.get(repoId)?.typedMessages ?? [])
      .map((message) => message.text)
      .some((text) => /COMPLETED/.test(text));
    return stored || typed;
  }

  /**
   * Shared deterministic-recovery assertions after PRODUCTION shutdown
   * (`fastify.close()` + `dbContext.close()` with NO caller-side settling)
   * and rebuild on the SAME dbPath/dataDir.
   */
  async function assertDeterministicRecovery(options: {
    repoId: string;
    runId: string;
    strategy: "SWARM" | "DAG";
    strategyRunId: string;
    packetIds: string[];
  }): Promise<void> {
    // Run + loop state land in RECOVERY_REQUIRED (persisted by
    // coordinator.shutdown pre-close or reconstructed by startup recovery).
    await waitForCondition(() => app.runStore.get(options.runId)?.status === "RECOVERY_REQUIRED", 30000);
    await waitForCondition(() => app.loopService.getStatus(options.repoId).state === "RECOVERY_REQUIRED", 30000);

    // Exactly ONE strategy record for the run, RECOVERY_REQUIRED, same identity.
    const strategies = app.strategyRunStore.listByRun(options.runId);
    expect(strategies).toHaveLength(1);
    expect(strategies[0]!.strategyRunId).toBe(options.strategyRunId);
    expect(strategies[0]!.status).toBe("RECOVERY_REQUIRED");
    expect(strategies[0]!.strategy).toBe(options.strategy);
    expect(app.runStore.get(options.runId)?.status).toBe("RECOVERY_REQUIRED");

    // Worktree directories survive the hard shutdown for recovery/inspection.
    // Row status may be ACTIVE (kill-finalize landed pre-close) or STALE
    // (worktreeIsolationService.recover marked the orphaned worktree on
    // restart) — either way the directory must still exist.
    for (const packetId of options.packetIds) {
      const worktree = app.workPacketStore.getWorktreeByPacket(packetId);
      if (worktree) {
        expect(["ACTIVE", "STALE"]).toContain(worktree.status);
        expect(fs.existsSync(worktree.path)).toBe(true);
      }
    }

    // No false COMPLETED anywhere: killed/recovered packets never report
    // success. A never-started packet (e.g. a DAG dependent) legitimately has
    // NO result row at all — null is truthful and passes this check.
    for (const packetId of options.packetIds) {
      expect(app.workPacketService.getResult(packetId)?.status).not.toBe("COMPLETED");
    }

    // ZERO COMPLETED Sol wakes in total across the whole lifecycle.
    expect(completedWakeExists(options.repoId)).toBe(false);

    // Observation window (~3s): no duplicate strategy records, no resurrected
    // workers, no further transitions.
    await expectStable(() => {
      expect(app.strategyRunStore.listByRun(options.runId)).toHaveLength(1);
      expect(app.strategyRunStore.getActiveForRun(options.runId)?.status).toBe("RECOVERY_REQUIRED");
      expect(app.runStore.get(options.runId)?.status).toBe("RECOVERY_REQUIRED");
      for (const packetId of options.packetIds) {
        const status = app.workPacketService.getResult(packetId)?.status;
        expect(status).not.toBe("RUNNING");
        expect(status).not.toBe("COMPLETED");
      }
      expect(completedWakeExists(options.repoId)).toBe(false);
    }, 3000);
  }

  it("SCENARIO S (SWARM): immediate production shutdown mid-run recovers deterministically; the rebuilt controller then runs a clean campaign to COMPLETED", async () => {
    // ---- Phase 1: live mid-run SWARM, then PRODUCTION SHUTDOWN (no settling).
    const s = await setupMidRunCampaign({
      label: "Swarm",
      goal: "Change 018 shutdown/restart SWARM qualification",
      strategy: "SWARM"
    });
    const strategyRunId = await waitForLiveStrategy(s.run.id, [s.packetAId, s.packetBId]);
    const worktreeBefore = app.workPacketStore.getWorktreeByPacket(s.packetAId);
    expect(worktreeBefore).toBeTruthy();
    expect(fs.existsSync(worktreeBefore!.path)).toBe(true);

    // PRODUCTION SHUTDOWN — exactly the two lines; close() itself awaits KILL
    // routing, engine settlement, recovery persistence and completion callbacks.
    await app.fastify.close();
    app.dbContext.close();

    // ---- Rebuild the whole controller on the SAME dbPath/dataDir.
    const config = loadConfig({
      dbPath,
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });

    await assertDeterministicRecovery({
      repoId: s.repo.id,
      runId: s.run.id,
      strategy: "SWARM",
      strategyRunId,
      packetIds: [s.packetAId, s.packetBId]
    });

    // ---- Phase R: the REBUILT controller is fully functional. Admissions
    // re-opened (the old coordinator was shutting down) and the autonomous
    // loop still drives a brand-new campaign to COMPLETED/SOL_REVIEWING.
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    const pair2 = makeRepoPair(tempDir, "secondary");
    const created2 = app.repositoryService.createRepository({
      displayName: "Shutdown Restart PostRecovery",
      githubRemote: pair2.bareDir,
      localPath: pair2.cloneDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-swarm-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/shutdown-restart-post-recovery",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });
    const startRes2 = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${created2.id}/runs/start`,
      payload: { goal: "post-recovery clean campaign qualification", maxIterations: 5 }
    });
    expect(startRes2.statusCode).toBe(201);
    const run2 = startRes2.json().run;

    const packetExecutor = {
      role: "PRIMARY" as const,
      executorCli: created2.executorCli,
      model: created2.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT" as const
    };
    const packetA2 = app.workPacketService.create(created2, { ...run2, currentIteration: 1 }, {
      workstream: "alpha",
      goal: "Produce alpha.txt after controller recovery",
      allowedPaths: ["alpha.txt"],
      dependencies: [],
      executor: packetExecutor
    });
    const packetB2 = app.workPacketService.create(created2, { ...run2, currentIteration: 1 }, {
      workstream: "beta",
      goal: "Produce beta.txt after controller recovery",
      allowedPaths: ["beta.txt"],
      dependencies: [],
      executor: packetExecutor
    });

    const dispatch2Id = `disp-swarm-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha2 = git(pair2.cloneDir, ["rev-parse", "HEAD"]);
    const marker2 = {
      schemaVersion: 1,
      type: "dispatch",
      runId: run2.id,
      dispatchId: dispatch2Id,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha: baseSha2,
      changePath: "openspec/changes/018-shutdown-restart",
      goal: "post-recovery clean campaign qualification",
      instructionsVersion: 1,
      strategy: "SWARM",
      executionPlan: { packetIds: [packetA2.packetId, packetB2.packetId], maxConcurrency: 2 }
    };
    fs.mkdirSync(path.join(pair2.cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(pair2.cloneDir, ".orca", "dispatch", `${dispatch2Id}.json`),
      JSON.stringify(marker2, null, 2)
    );
    git(pair2.cloneDir, ["add", "-A"]);
    git(pair2.cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatch2Id}`]);
    git(pair2.cloneDir, ["push", "origin", "main"]);

    // The recovered instance runs the FULL production loop to completion.
    await waitForCondition(() => {
      return app.strategyRunStore
        .listByRun(run2.id)
        .some((record) => record.status === "COMPLETED");
    }, 120000);
    expect(app.workPacketService.getResult(packetA2.packetId)?.status).toBe("COMPLETED");
    expect(app.workPacketService.getResult(packetB2.packetId)?.status).toBe("COMPLETED");
    await waitForCondition(() => app.dispatchStore.get(dispatch2Id)?.status === "consumed", 60000);
    await waitForCondition(() => app.runStore.get(run2.id)?.status === "SOL_REVIEWING", 60000);
    expect(completedWakeExists(created2.id)).toBe(true);
    // The recovered campaign stays untouched in RECOVERY_REQUIRED.
    expect(app.runStore.get(s.run.id)?.status).toBe("RECOVERY_REQUIRED");
    expect(app.strategyRunStore.listByRun(s.run.id)).toHaveLength(1);
  }, 300000);

  it("SCENARIO D (DAG): immediate production shutdown mid-run recovers deterministically with no false node completions", async () => {
    const d = await setupMidRunCampaign({
      label: "Dag",
      goal: "Change 018 shutdown/restart DAG qualification",
      strategy: "DAG"
    });
    // Only node A can be live: node B waits on A's dependency.
    const strategyRunId = await waitForLiveStrategy(d.run.id, [d.packetAId]);

    // PRODUCTION SHUTDOWN — no caller-side settling, then rebuild in place.
    await app.fastify.close();
    app.dbContext.close();

    const config = loadConfig({
      dbPath,
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });

    await assertDeterministicRecovery({
      repoId: d.repo.id,
      runId: d.run.id,
      strategy: "DAG",
      strategyRunId,
      packetIds: [d.packetAId, d.packetBId]
    });

    // DAG-specific truth: neither node may report success after the restart.
    // NOTE: node rows other than COMPLETED are intentionally not constrained
    // further: when the engine's kill-finalize lands before the DB closes,
    // recoverAll skips the already-terminal strategy and node rows keep their
    // truthful pre-kill statuses; when it does not land, recoverAll marks them
    // BLOCKED. Both paths are non-COMPLETED and single-record.
    const nodes = app.dagNodeStore.list(strategyRunId);
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.status).not.toBe("COMPLETED");
    }
  }, 240000);
});
