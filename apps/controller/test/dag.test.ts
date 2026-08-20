import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { WorkPacketStore } from "../src/packets/work-packet-store.js";
import { WorkPacketService } from "../src/packets/work-packet-service.js";
import { WorktreeIsolationService } from "../src/packets/worktree-isolation-service.js";
import { IntegrationService } from "../src/packets/integration-service.js";
import { SchedulerPolicyStore } from "../src/scheduler/scheduler-policy-store.js";
import { SchedulerService } from "../src/scheduler/scheduler-service.js";
import { StrategyRunStore } from "../src/strategy/strategy-run-store.js";
import { DagNodeStore } from "../src/strategy/dag-node-store.js";
import { DagExecutionService } from "../src/strategy/dag-execution-service.js";
import { SwarmExecutionService } from "../src/strategy/swarm-execution-service.js";
import { dagStartRequestSchema, type RepositoryRecord, type RunRecord } from "@orca/shared";

function records(): { repository: RepositoryRecord; run: RunRecord } {
  const now = new Date().toISOString();
  const repository: RepositoryRecord = {
    id: "repo-dag-contracts",
    displayName: "DAG Contracts",
    githubRemote: "https://example.invalid/dag.git",
    localPath: path.join(os.tmpdir(), "orca-dag-contracts-repo"),
    environment: "windows",
    wslDistribution: null,
    executorCli: "kimi",
    executorModel: "Kimi K3",
    solConversationUrl: "https://chatgpt.com/c/dag-contracts",
    maxIterations: 5,
    maxRuntimeMinutes: 10,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  const run: RunRecord = {
    id: "run-dag-contracts",
    repositoryId: repository.id,
    goal: "Test DAG contracts",
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

function service(db: DatabaseContext, repository: RepositoryRecord, run: RunRecord): {
  dag: DagExecutionService;
  packetService: WorkPacketService;
  nodeStore: DagNodeStore;
} {
  const repositoryStore = new RepositoryStore(db.db);
  const runStore = new RunStore(db.db);
  const packetStore = new WorkPacketStore(db.db);
  const packetService = new WorkPacketService(packetStore);
  const strategyStore = new StrategyRunStore(db.db);
  const nodeStore = new DagNodeStore(db.db);
  const execution = new SwarmExecutionService({
    repositoryStore,
    runStore,
    strategyStore,
    packetStore,
    packetService,
    worktreeService: new WorktreeIsolationService(packetStore, repository.localPath),
    integrationService: new IntegrationService(packetStore),
    schedulerService: new SchedulerService(new SchedulerPolicyStore(db.db)),
    dataDir: repository.localPath
  });
  return {
    dag: new DagExecutionService({ repositoryStore, runStore, strategyStore, nodeStore, packetStore, packetService, executionService: execution }),
    packetService,
    nodeStore
  };
}

describe("DAG strategy contracts and validation", () => {
  let db: DatabaseContext | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("round-trips explicit node state and accepts the DAG request contract", () => {
    db = initDatabase(":memory:");
    const { repository, run } = records();
    const repositoryStore = new RepositoryStore(db.db);
    const runStore = new RunStore(db.db);
    repositoryStore.create(repository);
    runStore.create(run);
    const packets = new WorkPacketService(new WorkPacketStore(db.db));
    const packet = packets.create(repository, run, {
      workstream: "root",
      goal: "root",
      allowedPaths: ["root.txt"],
      executor: { role: "PRIMARY", executorCli: "kimi", model: "Kimi K3", provider: null, source: "REPOSITORY_DEFAULT" }
    });
    const request = dagStartRequestSchema.parse({ nodes: [{ nodeId: "root", packetId: packet.packetId, dependsOn: [] }], maxConcurrency: 1 });
    expect(request.nodes[0]?.nodeId).toBe("root");
    const store = new DagNodeStore(db.db);
    const strategyStore = new StrategyRunStore(db.db);
    const now = new Date().toISOString();
    strategyStore.create({
      schemaVersion: 1,
      strategyRunId: "dag-contract-1",
      repositoryId: repository.id,
      campaignId: run.id,
      runId: run.id,
      iteration: 1,
      strategy: "DAG",
      status: "QUEUED",
      maxConcurrency: 1,
      packetIds: [packet.packetId],
      controlState: "NONE",
      startedAt: null,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now
    });
    const created = store.create({
      schemaVersion: 1,
      strategyRunId: "dag-contract-1",
      nodeId: "root",
      packetId: packet.packetId,
      dependsOn: [],
      status: "QUEUED",
      budget: packet.budget,
      attempt: 0,
      maxRetries: packet.budget.maxRetries,
      waitingReason: null,
      startedAt: null,
      finishedAt: null,
      resultId: null,
      createdAt: now,
      updatedAt: now
    });
    expect(store.get("dag-contract-1", "root")).toEqual(created);
  });

  it("rejects cycles and packet/dependency mismatches before execution", async () => {
    db = initDatabase(":memory:");
    const { repository, run } = records();
    const repositoryStore = new RepositoryStore(db.db);
    const runStore = new RunStore(db.db);
    repositoryStore.create(repository);
    runStore.create(run);
    const built = service(db, repository, run);
    const first = built.packetService.create(repository, run, {
      workstream: "first",
      goal: "first",
      allowedPaths: ["first.txt"],
      executor: { role: "PRIMARY", executorCli: "kimi", model: "Kimi K3", provider: null, source: "REPOSITORY_DEFAULT" }
    });
    const second = built.packetService.create(repository, run, {
      workstream: "second",
      goal: "second",
      allowedPaths: ["second.txt"],
      executor: { role: "PRIMARY", executorCli: "kimi", model: "Kimi K3", provider: null, source: "REPOSITORY_DEFAULT" }
    });
    await expect(built.dag.execute(repository.id, run.id, 1, {
      nodes: [
        { nodeId: "a", packetId: first.packetId, dependsOn: ["b"] },
        { nodeId: "b", packetId: second.packetId, dependsOn: ["a"] }
      ],
      maxConcurrency: 2
    })).rejects.toThrow("cycle");
    expect(built.nodeStore.list("missing-strategy")).toEqual([]);
    await expect(built.dag.execute(repository.id, run.id, 1, {
      nodes: [
        { nodeId: "a", packetId: first.packetId, dependsOn: [] },
        { nodeId: "b", packetId: second.packetId, dependsOn: ["a"] }
      ]
    })).rejects.toThrow("do not match");
  });
});
