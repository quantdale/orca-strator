import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import type { DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("DispatchStore & SQLite Schema (Task 2)", () => {
  let tempDir: string;
  let dbPath: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;

  const mockRepo: RepositoryRecord = {
    id: "repo-1",
    displayName: "TabDock",
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
    id: "disp-001",
    dispatchId: "disp-001",
    repositoryId: "repo-1",
    runId: "run-001",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/002-repository-watch-dispatch",
    goal: "Implement watcher and dispatch",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "detected",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-dispatch-"));
    dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    repoStore.create(mockRepo);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("2.T1 dispatches table exists and supports creation and retrieval", () => {
    dispatchStore.create(mockDispatch);

    const fetched = dispatchStore.get("disp-001");
    expect(fetched).toEqual(mockDispatch);
    expect(dispatchStore.hasDispatch("disp-001")).toBe(true);
    expect(dispatchStore.hasCommit("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(dispatchStore.hasCommit("non-existent-sha")).toBe(false);
  });

  it("2.T2 updateStatus updates status and rejectionReason", () => {
    dispatchStore.create(mockDispatch);

    dispatchStore.updateStatus("disp-001", "consumed");
    let fetched = dispatchStore.get("disp-001");
    expect(fetched?.status).toBe("consumed");

    dispatchStore.updateStatus("disp-001", "rejected", "Mixed commit with source changes");
    fetched = dispatchStore.get("disp-001");
    expect(fetched?.status).toBe("rejected");
    expect(fetched?.rejectionReason).toBe("Mixed commit with source changes");
  });

  it("2.T3 getByRepository returns dispatches for that repository ordered by iteration", () => {
    dispatchStore.create(mockDispatch);
    dispatchStore.create({
      ...mockDispatch,
      id: "disp-002",
      dispatchId: "disp-002",
      iteration: 2,
      commitSha: "2223456789abcdef0123456789abcdef01234567"
    });

    const list = dispatchStore.getByRepository("repo-1");
    expect(list).toHaveLength(2);
    expect(list[0].iteration).toBe(2);
    expect(list[1].iteration).toBe(1);
  });

  it("2.T4 watcher_state upsert and retrieval works", () => {
    expect(dispatchStore.getWatcherState("repo-1")).toBeNull();

    const created = dispatchStore.upsertWatcherState({
      repositoryId: "repo-1",
      lastObservedSha: "0123456789abcdef0123456789abcdef01234567",
      lastPolledAt: "2026-08-19T12:05:00.000Z"
    });
    expect(created.lastObservedSha).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(created.lastError).toBeNull();

    const updated = dispatchStore.upsertWatcherState({
      repositoryId: "repo-1",
      lastError: "Failed to connect to remote"
    });
    expect(updated.lastObservedSha).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(updated.lastError).toBe("Failed to connect to remote");
  });
});
