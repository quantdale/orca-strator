/** Real Change 013 qualification: isolated child workers, bounded scheduling, integration, and partial failure. */

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

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for swarm state.");
}

function fixture(prefix: string): { tempDir: string; bareDir: string; cloneDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const bareDir = path.join(tempDir, "remote.git");
  const cloneDir = path.join(tempDir, "clone");
  fs.mkdirSync(bareDir, { recursive: true });
  fs.mkdirSync(cloneDir, { recursive: true });
  git(bareDir, ["init", "--bare", "-b", "main"]);
  git(cloneDir, ["init", "-b", "main"]);
  git(cloneDir, ["config", "user.email", "orca-swarm-qual@example.com"]);
  git(cloneDir, ["config", "user.name", "Orca Swarm Qualification"]);
  git(cloneDir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(cloneDir, "README.md"), "# Swarm qualification\n");
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
    executorModel: "deterministic-test-model",
    solConversationUrl: "https://chatgpt.com/c/swarm-qualification",
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
    id: `run-swarm-${repositoryId}`,
    repositoryId,
    goal: "Qualify optional same-repository swarm",
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

function createPacket(
  service: WorkPacketService,
  repository: RepositoryRecord,
  run: RunRecord,
  workstream: string,
  dependencies: string[] = []
): WorkPacket {
  return service.create(repository, run, {
    workstream,
    goal: `Implement ${workstream}`,
    allowedPaths: [`${workstream}.txt`],
    dependencies,
    executor: {
      role: "PRIMARY",
      executorCli: repository.executorCli,
      model: repository.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT"
    }
  });
}

describe("Real Change 013 optional same-repository swarm qualification", () => {
  let dbContext: DatabaseContext | null = null;
  let tempDirs: string[] = [];
  const oldHarness = process.env.ORCA_SWARM_TEST_HARNESS;
  const oldFailPacket = process.env.ORCA_SWARM_FAIL_PACKET;

  afterEach(() => {
    dbContext?.close();
    dbContext = null;
    if (oldHarness === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldHarness;
    if (oldFailPacket === undefined) delete process.env.ORCA_SWARM_FAIL_PACKET;
    else process.env.ORCA_SWARM_FAIL_PACKET = oldFailPacket;
    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    delete process.env.ORCA_SWARM_WAIT_FILE;
    for (const tempDir of tempDirs) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDirs = [];
  });

  it("runs bounded isolated workers and integrates independent commits without pushing", async () => {
    const data = fixture("orca-real-swarm-win-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    dbContext = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-swarm-win", data);
    const run = campaign(repo.id);
    const remoteBefore = git(data.bareDir, ["rev-parse", "refs/heads/main"]);
    const repositoryStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    repositoryStore.create(repo);
    runStore.create(run);
    const packetStore = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(packetStore);
    const first = createPacket(packetService, repo, run, "swarm-alpha");
    const second = createPacket(packetService, repo, run, "swarm-beta");
    const isolation = new WorktreeIsolationService(packetStore, data.tempDir);
    const strategy = new SwarmExecutionService({
      repositoryStore,
      runStore,
      strategyStore: new StrategyRunStore(dbContext.db),
      packetStore,
      packetService,
      worktreeService: isolation,
      integrationService: new IntegrationService(packetStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: data.tempDir
    });

    const final = await strategy.execute(repo.id, run.id, 1, {
      packetIds: [first.packetId, second.packetId],
      maxConcurrency: 2
    });

    expect(final.status).toBe("COMPLETED");
    expect(final.report?.integration?.status).toBe("COMPLETED");
    expect(final.report?.results.every((result) => result.status === "COMPLETED")).toBe(true);
    expect(final.report?.results.map((result) => result.worktree?.path)).toHaveLength(2);
    expect(new Set(final.report?.results.map((result) => result.worktree?.path)).size).toBe(2);
    expect(fs.readFileSync(path.join(data.cloneDir, "swarm-alpha.txt"), "utf8").replace(/\r\n/g, "\n")).toContain("swarm worker");
    expect(fs.readFileSync(path.join(data.cloneDir, "swarm-beta.txt"), "utf8").replace(/\r\n/g, "\n")).toContain("swarm worker");
    expect(git(data.cloneDir, ["status", "--porcelain"])).toBe("");
    expect(git(data.bareDir, ["rev-parse", "refs/heads/main"])).toBe(remoteBefore);
    expect(git(data.cloneDir, ["rev-parse", "HEAD"])).not.toBe(remoteBefore);
  }, 180000);

  it("preserves partial success and dependency skips when a worker fails", async () => {
    const data = fixture("orca-real-swarm-partial-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    dbContext = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-swarm-partial", data);
    const run = campaign(repo.id);
    const repositoryStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    repositoryStore.create(repo);
    runStore.create(run);
    const packetStore = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(packetStore);
    const failed = createPacket(packetService, repo, run, "swarm-failed");
    const successful = createPacket(packetService, repo, run, "swarm-success");
    const dependent = createPacket(packetService, repo, run, "swarm-dependent", [failed.packetId]);
    process.env.ORCA_SWARM_FAIL_PACKET = failed.packetId;
    const strategy = new SwarmExecutionService({
      repositoryStore,
      runStore,
      strategyStore: new StrategyRunStore(dbContext.db),
      packetStore,
      packetService,
      worktreeService: new WorktreeIsolationService(packetStore, data.tempDir),
      integrationService: new IntegrationService(packetStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: data.tempDir
    });

    const final = await strategy.execute(repo.id, run.id, 1, {
      packetIds: [failed.packetId, successful.packetId, dependent.packetId],
      maxConcurrency: 2
    });
    const byPacket = new Map(final.report?.results.map((result) => [result.packetId, result]));

    expect(final.status).toBe("PARTIAL");
    expect(byPacket.get(failed.packetId)?.status).toBe("FAILED");
    expect(byPacket.get(successful.packetId)?.status).toBe("COMPLETED");
    expect(byPacket.get(dependent.packetId)?.status).toBe("SKIPPED_DEPENDENCY");
    expect(fs.existsSync(path.join(data.cloneDir, "swarm-success.txt"))).toBe(true);
    expect(fs.existsSync(path.join(data.cloneDir, "swarm-failed-failed.txt"))).toBe(false);
  }, 180000);

  it("persists pause/resume and preserves the isolated worktree across the control boundary", async () => {
    const data = fixture("orca-real-swarm-pause-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "1200";
    dbContext = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-swarm-pause", data);
    const run = campaign(repo.id);
    const repositoryStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    repositoryStore.create(repo);
    runStore.create(run);
    const packetStore = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(packetStore);
    const packet = createPacket(packetService, repo, run, "swarm-pause");
    const strategy = new SwarmExecutionService({
      repositoryStore,
      runStore,
      strategyStore: new StrategyRunStore(dbContext.db),
      packetStore,
      packetService,
      worktreeService: new WorktreeIsolationService(packetStore, data.tempDir),
      integrationService: new IntegrationService(packetStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: data.tempDir
    });

    const started = strategy.start(repo.id, run.id, 1, { packetIds: [packet.packetId], maxConcurrency: 1 });
    await waitFor(() => packetService.get(packet.packetId)?.status === "RUNNING");
    await strategy.control(repo.id, started.strategyRunId, "PAUSE", "qualification pause");
    await waitFor(() => strategy.get(started.strategyRunId)?.status === "PAUSED");
    const pausedWorktree = packetStore.getWorktreeByPacket(packet.packetId);
    expect(pausedWorktree?.status).toBe("ACTIVE");
    expect(strategy.listControls(started.strategyRunId).map((control) => control.decision)).toContain("PAUSE");

    delete process.env.ORCA_SWARM_HARNESS_SLOW_MS;
    // Change 018 review F6: a direct strategy RESUME must not contradict
    // campaign state - the engine requires the campaign itself to be PAUSED.
    // Mirror the coordinator's campaign move once the actor reached its paused
    // boundary (coordinator.pause stamps PAUSED after waitForStrategyBoundary).
    runStore.updateStatus(run.id, "PAUSED");
    await strategy.control(repo.id, started.strategyRunId, "RESUME", "qualification resume");
    // Mirror coordinator.resume moving the campaign back to EXECUTING after
    // engine acceptance.
    runStore.updateStatus(run.id, "EXECUTING");
    await waitFor(() => strategy.get(started.strategyRunId)?.status === "COMPLETED", 20_000);
    expect(strategy.listControls(started.strategyRunId).map((control) => control.decision)).toEqual(["PAUSE", "RESUME"]);
    expect(packetService.getResult(packet.packetId)?.status).toBe("COMPLETED");
    expect(fs.existsSync(path.join(data.cloneDir, "swarm-pause.txt"))).toBe(true);
  }, 180000);

  it("drains stop and records emergency kill as recovery-required without deleting worker state", async () => {
    const data = fixture("orca-real-swarm-controls-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    process.env.ORCA_SWARM_HARNESS_SLOW_MS = "5000";
    const stopRelease = path.join(data.tempDir, "stop-release");
    process.env.ORCA_SWARM_WAIT_FILE = stopRelease;
    dbContext = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-swarm-controls", data);
    const run = campaign(repo.id);
    const repositoryStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    repositoryStore.create(repo);
    runStore.create(run);
    const packetStore = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(packetStore);
    const first = createPacket(packetService, repo, run, "swarm-stop");
    const second = createPacket(packetService, repo, run, "swarm-kill");
    let firstWorkerStarted = false;
    const strategy = new SwarmExecutionService({
      repositoryStore,
      runStore,
      strategyStore: new StrategyRunStore(dbContext.db),
      packetStore,
      packetService,
      worktreeService: new WorktreeIsolationService(packetStore, data.tempDir),
      integrationService: new IntegrationService(packetStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: data.tempDir,
      eventPublisher: (event) => {
        // Packet IDs are UUIDs and the scheduler intentionally sorts them for
        // deterministic admission. The first admitted worker is therefore not
        // necessarily the packet created first; the control qualification only
        // needs to wait until any worker owns the latch-controlled process.
        if (event.type === "strategy.worker_started") firstWorkerStarted = true;
      }
    });

    const stopped = strategy.start(repo.id, run.id, 1, { packetIds: [first.packetId, second.packetId], maxConcurrency: 1 });
    await waitFor(() => firstWorkerStarted);
    await strategy.control(repo.id, stopped.strategyRunId, "STOP", "qualification stop");
    fs.writeFileSync(stopRelease, "release\n");
    await waitFor(() => ["CANCELLED", "PARTIAL", "COMPLETED"].includes(strategy.get(stopped.strategyRunId)?.status ?? ""), 20_000);
    expect(strategy.get(stopped.strategyRunId)?.status).toBe("CANCELLED");
    // UUID packet ordering determines which packet owns the latch-controlled
    // worker. Verify the durable boundary rather than assuming creation order:
    // the active worker drains, while the queued sibling is cancelled.
    expect([packetService.getResult(first.packetId)?.status, packetService.getResult(second.packetId)?.status].sort()).toEqual(["CANCELLED", "COMPLETED"]);

    const killData = fixture("orca-real-swarm-kill-");
    tempDirs.push(killData.tempDir);
    const killRelease = path.join(killData.tempDir, "kill-release");
    process.env.ORCA_SWARM_WAIT_FILE = killRelease;
    dbContext.close();
    dbContext = initDatabase(path.join(killData.tempDir, "orca.sqlite"));
    const killRepo = repository("repo-swarm-kill", killData);
    const killRun = campaign(killRepo.id);
    const killRepositoryStore = new RepositoryStore(dbContext.db);
    const killRunStore = new RunStore(dbContext.db);
    killRepositoryStore.create(killRepo);
    killRunStore.create(killRun);
    const killPacketStore = new WorkPacketStore(dbContext.db);
    const killPacketService = new WorkPacketService(killPacketStore);
    const killPacket = createPacket(killPacketService, killRepo, killRun, "swarm-emergency-kill");
    const killStrategy = new SwarmExecutionService({
      repositoryStore: killRepositoryStore,
      runStore: killRunStore,
      strategyStore: new StrategyRunStore(dbContext.db),
      packetStore: killPacketStore,
      packetService: killPacketService,
      worktreeService: new WorktreeIsolationService(killPacketStore, killData.tempDir),
      integrationService: new IntegrationService(killPacketStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: killData.tempDir
    });
    const killed = killStrategy.start(killRepo.id, killRun.id, 1, { packetIds: [killPacket.packetId], maxConcurrency: 1 });
    await waitFor(() => killPacketService.get(killPacket.packetId)?.status === "RUNNING");
    await killStrategy.control(killRepo.id, killed.strategyRunId, "KILL", "qualification emergency kill");
    await waitFor(() => killStrategy.get(killed.strategyRunId)?.status === "RECOVERY_REQUIRED", 20_000);
    expect(killPacketService.getResult(killPacket.packetId)?.status).toBe("CANCELLED");
    expect(killPacketStore.getWorktreeByPacket(killPacket.packetId)?.status).toBe("ACTIVE");
  }, 180000);

  it("reconciles a persisted running strategy after restart without deleting its worktree", async () => {
    const data = fixture("orca-real-swarm-recovery-");
    tempDirs.push(data.tempDir);
    dbContext = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-swarm-recovery", data);
    const run = campaign(repo.id);
    const repositoryStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    repositoryStore.create(repo);
    runStore.create(run);
    const packetStore = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(packetStore);
    const packet = createPacket(packetService, repo, run, "swarm-recovery");
    const isolation = new WorktreeIsolationService(packetStore, data.tempDir);
    const worktree = await isolation.allocate(repo, packet);
    packetService.updateStatus(packet.packetId, "RUNNING");
    const strategyStore = new StrategyRunStore(dbContext.db);
    const now = new Date().toISOString();
    strategyStore.create({
      schemaVersion: 1,
      strategyRunId: "strategy-recovery-1",
      repositoryId: repo.id,
      campaignId: run.id,
      runId: run.id,
      iteration: 1,
      strategy: "SWARM",
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
    const restarted = new SwarmExecutionService({
      repositoryStore,
      runStore,
      strategyStore,
      packetStore,
      packetService,
      worktreeService: new WorktreeIsolationService(packetStore, data.tempDir),
      integrationService: new IntegrationService(packetStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: data.tempDir
    });
    const recovered = await restarted.recoverAll();
    expect(recovered[0]?.status).toBe("RECOVERY_REQUIRED");
    expect(packetService.getResult(packet.packetId)?.status).toBe("BLOCKED");
    expect(packetStore.getWorktree(worktree.worktreeId)?.status).toBe("STALE");
    expect(fs.existsSync(worktree.path)).toBe(true);
  }, 180000);

  const wslReady = wslDistroReady("Ubuntu");
  if (!wslReady) console.warn("Change 013 WSL swarm qualification UNQUALIFIED: Ubuntu with node and git is unavailable.");

  it.skipIf(!wslReady)("runs a real WSL worker through the WSL adapter and Git integration path", async () => {
    const data = fixture("orca-real-swarm-wsl-");
    tempDirs.push(data.tempDir);
    process.env.ORCA_SWARM_TEST_HARNESS = HARNESS_PATH;
    dbContext = initDatabase(path.join(data.tempDir, "orca.sqlite"));
    const repo = repository("repo-swarm-wsl", data, "wsl");
    const run = campaign(repo.id);
    const repositoryStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    repositoryStore.create(repo);
    runStore.create(run);
    const packetStore = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(packetStore);
    const packet = createPacket(packetService, repo, run, "swarm-wsl");
    const strategy = new SwarmExecutionService({
      repositoryStore,
      runStore,
      strategyStore: new StrategyRunStore(dbContext.db),
      packetStore,
      packetService,
      worktreeService: new WorktreeIsolationService(packetStore, data.tempDir),
      integrationService: new IntegrationService(packetStore),
      schedulerService: new SchedulerService(new SchedulerPolicyStore(dbContext.db)),
      dataDir: data.tempDir
    });
    const final = await strategy.execute(repo.id, run.id, 1, { packetIds: [packet.packetId], maxConcurrency: 1 });
    expect(final.status).toBe("COMPLETED");
    expect(final.report?.integration?.status).toBe("COMPLETED");
    expect(fs.existsSync(path.join(data.cloneDir, "swarm-wsl.txt"))).toBe(true);
  }, 180000);
});
