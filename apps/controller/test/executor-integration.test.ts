import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("Executor Runtime & Supervision Integration (Task 6)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;

  const mockRepo: RepositoryRecord = {
    id: "repo-exec-integration",
    displayName: "Integration Repo",
    githubRemote: "https://github.com/quantdale/integration.git",
    localPath: "D:\\Projects\\Integration",
    environment: "windows",
    wslDistribution: null,
    executorCli: "codex",
    executorModel: "gpt-5.6",
    solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z"
  };

  const mockDispatch: DispatchRecord = {
    id: "disp-exec-int-01",
    dispatchId: "disp-exec-int-01",
    repositoryId: "repo-exec-integration",
    runId: "run-int-01",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/003-headless-executor-runtime",
    goal: "Integration executor test",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "detected",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-exec-int-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    executorStore = new ExecutorStore(dbCtx.db);

    repoStore.create(mockRepo);
    dispatchStore.create(mockDispatch);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("6.T1 successful execution records logs, completes run, and consumes dispatch", async () => {
    const fakeAdapter = new FakeExecutorAdapter({
      durationMs: 50,
      exitCode: 0,
      logLines: ["Booting executor...", "Generating code diff...", "Verification PASS"]
    });

    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: fakeAdapter
    });

    const runRecord = await service.startRun(mockRepo.id, mockDispatch.id);
    expect(runRecord.status).toBe("running");

    // Wait for fake executor to finish
    await new Promise((r) => setTimeout(r, 100));

    const finalRun = executorStore.get(runRecord.id);
    expect(finalRun?.status).toBe("completed");
    expect(finalRun?.exitCode).toBe(0);

    const updatedDispatch = dispatchStore.get(mockDispatch.id);
    expect(updatedDispatch?.status).toBe("consumed");

    expect(fs.existsSync(runRecord.logPath!)).toBe(true);
    const logContent = fs.readFileSync(runRecord.logPath!, "utf8");
    expect(logContent).toContain("Verification PASS");
  });

  it("6.T2 non-zero exit code marks run failed", async () => {
    const fakeAdapter = new FakeExecutorAdapter({
      durationMs: 50,
      exitCode: 1,
      logLines: ["Error encountered during compile"]
    });

    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: fakeAdapter
    });

    const runRecord = await service.startRun(mockRepo.id, mockDispatch.id);
    await new Promise((r) => setTimeout(r, 100));

    const finalRun = executorStore.get(runRecord.id);
    expect(finalRun?.status).toBe("failed");
    expect(finalRun?.exitCode).toBe(1);
    expect(finalRun?.errorMessage).toContain("non-zero code 1");
  });

  it("6.T3 pause control terminates running process and sets status to paused", async () => {
    const fakeAdapter = new FakeExecutorAdapter({
      durationMs: 500,
      logLines: ["Long running task step 1"]
    });

    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: fakeAdapter
    });

    const runRecord = await service.startRun(mockRepo.id, mockDispatch.id);
    expect(service.getStatus(mockRepo.id).isRunning).toBe(true);

    await service.pauseRun(mockRepo.id);
    expect(service.getStatus(mockRepo.id).isRunning).toBe(false);

    const finalRun = executorStore.get(runRecord.id);
    expect(finalRun?.status).toBe("paused");
  });

  it("6.T4 emergency kill control terminates process tree immediately", async () => {
    const fakeAdapter = new FakeExecutorAdapter({
      durationMs: 500,
      logLines: ["Unresponsive task loop"]
    });

    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: fakeAdapter
    });

    const runRecord = await service.startRun(mockRepo.id, mockDispatch.id);
    expect(service.getStatus(mockRepo.id).isRunning).toBe(true);

    await service.killRun(mockRepo.id);
    expect(service.getStatus(mockRepo.id).isRunning).toBe(false);

    const finalRun = executorStore.get(runRecord.id);
    expect(finalRun?.status).toBe("killed");
  });
});
