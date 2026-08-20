/** Real Change 012 qualification: Git worktrees, commits, integration, and WSL routing. */

import { afterEach, describe, expect, it } from "vitest";
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
import { toWslPath } from "../src/wsl-path.js";
import type { RepositoryRecord, RunRecord, WorkPacket, WorkPacketResult, IsolatedWorktreeRecord } from "@orca/shared";

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

function fixture(prefix: string): { tempDir: string; bareDir: string; cloneDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const bareDir = path.join(tempDir, "remote.git");
  const cloneDir = path.join(tempDir, "clone");
  fs.mkdirSync(bareDir, { recursive: true });
  fs.mkdirSync(cloneDir, { recursive: true });
  git(bareDir, ["init", "--bare", "-b", "main"]);
  git(cloneDir, ["init", "-b", "main"]);
  git(cloneDir, ["config", "user.email", "orca-qual@example.com"]);
  git(cloneDir, ["config", "user.name", "Orca Qualification"]);
  git(cloneDir, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(cloneDir, "README.md"), "# Worktree qualification\n");
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", "initial"]);
  git(cloneDir, ["remote", "add", "origin", bareDir]);
  git(cloneDir, ["push", "-u", "origin", "main"]);
  return { tempDir, bareDir, cloneDir };
}

function repository(id: string, fixtureData: { bareDir: string; cloneDir: string }, environment: "windows" | "wsl" = "windows", remote = fixtureData.bareDir): RepositoryRecord {
  const now = new Date().toISOString();
  return {
    id,
    displayName: id,
    githubRemote: remote,
    localPath: fixtureData.cloneDir,
    environment,
    wslDistribution: environment === "wsl" ? "Ubuntu" : null,
    executorCli: "orca-test-harness",
    executorModel: "test-model",
    solConversationUrl: "https://chatgpt.com/c/worktree-qualification",
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
    id: "run-worktree-real",
    repositoryId,
    goal: "Qualify isolated worktrees",
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

function packet(service: WorkPacketService, repo: RepositoryRecord, run: RunRecord, workstream: string, dependencies: string[] = []): WorkPacket {
  return service.create(repo, run, {
    workstream,
    goal: `Implement ${workstream}`,
    dependencies,
    allowedPaths: [`${workstream}.txt`],
    executor: { role: "PRIMARY", executorCli: repo.executorCli, model: repo.executorModel, provider: null, source: "REPOSITORY_DEFAULT" }
  });
}

function result(packetRecord: WorkPacket, worktree: IsolatedWorktreeRecord, commitSha: string, filesChanged: string[]): WorkPacketResult {
  return {
    schemaVersion: 1,
    packetId: packetRecord.packetId,
    campaignId: packetRecord.campaignId,
    runId: packetRecord.runId,
    iteration: packetRecord.iteration,
    status: "COMPLETED",
    worktree: { worktreeId: worktree.worktreeId, path: worktree.path, branch: worktree.branch, baseSha: worktree.baseSha, commitSha },
    filesChanged,
    verification: ["real local Git commit"],
    findings: [],
    risks: [],
    artifacts: [],
    dependenciesAffected: packetRecord.dependencies,
    usageMetricIds: [],
    summary: "real worker result",
    blocker: null,
    createdAt: new Date().toISOString()
  };
}

describe("Real Change 012 worktree/isolation qualification", () => {
  let dbContext: DatabaseContext | null = null;
  let tempDirs: string[] = [];

  afterEach(() => {
    dbContext?.close();
    dbContext = null;
    for (const tempDir of tempDirs) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDirs = [];
  });

  it("allocates distinct Windows worktrees, integrates non-overlapping commits, preserves dirty work, and detects conflicts", async () => {
    const fixtureData = fixture("orca-real-worktree-win-");
    tempDirs.push(fixtureData.tempDir);
    dbContext = initDatabase(path.join(fixtureData.tempDir, "orca.sqlite"));
    const repo = repository("repo-worktree-win", fixtureData);
    const run = campaign(repo.id);
    new RepositoryStore(dbContext.db).create(repo);
    new RunStore(dbContext.db).create(run);
    const store = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(store);
    const isolation = new WorktreeIsolationService(store, fixtureData.tempDir);
    const integration = new IntegrationService(store);
    const first = packet(packetService, repo, run, "alpha");
    const second = packet(packetService, repo, run, "beta");
    const firstTree = await isolation.allocate(repo, first);
    const secondTree = await isolation.allocate(repo, second);
    expect(firstTree.path).not.toBe(secondTree.path);
    expect(firstTree.branch).not.toBe(secondTree.branch);
    expect(git(fixtureData.cloneDir, ["status", "--porcelain"])).toBe("");

    fs.writeFileSync(path.join(firstTree.path, "alpha.txt"), "alpha\n");
    git(firstTree.path, ["add", "alpha.txt"]);
    git(firstTree.path, ["commit", "-m", "alpha worker"]);
    const firstResult = result(first, firstTree, git(firstTree.path, ["rev-parse", "HEAD"]), ["alpha.txt"]);
    fs.writeFileSync(path.join(secondTree.path, "beta.txt"), "beta\n");
    git(secondTree.path, ["add", "beta.txt"]);
    git(secondTree.path, ["commit", "-m", "beta worker"]);
    const secondResult = result(second, secondTree, git(secondTree.path, ["rev-parse", "HEAD"]), ["beta.txt"]);

    const report = await integration.integrate(repo, run.id, 1, [first, second], [firstResult, secondResult]);
    expect(report.status).toBe("COMPLETED");
    expect(report.integratedPacketIds).toHaveLength(2);
    expect(fs.readFileSync(path.join(fixtureData.cloneDir, "alpha.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("alpha\n");
    expect(fs.readFileSync(path.join(fixtureData.cloneDir, "beta.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("beta\n");

    const conflictOne = packet(packetService, repo, run, "conflict-one");
    const conflictTwo = packet(packetService, repo, run, "conflict-two");
    const conflictTreeOne = await isolation.allocate(repo, conflictOne);
    const conflictTreeTwo = await isolation.allocate(repo, conflictTwo);
    fs.writeFileSync(path.join(conflictTreeOne.path, "conflict.txt"), "one\n");
    git(conflictTreeOne.path, ["add", "conflict.txt"]);
    git(conflictTreeOne.path, ["commit", "-m", "conflict one"]);
    fs.writeFileSync(path.join(conflictTreeTwo.path, "conflict.txt"), "two\n");
    git(conflictTreeTwo.path, ["add", "conflict.txt"]);
    git(conflictTreeTwo.path, ["commit", "-m", "conflict two"]);
    const conflictReport = await integration.integrate(repo, run.id, 1, [conflictOne, conflictTwo], [
      result(conflictOne, conflictTreeOne, git(conflictTreeOne.path, ["rev-parse", "HEAD"]), ["conflict.txt"]),
      result(conflictTwo, conflictTreeTwo, git(conflictTreeTwo.path, ["rev-parse", "HEAD"]), ["conflict.txt"])
    ]);
    expect(conflictReport.status).toBe("INTEGRATION_CONFLICT");
    expect(conflictReport.integratedPacketIds).toHaveLength(1);
    expect(conflictReport.results.filter((item) => item.status === "INTEGRATION_CONFLICT")).toHaveLength(1);

    const failedPacket = packet(packetService, repo, run, "failed-worker");
    const dependentPacket = packet(packetService, repo, run, "dependent-worker", [failedPacket.packetId]);
    const failedResult: WorkPacketResult = {
      ...result(failedPacket, conflictTreeOne, git(conflictTreeOne.path, ["rev-parse", "HEAD"]), []),
      status: "FAILED",
      worktree: null,
      blocker: "WORKER_FAILED"
    };
    const dependentResult = result(dependentPacket, conflictTreeOne, git(conflictTreeOne.path, ["rev-parse", "HEAD"]), []);
    const partialReport = await integration.integrate(repo, run.id, 1, [failedPacket, dependentPacket], [failedResult, dependentResult]);
    expect(partialReport.results.find((item) => item.packetId === dependentPacket.packetId)?.status).toBe("SKIPPED_DEPENDENCY");
    expect(partialReport.status).toBe("BLOCKED");

    const dirtyPacket = packet(packetService, repo, run, "dirty");
    const dirtyTree = await isolation.allocate(repo, dirtyPacket);
    const dirtyFile = path.join(dirtyTree.path, "keep-me.txt");
    fs.writeFileSync(dirtyFile, "preserve\n");
    const dirtyRelease = await isolation.release(repo, dirtyTree.worktreeId);
    expect(dirtyRelease?.status).toBe("CLEANUP_REQUIRED");
    expect(fs.existsSync(dirtyFile)).toBe(true);

    const recoveredPacket = packet(packetService, repo, run, "recover");
    const recoveredTree = await isolation.allocate(repo, recoveredPacket);
    const recovered = await new WorktreeIsolationService(store, fixtureData.tempDir).recover(repo);
    expect(recovered.find((item) => item.worktreeId === recoveredTree.worktreeId)?.status).toBe("STALE");
  }, 180000);

  const wslReady = wslDistroReady("Ubuntu");
  if (!wslReady) console.warn("Change 012 WSL worktree qualification UNQUALIFIED: Ubuntu with node and git is unavailable.");

  it.skipIf(!wslReady)("allocates and recovers a real WSL worktree through wsl.exe", async () => {
    const fixtureData = fixture("orca-real-worktree-wsl-");
    tempDirs.push(fixtureData.tempDir);
    dbContext = initDatabase(path.join(fixtureData.tempDir, "orca.sqlite"));
    const wslRepo = repository("repo-worktree-wsl", fixtureData, "wsl", toWslPath(fixtureData.bareDir));
    const run = campaign(wslRepo.id);
    new RepositoryStore(dbContext.db).create(wslRepo);
    new RunStore(dbContext.db).create(run);
    const store = new WorkPacketStore(dbContext.db);
    const packetService = new WorkPacketService(store);
    const isolation = new WorktreeIsolationService(store, fixtureData.tempDir);
    const workPacket = packet(packetService, wslRepo, run, "wsl-stream");
    const worktree = await isolation.allocate(wslRepo, workPacket);
    expect(worktree.environment).toBe("wsl");
    expect(fs.existsSync(worktree.path)).toBe(true);
    const recovered = await isolation.recover(wslRepo);
    expect(recovered.find((item) => item.worktreeId === worktree.worktreeId)?.status).toBe("STALE");
    const released = await isolation.release(wslRepo, worktree.worktreeId);
    expect(released?.status).toBe("RELEASED");
  }, 180000);
});
