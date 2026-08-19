import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitEnvironment = "windows" | "wsl";

/**
 * Describes where and how Git operations run for a repository.
 *
 * - windows: `git` executes directly with `workingPath` as cwd.
 * - wsl: operations route through `wsl.exe -d <distribution> --cd <linuxPath> -- git ...`
 *   so the Linux working tree is used. `workingPath` is retained for FS operations
 *   that live on the Windows side (logs), but Git MUST NOT run against a Windows cwd
 *   for a WSL repository.
 */
export interface GitContext {
  environment: GitEnvironment;
  workingPath: string;
  linuxPath?: string;
  wslDistribution?: string | null;
}

export function normalizeGitTarget(target: GitContext | string): GitContext {
  return typeof target === "string"
    ? { environment: "windows", workingPath: target }
    : target;
}

export interface FileChange {
  status: "A" | "M" | "D" | "R" | string;
  path: string;
}

export class GitClient {
  constructor(private readonly timeoutMs: number = 30000) {}

  private async runProc(
    command: string,
    args: string[],
    cwd?: string
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync(command, args, {
        cwd,
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });
      return stdout.trim();
    } catch (err: any) {
      const stderr = err.stderr ? err.stderr.toString().trim() : "";
      const message = stderr || err.message;
      throw new Error(`Git error (${command} ${args.join(" ")}): ${message}`);
    }
  }

  private async runGit(args: string[], target?: GitContext | string): Promise<string> {
    const ctx = target ? normalizeGitTarget(target) : null;

    if (ctx && ctx.environment === "wsl") {
      const wslArgs: string[] = [];
      if (ctx.wslDistribution) {
        wslArgs.push("-d", ctx.wslDistribution);
      }
      if (ctx.linuxPath) {
        wslArgs.push("--cd", ctx.linuxPath);
      }
      wslArgs.push("--", "git", ...args);
      return this.runProc("wsl.exe", wslArgs, undefined);
    }

    return this.runProc("git", args, ctx ? ctx.workingPath : undefined);
  }

  async getRemoteHeadSha(remoteUrl: string, branch: string = "main"): Promise<string | null> {
    try {
      const output = await this.runProc("git", [
        "ls-remote",
        remoteUrl,
        `refs/heads/${branch}`
      ]);
      if (!output) return null;
      const match = output.match(/^([0-9a-fA-F]{40})\s+/);
      return match && match[1] ? match[1].toLowerCase() : null;
    } catch (err: any) {
      throw new Error(`Failed to query remote HEAD for ${remoteUrl} (${branch}): ${err.message}`);
    }
  }

  async fetch(
    target: GitContext | string,
    remote: string = "origin",
    branch: string = "main"
  ): Promise<void> {
    await this.runGit(["fetch", remote, branch], target);
  }

  async getCommitChanges(
    target: GitContext | string,
    commitSha: string
  ): Promise<FileChange[]> {
    const output = await this.runGit(
      ["diff-tree", "--no-commit-id", "--name-status", "-r", "-m", "--root", commitSha],
      target
    );

    if (!output) return [];

    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    const changes: FileChange[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[0]) {
        changes.push({
          status: parts[0],
          path: parts.slice(1).join(" ")
        });
      }
    }
    return changes;
  }

  async getFileContentAtCommit(
    target: GitContext | string,
    commitSha: string,
    filePath: string
  ): Promise<string> {
    return await this.runGit(["show", `${commitSha}:${filePath}`], target);
  }

  async getRevList(
    target: GitContext | string,
    fromSha: string,
    toSha: string
  ): Promise<string[]> {
    // `fromSha..toSha` excludes fromSha; the caller is responsible for choosing a
    // safe starting point. Returns commits in reverse (chronological) order.
    const output = await this.runGit(
      ["rev-list", "--reverse", `${fromSha}..${toSha}`],
      target
    );
    if (!output) return [];
    return output.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  /** List all commit SHAs reachable from `toSha` not in `fromSha`, chronological. */
  async getRevListRange(
    target: GitContext | string,
    fromSha: string,
    toSha: string
  ): Promise<string[]> {
    return this.getRevList(target, fromSha, toSha);
  }

  async getCurrentSha(target: GitContext | string): Promise<string | null> {
    try {
      const output = await this.runGit(["rev-parse", "HEAD"], target);
      return output.toLowerCase();
    } catch {
      return null;
    }
  }

  /**
   * True when `maybeAncestor` is an ancestor of (or equal to) `descendant`.
   *
   * Finding E: a real executor commits its work and then commits the result
   * manifest on top, so the manifest's `resultSha` (the work commit) is an
   * ANCESTOR of final HEAD rather than equal to it. Postflight verification
   * therefore must accept ancestor containment, not exact equality.
   */
  async isAncestor(
    maybeAncestor: string,
    descendant: string,
    target?: GitContext | string
  ): Promise<boolean> {
    try {
      await this.runGit(
        ["merge-base", "--is-ancestor", maybeAncestor, descendant],
        target
      );
      return true;
    } catch {
      // Exit code 1 => not an ancestor. Any other failure is treated conservatively
      // as "cannot prove ancestry", which the caller must treat as a verification
      // failure rather than a success.
      return false;
    }
  }

  async getWorkingTreeStatus(target: GitContext | string): Promise<string> {
    return this.runGit(["status", "--porcelain"], target);
  }

  async hasUncommittedChanges(target: GitContext | string): Promise<boolean> {
    const status = await this.getWorkingTreeStatus(target);
    return status.trim().length > 0;
  }

  /** Read a file from the working tree (used for executor result manifest inspection). */
  async readWorkingTreeFile(
    target: GitContext | string,
    filePath: string
  ): Promise<string> {
    const ctx = normalizeGitTarget(target);
    if (ctx.environment === "wsl") {
      const wslArgs: string[] = [];
      if (ctx.wslDistribution) wslArgs.push("-d", ctx.wslDistribution);
      if (ctx.linuxPath) wslArgs.push("--cd", ctx.linuxPath);
      wslArgs.push("--", "cat", filePath);
      return this.runProc("wsl.exe", wslArgs, undefined);
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.join(ctx.workingPath, filePath), "utf8");
  }
}

export const defaultGitClient = new GitClient();
