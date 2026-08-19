import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import type { ExecutorRunRecord, DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("ExecutorStore & SQLite Schema (Task 2)", () => {
  let tempDir: string;
  let dbPath: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;

  const mockRepo: RepositoryRecord = {
    id: "repo-exec-1",
    displayName: "TabDock Exec",
    githubRemote: "https://github.com/quantdale/tabdock.git",
    localPath: "D:\\Projects\\TabDock",
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
    id: "disp-exec-001",
    dispatchId: "disp-exec-001",
    repositoryId: "repo-exec-1",
    runId: "run-exec-001",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/003-headless-executor-runtime",
    goal: "Implement executor runtime",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "consumed",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  const mockRun: ExecutorRunRecord = {
    id: "run-attempt-1",
    repositoryId: "repo-exec-1",
    dispatchId: "disp-exec-001",
    runId: "run-exec-001",
    iteration: 1,
    status: "running",
    exitCode: null,
    logPath: "/logs/run-1.log",
    errorMessage: null,
    startedAt: "2026-08-19T12:05:00.000Z",
    finishedAt: null,
    createdAt: "2026-08-19T12:05:00.000Z",
    updatedAt: "2026-08-19T12:05:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-exec-store-"));
    dbPath = path.join(tempDir, "test.sqlite");
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

  it("2.T1 executor_runs table exists and supports creation and retrieval", () => {
    executorStore.create(mockRun);

    const fetched = executorStore.get("run-attempt-1");
    expect(fetched).toEqual(mockRun);
  });

  it("2.T2 getActiveRun returns in-flight run for repository", () => {
    executorStore.create(mockRun);

    const active = executorStore.getActiveRun("repo-exec-1");
    expect(active?.id).toBe("run-attempt-1");
    expect(active?.status).toBe("running");
  });

  it("2.T3 updateStatus updates status, exit code, and finishedAt", () => {
    executorStore.create(mockRun);

    const finishedAt = "2026-08-19T12:20:00.000Z";
    executorStore.updateStatus("run-attempt-1", "completed", {
      exitCode: 0,
      finishedAt
    });

    const fetched = executorStore.get("run-attempt-1");
    expect(fetched?.status).toBe("completed");
    expect(fetched?.exitCode).toBe(0);
    expect(fetched?.finishedAt).toBe(finishedAt);

    // No longer active
    expect(executorStore.getActiveRun("repo-exec-1")).toBeNull();
  });
});
