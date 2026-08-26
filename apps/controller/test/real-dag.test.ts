/** Real Change 014 qualification: explicit DAG validation, scheduling, integration, controls, and recovery. */

import { vi, afterEach, describe, expect, it } from "vitest";
vi.setConfig({ hookTimeout: 60_000, testTimeout: 240_000 });
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
import { toWslPath } from "../src/wsl-path.js";
import type { RepositoryRecord, RunRecord, WorkPacket } from "@orca/shared";

const HARNESS_PATH = path.resolve(__dirname, "fixtures", "swarm-worker-harness.mjs");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function wslDistroReady(distribution: string): boolean {
  try {
    execFileSync("wsl.exe", ["-d", distribution, "-e", "bash", "-lc", "command -v node && command -v git"], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for DAG state.");
}

function fixture(prefix: string): { tempDir: string; bareDir: string; cloneDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const bareDir = path.join(tempDir, "remote.git");
  const cloneDir = path.join(tempDir, "clone");
  fs.mkdirSync(bareDir, { recursive: true });
  fs.mkdirSync(cloneDir, { recursive: true });
  git(bareDir, ["init", "--bare", "-b", "main"]);
  git(cloneDir, ["init", "-b", "main"]);
  git(cloneDir, ["config", "user.email", "orca-dag-qual@example.com"]);
  git(cloneDir, ["config", "user.name", "Orca DAG Qualification"]);
  git(cloneDir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(cloneDir, "README.md"), "# DAG qualification\n");
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", "initial"]);
  git(cloneDir, ["remote", "add", "origin", bareDir]);
  git(cloneDir, ["push", "-u", "origin", "main"]);
  return { tempDir, bareDir, cloneDir };
}

function repository(id: string, data: { bareDir: string; cloneDir: string }, environment: "windows" | "wsl" = "windows"): RepositoryRecord {
  const now = new Date().toISOString();
  return {
    id,
    displayName: id,
    githubRemote: environment === "wsl" ? toWslPath(data.bareDir) : data.bareDir,
    localPath: data.cloneDir,
    environment,
    wslDistribution: environment === "wsl" ? "Ubuntu" : null,
    executorCli: "orca-swarm-test-harness",
    executorModel: "deterministic-dag-model",
    solConversationUrl: "https://chatgpt.com/c/dag-qualification",
    maxIterations: 3,
    maxRuntimeMinutes: 2,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

function campaign(repositoryId: string): RunRecord {
  const now = new Date().toISOString();
  return {
    id: `run-dag-${repositoryId}`,
    repositoryId,
    goal: "Qualify optional DAG execution",
    status: "EXECUTING",
    currentIteration: 1,
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

function makeServices(db: DatabaseContext, dataDir: string, repository: RepositoryRecord, run: RunRecord): {
  repositoryStore: RepositoryStore;
  runStore: RunStore;
  packetStore: WorkPacketStore;
  packetService: WorkPacketService;
  strategyStore: StrategyRunStore;
  nodeStore: DagNodeStore;
  dag: DagExecutionService;
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
    worktreeService: new WorktreeIsolationService(packetStore, dataDir),
    integrationService: new IntegrationService(packetStore),
    schedulerService: new SchedulerService(new SchedulerPolicyStore(db.db)),
    dataDir
  });
  return {
    repositoryStore,
    runStore,
    packetStore,
    packetService,
    strategyStore,
    nodeStore,
    dag: new DagExecutionService({ repositoryStore, runStore, strategyStore, nodeStore, packetStore, packetService, executionService: execution })
  };
}

function createPacket(service: WorkPacketService, repository: RepositoryRecord, run: RunRecord, workstream: string, allowedPaths: string[], dependencies: string[] = [], budget: { maxRuntimeMs?: number } = {}): WorkPacket {
  return service.create(repository, run, {
    workstream,
    goal: `Implement ${workstream}`,
    allowedPaths,
    dependencies,
    budget,
    executor: {
      role: "PRIMARY",
      executorCli: repository.executorCli,
      model: repository.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT"
    }
  });
}

describe("Real Change 014 optional DAG qualification", () => {
  let db: DatabaseContext | null = null;
  let tempDirs: string[] = [];
  const oldHarness = process.env.ORCA_SWARM_TEST_HARNESS;
  const oldFailPacket = process.env.ORCA_SWARM_FAIL_PACKET;

  afterEach(() => {
    db?.close();
    db = null;
    if (oldHarness === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldHarness;
    if (oldFailPacket === undefined) delete process.env.ORCA_SWARM_FAIL_PACKET;
    else process.env.ORCA_SWARM_FAIL_PACKET = oldFailPacket;
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    delete process.env.ORCA_SWARM_WAIT_FILE;
    for (const tempDir of tempDirs) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
    tempDirs = [];
  });

  it("runs explicit independent/dependent nodes with bounded isolated integration", async () => {
    const data = fixture("orca-real-dag-win-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    db = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-dag-win", data);
    const run = campaign(repo.id);
    const built = makeServices(db, data.tempDir, repo, run);
    built.repositoryStore.create(repo);
    built.runStore.create(run);
    const alpha = createPacket(built.packetService, repo, run, "dag-alpha", ["dag-alpha.txt"]);
    const beta = createPacket(built.packetService, repo, run, "dag-beta", ["dag-beta.txt"]);
    const gamma = createPacket(built.packetService, repo, run, "dag-gamma", ["dag-gamma.txt"], [alpha.packetId, beta.packetId]);

    const final = await built.dag.execute(repo.id, run.id, 1, {
      nodes: [
        { nodeId: "alpha", packetId: alpha.packetId, dependsOn: [] },
        { nodeId: "beta", packetId: beta.packetId, dependsOn: [] },
        { nodeId: "gamma", packetId: gamma.packetId, dependsOn: ["alpha", "beta"] }
      ],
      maxConcurrency: 2
    });

    expect(final.strategy).toBe("DAG");
    expect(final.status).toBe("COMPLETED");
    expect(final.report?.strategy).toBe("DAG");
    expect(final.report?.nodes.map((node) => node.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(final.report?.nodes.find((node) => node.nodeId === "gamma")?.dependsOn).toEqual(["alpha", "beta"]);
    expect(fs.existsSync(path.join(data.cloneDir, "dag-alpha.txt"))).toBe(true);
    expect(fs.existsSync(path.join(data.cloneDir, "dag-beta.txt"))).toBe(true);
    expect(fs.existsSync(path.join(data.cloneDir, "dag-gamma.txt"))).toBe(true);
    expect(git(data.cloneDir, ["status", "--porcelain"])).toBe("");
  }, 180000);

  it("preserves independent success when integration detects a DAG conflict", async () => {
    const data = fixture("orca-real-dag-conflict-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    db = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-dag-conflict", data);
    const run = campaign(repo.id);
    const built = makeServices(db, data.tempDir, repo, run);
    built.repositoryStore.create(repo);
    built.runStore.create(run);
    const first = createPacket(built.packetService, repo, run, "dag-conflict-a", ["shared.txt"]);
    const second = createPacket(built.packetService, repo, run, "dag-conflict-b", ["shared.txt"]);

    const final = await built.dag.execute(repo.id, run.id, 1, {
      nodes: [
        { nodeId: "a", packetId: first.packetId, dependsOn: [] },
        { nodeId: "b", packetId: second.packetId, dependsOn: [] }
      ],
      maxConcurrency: 2
    });

    expect(final.status).toBe("PARTIAL");
    expect(final.report?.nodes.map((node) => node.status).sort()).toEqual(["BLOCKED", "COMPLETED"]);
    expect(final.report?.integration?.status).toBe("INTEGRATION_CONFLICT");
    expect(fs.existsSync(path.join(data.cloneDir, "shared.txt"))).toBe(true);
    expect(git(data.cloneDir, ["status", "--porcelain"])).toBe("");
  }, 180000);

  it("honors graceful stop and preserves typed node cancellation", async () => {
    const data = fixture("orca-real-dag-stop-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "5000";
    const release = path.join(data.tempDir, "release");
    process.env.ORCA_SWARM_WAIT_FILE = release;
    db = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-dag-stop", data);
    const run = campaign(repo.id);
    const built = makeServices(db, data.tempDir, repo, run);
    built.repositoryStore.create(repo);
    built.runStore.create(run);
    const first = createPacket(built.packetService, repo, run, "dag-stop-a", ["stop-a.txt"]);
    const second = createPacket(built.packetService, repo, run, "dag-stop-b", ["stop-b.txt"]);
    const started = built.dag.start(repo.id, run.id, 1, {
      nodes: [
        { nodeId: "a", packetId: first.packetId, dependsOn: [] },
        { nodeId: "b", packetId: second.packetId, dependsOn: [] }
      ],
      maxConcurrency: 1
    });
    await waitFor(() => built.nodeStore.list(started.strategyRunId).some((node) => node.status === "RUNNING"));
    await built.dag.control(repo.id, started.strategyRunId, "STOP", "DAG qualification stop");
    fs.writeFileSync(release, "release\n");
    await waitFor(() => built.dag.get(started.strategyRunId)?.status === "CANCELLED");
    expect(built.nodeStore.list(started.strategyRunId).some((node) => node.status === "CANCELLED")).toBe(true);
  }, 180000);

  it("reconciles an orphaned DAG and preserves its real worktree", async () => {
    const data = fixture("orca-real-dag-recovery-");
    tempDirs.push(data.tempDir);
    db = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-dag-recovery", data);
    const run = campaign(repo.id);
    const built = makeServices(db, data.tempDir, repo, run);
    built.repositoryStore.create(repo);
    built.runStore.create(run);
    const packet = createPacket(built.packetService, repo, run, "dag-recovery", ["recovery.txt"]);
    const worktree = await new WorktreeIsolationService(built.packetStore, data.tempDir).allocate(repo, packet);
    built.packetService.updateStatus(packet.packetId, "RUNNING");
    const now = new Date().toISOString();
    built.strategyStore.create({
      schemaVersion: 1,
      strategyRunId: "dag-recovery-1",
      repositoryId: repo.id,
      campaignId: run.id,
      runId: run.id,
      iteration: 1,
      strategy: "DAG",
      status: "RUNNING",
      maxConcurrency: 1,
      packetIds: [packet.packetId],
      controlState: "NONE",
      startedAt: now,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now
    });
    built.nodeStore.create({
      schemaVersion: 1,
      strategyRunId: "dag-recovery-1",
      nodeId: "recovery",
      packetId: packet.packetId,
      dependsOn: [],
      status: "RUNNING",
      budget: packet.budget,
      attempt: 1,
      maxRetries: packet.budget.maxRetries,
      waitingReason: null,
      startedAt: now,
      finishedAt: null,
      resultId: null,
      createdAt: now,
      updatedAt: now
    });

    const recovered = await built.dag.recoverAll();
    expect(recovered[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(built.nodeStore.get("dag-recovery-1", "recovery")?.status).toBe("BLOCKED");
    expect(built.packetService.getResult(packet.packetId)?.status).toBe("BLOCKED");
    expect(built.packetStore.getWorktree(worktree.worktreeId)?.status).toBe("STALE");
    expect(fs.existsSync(worktree.path)).toBe(true);
  }, 180000);

  const wslReady = wslDistroReady("Ubuntu");
  if (!wslReady) console.warn("Change 014 WSL DAG qualification UNQUALIFIED: Ubuntu with node and git is unavailable.");

  it.skipIf(!wslReady)("runs a real WSL DAG worker through the shared adapter and integration path", async () => {
    const data = fixture("orca-real-dag-wsl-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    db = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-dag-wsl", data, "wsl");
    const run = campaign(repo.id);
    const built = makeServices(db, data.tempDir, repo, run);
    built.repositoryStore.create(repo);
    built.runStore.create(run);
    const packet = createPacket(built.packetService, repo, run, "dag-wsl", ["dag-wsl.txt"]);
    const final = await built.dag.execute(repo.id, run.id, 1, { nodes: [{ nodeId: "wsl", packetId: packet.packetId, dependsOn: [] }], maxConcurrency: 1 });
    expect(final.status).toBe("COMPLETED");
    expect(final.report?.nodes[0]?.status).toBe("COMPLETED");
    expect(fs.existsSync(path.join(data.cloneDir, "dag-wsl.txt"))).toBe(true);
  }, 180000);
});
