import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import type { RunRecord, RepositoryRecord } from "@orca/shared";

describe("RunStore & SQLite Schema (Task 2)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let runStore: RunStore;

  const mockRepo: RepositoryRecord = {
    id: "repo-run-1",
    displayName: "TabDock Run",
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

  const mockRun: RunRecord = {
    id: "run-2026-001",
    repositoryId: "repo-run-1",
    goal: "Implement V1 roadmap autonomously",
    status: "SOL_PENDING",
    currentIteration: 0,
    maxIterations: 20,
    activeDispatchId: null,
    lastError: null,
    startedAt: "2026-08-19T12:00:00.000Z",
    finishedAt: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    drainReason: null
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-run-store-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);
    repoStore.create(mockRepo);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("2.T1 runs table exists and supports creation and retrieval", () => {
    runStore.create(mockRun);

    const fetched = runStore.get("run-2026-001");
    expect(fetched).toEqual(mockRun);
  });

  it("2.T2 getActiveRun returns in-flight run and ignores terminal states", () => {
    runStore.create(mockRun);

    const active = runStore.getActiveRun("repo-run-1");
    expect(active?.id).toBe("run-2026-001");

    runStore.updateStatus("run-2026-001", "GOAL_COMPLETE", {
      finishedAt: "2026-08-19T14:00:00.000Z"
    });

    expect(runStore.getActiveRun("repo-run-1")).toBeNull();
  });
});
