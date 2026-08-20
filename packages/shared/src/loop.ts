import { z } from "zod";

export type LoopState =
  | "IDLE"
  | "SOL_PENDING"
  | "SOL_REVIEWING"
  | "EXECUTOR_PENDING"
  | "EXECUTING"
  | "GOAL_COMPLETE"
  | "BLOCKED"
  | "NEEDS_HUMAN"
  | "PAUSED"
  | "STOPPED"
  | "DRAINING"
  | "CEILING_REACHED"
  | "SOL_STALLED"
  | "ATTENTION_REQUIRED"
  | "EXECUTOR_UNAVAILABLE"
  | "RECOVERY_REQUIRED";

export type DrainReason = 'USER_STOP' | 'WALL_CLOCK_CEILING' | 'ITERATION_CEILING' | null;

export interface RunRecord {
  id: string;
  repositoryId: string;
  goal: string;
  status: LoopState;
  currentIteration: number;
  maxIterations: number;
  activeDispatchId: string | null;
  lastError: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  drainReason: DrainReason;
}

export interface StartRunParams {
  goal: string;
  maxIterations?: number;
}

export const startRunParamsSchema = z
  .object({
    goal: z.string().trim().min(1, "goal is required").max(4000),
    maxIterations: z.number().int().min(1).max(1000).optional()
  })
  .strict();

export interface LoopStatusResponse {
  repositoryId: string;
  state: LoopState;
  activeRun: RunRecord | null;
  currentIteration: number;
  maxIterations: number;
  activeActor: "SOL" | "EXECUTOR" | "NONE";
}

export function isTerminalLoopState(state: LoopState): boolean {
  return (
    state === "GOAL_COMPLETE" ||
    state === "BLOCKED" ||
    state === "NEEDS_HUMAN" ||
    state === "STOPPED" ||
    state === "CEILING_REACHED" ||
    state === "SOL_STALLED" ||
    state === "ATTENTION_REQUIRED" ||
    state === "EXECUTOR_UNAVAILABLE" ||
    state === "RECOVERY_REQUIRED"
  );
}

export function getActiveActor(state: LoopState): "SOL" | "EXECUTOR" | "NONE" {
  if (state === "SOL_PENDING" || state === "SOL_REVIEWING") return "SOL";
  if (state === "EXECUTOR_PENDING" || state === "EXECUTING") return "EXECUTOR";
  return "NONE";
}

export function shouldNotifyLoopState(state: LoopState): boolean {
  return (
    state === "GOAL_COMPLETE" ||
    state === "NEEDS_HUMAN" ||
    state === "BLOCKED" ||
    state === "SOL_STALLED" ||
    state === "ATTENTION_REQUIRED" ||
    state === "EXECUTOR_UNAVAILABLE" ||
    state === "RECOVERY_REQUIRED" ||
    state === "CEILING_REACHED" ||
    state === "STOPPED"
  );
}

export interface TailscaleGuidance {
  loopbackPort: number;
  loopbackUrl: string;
  command: string;
  /**
   * Honest Tailscale status (Finding P). Orca must NOT report "configured" merely
   * because it knows a command string. The controller stays loopback-only and never
   * enables Funnel/public exposure.
   */
  status:
    | "not_installed"
    | "not_running"
    | "not_authenticated"
    | "serve_not_configured"
    | "configured"
    | "unknown";
  /** Human-readable detail about why the status is what it is. */
  details?: string;
  instructions: string[];
}
