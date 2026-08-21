import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { ExecutorAdapter, ExecutionContext } from "./adapters/executor-adapter.js";

export type ExecutorExitReason =
  | "NORMAL_EXIT"
  | "PAUSED"
  | "EMERGENCY_KILLED"
  | "WATCHDOG_TIMEOUT"
  | "SPAWN_FAILURE";

export interface RunnerOptions {
  adapter: ExecutorAdapter;
  context: ExecutionContext;
  logPath: string;
  /** @deprecated use watchdogMs */
  timeoutMs?: number;
  /** Separate executor watchdog; 0/disabled by default (V1). Wall-clock ceiling does NOT kill executor. */
  watchdogMs?: number;
  onLog: (line: string) => void;
  onExit: (
    exitCode: number | null,
    details: {
      reason: ExecutorExitReason;
      timedOut: boolean;
      wasKilled: boolean;
      wasPaused: boolean;
    }
  ) => void;
}

export class ExecutorRunner {
  private child: ChildProcess | null = null;
  private logStream: fs.WriteStream | null = null;
  private timer: NodeJS.Timeout | null = null;
  private isKilled = false;
  private isPaused = false;
  private isTimedOut = false;
  private recentLogs: string[] = [];
  private readonly maxBufferedLogs = 200;
  private completionFired = false;

  constructor(private readonly options: RunnerOptions) {}

  private get watchdogMs(): number {
    if (this.options.watchdogMs !== undefined) return this.options.watchdogMs;
    if (this.options.timeoutMs !== undefined) return this.options.timeoutMs;
    return 0;
  }

  async start(): Promise<void> {
    // Ensure log directory exists
    const dir = path.dirname(this.options.logPath);
    fs.mkdirSync(dir, { recursive: true });

    this.logStream = fs.createWriteStream(this.options.logPath, { flags: "a" });
    this.logStream.on("error", () => {
      // Ignore file stream errors on process cleanup / temp dir deletion
    });
    this.child = this.options.adapter.spawn(this.options.context);

    // Setup stdout / stderr streaming
    if (this.child.stdout) {
      const rlOut = readline.createInterface({ input: this.child.stdout });
      rlOut.on("line", (line) => this.handleLogLine(`[stdout] ${line}`));
    }

    if (this.child.stderr) {
      const rlErr = readline.createInterface({ input: this.child.stderr });
      rlErr.on("line", (line) => this.handleLogLine(`[stderr] ${line}`));
    }

    // Handshake: resolve only after successful spawn, reject on async spawn error (ENOENT etc.)
    // This enables genuine launch retries (item #8) – a failure to launch vs a failure after launch.
    await this.awaitSpawn();

    // Setup watchdog enforcement (separate from wall-clock ceiling; disabled by default)
    if (this.watchdogMs > 0) {
      this.timer = setTimeout(() => {
        this.isTimedOut = true;
        this.handleLogLine("[system] Executor watchdog timeout. Terminating process tree...");
        this.kill();
      }, this.watchdogMs);
      // Consistent with other controller timers: a disarmed-but-pending watchdog
      // must never keep the event loop (and process exit) alive.
      if ((this.timer as any).unref) (this.timer as any).unref();
    }

    this.setupExitHandling();
  }

  private awaitSpawn(): Promise<void> {
    const child = this.child!;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        child.off("error", onError);
        child.off("spawn", onSpawn);
      };
      const onSpawn = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.handleLogLine(`[system] Executor spawn error: ${err?.message || String(err)}`);
        // Clean up log resources after failed launch attempt (#14)
        if (this.logStream) { try { this.logStream.end(); } catch {} this.logStream = null; }
        reject(err);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
      // No fallback timer: real ChildProcess always emits spawn or error
    });
  }

  private setupExitHandling(): void {
    if (!this.child) return;
    const child = this.child;
    // Guard against double firing from error+exit+close combos; fire exactly once.
    const fire = (code: number | null, reason: ExecutorExitReason) => {
      if (this.completionFired) return;
      this.completionFired = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }
      this.options.onExit(code, {
        reason,
        timedOut: this.isTimedOut,
        wasKilled: this.isKilled && !this.isPaused,
        wasPaused: this.isPaused
      });
    };

    child.on("exit", (code) => {
      let reason: ExecutorExitReason = "NORMAL_EXIT";
      if (this.isPaused) reason = "PAUSED";
      else if (this.isTimedOut) reason = "WATCHDOG_TIMEOUT";
      else if (this.isKilled) reason = "EMERGENCY_KILLED";
      fire(code, reason);
    });

    child.on("error", (err) => {
      this.handleLogLine(`[system] Executor process error: ${err?.message || String(err)}`);
      // Post-spawn error is a transport failure; surface as spawn failure if never spawned successfully.
      let reason: ExecutorExitReason = "SPAWN_FAILURE";
      if (this.isPaused) reason = "PAUSED";
      else if (this.isTimedOut) reason = "WATCHDOG_TIMEOUT";
      else if (this.isKilled) reason = "EMERGENCY_KILLED";
      fire(null, reason);
    });
  }

  private handleLogLine(line: string): void {
    const timestamped = `[${new Date().toISOString()}] ${line}`;
    this.recentLogs.push(timestamped);
    if (this.recentLogs.length > this.maxBufferedLogs) {
      this.recentLogs.shift();
    }

    if (this.logStream && this.logStream.writable) {
      this.logStream.write(`${timestamped}\n`);
    }

    this.options.onLog(timestamped);
  }

  async kill(): Promise<void> {
    this.isKilled = true;
    if (this.child) {
      if (this.options.adapter.cancel) {
        await this.options.adapter.cancel(this.child, "emergency-kill-or-watchdog");
      } else {
        await this.options.adapter.killProcessTree(this.child);
      }
    }
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    this.handleLogLine("[system] Execution paused by user. Terminating process tree...");
    await this.kill();
  }

  getLogs(): string[] {
    return [...this.recentLogs];
  }

  /** True once emergency-kill was requested; an in-flight launch must abort instead of re-spawning. */
  killRequested(): boolean {
    return this.isKilled;
  }

  isRunning(): boolean {
    return this.child !== null && !this.isKilled && !this.isPaused && this.child.exitCode === null;
  }
}
