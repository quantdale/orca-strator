import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { ExecutorAdapter, ExecutionContext } from "../../src/executor/adapters/executor-adapter.js";

export interface FakeExecutorBehavior {
  durationMs?: number;
  exitCode?: number;
  logLines?: string[];
  onStart?: (context: ExecutionContext) => void;
}

export class FakeChildProcess extends EventEmitter {
  pid: number = Math.floor(Math.random() * 50000) + 1000;
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly behavior: FakeExecutorBehavior = {}) {
    super();
  }

  run(): void {
    const lines = this.behavior.logLines || ["Running fake executor turn...", "Completed task."];
    for (const line of lines) {
      this.stdout.write(`${line}\n`);
    }

    const duration = this.behavior.durationMs ?? 100;
    this.timer = setTimeout(() => {
      this.exitCode = this.behavior.exitCode !== undefined ? this.behavior.exitCode : 0;
      this.emit("exit", this.exitCode);
    }, duration);
  }

  kill(): boolean {
    this.killed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.exitCode = 130;
    this.emit("exit", this.exitCode);
    return true;
  }
}

export class FakeExecutorAdapter implements ExecutorAdapter {
  public lastSpawned: FakeChildProcess | null = null;
  public lastContext: ExecutionContext | null = null;

  constructor(private readonly behavior: FakeExecutorBehavior = {}) {}

  spawn(context: ExecutionContext): ChildProcess {
    this.lastContext = context;
    if (this.behavior.onStart) {
      this.behavior.onStart(context);
    }
    const proc = new FakeChildProcess(this.behavior);
    this.lastSpawned = proc;
    setImmediate(() => proc.run());
    return proc as unknown as ChildProcess;
  }

  async killProcessTree(child: ChildProcess): Promise<void> {
    if (child && typeof (child as any).kill === "function") {
      (child as any).kill();
    }
  }
}
