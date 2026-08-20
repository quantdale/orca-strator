import type { ChildProcess } from "node:child_process";
import type { CapabilityReadiness, ProbeLevel } from "@orca/shared";

export interface ExecutionContext {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  wslDistribution?: string | null;
}

/** Optional adapter features are discovered at runtime; the loop never assumes a brand. */
export interface ExecutorAdapterCapabilities {
  environment: "windows" | "wsl";
  headless: CapabilityReadiness;
  cancellation: CapabilityReadiness;
  pause: CapabilityReadiness;
  resume: CapabilityReadiness;
  structuredEvents: CapabilityReadiness;
  permissionApi: CapabilityReadiness;
  usageTelemetry: CapabilityReadiness;
  sessionResume: CapabilityReadiness;
  sessionHistory: CapabilityReadiness;
}

export interface ExecutorProbeContext extends ExecutionContext {
  level: ProbeLevel;
}

export interface ExecutorAdapter {
  capabilities?(context?: Partial<ExecutionContext>): ExecutorAdapterCapabilities;
  probe?(context: ExecutorProbeContext): Promise<ExecutorAdapterCapabilities>;
  spawn(context: ExecutionContext): ChildProcess;
  killProcessTree(child: ChildProcess): Promise<void>;
  cancel?(child: ChildProcess, reason?: string): Promise<void>;
  pause?(child: ChildProcess): Promise<void>;
  resume?(context: ExecutionContext): ChildProcess;
  status?(child: ChildProcess): Promise<{ state: string; detail?: string }>;
  usage?(): Promise<Record<string, number | string | null>>;
}
