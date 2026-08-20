import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ValidationError, type IsolatedWorktreeRecord, type RepositoryRecord, type WorkPacket } from "@orca/shared";
import { toWslPath } from "../wsl-path.js";
import type { WorkPacketStore } from "./work-packet-store.js";

const execFileAsync = promisify(execFile);

export class WorktreeIsolationService {
  private readonly dataDir: string;

  constructor(
    private readonly store: WorkPacketStore,
    dataDir: string
  ) {
    this.dataDir = path.resolve(dataDir);
  }

  async allocate(repository: RepositoryRecord, packet: WorkPacket): Promise<IsolatedWorktreeRecord> {
    const existing = this.store.getWorktreeByPacket(packet.packetId);
    if (existing && ["ALLOCATED", "ACTIVE"].includes(existing.status)) return existing;
    if (packet.runId !== packet.campaignId) throw new ValidationError("Worktree packet campaign/run correlation is invalid.");

    const baseSha = await this.git(repository, ["rev-parse", "refs/heads/main"], repository.localPath);
    if (!/^[0-9a-f]{40}$/i.test(baseSha)) throw new ValidationError("Cannot allocate a worktree without a valid local main SHA.");
    const safeRepository = this.safePart(repository.id);
    const safeRun = this.safePart(packet.runId);
    const safePacket = this.safePart(packet.packetId);
    const worktreePath = path.join(this.dataDir, "worktrees", safeRepository, safeRun, safePacket);
    this.assertWithinDataDir(worktreePath);
    const branch = `orca/internal/${safeRepository}/${safeRun}/${packet.iteration}/${safePacket}`;
    const parent = path.dirname(worktreePath);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(worktreePath)) {
      throw new ValidationError(`Deterministic worktree path already exists and was not removed: ${worktreePath}`);
    }

    await this.git(repository, ["worktree", "add", "-b", branch, this.gitPath(repository, worktreePath), baseSha], repository.localPath);
    const now = new Date().toISOString();
    return this.store.saveWorktree({
      worktreeId: crypto.randomUUID(),
      repositoryId: repository.id,
      packetId: packet.packetId,
      campaignId: packet.campaignId,
      runId: packet.runId,
      iteration: packet.iteration,
      path: worktreePath,
      branch,
      environment: repository.environment,
      wslDistribution: repository.wslDistribution,
      baseSha,
      status: "ACTIVE",
      createdAt: now,
      releasedAt: null,
      lastError: null
    });
  }

  async release(repository: RepositoryRecord, worktreeId: string): Promise<IsolatedWorktreeRecord | null> {
    const record = this.store.getWorktree(worktreeId);
    if (!record || record.repositoryId !== repository.id) return null;
    if (record.status === "RELEASED") return record;
    if (!fs.existsSync(record.path)) {
      return this.store.updateWorktree(worktreeId, { status: "ORPHANED", releasedAt: new Date().toISOString(), lastError: "Worktree path is missing; branch provenance was retained." });
    }
    let status = "";
    try { status = await this.git(repository, ["status", "--porcelain"], record.path); } catch (error: any) {
      return this.store.updateWorktree(worktreeId, { status: "CLEANUP_REQUIRED", lastError: error?.message ?? String(error) });
    }
    if (status.trim()) {
      return this.store.updateWorktree(worktreeId, { status: "CLEANUP_REQUIRED", lastError: "Worktree has uncommitted files; automatic cleanup is refused." });
    }
    try {
      await this.git(repository, ["worktree", "remove", this.gitPath(repository, record.path)], repository.localPath);
    } catch (error: any) {
      return this.store.updateWorktree(worktreeId, { status: "CLEANUP_REQUIRED", lastError: error?.message ?? String(error) });
    }
    let branchError: string | null = null;
    try {
      // -d is deliberately non-forceful. An unmerged internal branch remains
      // available as provenance/recovery evidence.
      await this.git(repository, ["branch", "-d", record.branch], repository.localPath);
    } catch (error: any) {
      branchError = `Internal branch retained: ${error?.message ?? String(error)}`;
    }
    return this.store.updateWorktree(worktreeId, {
      status: "RELEASED",
      releasedAt: new Date().toISOString(),
      lastError: branchError
    });
  }

  async recover(repository: RepositoryRecord): Promise<IsolatedWorktreeRecord[]> {
    const records = this.store.listWorktrees(repository.id, ["ALLOCATED", "ACTIVE"]);
    const recovered: IsolatedWorktreeRecord[] = [];
    for (const record of records) {
      if (!fs.existsSync(record.path)) {
        const next = this.store.updateWorktree(record.worktreeId, { status: "ORPHANED", lastError: "Worktree path is missing after restart; no cleanup was attempted." });
        if (next) recovered.push(next);
        continue;
      }
      try {
        const status = await this.git(repository, ["status", "--porcelain"], record.path);
        const next = this.store.updateWorktree(record.worktreeId, {
          status: status.trim() ? "CLEANUP_REQUIRED" : "STALE",
          lastError: status.trim() ? "Recovered worktree is dirty; user/worker files are preserved." : "Recovered after controller restart; explicit strategy reconciliation required."
        });
        if (next) recovered.push(next);
      } catch (error: any) {
        const next = this.store.updateWorktree(record.worktreeId, { status: "ORPHANED", lastError: error?.message ?? String(error) });
        if (next) recovered.push(next);
      }
    }
    return recovered;
  }

  list(repositoryId: string): IsolatedWorktreeRecord[] { return this.store.listWorktrees(repositoryId); }

  private async git(repository: RepositoryRecord, args: string[], cwd: string): Promise<string> {
    const commandArgs: string[] = [];
    let command = "git";
    let commandCwd: string | undefined = cwd;
    if (repository.environment === "wsl") {
      command = "wsl.exe";
      commandCwd = undefined;
      if (repository.wslDistribution) commandArgs.push("-d", repository.wslDistribution);
      commandArgs.push("--cd", this.gitPath(repository, cwd), "--", "git", ...args);
    } else {
      commandArgs.push(...args);
    }
    try {
      const result = await execFileAsync(command, commandArgs, { cwd: commandCwd, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      return result.stdout.toString().trim();
    } catch (error: any) {
      const stderr = error?.stderr?.toString().trim();
      throw new Error(`Git worktree error (${command} ${commandArgs.join(" ")}): ${stderr || error?.message || String(error)}`);
    }
  }

  private gitPath(repository: RepositoryRecord, value: string): string {
    return repository.environment === "wsl" ? toWslPath(value) : value;
  }

  private safePart(value: string): string {
    const safe = value.replace(/[^A-Za-z0-9._-]/g, "-");
    return safe.slice(0, 80) || "unknown";
  }

  private assertWithinDataDir(target: string): void {
    const relative = path.relative(this.dataDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ValidationError("Worktree path escaped the Orca data directory.");
  }
}
