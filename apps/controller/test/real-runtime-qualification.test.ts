/**
 * REAl RUNTIME QUALIFICATION TIER (Finding Q).
 *
 * This is NOT a simulation. It starts the assembled REAL controller services
 * (GitClient + Watcher + Loop + Executor + BrowserManager) against a real,
 * temporary git repository and a real bare remote, and proves the production
 * pipeline moves a dispatch end-to-end WITHOUT the test manually invoking any
 * internal transition method (no onDispatchDetected/onExecutorCompleted calls).
 *
 * The pipeline under test:
 *   remote git dispatch commit
 *     -> WatcherService poll detects it
 *     -> LoopService.onDispatchDetected (real wiring)
 *     -> ExecutorService starts a REAL child process (test harness profile)
 *     -> harness commits real work + durable result manifest, pushes to main
 *     -> ExecutorService reads/validates the manifest (real result contract)
 *     -> LoopService.onExecutorCompleted (real wiring)
 *     -> BrowserManager submits a Sol wake (real transport boundary, mock driver)
 *
 * If ChatGPT auth / Chromium / Tailscale / a real Kimi/Codex CLI are absent on
 * this machine, those sub-checks are explicitly marked UNQUALIFIED/MANUAL and
 * never faked green.
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
import { toWslPath } from "../src/wsl-path.js";
import type { RepositoryRecord } from "@orca/shared";

/** True when wsl.exe is present and the named distro has node available (Q.5). */
function wslDistroReady(distribution: string): boolean {
  try {
    execFileSync("wsl.exe", ["-d", distribution, "-e", "bash", "-lc", "command -v node"], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

const HARNESS_PATH = path.resolve(__dirname, "fixtures", "real-executor-harness.mjs");

// Make the real qualification tier self-contained: default the harness path so
// `npm run test:real` works without an externally exported env var. Q.WIN.2 still
// deletes the var and asserts the honest throw, so this default does not mask it.
if (!process.env.ORCA_TEST_EXECUTOR_HARNESS) {
  process.env.ORCA_TEST_EXECUTOR_HARNESS = HARNESS_PATH;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

function waitForCondition(fn: () => boolean, timeoutMs: number, everyMs = 150): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try {
        ok = fn();
      } catch {
        ok = false;
      }
      if (ok) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitForCondition timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

describe("Real Runtime Qualification (Q): assembled controller, real git + real child executor", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;
  let wakeStore: SolWakeStore;
  let solControlStore: SolControlStore;
  let runStore: RunStore;
  let watcherService: WatcherService;
  let executorService: ExecutorService;
  let browserManager: BrowserManager;
  let loopService: LoopService;
  let mockBrowser: MockBrowserDriver;
  let repo: RepositoryRecord;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-real-qual-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });

    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-qual@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca Qualification"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Orca Qualification Fixture\n");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "initial"]);
    git(cloneDir, ["remote", "add", "origin", bareDir]);
    git(cloneDir, ["push", "-u", "origin", "main"]);

    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    executorStore = new ExecutorStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    solControlStore = new SolControlStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);

    repo = {
      id: "repo-real-win",
      displayName: "Real Windows Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/real-qual-test",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    repoStore.create(repo);

    mockBrowser = new MockBrowserDriver();
    const gitClient = new GitClient();
    const commitInspector = new CommitInspector(gitClient);

    watcherService = new WatcherService({
      repoStore,
      dispatchStore,
      solControlStore,
      gitClient,
      commitInspector,
      pollIntervalMs: 250,
      onDispatchDetected: (rid, did) => void loopService.onDispatchDetected(rid, did),
      onControlDetected: (rid, cid, dec, runId) =>
        void loopService.onControlDetected(rid, cid, dec, runId)
    });

    executorService = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      gitClient,
      dataDir: tempDir,
      windowsAdapter: new WindowsPowerShellAdapter(),
      onExecutorCompleted: (rid, did, result) =>
        void loopService.onExecutorCompleted(rid, did, result)
    });

    browserManager = new BrowserManager({
      dataDir: tempDir,
      driver: mockBrowser,
      wakeStore
    });

    loopService = new LoopService({
      repoStore,
      dispatchStore,
      runStore,
      watcherService,
      executorService,
      browserManager,
      solControlStore
    });
  });

  afterEach(async () => {
    try {
      watcherService.stop();
      await browserManager.close().catch(() => {});
    } finally {
      dbCtx.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("Q.WIN.1 autonomous pipeline: remote dispatch -> watcher -> loop -> real executor process -> durable result -> loop -> Sol wake, without manual transition calls", async () => {
    // 1. Start a run. This is the ONLY explicit loop call; everything else is
    // driven by the watcher + real executor + real git. The initial Sol wake is
    // asynchronous (it submits a real wake transport), so the run may already be
    // in SOL_REVIEWING by the time we observe it.
    const run = await loopService.startRun(repo.id, {
      goal: "Real qualification run",
      maxIterations: 5
    });
    expect(["SOL_PENDING", "SOL_REVIEWING"]).toContain(run.status);

    // 2. Commit a real, ISOLATED dispatch marker into the clone and push to main.
    const dispatchId = `disp-real-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: run.id,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/009-real",
      goal: "Real qualification dispatch",
      instructionsVersion: 1
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`),
      JSON.stringify(marker, null, 2)
    );
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(cloneDir, ["push", "origin", "main"]);

    // 3. Start the REAL watcher. It must autonomously detect the dispatch and
    // drive the rest of the pipeline. No manual onDispatchDetected call.
    watcherService.start();

    // 4. Wait until the watcher->loop->executor->result->loop completes and the
    // dispatch is consumed (the loop marks it consumed after a valid result).
    await waitForCondition(
      () => dispatchStore.get(dispatchId)?.status === "consumed",
      60000
    );

    // 5. Assert the executor actually ran as a real child process and produced a
    // completed run record.
    const execRuns = executorStore.getByRepository(repo.id);
    expect(execRuns.length).toBeGreaterThan(0);
    const completedRun = execRuns.find((r) => r.status === "completed");
    expect(completedRun, "executor run should be completed by the real harness").toBeTruthy();

    // 6. Assert a Sol wake was submitted with the real COMPLETED result status.
    const wakes = wakeStore.getByRepository(repo.id);
    expect(wakes.length).toBeGreaterThan(0);
    // History is retained after the page closes (mock browser semantics).
    const page = mockBrowser.history.get(repo.id);
    expect(page, "sol wake page should exist in history").toBeTruthy();
    const wakeText = (page?.typedMessages ?? []).map((m) => m.text).join("\n");
    expect(wakeText).toMatch(/COMPLETED/);

    // 7. The durable result manifest must exist on main and be committed/pushed.
    const remoteResultPath = `.orca/results/${dispatchId}.json`;
    const remoteHead = git(bareDir, ["rev-parse", "HEAD"]);
    const resultSha = git(bareDir, ["rev-parse", `${remoteHead}:${remoteResultPath}`]);
    expect(resultSha).toBeTruthy();

    const loopStatus = loopService.getStatus(repo.id);
    expect(loopStatus.state).toBe("SOL_REVIEWING");

    watcherService.stop();
  }, 120000);

  it("Q.WIN.2 truthfully reports UNQUALIFIED when the real executor harness env is missing", async () => {
    // If ORCA_TEST_EXECUTOR_HARNESS is unset, the test profile must throw rather
    // than silently fake a pass. We assert the harness build path is honest.
    const saved = process.env.ORCA_TEST_EXECUTOR_HARNESS;
    delete process.env.ORCA_TEST_EXECUTOR_HARNESS;
    try {
      const { buildTestInvocation } = await import("../src/executor/profiles.js");
      expect(() =>
        buildTestInvocation({ cli: "orca-test-harness", model: "m", prompt: "p" })
      ).toThrow(/ORCA_TEST_EXECUTOR_HARNESS/);
    } finally {
      if (saved) process.env.ORCA_TEST_EXECUTOR_HARNESS = saved;
    }
  });

  it("Q.WIN.WSL.1 autonomous pipeline via REAL wsl.exe executor with a Linux working tree", async () => {
    // This is the genuine WSL execution path (C/Q.5): the executor runs through
    // wsl.exe -d Ubuntu --cd <linux working tree> -- node <harness>. It must NOT
    // be skipped silently; if WSL or a node-capable distro is missing on this
    // machine we mark it UNQUALIFIED rather than faking green.
    const distribution = "Ubuntu";
    if (!wslDistroReady(distribution)) {
      console.warn(
        `Q.WIN.WSL.1 SKIPPED: wsl.exe distro '${distribution}' with node not available; UNQUALIFIED on this machine.`
      );
      this.skip();
      return;
    }

    // The Windows-side watcher reads the bare remote via the Windows path, but the
    // WSL executor must push through the Linux mount path. Repoint the clone's
    // origin to the WSL path so the executor's `git push` reaches the same bare
    // repo without a Windows cwd under Linux.
    const wslBarePath = toWslPath(bareDir);

    const wslRepo: RepositoryRecord = {
      ...repo,
      id: "repo-real-wsl",
      displayName: "Real WSL Repo",
      environment: "wsl",
      wslDistribution: distribution,
      solConversationUrl: "https://chatgpt.com/c/real-qual-wsl-test"
    };
    repoStore.create(wslRepo);

    const run = await loopService.startRun(wslRepo.id, {
      goal: "Real WSL qualification run",
      maxIterations: 5
    });
    expect(["SOL_PENDING", "SOL_REVIEWING"]).toContain(run.status);

    // Commit a real isolated dispatch marker and push it (Windows-side, before the
    // origin remote is repointed for the WSL executor).
    const dispatchId = `disp-real-wsl-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: run.id,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/009-real",
      goal: "Real WSL qualification dispatch",
      instructionsVersion: 1
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`),
      JSON.stringify(marker, null, 2)
    );
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(cloneDir, ["push", "origin", "main"]);

    // Repoint the clone origin to the WSL mount path for the executor turn.
    git(cloneDir, ["remote", "set-url", "origin", wslBarePath]);

    watcherService.start();

    await waitForCondition(
      () => dispatchStore.get(dispatchId)?.status === "consumed",
      120000
    );

    const execRuns = executorStore.getByRepository(wslRepo.id);
    expect(execRuns.length).toBeGreaterThan(0);
    expect(
      execRuns.find((r) => r.status === "completed"),
      "WSL executor run should be completed by the real harness"
    ).toBeTruthy();

    const wakes = wakeStore.getByRepository(wslRepo.id);
    expect(wakes.length).toBeGreaterThan(0);
    const page = mockBrowser.history.get(wslRepo.id);
    expect(page, "sol wake page should exist in history").toBeTruthy();
    const wakeText = (page?.typedMessages ?? []).map((t) => t.text).join("\n");
    expect(wakeText).toMatch(/COMPLETED/);

    // The durable result manifest must exist on main (committed by the WSL executor).
    const remoteResultPath = `.orca/results/${dispatchId}.json`;
    const remoteHead = git(bareDir, ["rev-parse", "HEAD"]);
    const resultSha = git(bareDir, ["rev-parse", `${remoteHead}:${remoteResultPath}`]);
    expect(resultSha).toBeTruthy();

    const loopStatus = loopService.getStatus(wslRepo.id);
    expect(loopStatus.state).toBe("SOL_REVIEWING");

    watcherService.stop();
  }, 180000);
});
