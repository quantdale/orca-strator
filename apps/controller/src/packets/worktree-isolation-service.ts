import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ValidationError,
  type IsolatedWorktreeRecord,
  type RepositoryRecord,
  type WorkPacket,
} from "@orca/shared";
import { toWslPath } from "../wsl-path.js";
import type { WorkPacketStore } from "./work-packet-store.js";

const execFileAsync = promisify(execFile);

/**
 * Change 018: per-strategy-run staging checkout. One linked worktree on an
 * internal `orca/staging/<strategyRunId>` branch receives every accepted DAG
 * node commit; the branch is the strategy-owned lineage that is finally merged
 * into persistent main at strategy terminal. The worktree directory is removed
 * at terminal while the branch is retained as provenance.
 */
export interface StrategyStagingHandle {
  strategyRunId: string;
  path: string;
  branch: string;
  baseSha: string;
}

/** Result of a best-effort git mutation that must not throw into the engine. */
export type GitMutationResult =
  | { ok: true; head: string; alreadyApplied?: boolean }
  | { ok: false; error: string };

/**
 * Detects git's stop when a cherry-pick would produce an empty commit —
 * "The previous cherry-pick is now empty, possibly due to conflict resolution."
 * (phrased with or without "now" across git versions). That stop means the
 * commit's content is already applied, not a conflict.
 */
function isEmptyCherryPickError(message: string): boolean {
  return /previous cherry-pick is (now )?empty/i.test(message);
}

export class WorktreeIsolationService {
  private readonly dataDir: string;

  constructor(
    private readonly store: WorkPacketStore,
    dataDir: string,
  ) {
    this.dataDir = path.resolve(dataDir);
  }

  async allocate(
    repository: RepositoryRecord,
    packet: WorkPacket,
    baseSha?: string,
    materialize?: (worktree: {
      path: string;
      branch: string;
      baseSha: string;
    }) => Promise<string>,
  ): Promise<IsolatedWorktreeRecord> {
    const existing = this.store.getWorktreeByPacket(packet.packetId);
    if (existing && ["ALLOCATED", "ACTIVE"].includes(existing.status))
      return existing;
    if (packet.runId !== packet.campaignId)
      throw new ValidationError(
        "Worktree packet campaign/run correlation is invalid.",
      );

    // Item #7: when an immutable strategy base SHA is supplied, every worker
    // derives from that deterministic snapshot instead of reading mutable
    // refs/heads/main independently (which could differ per packet).
    let resolvedBase =
      baseSha && /^[0-9a-f]{40}$/i.test(baseSha) ? baseSha : "";
    if (!resolvedBase) {
      resolvedBase = await this.git(
        repository,
        ["rev-parse", "refs/heads/main"],
        repository.localPath,
      );
    }
    if (!/^[0-9a-f]{40}$/i.test(resolvedBase))
      throw new ValidationError(
        "Cannot allocate a worktree without a valid local main SHA.",
      );
    const safeRepository = this.safePart(repository.id);
    const safeRun = this.safePart(packet.runId);
    const safePacket = this.safePart(packet.packetId);
    const worktreePath = path.join(
      this.dataDir,
      "worktrees",
      safeRepository,
      safeRun,
      safePacket,
    );
    this.assertWithinDataDir(worktreePath);
    const branch = `orca/internal/${safeRepository}/${safeRun}/${packet.iteration}/${safePacket}`;
    const parent = path.dirname(worktreePath);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(worktreePath)) {
      throw new ValidationError(
        `Deterministic worktree path already exists and was not removed: ${worktreePath}`,
      );
    }

