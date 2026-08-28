/**
 * Change 018 R1/R2 — Production buildApp() POSTFLIGHT qualification.
 *
 * Proof chain (production seams ONLY — buildApp lifecycle, REST via
 * app.fastify.inject, durable Git pushes, store inspection, and the public
 * coordinator retry API; no LoopService transition methods, no manual watcher
 * start, no direct IntegrationService calls):
 *
 *   A FAILED remote publication can never masquerade as successful iteration
 *   completion. An engine-COMPLETED SWARM strategy whose integrated main
 *   cannot be verifiably pushed to the remote leaves the run in
 *   RECOVERY_REQUIRED with durable POSTFLIGHT_BLOCKED evidence, keeps the
 *   authorizing dispatch unconsumed ("detected"), sends ZERO COMPLETED wakes,
 *   and is recoverable later — via `retryPendingPostflight` or automatically
 *   by the startup replay after a controller restart — WITHOUT rerunning any
 *   worker.
 *
 * Publication-failure forcing mechanism (deterministic, Git-only): while the
 * swarm workers are still running (ORCA_SWARM_HARNESS_SLOW_MS), a SECOND clone
 * of the same bare remote commits and pushes a file that will CONFLICT with
 * the strategy landing (same path a successful worker writes, different
 * content). When the engine finishes, publishToRemote classifies local main
 * vs origin/main as DIVERGED, the reconciliation rebase hits the conflicting
 * path, aborts, and returns the structured BLOCKED result
 * "Unsafe remote advancement: ..." (apps/controller/src/packets/
 * integration-service.ts, DIVERGED branch). For the PARTIAL scenario the
 * conflict targets the SUCCESSFUL worker's file: the failed worker never
 * lands its path, so conflicting on the failed packet's file would rebase
 * cleanly and publication would succeed.
 *
 * Safe-remote restore (still Git-only, ordinary non-force pushes from the
 * second clone): fetch + reset --hard origin/main, REVERT the conflicting
 * commit (this removes the contested path again — resetting alone would keep
 * the conflict and every republish would block identically), then add an
 * UNRELATED file and push. The resulting remote main no longer conflicts with
 * the strategy landing, so the retry rebases the integration commits cleanly
 * over the unrelated advancement and publishes.
 *
 * Fixture notes (verified against production behavior):
 *   - Same fixture style as real-strategy-loop-swarm.test.ts: .orca/results is
 *     seeded empty because a real Orca repository always carries it after any
 *     prior executor turn (result contract E); production publishToRemote now
 *     also mkdir -p's the directory defensively.
 *   - Swarm packets carry executor {role:"PRIMARY", executorCli:
 *     "orca-swarm-test-harness", model:"test-model", provider:null,
 *     source:"REPOSITORY_DEFAULT"}; the repository default stays
 *     "orca-test-harness". Packets are stamped for iteration 1 before the
 *     dispatch push.
 *   - The SWARM dispatch marker carries strategy:"SWARM" +
 *     executionPlan.packetIds and is pushed as an isolated
 *     .orca/dispatch/<id>.json commit; baseSha = clone HEAD before the marker.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
vi.setConfig({ hookTimeout: 60_000, testTimeout: 240_000 });
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

/** Content pushed from the SECOND clone onto a successful worker's output path. */
const CONFLICT_MARKER = "CONFLICTING-REMOTE-CONTENT diverged while the swarm ran";
/** Worker sleep long enough to interleave the adversarial remote push mid-flight. */
const WORKER_SLOW_MS = 6000;

