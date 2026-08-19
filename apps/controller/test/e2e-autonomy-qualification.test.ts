import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { WatcherService } from "../src/watcher/watcher-service.js";
import { GitClient } from "../src/watcher/git-client.js";
import { CommitInspector } from "../src/watcher/commit-inspector.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { LoopService } from "../src/loop/loop-service.js";
import { StartupReconciler } from "../src/loop/startup-reconciler.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import { shouldNotifyLoopState, type RepositoryRecord, type DispatchRecord, type ExecutorResult } from "@orca/shared";

/** Build a structurally valid COMPLETED executor result for simulation tests. */
function completedResult(
  dispatchId: string,
  runId: string,
  iteration: number
): ExecutorResult {
  return {
    schemaVersion: 1,
    type: "executor-result",
    runId,
    dispatchId,
    iteration,
    status: "COMPLETED",
    startedAt: "2026-08-19T12:00:00.000Z",
    finishedAt: "2026-08-19T12:05:00.000Z",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    resultSha: "0123456789abcdef0123456789abcdef01234567",
    executor: { cli: "codex", model: "gpt-5.6", environment: "windows" },
    verification: [{ name: "smoke", status: "PASS", summary: "ok" }],
    blockers: [],
    summary: "Completed simulation turn"
  };
}

