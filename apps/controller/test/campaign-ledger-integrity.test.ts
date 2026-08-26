import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { RunPolicyStore } from "../src/loop/run-policy-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { SolControlStore } from "../src/watcher/sol-control-store.js";
import { RepositoryService } from "../src/repositories/repository-service.js";
import { CampaignLedgerStore } from "../src/ledger/campaign-ledger-store.js";
import { CampaignLedgerService } from "../src/ledger/campaign-ledger-service.js";
import { EventBus } from "../src/events/event-bus.js";
import type { DispatchRecord, RepositoryRecord, RunRecord } from "@orca/shared";

function repository(id: string, localPath: string): RepositoryRecord {
  const now = "2026-08-26T08:00:00.000Z";
  return {
    id,
    displayName: id,
    githubRemote: `https://example.invalid/${id}.git`,
    localPath,
    environment: "windows",
    wslDistribution: null,
    executorCli: process.execPath,
    executorModel: "test-model",
    solConversationUrl: "https://chatgpt.com/c/test",
    maxIterations: 3,
    maxRuntimeMinutes: 2,
    enabled: false,
    createdAt: now,
    updatedAt: now
  };
}

function run(repositoryId: string, id: string): RunRecord {
  const now = "2026-08-26T08:00:00.000Z";
  return {
    id,
    repositoryId,
    goal: "Integrity fixture campaign",
    status: "SOL_PENDING",
    currentIteration: 0,
    maxIterations: 3,
    activeDispatchId: null,
    lastError: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    drainReason: null
  };
}

function dispatch(repositoryId: string, id: string, runId: string, status: DispatchRecord["status"] = "detected"): DispatchRecord {
  const now = "2026-08-26T08:00:01.000Z";
  return {
    id,
    dispatchId: id,
    repositoryId,
    runId,
    iteration: 1,
    commitSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    changePath: "openspec/changes/x",
    goal: "fixture",
    instructionsVersion: 1,
    schemaVersion: 1,
    type: "dispatch",
    status,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now
  };
}

