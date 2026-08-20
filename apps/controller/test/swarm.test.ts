import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { StrategyRunStore } from "../src/strategy/strategy-run-store.js";
import { strategyControlRequestSchema, swarmStartRequestSchema, type RepositoryRecord, type RunRecord } from "@orca/shared";

function records(): { repository: RepositoryRecord; run: RunRecord } {
  const now = new Date().toISOString();
  const repository: RepositoryRecord = {
    id: "repo-swarm-store",
    displayName: "Swarm Store",
    githubRemote: "https://example.invalid/swarm.git",
    localPath: path.join(os.tmpdir(), "orca-swarm-store-repo"),
    environment: "windows",
    wslDistribution: null,
    executorCli: "kimi",
    executorModel: "Kimi K3",
    solConversationUrl: "https://chatgpt.com/c/swarm-store",
    maxIterations: 5,
    maxRuntimeMinutes: 10,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  const run: RunRecord = {
    id: "run-swarm-store",
    repositoryId: repository.id,
    goal: "Test strategy persistence",
    status: "EXECUTING",
    currentIteration: 1,
    maxIterations: 5,
    activeDispatchId: null,
    lastError: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    drainReason: null
  };
  return { repository, run };
}

describe("Swarm strategy contracts and durable state", () => {
  let dbContext: DatabaseContext | null = null;

  afterEach(() => {
    dbContext?.close();
    dbContext = null;
  });

  it("round-trips strategy runs, controls, and reports across store reads", () => {
    dbContext = initDatabase(":memory:");
    const { repository, run } = records();
    new RepositoryStore(dbContext.db).create(repository);
    new RunStore(dbContext.db).create(run);
    const store = new StrategyRunStore(dbContext.db);
    const now = new Date().toISOString();
    const created = store.create({
      schemaVersion: 1,
      strategyRunId: "strategy-store-1",
      repositoryId: repository.id,
      campaignId: run.id,
      runId: run.id,
      iteration: 1,
      strategy: "SWARM",
      status: "QUEUED",
      maxConcurrency: 2,
      packetIds: ["packet-a", "packet-b"],
      controlState: "NONE",
      startedAt: null,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now
    });
    expect(store.get(created.strategyRunId)?.packetIds).toEqual(["packet-a", "packet-b"]);
    const control = store.createControl({
      strategyRunId: created.strategyRunId,
      repositoryId: repository.id,
      runId: run.id,
      iteration: 1,
      decision: "PAUSE",
      reason: "qualification",
      createdAt: now
    });
    store.update(created.strategyRunId, { status: "PAUSED", controlState: "PAUSE_REQUESTED", lastError: "paused" });
    expect(store.listControls(created.strategyRunId)).toEqual([control]);
    expect(store.getActiveForRun(run.id)?.status).toBe("PAUSED");
    expect(store.get(created.strategyRunId)?.lastError).toBe("paused");
  });

  it("rejects malformed or unsafe strategy request shapes", () => {
    expect(() => swarmStartRequestSchema.parse({ packetIds: [], maxConcurrency: 2 })).toThrow();
    expect(() => swarmStartRequestSchema.parse({ packetIds: ["a"], maxConcurrency: 33 })).toThrow();
    expect(strategyControlRequestSchema.parse({ decision: "STOP" })).toEqual({ decision: "STOP" });
  });
});