    await this.git(
      repository,
      [
        "worktree",
        "add",
        "-b",
        branch,
        this.gitPath(repository, worktreePath),
        resolvedBase,
      ],
      repository.localPath,
    );
    // Change 018: authorized dependency replay runs between worktree creation
    // and record persistence so the stored baseSha is the post-replay HEAD —
    // the exact snapshot the worker will see. A failed replay leaves no
    // orphaned worktree/branch behind.
    let persistedBase = resolvedBase;
    if (materialize) {
      try {
        const head = await materialize({
          path: worktreePath,
          branch,
          baseSha: resolvedBase,
        });
        if (/^[0-9a-f]{40}$/i.test(head)) persistedBase = head;
      } catch (error: any) {
        try {
          await this.git(
            repository,
            [
              "worktree",
              "remove",
              "--force",
              this.gitPath(repository, worktreePath),
            ],
            repository.localPath,
          );
        } catch {}
        try {
          await this.git(repository, ["branch", "-D", branch], repository.localPath);
        } catch {}
        throw error;
      }
    }
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
      baseSha: persistedBase,
      dependencyInputShas: [],
      status: "ACTIVE",
      createdAt: now,
      releasedAt: null,
      lastError: null,
    });
  }

  async release(
    repository: RepositoryRecord,
    worktreeId: string,
  ): Promise<IsolatedWorktreeRecord | null> {
    const record = this.store.getWorktree(worktreeId);
    if (!record || record.repositoryId !== repository.id) return null;
    if (record.status === "RELEASED") return record;
    if (!fs.existsSync(record.path)) {
      return this.store.updateWorktree(worktreeId, {
        status: "ORPHANED",
        releasedAt: new Date().toISOString(),
        lastError: "Worktree path is missing; branch provenance was retained.",
      });
    }
    let status = "";
    try {
      status = await this.git(
        repository,
        ["status", "--porcelain"],
        record.path,
      );
    } catch (error: any) {
      return this.store.updateWorktree(worktreeId, {
        status: "CLEANUP_REQUIRED",
        lastError: error?.message ?? String(error),
      });
    }
    if (status.trim()) {
      return this.store.updateWorktree(worktreeId, {
        status: "CLEANUP_REQUIRED",
        lastError:
          "Worktree has uncommitted files; automatic cleanup is refused.",
      });
    }
    try {
      await this.git(
        repository,
        ["worktree", "remove", this.gitPath(repository, record.path)],
        repository.localPath,
      );
    } catch (error: any) {
      return this.store.updateWorktree(worktreeId, {
        status: "CLEANUP_REQUIRED",
        lastError: error?.message ?? String(error),
      });
    }
    let branchError: string | null = null;
    try {
      // -d is deliberately non-forceful. An unmerged internal branch remains
      // available as provenance/recovery evidence.
      await this.git(
        repository,
        ["branch", "-d", record.branch],
        repository.localPath,
      );
    } catch (error: any) {
      branchError = `Internal branch retained: ${error?.message ?? String(error)}`;
    }
    return this.store.updateWorktree(worktreeId, {
      status: "RELEASED",
      releasedAt: new Date().toISOString(),
      lastError: branchError,
    });
  }

  async recover(
    repository: RepositoryRecord,
  ): Promise<IsolatedWorktreeRecord[]> {
    const records = this.store.listWorktrees(repository.id, [
      "ALLOCATED",
      "ACTIVE",
    ]);
    const recovered: IsolatedWorktreeRecord[] = [];
    for (const record of records) {
      if (!fs.existsSync(record.path)) {
        const next = this.store.updateWorktree(record.worktreeId, {
          status: "ORPHANED",
          lastError:
            "Worktree path is missing after restart; no cleanup was attempted.",
        });
        if (next) recovered.push(next);
        continue;
      }
      try {
        const status = await this.git(
          repository,
          ["status", "--porcelain"],
          record.path,
        );
        const next = this.store.updateWorktree(record.worktreeId, {
          status: status.trim() ? "CLEANUP_REQUIRED" : "STALE",
          lastError: status.trim()
            ? "Recovered worktree is dirty; user/worker files are preserved."
            : "Recovered after controller restart; explicit strategy reconciliation required.",
        });
        if (next) recovered.push(next);
      } catch (error: any) {
        const next = this.store.updateWorktree(record.worktreeId, {
          status: "ORPHANED",
          lastError: error?.message ?? String(error),
        });
        if (next) recovered.push(next);
      }
    }
    // Change 018 R4: packet worktrees are reconciled above, but DAG staging
    // checkouts have no persisted record (the swarm runner's stagings map is
    // memory-only), so restart-orphaned ones are swept here. Never throws.
    await this.sweepOrphanedStagings(repository);
    return recovered;
  }

  /**
   * Change 018 R4: sweep orphaned DAG staging checkouts under
   * `<dataDir>/staging/<repositoryId>/**`. Staging handles live only in the
   * swarm runner's memory, so a controller restart strands their checkout
   * directories forever. Every path below the repository's staging root is
   * Orca-owned, so each directory is detached with `git worktree remove
   * --force` (dropping Git's registration) and then deleted recursively.
   * The `orca/staging/*` BRANCHES are intentionally retained as provenance.
   * Best-effort by contract: never throws; per-directory failures are logged
   * and a directory that cannot be deleted is preserved (its ancestors are
   * skipped) for inspection.
   */
  private async sweepOrphanedStagings(
    repository: RepositoryRecord,
  ): Promise<void> {
    const stagingRoot = path.join(
      this.dataDir,
      "staging",
      this.safePart(repository.id),
    );
    const directories: string[] = [];
    const collect = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // No staging root (or unreadable level) for this repository.
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const child = path.join(dir, entry.name);
        directories.push(child);
        collect(child);
      }
    };
    collect(stagingRoot);
    if (directories.length === 0) return;

    const retained = new Set<string>();
    // Deepest-first so children are decided before their ancestors and a
    // preserved checkout is never destroyed by an ancestor cleanup.
    for (const dir of [...directories].reverse()) {
      if (
        [...retained].some((kept) => kept.startsWith(dir + path.sep))
      )
        continue;
      try {
        // Detach Git's worktree registration first; a directory that is not
        // a registered worktree simply fails here and is handled below.
        await this.git(
          repository,
          ["worktree", "remove", "--force", this.gitPath(repository, dir)],
          repository.localPath,
        );
      } catch {}
      if (!fs.existsSync(dir)) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error: any) {
        retained.add(dir);
        console.warn(
          `[worktree-isolation] staging sweep kept ${dir}: ${error?.message ?? String(error)}`,
        );
      }
    }
  }

  list(repositoryId: string): IsolatedWorktreeRecord[] {
    return this.store.listWorktrees(repositoryId);
  }

  /**
   * Change 018: lazily create (or reuse) the single staging checkout for a
   * strategy run at `<dataDir>/staging/<repositoryId>/<runId>/<strategyRunId>`
   * on internal branch `orca/staging/<strategyRunId>`, created at the immutable
   * strategy base. Reused across nodes; the worktree is removed at strategy
   * terminal while the branch is retained as provenance.
   */
  async ensureStaging(
    repository: RepositoryRecord,
    options: { strategyRunId: string; runId: string; baseSha: string },
  ): Promise<StrategyStagingHandle> {
    if (!/^[0-9a-f]{40}$/i.test(options.baseSha))
      throw new ValidationError(
        "Cannot create a strategy staging checkout without a valid base SHA.",
      );
    const safeRepository = this.safePart(repository.id);
    const safeRun = this.safePart(options.runId);
    const safeStrategy = this.safePart(options.strategyRunId);
    const worktreePath = path.join(
      this.dataDir,
      "staging",
      safeRepository,
      safeRun,
      safeStrategy,
    );
    this.assertWithinDataDir(worktreePath);
    const branch = `orca/staging/${safeStrategy}`;
    if (fs.existsSync(worktreePath)) {
      // Resume path: re-wrap the existing checkout. A stale or corrupted
      // leftover (e.g. a crash mid `worktree add`) is pruned and recreated.
      try {
        const headBranch = await this.git(
          repository,
          ["rev-parse", "--abbrev-ref", "HEAD"],
          worktreePath,
        );
        if (headBranch.trim() === branch) {
          return {
            strategyRunId: options.strategyRunId,
            path: worktreePath,
            branch,
            baseSha: options.baseSha,
          };
        }
      } catch {}
      try {
        await this.git(
          repository,
          ["worktree", "remove", "--force", this.gitPath(repository, worktreePath)],
          repository.localPath,
        );
      } catch {}
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {}
    }
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await this.git(
      repository,
      [
        "worktree",
        "add",
        "-b",
        branch,
        this.gitPath(repository, worktreePath),
        options.baseSha,
      ],
      repository.localPath,
    );
    return {
      strategyRunId: options.strategyRunId,
      path: worktreePath,
      branch,
      baseSha: options.baseSha,
    };
  }

  /**
   * Cherry-pick one accepted worker commit into the staging checkout. On
   * failure the pick is aborted cleanly so the staging branch stays exactly at
   * its last accepted state.
   *
   * A pick that stops because it would create an EMPTY commit ("The previous
   * cherry-pick is now empty") means the content is ALREADY present in the
   * lineage — nodes staged during the run were cherry-picked, so their
   * rewritten SHAs are ancestors while the ORIGINAL result SHAs are not. That
   * case is treated as already-applied success: `git cherry-pick --skip` ends
   * the sequence cleanly, leaving the worktree clean and HEAD unmoved. Only a
   * genuine conflict aborts and reports failure.
   */
  async cherryPickIntoStaging(
    repository: RepositoryRecord,
    staging: StrategyStagingHandle,
    commitSha: string,
  ): Promise<GitMutationResult> {
    try {
      await this.git(repository, ["cherry-pick", commitSha], staging.path);
      const head = await this.git(repository, ["rev-parse", "HEAD"], staging.path);
      return { ok: true, head };
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (isEmptyCherryPickError(message)) {
        try {
          await this.git(repository, ["cherry-pick", "--skip"], staging.path);
          const head = await this.git(
            repository,
            ["rev-parse", "HEAD"],
            staging.path,
          );
          return { ok: true, head, alreadyApplied: true };
        } catch {
          // Fall through to the abort below: the checkout must never be left
          // mid-cherry-pick while reporting success.
        }
      }
      try {
        await this.git(repository, ["cherry-pick", "--abort"], staging.path);
      } catch {}
      return { ok: false, error: message };
    }
  }

  /**
   * Cheap presence probe for lineage reconciliation: true when commitSha is
   * already an ancestor of the checkout's HEAD (`git merge-base --is-ancestor`
   * exits 0). A git failure also reads as "absent"; the caller's next mutation
   * then surfaces the real failure as a structured blocker instead of silently
   * treating the commit as present.
   */
  async isCommitAncestorOfHead(
    repository: RepositoryRecord,
    worktreePath: string,
    commitSha: string,
  ): Promise<boolean> {
    try {
      await this.git(
        repository,
        ["merge-base", "--is-ancestor", commitSha, "HEAD"],
        worktreePath,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Replay authorized dependency commits (original staged SHAs, completion
   * order) into a freshly allocated node worktree. Accepted dependency commits
   * are linear by construction, so a failure is surfaced as a structured
   * replay blocker instead of being silently ignored.
   */
  async replayCommits(
    repository: RepositoryRecord,
    worktreePath: string,
    commitShas: string[],
  ): Promise<string> {
    let head = "";
    for (const sha of commitShas) {
      try {
        await this.git(repository, ["cherry-pick", sha], worktreePath);
        head = await this.git(repository, ["rev-parse", "HEAD"], worktreePath);
      } catch (error: any) {
        try {
          await this.git(repository, ["cherry-pick", "--abort"], worktreePath);
        } catch {}
        throw new Error(
          `DEPENDENCY_REPLAY_FAILED: ${sha}: ${error?.message ?? String(error)}`,
        );
      }
    }
    return head;
  }

  /** Fast-forward persistent main to the staging lineage branch. */
  async mergeFastForwardIntoMain(
    repository: RepositoryRecord,
    branch: string,
  ): Promise<GitMutationResult> {
    try {
      await this.git(
        repository,
        ["merge", "--ff-only", branch],
        repository.localPath,
      );
      const head = await this.git(
        repository,
        ["rev-parse", "HEAD"],
        repository.localPath,
      );
      return { ok: true, head };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /**
   * Rebase the staging lineage onto persistent main when main advanced during
   * the run. Any conflict aborts the rebase so neither the staging branch nor
   * main is left in a partial state.
   */
  async rebaseStagingOntoMain(
    repository: RepositoryRecord,
    staging: StrategyStagingHandle,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.git(repository, ["rebase", "main"], staging.path);
      return { ok: true };
    } catch (error: any) {
      try {
        await this.git(repository, ["rebase", "--abort"], staging.path);
      } catch {}
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /**
   * Remove the staging worktree directory while RETAINING its branch as
   * provenance (mirrors release semantics). Best-effort: a dirty or locked
   * checkout is left in place for inspection.
   */
  async removeStagingWorktree(
    repository: RepositoryRecord,
    staging: StrategyStagingHandle,
  ): Promise<void> {
    if (!fs.existsSync(staging.path)) return;
    try {
      await this.git(
        repository,
        ["worktree", "remove", this.gitPath(repository, staging.path)],
        repository.localPath,
      );
    } catch {}
  }

  private async git(
    repository: RepositoryRecord,
    args: string[],
    cwd: string,
  ): Promise<string> {
    const commandArgs: string[] = [];
    let command = "git";
    let commandCwd: string | undefined = cwd;
    if (repository.environment === "wsl") {
      command = "wsl.exe";
      commandCwd = undefined;
      if (repository.wslDistribution)
        commandArgs.push("-d", repository.wslDistribution);
      commandArgs.push(
        "--cd",
        this.gitPath(repository, cwd),
        "--",
        "git",
        // Deep Orca-managed worktree paths on Windows push Git's internal
        // revision-range arguments past MAX_PATH ("failed to stat ... Filename
        // too long"); longpaths keeps rev/path disambiguation working.
        "-c",
        "core.longpaths=true",
        ...args,
      );
    } else {
      commandArgs.push(
        // See the WSL note above: same Windows MAX_PATH hazard.
        "-c",
        "core.longpaths=true",
        ...args,
      );
    }
    try {
      const result = await execFileAsync(command, commandArgs, {
        cwd: commandCwd,
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return result.stdout.toString().trim();
    } catch (error: any) {
      const stderr = error?.stderr?.toString().trim();
      throw new Error(
        `Git worktree error (${command} ${commandArgs.join(" ")}): ${stderr || error?.message || String(error)}`,
      );
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
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new ValidationError(
        "Worktree path escaped the Orca data directory.",
      );
  }
}
