import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FileChange {
  status: "A" | "M" | "D" | "R" | string;
  path: string;
}

export class GitClient {
  constructor(private readonly timeoutMs: number = 30000) {}

  private async runGit(args: string[], cwd?: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        timeout: this.timeoutMs,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });
      return stdout.trim();
    } catch (err: any) {
      const stderr = err.stderr ? err.stderr.toString().trim() : "";
      const message = stderr || err.message;
      throw new Error(`Git error (git ${args.join(" ")}): ${message}`);
    }
  }

  async getRemoteHeadSha(remoteUrl: string, branch: string = "main"): Promise<string | null> {
    try {
      const output = await this.runGit(["ls-remote", remoteUrl, `refs/heads/${branch}`]);
      if (!output) return null;
      const match = output.match(/^([0-9a-fA-F]{40})\s+/);
      return match && match[1] ? match[1].toLowerCase() : null;
    } catch (err: any) {
      throw new Error(`Failed to query remote HEAD for ${remoteUrl} (${branch}): ${err.message}`);
    }
  }

  async fetch(repoPath: string, remote: string = "origin", branch: string = "main"): Promise<void> {
    await this.runGit(["fetch", remote, branch], repoPath);
  }

  async getCommitChanges(repoPath: string, commitSha: string): Promise<FileChange[]> {
    const output = await this.runGit(
      ["diff-tree", "--no-commit-id", "--name-status", "-r", "-m", "--root", commitSha],
      repoPath
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
    repoPath: string,
    commitSha: string,
    filePath: string
  ): Promise<string> {
    return await this.runGit(["show", `${commitSha}:${filePath}`], repoPath);
  }

  async getRevList(repoPath: string, fromSha: string, toSha: string): Promise<string[]> {
    const output = await this.runGit(["rev-list", "--reverse", `${fromSha}..${toSha}`], repoPath);
    if (!output) return [];
    return output.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  }
}

export const defaultGitClient = new GitClient();