describe("Change 027 campaign-ledger referential integrity", () => {
  let tempDir: string;
  let dbContext: DatabaseContext;
  let repoStore: RepositoryStore;
  let runStore: RunStore;
  let dispatchStore: DispatchStore;
  let ledgerStore: CampaignLedgerStore;
  let ledgerService: CampaignLedgerService;
  let eventBus: EventBus;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-ledger-fk-"));
    dbContext = initDatabase(path.join(tempDir, "orca.sqlite"));
    repoStore = new RepositoryStore(dbContext.db);
    runStore = new RunStore(dbContext.db);
    dispatchStore = new DispatchStore(dbContext.db);
    ledgerStore = new CampaignLedgerStore(dbContext.db);
    ledgerService = new CampaignLedgerService(
      dbContext.db,
      repoStore,
      runStore,
      new RunPolicyStore(dbContext.db),
      ledgerStore
    );
    eventBus = new EventBus();
    eventBus.subscribe((event) => ledgerService.recordEvent(event));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists events whose explicitly carried runId is durable", () => {
    const repo = repository("repo-durable", tempDir);
    repoStore.create(repo);
    runStore.create(run(repo.id, "run-durable"));

    eventBus.publish({
      type: "loop.state_changed",
      at: "2026-08-26T08:00:02.000Z",
      repositoryId: repo.id,
      data: { runId: "run-durable", iteration: 1, loopState: "EXECUTING" }
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const timeline = ledgerStore.listByRepository(repo.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.runId).toBe("run-durable");
  });

  it("records an explicitly carried but non-durable run reference as unattributed without warning or fabricated correlation", () => {
    // Sol/Git-authored content may reference a run that is not durable; the
    // ledger must not violate the runs FK nor silently attribute the event to
    // an unrelated latest campaign.
    const repo = repository("repo-bogus", tempDir);
    repoStore.create(repo);
    runStore.create(run(repo.id, "run-unrelated-latest"));

    // Mirrors production ordering: the watcher persists the sol_control row
    // BEFORE publishing control_detected (Sol-authored runId may be garbage;
    // sol_controls.run_id intentionally has no FK).
    new SolControlStore(dbContext.db).create({
      id: "ctrl-x",
      repositoryId: repo.id,
      runId: "run-never-created",
      controlId: "ctrl-x",
      decision: "GOAL_COMPLETE",
      iteration: 1,
      commitSha: "c".repeat(40),
      relatedDispatchId: null,
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-26T08:00:01.000Z",
      updatedAt: "2026-08-26T08:00:01.000Z"
    });
    eventBus.publish({
      type: "watcher.control_detected",
      at: "2026-08-26T08:00:02.000Z",
      repositoryId: repo.id,
      data: { controlId: "ctrl-x", decision: "GOAL_COMPLETE", runId: "run-never-created" }
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const timeline = ledgerStore.listByRepository(repo.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.runId).toBeNull();
    expect(timeline[0]?.controlId).toBe("ctrl-x");
  });

  it("treats the rejected-record 'unknown' run sentinel as unattributed without warning", () => {
    const repo = repository("repo-sentinel", tempDir);
    repoStore.create(repo);

    // Mirrors watcher-service REJECTED_DISPATCH persistence + event payload.
    const rejected = dispatch(repo.id, "rejected-abcd1234", "unknown", "rejected");
    dispatchStore.create(rejected);
    eventBus.publish({
      type: "watcher.dispatch_rejected",
      at: "2026-08-26T08:00:03.000Z",
      repositoryId: repo.id,
      data: { dispatch: rejected, reason: "schema-invalid dispatch" }
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const timeline = ledgerStore.listByRepository(repo.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe("watcher.dispatch_rejected");
    expect(timeline[0]?.runId).toBeNull();
  });

  it("attributes dispatch-carried events only through durable runs", () => {
    const repo = repository("repo-join", tempDir);
    repoStore.create(repo);
    runStore.create(run(repo.id, "run-real"));
    dispatchStore.create(dispatch(repo.id, "disp-real", "run-real"));
    dispatchStore.create(dispatch(repo.id, "disp-sentinel", "unknown", "rejected"));

    eventBus.publish({
      type: "watcher.dispatch_detected",
      at: "2026-08-26T08:00:04.000Z",
      repositoryId: repo.id,
      data: { dispatchId: "disp-real" }
    });
    eventBus.publish({
      type: "watcher.dispatch_rejected",
      at: "2026-08-26T08:00:05.000Z",
      repositoryId: repo.id,
      data: { dispatchId: "disp-sentinel", reason: "stale" }
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const timeline = ledgerStore.listByRepository(repo.id);
    const byDispatch = new Map(timeline.map((event) => [event.dispatchId, event.runId]));
    expect(byDispatch.get("disp-real")).toBe("run-real");
    expect(byDispatch.get("disp-sentinel")).toBeNull();
  });

  it("skips persisting repository.deleted while still broadcasting it and cascading history per the data model", () => {
    const repo = repository("repo-deleted", tempDir);
    repoStore.create(repo);
    const historyRun = run(repo.id, "run-history");
    runStore.create(historyRun);
    eventBus.publish({
      type: "loop.state_changed",
      at: "2026-08-26T08:00:06.000Z",
      repositoryId: repo.id,
      data: { runId: "run-history", loopState: "SOL_PENDING" }
    });
    expect(ledgerStore.listByRepository(repo.id)).toHaveLength(1);

    // Deletion refuses active campaigns; finish the run first (terminal).
    runStore.updateStatus("run-history", "GOAL_COMPLETE", {
      finishedAt: "2026-08-26T08:00:06.500Z"
    });

    const broadcast: string[] = [];
    eventBus.subscribe((event) => broadcast.push(event.type));
    const repositoryService = new RepositoryService(repoStore, eventBus, runStore);
    repositoryService.deleteRepository(repo.id);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(broadcast).toContain("repository.deleted");
    // Documented retention policy: hard delete cascades the campaign history.
    expect(ledgerStore.listByRepository(repo.id)).toHaveLength(0);
    expect(repoStore.get(repo.id)).toBeNull();
  });

  it("keeps unrelated repositories' campaigns independent of another repository's deletion", () => {
    const repoA = repository("repo-a-del", path.join(tempDir, "a"));
    const repoB = repository("repo-b-keep", path.join(tempDir, "b"));
    repoStore.create(repoA);
    repoStore.create(repoB);
    runStore.create(run(repoB.id, "run-b"));
    eventBus.publish({
      type: "loop.state_changed",
      at: "2026-08-26T08:00:07.000Z",
      repositoryId: repoB.id,
      data: { runId: "run-b", loopState: "EXECUTING" }
    });

    const repositoryService = new RepositoryService(repoStore, eventBus, runStore);
    repositoryService.deleteRepository(repoA.id);

    expect(warnSpy).not.toHaveBeenCalled();
    const surviving = ledgerStore.listByRepository(repoB.id);
    expect(surviving).toHaveLength(1);
    expect(surviving[0]?.runId).toBe("run-b");
    expect(runStore.get("run-b")).toBeDefined();
  });
});
