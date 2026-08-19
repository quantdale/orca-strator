import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { WatcherService } from "../src/watcher/watcher-service.js";
import { GitClient } from "../src/watcher/git-client.js";
import { CommitInspector } from "../src/watcher/commit-inspector.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { LoopService } from "../src/loop/loop-service.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type { DispatchRecord, ExecutorResult, RepositoryRecord } from "@orca/shared";

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

describe("Autonomous Loop Engine Integration (Task 6)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;
  let wakeStore: SolWakeStore;
  let runStore: RunStore;
  let loopService: LoopService;
  let fakeExecutor: FakeExecutorAdapter;
  let mockBrowser: MockBrowserDriver;

  const mockRepo1: RepositoryRecord = {
    id: "repo-loop-1",
    displayName: "Loop Repo 1",
    githubRemote: "https://github.com/quantdale/repo1.git",
    localPath: "D:\\Projects\\Repo1",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-4444-8001-a123-1234567890ab",
    maxIterations: 2,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  const mockRepo2: RepositoryRecord = {
    id: "repo-loop-2",
    displayName: "Loop Repo 2",
    githubRemote: "https://github.com/quantdale/repo2.git",
    localPath: "D:\\Projects\\Repo2",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-5555-8001-a123-1234567890ab",
    maxIterations: 10,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-loop-int-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    executorStore = new ExecutorStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);

    repoStore.create(mockRepo1);
    repoStore.create(mockRepo2);

    fakeExecutor = new FakeExecutorAdapter({ durationMs: 20 });
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
      windowsAdapter: fakeExecutor
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

  it("6.T1 full autonomous progression cycle: start -> Sol wake -> dispatch -> execute -> next Sol wake", async () => {
    const run = await loopService.startRun(mockRepo1.id, {
      goal: "Implement autonomous orchestration loop",
      maxIterations: 3
    });

    expect(run.status).toBe("SOL_REVIEWING");
    // The initial Sol wake opened a page (closed afterward, so the browser may
    // be idle). Assert the wake page was actually opened via persistent history.
    expect(mockBrowser.history.has(mockRepo1.id)).toBe(true);

    const mockDispatch: DispatchRecord = {
      id: "disp-loop-01",
      dispatchId: "disp-loop-01",
      repositoryId: mockRepo1.id,
      runId: run.id,
      iteration: 1,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      baseSha: "1123456789abcdef0123456789abcdef01234567",
      changePath: "openspec/changes/005-autonomous-loop-engine",
      goal: "Implement loop",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    dispatchStore.create(mockDispatch);

    // Watcher detects dispatch -> triggers executor
    await loopService.onDispatchDetected(mockRepo1.id, mockDispatch.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("EXECUTING");

    // Wait for fake executor to complete
    await new Promise((r) => setTimeout(r, 60));

    // Notify executor completed -> triggers next Sol wake
    await loopService.onExecutorCompleted(
      mockRepo1.id,
      mockDispatch.id,
      completedResult(mockDispatch.id, run.id, mockDispatch.iteration)
    );

    const statusAfter = loopService.getStatus(mockRepo1.id);
    expect(statusAfter.state).toBe("SOL_REVIEWING");
    expect(statusAfter.currentIteration).toBe(1);
  });

  it("6.T2 reaches iteration ceiling and stops at CEILING_REACHED (never GOAL_COMPLETE)", async () => {
    const run = await loopService.startRun(mockRepo1.id, {
      goal: "Quick run",
      maxIterations: 1
    });

    const mockDispatch: DispatchRecord = {
      id: "disp-loop-ceiling-1",
      dispatchId: "disp-loop-ceiling-1",
      repositoryId: mockRepo1.id,
      runId: run.id,
      iteration: 1,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      baseSha: "1123456789abcdef0123456789abcdef01234567",
      changePath: "openspec/changes/005-autonomous-loop-engine",
      goal: "Implement loop",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    dispatchStore.create(mockDispatch);

    // A ceiling crossing while the actor is active => DRAINING then CEILING_REACHED.
    await loopService.onDispatchDetected(mockRepo1.id, mockDispatch.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("EXECUTING");

    await loopService.onExecutorCompleted(
      mockRepo1.id,
      mockDispatch.id,
      completedResult(mockDispatch.id, run.id, mockDispatch.iteration)
    );

    const status = loopService.getStatus(mockRepo1.id);
    expect(status.state).toBe("CEILING_REACHED");

    const savedRun = runStore.get(run.id);
    expect(savedRun?.status).toBe("CEILING_REACHED");
  });

  it("6.T3 operational controls: pause, resume (same dispatch), stop", async () => {
    const run = await loopService.startRun(mockRepo1.id, {
      goal: "Control test",
      maxIterations: 5
    });

    const mockDispatch: DispatchRecord = {
      id: "disp-loop-control-1",
      dispatchId: "disp-loop-control-1",
      repositoryId: mockRepo1.id,
      runId: run.id,
      iteration: 1,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      baseSha: "1123456789abcdef0123456789abcdef01234567",
      changePath: "openspec/changes/005-autonomous-loop-engine",
      goal: "Implement loop",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-19T12:00:00.000Z",
      updatedAt: "2026-08-19T12:00:00.000Z"
    };
    dispatchStore.create(mockDispatch);
    await loopService.onDispatchDetected(mockRepo1.id, mockDispatch.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("EXECUTING");

    await loopService.pauseRun(mockRepo1.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("PAUSED");

    // Resume restarts the SAME unfinished dispatch with a recovery bootstrap (I).
    await loopService.resumeRun(mockRepo1.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("EXECUTING");

    await loopService.stopRun(mockRepo1.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("IDLE");

    const savedRun = runStore.get(run.id);
    expect(savedRun?.status).toBe("STOPPED");
  });

  it("6.T4 multiple repositories run autonomous loops concurrently and independently", async () => {
    const run1 = await loopService.startRun(mockRepo1.id, {
      goal: "Repo 1 goal",
      maxIterations: 5
    });

    const run2 = await loopService.startRun(mockRepo2.id, {
      goal: "Repo 2 goal",
      maxIterations: 5
    });

    expect(run1.id).not.toBe(run2.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("SOL_REVIEWING");
    expect(loopService.getStatus(mockRepo2.id).state).toBe("SOL_REVIEWING");

    await loopService.pauseRun(mockRepo1.id);
    expect(loopService.getStatus(mockRepo1.id).state).toBe("PAUSED");
    expect(loopService.getStatus(mockRepo2.id).state).toBe("SOL_REVIEWING");
  });
});
