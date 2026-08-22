import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { execFile } from "node:child_process";

/**
 * Change 023: external setup-browser launcher.
 *
 * Spawns the ORDINARY installed Chrome binary directly as a child process for
 * human-controlled ChatGPT authentication. No Playwright / remote automation
 * is attached, and the argument list is pinned to EXACTLY:
 *
 *   chrome.exe --user-data-dir=<orca dedicated profile> <login URL>
 *
 * Forbidden forever (Change 023): anti-detection switches, user-agent
 * overrides, `--no-sandbox`, remote-debugging ports — none can appear here
 * because the argument list is constructed from exactly two inputs and pinned
 * by test snapshot.
 */

export const SETUP_LOGIN_URL = "https://chatgpt.com/auth/login";

export interface ExternalSpawnResult {
  pid: number;
  /** Resolves when the spawned Chrome process exits (code may be null on signal). */
  exit: Promise<{ code: number | null }>;
}

/** Captured spawn invocation (for pinning the exact permitted arguments). */
export interface CapturedSpawnInvocation {
  executablePath: string;
  args: string[];
  options: SpawnOptions;
}

/** Seam interface so tests can substitute a deterministic fake launcher. */
export interface ExternalSetupLauncherLike {
  spawn(
    executablePath: string,
    profileDir: string,
    loginUrl: string,
  ): ExternalSpawnResult;
  close(): Promise<void>;
  isRunning(): boolean;
}

/** Seam so tests can substitute a deterministic fake child process. */
export type SpawnFunction = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** Kills the whole process tree for the given pid. */
export type KillTreeFunction = (pid: number) => Promise<void>;

async function defaultKillTree(pid: number): Promise<void> {
  if (process.platform !== "win32") return; // POSIX falls back to child.kill below
  await new Promise<void>((resolve) => {
    execFile(
      "taskkill",
      ["/PID", String(pid), "/T", "/F"],
      { timeout: 10000 },
      () => resolve(),
    );
  });
}

export class ExternalSetupBrowserLauncher implements ExternalSetupLauncherLike {
  private child: ChildProcess | null = null;

  constructor(
    private readonly spawnFn: SpawnFunction = spawn,
    private readonly killTreeFn: KillTreeFunction = defaultKillTree,
  ) {}

  spawn(
    executablePath: string,
    profileDir: string,
    loginUrl: string,
  ): ExternalSpawnResult {
    if (this.child) {
      throw new Error("External setup Chrome is already running");
    }

    // Exactly two permitted arguments — pinned by test snapshot.
    const args = [`--user-data-dir=${profileDir}`, loginUrl];
    const child = this.spawnFn(executablePath, args, {
      detached: false,
      stdio: "ignore",
      windowsHide: false,
    });
    this.child = child;

    const pid = child.pid;
    if (pid === undefined) {
      this.child = null;
      throw new Error(
        `Failed to spawn external setup Chrome (${executablePath})`,
      );
    }

    const exit = new Promise<{ code: number | null }>((resolve) => {
      child.once("exit", (code) => {
        if (this.child === child) this.child = null;
        resolve({ code });
      });
      child.once("error", () => {
        if (this.child === child) this.child = null;
        resolve({ code: null });
      });
    });

    return { pid, exit };
  }

  /**
   * Kill the external setup Chrome process tree. Windows uses
   * `taskkill /PID <pid> /T /F`; POSIX sends SIGTERM to the child.
   */
  async close(): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined) return;

    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });

    try {
      await this.killTreeFn(child.pid);
    } catch {
      // already gone / kill tool unavailable — bounded wait below still applies
    }
    if (process.platform !== "win32") {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }

    // Bounded wait so ownership release happens deterministically after exit.
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5000))]);
    if (this.child === child) this.child = null;
  }

  isRunning(): boolean {
    return (
      this.child !== null &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }
}
