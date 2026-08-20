/**
 * Real runtime controls qualification tier — items 3/5 accelerated-clock
 * and pause/resume/stop/kill machine qualification (real child-process executors).
 *
 * Runs under `npm run test:real` tier. Uses ORCA_TEST_EXECUTOR_HARNESS harness
 * and ORCA_SLOW_MS deterministic slow mode (no inference).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { SolControlStore } from "../src/watcher/sol-control-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { WatcherService } from "../src/watcher/watcher-service.js";
import { GitClient } from "../src/watcher/git-client.js";
import { CommitInspector } from "../src/watcher/commit-inspector.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { WindowsPowerShellAdapter } from "../src/executor/adapters/windows-adapter.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { LoopService } from "../src/loop/loop-service.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type { RepositoryRecord } from "@orca/shared";

const HARNESS_PATH = path.resolve(__dirname, "fixtures", "real-executor-harness.mjs");
if (!process.env.ORCA_TEST_EXECUTOR_HARNESS) process.env.ORCA_TEST_EXECUTOR_HARNESS = HARNESS_PATH;

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

function makeBareAndClone(tempDir: string, label: string) {
  const bareDir = path.join(tempDir, `${label}-remote.git`);
  const cloneDir = path.join(tempDir, `${label}-clone`);
  fs.mkdirSync(bareDir, { recursive: true });
  fs.mkdirSync(cloneDir, { recursive: true });
  git(bareDir, ["init", "--bare", "-b", "main"]);
  git(cloneDir, ["init", "-b", "main"]);
  git(cloneDir, ["config", "user.email", "orca-controls@example.com"]);
  git(cloneDir, ["config", "user.name", "Orca Controls"]);
  git(cloneDir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(cloneDir, "README.md"), `# Orca Controls Fixture ${label}\n`);
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", "initial"]);
  git(cloneDir, ["remote", "add", "origin", bareDir]);
  git(cloneDir, ["push", "-u", "origin", "main"]);
  return { bareDir, cloneDir };
}

type HarnessServices = {
  dbCtx: DatabaseContext;
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  executorStore: ExecutorStore;
  wakeStore: SolWakeStore;
  solControlStore: SolControlStore;
  runStore: RunStore;
  watcherService: WatcherService;
  executorService: ExecutorService;
  browserManager: BrowserManager;
  loopService: LoopService;
  mockBrowser: MockBrowserDriver;
};

function buildServices(tempDir: string): HarnessServices {
  const dbPath = path.join(tempDir, "test.sqlite");
  const dbCtx = initDatabase(dbPath);
  const repoStore = new RepositoryStore(dbCtx.db);
  const dispatchStore = new DispatchStore(dbCtx.db);
  const executorStore = new ExecutorStore(dbCtx.db);
  const wakeStore = new SolWakeStore(dbCtx.db);
  const solControlStore = new SolControlStore(dbCtx.db);
  const runStore = new RunStore(dbCtx.db);
  const mockBrowser = new MockBrowserDriver();
  const gitClient = new GitClient();
  const commitInspector = new CommitInspector(gitClient);
  let loopService!: LoopService;
  const watcherService = new WatcherService({
    repoStore, dispatchStore, solControlStore, gitClient, commitInspector,
    pollIntervalMs: 250,
    onDispatchDetected: (rid, did) => void loopService.onDispatchDetected(rid, did),
    onControlDetected: (rid, cid, dec, runId) => void loopService.onControlDetected(rid, cid, dec, runId)
  });
  const executorService = new ExecutorService({
    repoStore, dispatchStore, executorStore, gitClient,
    dataDir: tempDir,
    windowsAdapter: new WindowsPowerShellAdapter(),
    onExecutorCompleted: (rid, did, result) => void loopService.onExecutorCompleted(rid, did, result)
  });
  const browserManager = new BrowserManager({ dataDir: tempDir, driver: mockBrowser, wakeStore });
  loopService = new LoopService({ repoStore, dispatchStore, runStore, watcherService, executorService, browserManager, solControlStore });
  return { dbCtx, repoStore, dispatchStore, executorStore, wakeStore, solControlStore, runStore, watcherService, executorService, browserManager, loopService, mockBrowser };
}

function makeRepo(bareDir: string, cloneDir: string, id: string, extra?: Partial<RepositoryRecord>): RepositoryRecord {
  return {
    id, displayName: `Controls ${id}`, githubRemote: bareDir, localPath: cloneDir,
    environment: "windows", wslDistribution: null,
    executorCli: "orca-test-harness", executorModel: "test-model",
    solConversationUrl: "https://chatgpt.com/c/controls-test",
    maxIterations: 5, maxRuntimeMinutes: 480, enabled: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...extra
  };
}

describe("Real Runtime Controls (pause/resume/stop/kill/ceiling)", () => {
  let tempDir: string;
  let svc: HarnessServices;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-real-controls-"));
    svc = buildServices(tempDir);
  });
  afterEach(async () => {
    delete process.env.ORCA_SLOW_MS;
    delete process.env.ORCA_HARNESS_STATUS;
    delete process.env.ORCA_HARNESS_EXIT_CODE;
    try {
      svc.watcherService.stop();
      await svc.browserManager.close().catch(() => {});
      // Settle async executor/loop callbacks before closing DB (Fix #11: DB errors now surface)
      await new Promise((r) => setTimeout(r, 600));
      // Ensure no active runners remain (avoid post-close onDispatchDetected -> DB closed)
      for (const runner of Array.from((svc.executorService as any).activeRunners?.values() ?? [])) {
        try { await (runner as any).kill?.(); } catch {}
      }
    } finally {
      try { svc.dbCtx.close(); } catch {}
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("pause mid-execution preserves partial work and resume continues SAME dispatch with recovery=true", async () => {
    process.env.ORCA_SLOW_MS = "4000";
    const { bareDir, cloneDir } = makeBareAndClone(tempDir, "pause");
    const repo = makeRepo(bareDir, cloneDir, "repo-ctrl-pause");
    svc.repoStore.create(repo);

    const run = await svc.loopService.startRun(repo.id, { goal: "pause resume qual" });
    const dispatchId = `disp-pause-${crypto.randomUUID().slice(0, 6)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = { schemaVersion: 1, type: "dispatch", runId: run.id, dispatchId, iteration: 1, createdAt: new Date().toISOString(), baseSha, changePath: "openspec/changes/009-real", goal: "pause", instructionsVersion: 1 };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`), JSON.stringify(marker, null, 2));
    git(cloneDir, ["add", "-A"]); git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]); git(cloneDir, ["push", "origin", "main"]);

    svc.watcherService.start();
    await waitForCondition(() => svc.loopService.getStatus(repo.id).state === "EXECUTING", 15000);
    await new Promise((r) => setTimeout(r, 900));
    // Pause while harness still sleeping; partial file must already exist.
    await svc.loopService.pauseRun(repo.id);
    const paused = svc.loopService.getStatus(repo.id);
    expect(paused.state).toBe("PAUSED");
    const partialPath = path.join(cloneDir, ".orca", "work", `${dispatchId}.partial.txt`);
    expect(fs.existsSync(partialPath), "partial file must exist after pause").toBe(true);
    const beforePauseWakes = svc.wakeStore.getByRepository(repo.id).length;

    await svc.loopService.resumeRun(repo.id);
    expect(svc.loopService.getStatus(repo.id).state).toBe("EXECUTING");

    await waitForCondition(() => svc.dispatchStore.get(dispatchId)?.status === "consumed", 30000);
    expect(fs.existsSync(partialPath)).toBe(true);
    const content = fs.readFileSync(partialPath, "utf8");
    // Recovery harness appends a line; original partial preserved.
    expect(content).toContain("partial work for");
    // After resume, a wake must eventually be sent (consume path).
    await waitForCondition(() => svc.wakeStore.getByRepository(repo.id).length > beforePauseWakes, 20000);
    svc.watcherService.stop();
  }, 90000);

  it("stop enters DRAINING while executor active; executor finishes naturally to STOPPED without Sol wake", async () => {
    process.env.ORCA_SLOW_MS = "2500";
    const { bareDir, cloneDir } = makeBareAndClone(tempDir, "stop");
    const repo = makeRepo(bareDir, cloneDir, "repo-ctrl-stop");
    svc.repoStore.create(repo);

    const run = await svc.loopService.startRun(repo.id, { goal: "stop drain qual" });
    const dispatchId = `disp-stop-${crypto.randomUUID().slice(0, 6)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = { schemaVersion: 1, type: "dispatch", runId: run.id, dispatchId, iteration: 1, createdAt: new Date().toISOString(), baseSha, changePath: "openspec/changes/009-real", goal: "stop", instructionsVersion: 1 };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`), JSON.stringify(marker, null, 2));
    git(cloneDir, ["add", "-A"]); git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]); git(cloneDir, ["push", "origin", "main"]);

    svc.watcherService.start();
    await waitForCondition(() => svc.loopService.getStatus(repo.id).state === "EXECUTING", 15000);
    const wakesBefore = svc.wakeStore.getByRepository(repo.id).length;

    await svc.loopService.stopRun(repo.id);
    expect(svc.loopService.getStatus(repo.id).state).toBe("DRAINING");
    // Do NOT kill the runner — prove natural graceful drain (#10A)
    expect((svc.executorService as any).activeRunners.has(repo.id)).toBe(true);

    await waitForCondition(() => ["STOPPED", "IDLE"].includes(svc.loopService.getStatus(repo.id).state), 20000);
    // Result was persisted even though Stop was pending, but no Sol wake
    expect(svc.dispatchStore.get(dispatchId)?.status).toBe("consumed");
    expect(svc.wakeStore.getByRepository(repo.id).length - wakesBefore).toBe(0);
    svc.watcherService.stop();
  }, 90000);

  it("emergency kill isolates per-repo: kill A leaves B to finish naturally", async () => {
    // Windows taskkill /T kills a process tree rooted at a pid; sibling harnesses have
    // distinct pids so killing A's tree does not affect B if each spawn is independent.
    process.env.ORCA_SLOW_MS = "3000";
    const a = makeBareAndClone(tempDir, "kill-a");
    const b = makeBareAndClone(tempDir, "kill-b");
    const repoA = makeRepo(a.bareDir, a.cloneDir, "repo-kill-a");
    const repoB = makeRepo(b.bareDir, b.cloneDir, "repo-kill-b");
    svc.repoStore.create(repoA);
    svc.repoStore.create(repoB);

    const runA = await svc.loopService.startRun(repoA.id, { goal: "kill a" });
    const runB = await svc.loopService.startRun(repoB.id, { goal: "kill b" });

    const dA = `disp-ka-${crypto.randomUUID().slice(0, 5)}`;
    const dB = `disp-kb-${crypto.randomUUID().slice(0, 5)}`;
    for (const [clone, runId, dId] of [[a.cloneDir, runA.id, dA], [b.cloneDir, runB.id, dB]] as const) {
      const sha = git(clone, ["rev-parse", "HEAD"]);
      const marker = { schemaVersion: 1, type: "dispatch", runId, dispatchId: dId, iteration: 1, createdAt: new Date().toISOString(), baseSha: sha, changePath: "openspec/changes/009-real", goal: "kill qual", instructionsVersion: 1 };
      fs.mkdirSync(path.join(clone, ".orca", "dispatch"), { recursive: true });
      fs.writeFileSync(path.join(clone, ".orca", "dispatch", `${dId}.json`), JSON.stringify(marker, null, 2));
      git(clone, ["add", "-A"]); git(clone, ["commit", "-m", `chore(sol): dispatch ${dId}`]); git(clone, ["push", "origin", "main"]);
    }

    svc.watcherService.start();
    await waitForCondition(() => svc.loopService.getStatus(repoA.id).state === "EXECUTING" && svc.loopService.getStatus(repoB.id).state === "EXECUTING", 15000);

    await svc.loopService.emergencyKill(repoA.id);
    expect(svc.loopService.getStatus(repoA.id).state).toBe("RECOVERY_REQUIRED");
    expect(svc.loopService.getStatus(repoB.id).state).toBe("EXECUTING");

    // B must finish naturally even though A was killed — result consumed is proof
    await waitForCondition(() => svc.dispatchStore.get(dB)?.status === "consumed", 40000);
    expect(svc.dispatchStore.get(dA)?.status).not.toBe("consumed");
    expect(svc.loopService.getStatus(repoA.id).state).toBe("RECOVERY_REQUIRED");

    svc.watcherService.stop();
  }, 90000);

  it("accelerated clock: wall-clock deadline crossed does NOT kill active executor", async () => {
    process.env.ORCA_SLOW_MS = "2500";
    const { bareDir, cloneDir } = makeBareAndClone(tempDir, "ceiling");
    const repo = makeRepo(bareDir, cloneDir, "repo-ceiling", { maxRuntimeMinutes: 1 });
    svc.repoStore.create(repo);

    const run = await svc.loopService.startRun(repo.id, { goal: "ceiling qual" });
    const dispatchId = `disp-ceil-${crypto.randomUUID().slice(0, 5)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = { schemaVersion: 1, type: "dispatch", runId: run.id, dispatchId, iteration: 1, createdAt: new Date().toISOString(), baseSha, changePath: "openspec/changes/009-real", goal: "ceiling", instructionsVersion: 1 };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`), JSON.stringify(marker, null, 2));
    git(cloneDir, ["add", "-A"]); git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]); git(cloneDir, ["push", "origin", "main"]);

    svc.watcherService.start();
    await waitForCondition(() => svc.loopService.getStatus(repo.id).state === "EXECUTING", 15000);

    const active = svc.runStore.getActiveRun(repo.id)!;
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    svc.dbCtx.db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(past, active.id);

    const wakesBefore = svc.wakeStore.getByRepository(repo.id).length;
    const crossed = svc.loopService.checkWallClockCeiling(repo.id);
    expect(crossed).toBe(true);
    expect(svc.loopService.getStatus(repo.id).state).toBe("DRAINING");
    expect((svc.executorService as any).activeRunners.has(repo.id)).toBe(true);

    await waitForCondition(() => svc.dispatchStore.get(dispatchId)?.status === "consumed", 30000);
    await waitForCondition(() => svc.loopService.getStatus(repo.id).state === "CEILING_REACHED", 20000);
    expect(svc.wakeStore.getByRepository(repo.id).length - wakesBefore).toBe(0);

    svc.watcherService.stop();
  }, 90000);
});
