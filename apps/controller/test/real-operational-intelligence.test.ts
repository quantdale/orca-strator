/**
 * Real Change 010 qualification. These checks use real child processes and
 * real Git repositories. They do not make provider inference requests.
 */

import { describe, expect, it, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { CapabilityStore } from "../src/executor/capability-store.js";
import { CapabilityProbeService } from "../src/executor/capability-probe-service.js";
import { GitClient } from "../src/watcher/git-client.js";
import { toWslPath } from "../src/wsl-path.js";
import type { RepositoryRecord } from "@orca/shared";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function wslDistroReady(distribution: string): boolean {
  try {
    execFileSync("wsl.exe", ["-d", distribution, "-e", "bash", "-lc", "command -v node && command -v git"], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function createGitFixture(prefix: string): { tempDir: string; bareDir: string; cloneDir: string } {
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
  fs.writeFileSync(path.join(cloneDir, "README.md"), "# Capability qualification\n");
  git(cloneDir, ["add", "-A"]);
  git(cloneDir, ["commit", "-m", "initial"]);
  git(cloneDir, ["remote", "add", "origin", bareDir]);
  git(cloneDir, ["push", "-u", "origin", "main"]);
  return { tempDir, bareDir, cloneDir };
}

function repo(id: string, fixture: { bareDir: string; cloneDir: string }, environment: "windows" | "wsl", remote = fixture.bareDir): RepositoryRecord {
  const now = new Date().toISOString();
  return {
    id,
    displayName: id,
    githubRemote: remote,
    localPath: fixture.cloneDir,
    environment,
    wslDistribution: environment === "wsl" ? "Ubuntu" : null,
    executorCli: "node",
    executorModel: "probe-only",
    solConversationUrl: "https://chatgpt.com/c/capability-qualification",
    maxIterations: 2,
    maxRuntimeMinutes: 2,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

describe("Real Change 010 capability qualification", () => {
  let dbContext: DatabaseContext | null = null;
  let tempDirs: string[] = [];

  afterEach(() => {
    dbContext?.close();
    dbContext = null;
    for (const tempDir of tempDirs) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDirs = [];
  });

  it("qualifies a Windows NON_INFERENCE probe against real node and Git", async () => {
    const fixture = createGitFixture("orca-real-capability-win-");
    tempDirs.push(fixture.tempDir);
    dbContext = initDatabase(path.join(fixture.tempDir, "probe.sqlite"));
    const repository = repo("real-capability-win", fixture, "windows");
    const repositories = new RepositoryStore(dbContext.db);
    repositories.create(repository);
    const service = new CapabilityProbeService({
      store: new CapabilityStore(dbContext.db),
      gitClient: new GitClient()
    });

    const result = await service.probe(repository, { level: "NON_INFERENCE" });

    expect(result.snapshot.installed).toBe(true);
    expect(result.snapshot.commandProfileValid).toBe("READY");
    expect(result.snapshot.workingDirectoryAccessible).toBe("READY");
    expect(result.snapshot.gitAvailable).toBe("READY");
    expect(result.snapshot.fetchUsable).toBe("READY");
    expect(result.snapshot.remoteMainUsable).toBe("READY");
    expect(result.snapshot.pushUsable).toBe("UNKNOWN");
    expect(result.snapshot.authStatus).toBe("UNKNOWN");
    expect(result.snapshot.modelRecognition).toBe("UNKNOWN");
    expect(result.snapshot.overall).toBe("UNKNOWN");
  }, 120000);

  const wslReady = wslDistroReady("Ubuntu");
  if (!wslReady) {
    console.warn("Change 010 WSL capability qualification UNQUALIFIED: Ubuntu with node and git is unavailable.");
  }

  it.skipIf(!wslReady)("qualifies a WSL NON_INFERENCE probe through wsl.exe", async () => {
    const fixture = createGitFixture("orca-real-capability-wsl-");
    tempDirs.push(fixture.tempDir);
    const wslRemote = toWslPath(fixture.bareDir);
    git(fixture.cloneDir, ["remote", "set-url", "origin", wslRemote]);
    dbContext = initDatabase(path.join(fixture.tempDir, "probe.sqlite"));
    const repository = repo("real-capability-wsl", fixture, "wsl", wslRemote);
    const repositories = new RepositoryStore(dbContext.db);
    repositories.create(repository);
    const service = new CapabilityProbeService({
      store: new CapabilityStore(dbContext.db),
      gitClient: new GitClient()
    });

    const result = await service.probe(repository, { level: "NON_INFERENCE" });

    expect(result.snapshot.installed).toBe(true);
    expect(result.snapshot.commandProfileValid).toBe("READY");
    expect(result.snapshot.workingDirectoryAccessible).toBe("READY");
    expect(result.snapshot.gitAvailable).toBe("READY");
    expect(result.snapshot.fetchUsable).toBe("READY");
    expect(result.snapshot.remoteMainUsable).toBe("READY");
    expect(result.snapshot.authStatus).toBe("UNKNOWN");
    expect(result.snapshot.modelRecognition).toBe("UNKNOWN");
  }, 120000);
});