describe("Real Strategy Postflight (Change 018) — failed remote publication never masquerades as iteration success", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let clone2Dir: string;
  let controllerDbPath: string;
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    // Per-test env (re)arm: afterEach restores the original environment.
    process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-strategy-postflight-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    clone2Dir = path.join(tempDir, "clone2");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });
    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-postflight@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca Postflight Qual"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Change 018 postflight qualification fixture\n");
    // Real repositories carry .orca/results after any prior executor turn; seed
    // it exactly so. Everything inside it during the campaign is produced by
    // production publishToRemote.
    fs.mkdirSync(path.join(cloneDir, ".orca", "results"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "results", ".gitkeep"), "");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "initial"]);
    git(cloneDir, ["remote", "add", "origin", bareDir]);
    git(cloneDir, ["push", "-u", "origin", "main"]);

    // Second clone of the SAME bare remote: the adversarial writer that
    // diverges remote main while the swarm owns the iteration.
    git(tempDir, ["clone", bareDir, clone2Dir]);
    git(clone2Dir, ["config", "user.email", "orca-postflight-adversary@example.com"]);
    git(clone2Dir, ["config", "user.name", "Orca Postflight Adversary"]);
    git(clone2Dir, ["config", "commit.gpgsign", "false"]);

    controllerDbPath = path.join(tempDir, "test.sqlite");
    const config = loadConfig({
      dbPath: controllerDbPath,
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
    if (oldSwarmHarnessEnv === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldSwarmHarnessEnv;
  });

  function remoteFileAtHead(filePath: string): string | null {
    const remoteHead = git(bareDir, ["rev-parse", "HEAD"]);
    try {
      return git(bareDir, ["show", `${remoteHead}:${filePath}`]);
    } catch {
      return null;
    }
  }

  function pageCompletedWakeCount(repoId: string): number {
    return (mockBrowser.history.get(repoId)?.typedMessages ?? [])
      .map((m) => m.text)
      .filter((text) => /COMPLETED/.test(text)).length;
  }

  function storeCompletedWakeCount(repoId: string): number {
    return app.wakeStore.getByRepository(repoId)
      .filter((w) => /COMPLETED/.test(w.message)).length;
  }

  function terminalSwarmRecord(runId: string) {
    return app.strategyRunStore.listByRun(runId)
      .filter((r) => r.strategy === "SWARM")
      .find((r) => STRATEGY_TERMINAL.includes(r.status));
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
   * Fresh repo + run + two independent packets + SWARM dispatch push, then an
   * adversarial CONFLICTING push to remote main WHILE the swarm runs, and a
   * wait for the strategy record to reach a terminal status. Returns the ids
   * needed for postflight assertions.
   */
  async function setupSwarmIterationWithConflictingRemote(options: {
    goal: string;
    /** Worker output path the adversary conflicts with. Must be a file a SUCCESSFUL worker writes when publication failure is required. */
    conflictFile: "alpha.txt" | "beta.txt";
    /** Workstream whose packet the harness fails (exit 17) before writing anything. */
    failWorkstream?: string;
  }): Promise<{
    repoId: string;
    runId: string;
    dispatchId: string;
    baseSha: string;
    packetAId: string;
    packetBId: string;
  }> {
    if (options.failWorkstream) {
      process.env.ORCA_SWARM_FAIL_PACKET = options.failWorkstream;
    }

    const created = app.repositoryService.createRepository({
      displayName: "Change 018 Postflight Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/change-018-postflight",
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

    process.env.ORCA_SWARM_HARNESS_SLOW_MS = String(WORKER_SLOW_MS);

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
      changePath: "openspec/changes/018-authoritative-publication",
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

    // Adversarial divergence WHILE the swarm owns the iteration: remote main
    // gains a commit touching the same path a successful worker will land,
    // with different content -> DIVERGED + unresolvable rebase conflict.
    await waitForCondition(() => {
      const swarmRuns = app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "SWARM");
      return swarmRuns.some((r) => r.status === "RUNNING");
    }, 60000);
    // Sync the adversary clone first: the dispatch marker commit advanced
    // remote main after this clone was created.
    git(clone2Dir, ["fetch", "origin"]);
    git(clone2Dir, ["reset", "--hard", "origin/main"]);
    fs.writeFileSync(path.join(clone2Dir, options.conflictFile), `${CONFLICT_MARKER}\n`);
    git(clone2Dir, ["add", "-A"]);
    git(clone2Dir, ["commit", "-m", "chore(adversary): conflicting remote advancement"]);
    git(clone2Dir, ["push", "origin", "main"]);

    await waitForCondition(() => terminalSwarmRecord(runId) !== undefined, 120000);

    return { repoId, runId, dispatchId, baseSha, packetAId: packetA.packetId, packetBId: packetB.packetId };
  }

  /**
   * Restore a SAFE remote state after the adversarial divergence using only
   * ordinary (non-force) pushes from the second clone: sync to origin/main,
   * REVERT the conflicting commit (removes the contested path again — a reset
   * alone would keep the conflict and every republish would block
   * identically), then add an UNRELATED file and push. The resulting remote
   * main no longer conflicts with the strategy landing, so republishing
   * rebases the integration commits cleanly over the unrelated advancement.
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
    git(clone2Dir, ["commit", "-m", "chore(adversary): unrelated remote advancement"]);
    git(clone2Dir, ["push", "origin", "main"]);
  }

  it("postflight gate: COMPLETED swarm over a conflicting remote stays RECOVERY_REQUIRED with zero COMPLETED wakes until retry republishes (workers never rerun)", async () => {
    const postflightEvents: any[] = [];
    app.eventBus.subscribe((event) => {
      if ((event as any).type === "loop.postflight_blocked") postflightEvents.push(event);
    });

    const { repoId, runId, dispatchId, baseSha, packetAId, packetBId } =
      await setupSwarmIterationWithConflictingRemote({
        goal: "Change 018: a failed remote publication must not complete the iteration",
        conflictFile: "alpha.txt"
      });

    // The ENGINE genuinely succeeded...
    const strategy = terminalSwarmRecord(runId);
    expect(strategy, "a terminal SWARM strategy record must exist").toBeTruthy();
    expect(strategy!.status).toBe("COMPLETED");
    expect(strategy!.strategyBaseSha).toBe(baseSha);

    // ...but engine success did NOT leak into the campaign: the unconfirmed
    // publication puts the run into RECOVERY_REQUIRED with durable evidence.
    await waitForCondition(() => app.runStore.get(runId)?.status === "RECOVERY_REQUIRED", 30000);
    const run = app.runStore.get(runId);
    expect(run?.status).toBe("RECOVERY_REQUIRED");
    expect(run?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");
    expect(run?.lastError ?? "").toContain("Unsafe remote advancement");

    // Durable evidence also on the strategy record itself (written by the
    // coordinator AFTER the engine's own terminal write, so re-read fresh).
    const strategyWithEvidence = app.strategyRunStore.get(strategy!.strategyRunId);
    expect(strategyWithEvidence?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");
    expect(strategyWithEvidence?.report).toEqual(strategy!.report);

    // The iteration was NOT applied as a successful completion. (Change 028
    // consumes the dispatch when the turn STARTS, so the durable completion
    // transition is what distinguishes success here.)
    expect(app.loopService.iterationCompletedSuccessfully(dispatchId)).toBe(false);

    // ZERO COMPLETED wakes: neither browser history nor the durable wake store.
    expect(pageCompletedWakeCount(repoId)).toBe(0);
    expect(storeCompletedWakeCount(repoId)).toBe(0);

    // Structured event carries the remote publication verdict.
    expect(postflightEvents.length).toBeGreaterThanOrEqual(1);
    const remoteData = postflightEvents[0].data.remote;
    expect(remoteData.status).toBe("BLOCKED");
    expect(remoteData.remoteVerified).toBe(false);
    expect(String(remoteData.blocker)).toContain("Unsafe remote advancement");

    // Nothing landed on remote main: the contested file still carries ONLY the
    // adversary content and no canonical result manifest was published.
    expect(remoteFileAtHead("alpha.txt")).toContain(CONFLICT_MARKER);
    expect(remoteFileAtHead(`.orca/results/${dispatchId}.json`)).toBeNull();

    // ---- Restore a safe remote, then retry through the public coordinator API.
    restoreSafeRemoteState();

    const fingerprintsBefore = packetFingerprints([packetAId, packetBId]);
    const reportBefore = JSON.stringify(app.strategyRunStore.get(strategy!.strategyRunId)?.report ?? null);
    const workerShasBefore = [packetAId, packetBId]
      .map((id) => app.workPacketService.getResult(id)?.worktree?.commitSha ?? null);

    // NOTE: the production watcher keeps fetching origin/main INSIDE the same
    // repository working tree every 5s (apps/controller/src/watcher/
    // watcher-service.ts:205). Rarely a fetch/ref-lock collision makes ONE
    // sweep transiently BLOCKED ("cannot lock ref 'refs/remotes/origin/main'")
    // — an environmental Git race, not a postflight defect: sweeps are
    // idempotent (the dispatch stays unconsumed until a publication is
    // confirmed) and the startup replay re-sweeps after any restart. Exercise
    // the PUBLIC retry API the way production recovery does: repeat the sweep
    // until the pending publication is confirmed. No sweep can ever spawn a
    // worker — retryPendingPostflight only republishes record.report.
    let summary = await app.iterationExecutionCoordinator.retryPendingPostflight(repoId);
    expect(summary.failures).toEqual([]);
    expect(summary.candidates).toHaveLength(1);
    expect(summary.republished).toBe(1);
    for (let attempt = 0; summary.confirmed === 0 && attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      summary = await app.iterationExecutionCoordinator.retryPendingPostflight(repoId);
      expect(summary.failures).toEqual([]);
    }
    expect(summary.confirmed, [
      "postflight retry did not confirm the pending publication.",
      `summary=${JSON.stringify(summary)}`,
      `strategyLastError=${app.strategyRunStore.get(strategy!.strategyRunId)?.lastError}`,
      `runLastError=${app.runStore.get(runId)?.lastError}`,
      `localStatus=${JSON.stringify(git(cloneDir, ["status", "--porcelain"]))}`,
      `remoteAlpha=${JSON.stringify(remoteFileAtHead("alpha.txt"))}`
    ].join("\n")).toBe(1);
    expect(summary.blocked).toBe(0);

    // Success continuation ran exactly as a live completion would:
    // dispatch consumed, Sol woken with COMPLETED, run SOL_REVIEWING.
    await waitForCondition(() => app.dispatchStore.get(dispatchId)?.status === "consumed", 30000);
    await waitForCondition(() => app.runStore.get(runId)?.status === "SOL_REVIEWING", 30000);
    expect(pageCompletedWakeCount(repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(repoId)).toBeGreaterThanOrEqual(1);

    // The SAME persisted report was republished: both worker outputs plus the
    // canonical manifest are now on remote main, reconciled over the
    // unrelated remote advancement (relation DIVERGED, reconciled true).
    await waitForCondition(
      () => remoteFileAtHead("alpha.txt")?.includes(`swarm worker alpha (${packetAId})`) ?? false,
      30000
    );
    expect(remoteFileAtHead("beta.txt")).toContain(`swarm worker beta (${packetBId})`);
    await waitForCondition(() => remoteFileAtHead(`.orca/results/${dispatchId}.json`) !== null, 30000);
    const manifest = remoteFileAtHead(`.orca/results/${dispatchId}.json`)!;
    expect(manifest).toMatch(/"strategyStatus":\s*"COMPLETED"/);
    expect(manifest).toMatch(/"relation":\s*"DIVERGED"/);
    expect(manifest).toMatch(/"reconciled":\s*true/);

    // Workers did NOT rerun: packet results, worker commit SHAs, and the
    // strategy report are byte-identical; only the stale blocker was cleared.
    expect(packetFingerprints([packetAId, packetBId])).toEqual(fingerprintsBefore);
    const workerShasAfter = [packetAId, packetBId]
      .map((id) => app.workPacketService.getResult(id)?.worktree?.commitSha ?? null);
    expect(workerShasAfter).toEqual(workerShasBefore);
    expect(JSON.stringify(app.strategyRunStore.get(strategy!.strategyRunId)?.report ?? null)).toBe(reportBefore);
    expect(app.strategyRunStore.get(strategy!.strategyRunId)?.lastError).toBeNull();

    // Idempotent: a second sweep finds nothing pending.
    const summary2 = await app.iterationExecutionCoordinator.retryPendingPostflight(repoId);
    expect(summary2.candidates).toHaveLength(0);
    expect(summary2.republished).toBe(0);
    expect(summary2.confirmed).toBe(0);
    expect(summary2.blocked).toBe(0);
  }, 240000);

  it("restart persistence: the startup replay republishes the SAME report after a full controller rebuild — dispatch consumed, Sol woken, no worker rerun, NO manual retry call", async () => {
    const { repoId, runId, dispatchId, packetAId, packetBId } =
      await setupSwarmIterationWithConflictingRemote({
        goal: "Change 018: pending postflight survives a controller restart",
        conflictFile: "alpha.txt"
      });

    // Reproduce the blocked state first.
    await waitForCondition(() => app.runStore.get(runId)?.status === "RECOVERY_REQUIRED", 30000);
    expect(app.loopService.iterationCompletedSuccessfully(dispatchId)).toBe(false);

    // Make the remote safe BEFORE the restart so the automatic replay can confirm.
    restoreSafeRemoteState();

    const fingerprintsBefore = packetFingerprints([packetAId, packetBId]);
    const strategyBefore = terminalSwarmRecord(runId);
    expect(strategyBefore?.status).toBe("COMPLETED");
    expect(strategyBefore?.lastError ?? "").toContain("POSTFLIGHT_BLOCKED:");

    // Full production teardown, then rebuild on the SAME dbPath/dataDir.
    await app.fastify.close();
    app.dbContext.close();
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(
      loadConfig({
        dbPath: controllerDbPath,
        dataDir: tempDir,
        logLevel: "silent",
        uiDistDir: null
      }),
      { browserDriver: mockBrowser }
    );

    // NO manual retry call here: buildApp replays pending publications after
    // restart reconciliation and BEFORE the watcher starts.
    await waitForCondition(() => app.dispatchStore.get(dispatchId)?.status === "consumed", 60000);
    await waitForCondition(() => app.runStore.get(runId)?.status === "SOL_REVIEWING", 60000);
    expect(pageCompletedWakeCount(repoId)).toBeGreaterThanOrEqual(1);
    expect(storeCompletedWakeCount(repoId)).toBeGreaterThanOrEqual(1);

    // No worker rerun across the restart: same strategy record, same packet
    // results/provenance, stale postflight evidence cleared on confirmation.
    expect(packetFingerprints([packetAId, packetBId])).toEqual(fingerprintsBefore);
    const strategyAfter = terminalSwarmRecord(runId);
    expect(strategyAfter?.strategyRunId).toBe(strategyBefore!.strategyRunId);
    expect(strategyAfter?.report).toEqual(strategyBefore!.report);
    expect(strategyAfter?.lastError).toBeNull();
  }, 240000);

  it("PARTIAL outcome with failed publication reflects BOTH truths: BLOCKED review state plus '(publication: ...)' evidence, dispatch unconsumed, zero COMPLETED wakes", async () => {
    const { repoId, runId, dispatchId, packetAId, packetBId } =
      await setupSwarmIterationWithConflictingRemote({
        goal: "Change 018: PARTIAL outcome plus failed publication",
        // Conflict with the SUCCESSFUL worker's file: the failed alpha worker
        // never lands alpha.txt, so conflicting there would rebase cleanly and
        // publication would succeed.
        conflictFile: "beta.txt",
        failWorkstream: "alpha"
      });

    // Semantic truth: one packet failed, one succeeded -> strategy PARTIAL.
    const strategy = terminalSwarmRecord(runId);
    expect(strategy, "a terminal SWARM strategy record must exist").toBeTruthy();
    expect(strategy!.status).toBe("PARTIAL");
    expect(app.workPacketService.getResult(packetAId)?.status).toBe("FAILED");
    expect(app.workPacketService.getResult(packetBId)?.status).toBe("COMPLETED");

    // Publication truth: the beta landing could not be reconciled/pushed, so
    // the run reflects BOTH the semantic review state AND the publication
    // failure appended to lastError.
    await waitForCondition(() => app.runStore.get(runId)?.status === "BLOCKED", 30000);
    const run = app.runStore.get(runId);
    expect(run?.status).toBe("BLOCKED");
    expect(run?.lastError ?? "").toContain("(publication:");
    expect(run?.lastError ?? "").toContain("Unsafe remote advancement");

    // A PARTIAL outcome never consumes the dispatch and never wakes Sol with
    // COMPLETED — regardless of what publication did.
    expect(app.loopService.iterationCompletedSuccessfully(dispatchId)).toBe(false);
    expect(pageCompletedWakeCount(repoId)).toBe(0);
    expect(storeCompletedWakeCount(repoId)).toBe(0);

    // Neither the semantic landing nor any manifest reached remote main: the
    // contested file still carries only the adversary content.
    expect(remoteFileAtHead("beta.txt")).toContain(CONFLICT_MARKER);
    expect(remoteFileAtHead(`.orca/results/${dispatchId}.json`)).toBeNull();
  }, 240000);
});
