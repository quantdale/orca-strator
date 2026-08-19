import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import type { SolWakeRecord, DispatchRecord, RepositoryRecord } from "@orca/shared";

describe("SolWakeStore & SQLite Schema (Task 2)", () => {
  let tempDir: string;
  let dbPath: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let wakeStore: SolWakeStore;

  const mockRepo: RepositoryRecord = {
    id: "repo-wake-1",
    displayName: "TabDock Wake",
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
    id: "disp-wake-001",
    dispatchId: "disp-wake-001",
    repositoryId: "repo-wake-1",
    runId: "run-wake-001",
    iteration: 1,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    baseSha: "1123456789abcdef0123456789abcdef01234567",
    changePath: "openspec/changes/004-playwright-sol-bridge",
    goal: "Implement Playwright bridge",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status: "consumed",
    rejectionReason: null,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z"
  };

  const mockWake: SolWakeRecord = {
    id: "wake-attempt-1",
    repositoryId: "repo-wake-1",
    runId: "run-wake-001",
    dispatchId: "disp-wake-001",
    conversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
    message: "Orca-Strator executor turn completed for TabDock Wake.",
    status: "pending",
    errorMessage: null,
    submittedAt: null,
    createdAt: "2026-08-19T12:30:00.000Z",
    updatedAt: "2026-08-19T12:30:00.000Z"
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-wake-store-"));
    dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    wakeStore = new SolWakeStore(dbCtx.db);
    repoStore.create(mockRepo);
    dispatchStore.create(mockDispatch);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("2.T1 sol_wakes table exists and supports creation and retrieval", () => {
    wakeStore.create(mockWake);

    const fetched = wakeStore.get("wake-attempt-1");
    expect(fetched).toEqual(mockWake);
  });

  it("2.T2 updateStatus updates status and submittedAt", () => {
    wakeStore.create(mockWake);

    const submittedAt = "2026-08-19T12:30:05.000Z";
    wakeStore.updateStatus("wake-attempt-1", "submitted", {
      submittedAt
    });

    const fetched = wakeStore.get("wake-attempt-1");
    expect(fetched?.status).toBe("submitted");
    expect(fetched?.submittedAt).toBe(submittedAt);
  });
});
