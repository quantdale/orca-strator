import type { ChildProcess } from "node:child_process";

export interface ExecutionContext {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  wslDistribution?: string | null;
}

export interface ExecutorAdapter {
  spawn(context: ExecutionContext): ChildProcess;
  killProcessTree(child: ChildProcess): Promise<void>;
}
