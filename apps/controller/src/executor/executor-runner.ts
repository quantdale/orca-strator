import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ChildProcess } from "node:child_process";
import type { ExecutorAdapter, ExecutionContext } from "./adapters/executor-adapter.js";

export interface RunnerOptions {
  adapter: ExecutorAdapter;
  context: ExecutionContext;
  logPath: string;
  timeoutMs: number;
  onLog: (line: string) => void;
  onExit: (
    exitCode: number | null,
    details: { timedOut: boolean; wasKilled: boolean; wasPaused: boolean }
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

  constructor(private readonly options: RunnerOptions) {}

  start(): void {
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

    // Setup timeout enforcement
    if (this.options.timeoutMs > 0) {
      this.timer = setTimeout(() => {
        this.isTimedOut = true;
        this.handleLogLine("[system] Execution timed out. Terminating process tree...");
        this.kill();
      }, this.options.timeoutMs);
    }

    // Setup exit handling
    this.child.on("exit", (code) => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.logStream) {
        this.logStream.end();
        this.logStream = null;
      }
      this.options.onExit(code, {
        timedOut: this.isTimedOut,
        wasKilled: this.isKilled && !this.isPaused,
        wasPaused: this.isPaused
      });
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
      await this.options.adapter.killProcessTree(this.child);
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

  isRunning(): boolean {
    return this.child !== null && !this.isKilled && !this.isPaused && this.child.exitCode === null;
  }
}