describe("Milestone 8: End-to-End Autonomy Qualification Suite", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;
  let wakeStore: SolWakeStore;
  let runStore: RunStore;
  let loopService: LoopService;
  let fakeWindowsExecutor: FakeExecutorAdapter;
  let fakeWslExecutor: FakeExecutorAdapter;
  let mockBrowser: MockBrowserDriver;

  const mockRepoWindows: RepositoryRecord = {
    id: "repo-e2e-win",
    displayName: "Windows Native Repo",
    githubRemote: "https://github.com/quantdale/e2e-win.git",
    localPath: "D:\\Projects\\E2eWin",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-aaaa-8001-a123-1234567890ab",
    maxIterations: 3,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  const mockRepoWsl: RepositoryRecord = {
    id: "repo-e2e-wsl",
    displayName: "WSL Ubuntu Repo",
    githubRemote: "https://github.com/quantdale/e2e-wsl.git",
    localPath: "\\\\wsl$\\Ubuntu\\home\\user\\e2e-wsl",
    environment: "wsl",
    wslDistribution: "Ubuntu",
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-bbbb-8001-a123-1234567890ab",
    maxIterations: 3,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-e2e-qual-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    executorStore = new ExecutorStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);

    repoStore.create(mockRepoWindows);
    repoStore.create(mockRepoWsl);

    fakeWindowsExecutor = new FakeExecutorAdapter({ durationMs: 20 });
    fakeWslExecutor = new FakeExecutorAdapter({ durationMs: 20 });
    mockBrowser = new MockBrowserDriver();

    const gitClient = new GitClient();
    const commitInspector = new CommitInspector(gitClient);
    const watcherService = new WatcherService({
      repoStore,
      dispatchStore,
      gitClient,
      commitInspector,
      pollIntervalMs: 100000
    });

    const executorService = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: fakeWindowsExecutor,
      wslAdapter: fakeWslExecutor
    });

    const browserManager = new BrowserManager({
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
      browserManager
    });
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("8.T1 Multi-Repository Concurrent Matrix: Windows & WSL repos execute independent loops concurrently", async () => {
    // 1. Start runs on both repos
    const runWin = await loopService.startRun(mockRepoWindows.id, {
      goal: "Implement Windows feature",
      maxIterations: 3
    });
    const runWsl = await loopService.startRun(mockRepoWsl.id, {
      goal: "Implement WSL feature",
      maxIterations: 3
    });

    expect(runWin.status).toBe("SOL_REVIEWING");
    expect(runWsl.status).toBe("SOL_REVIEWING");

    // 2. Simulate dispatches detected for both
    const dispatchWin: DispatchRecord = {
      id: "disp-e2e-win-1",
      dispatchId: "disp-e2e-win-1",
      repositoryId: mockRepoWindows.id,
      runId: runWin.id,
      iteration: 1,
      commitSha: "1111111111111111111111111111111111111111",
      baseSha: "0000000000000000000000000000000000000000",
      changePath: "openspec/changes/001-win",
      goal: "Win step",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    const dispatchWsl: DispatchRecord = {
      id: "disp-e2e-wsl-1",
      dispatchId: "disp-e2e-wsl-1",
      repositoryId: mockRepoWsl.id,
      runId: runWsl.id,
      iteration: 1,
      commitSha: "2222222222222222222222222222222222222222",
      baseSha: "0000000000000000000000000000000000000000",
      changePath: "openspec/changes/001-wsl",
      goal: "WSL step",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    dispatchStore.create(dispatchWin);
    dispatchStore.create(dispatchWsl);

    // Launch executors concurrently
    await Promise.all([
      loopService.onDispatchDetected(mockRepoWindows.id, dispatchWin.id),
      loopService.onDispatchDetected(mockRepoWsl.id, dispatchWsl.id)
    ]);

    expect(loopService.getStatus(mockRepoWindows.id).state).toBe("EXECUTING");
    expect(loopService.getStatus(mockRepoWsl.id).state).toBe("EXECUTING");

    // Wait for executors to complete
    await new Promise((r) => setTimeout(r, 60));

    // Complete executors and advance to next Sol wakes
    await Promise.all([
      loopService.onExecutorCompleted(
        mockRepoWindows.id,
        dispatchWin.id,
        completedResult(dispatchWin.id, runWin.id, dispatchWin.iteration)
      ),
      loopService.onExecutorCompleted(
        mockRepoWsl.id,
        dispatchWsl.id,
        completedResult(dispatchWsl.id, runWsl.id, dispatchWsl.iteration)
      )
    ]);

    const statusWin = loopService.getStatus(mockRepoWindows.id);
    const statusWsl = loopService.getStatus(mockRepoWsl.id);

    expect(statusWin.state).toBe("SOL_REVIEWING");
    expect(statusWin.currentIteration).toBe(1);

    expect(statusWsl.state).toBe("SOL_REVIEWING");
    expect(statusWsl.currentIteration).toBe(1);
  });

  it("8.T2 Crash, Reboot, and Manual Recovery Qualification", async () => {
    // 1. Create in-flight run
    const run = await loopService.startRun(mockRepoWindows.id, {
      goal: "Crash qualification run",
      maxIterations: 5
    });

    // Simulate crash happening while in EXECUTING state
    runStore.updateStatus(run.id, "EXECUTING");

    // 2. Controller restarts -> StartupReconciler runs
    const reconciler = new StartupReconciler(repoStore, runStore, loopService);
    const reconcileSummary = await reconciler.reconcile();

    expect(reconcileSummary.reconciledCount).toBe(1);
    expect(reconcileSummary.recoveryRequiredCount).toBe(1);

    const crashedRun = runStore.get(run.id);
    expect(crashedRun?.status).toBe("RECOVERY_REQUIRED");
    expect(crashedRun?.lastError).toContain("Controller process restarted");

    // 3. User inspects and resolves recovery with retry
    const recovered = await loopService.recoverRun(mockRepoWindows.id, "retry");
    expect(recovered.status).toBe("SOL_REVIEWING");

    // State machine is healthy and ready to continue
    expect(loopService.getStatus(mockRepoWindows.id).state).toBe("SOL_REVIEWING");
  });

  it("8.T3 Safety Ceilings and Draining Qualification", async () => {
    const run = await loopService.startRun(mockRepoWindows.id, {
      goal: "Ceiling run",
      maxIterations: 1
    });

    const dispatch: DispatchRecord = {
      id: "disp-e2e-ceil-1",
      dispatchId: "disp-e2e-ceil-1",
      repositoryId: mockRepoWindows.id,
      runId: run.id,
      iteration: 1,
      commitSha: "3333333333333333333333333333333333333333",
      baseSha: "0000000000000000000000000000000000000000",
      changePath: "openspec/changes/001-ceil",
      goal: "Ceil step",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    dispatchStore.create(dispatch);

    // Detect the dispatch so the iteration is actually executed, then complete it.
    await loopService.onDispatchDetected(mockRepoWindows.id, dispatch.id);
    expect(loopService.getStatus(mockRepoWindows.id).state).toBe("EXECUTING");

    await loopService.onExecutorCompleted(
      mockRepoWindows.id,
      dispatch.id,
      completedResult(dispatch.id, run.id, dispatch.iteration)
    );

    const saved = runStore.get(run.id);
    // A ceiling crossing is NEVER GOAL_COMPLETE (G). It is CEILING_REACHED.
    expect(saved?.status).toBe("CEILING_REACHED");
    expect(saved?.finishedAt).not.toBeNull();
  });

  it("8.T4 Notification filtering accurately distinguishes problem states from routine turns", () => {
    expect(shouldNotifyLoopState("GOAL_COMPLETE")).toBe(true);
    expect(shouldNotifyLoopState("RECOVERY_REQUIRED")).toBe(true);
    expect(shouldNotifyLoopState("BLOCKED")).toBe(true);
    expect(shouldNotifyLoopState("SOL_STALLED")).toBe(true);

    expect(shouldNotifyLoopState("SOL_PENDING")).toBe(false);
    expect(shouldNotifyLoopState("SOL_REVIEWING")).toBe(false);
    expect(shouldNotifyLoopState("EXECUTING")).toBe(false);
  });
});
