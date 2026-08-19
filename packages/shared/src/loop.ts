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
  | "SOL_STALLED"
  | "EXECUTOR_UNAVAILABLE"
  | "RECOVERY_REQUIRED";

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
    state === "SOL_STALLED" ||
    state === "EXECUTOR_UNAVAILABLE"
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
    state === "EXECUTOR_UNAVAILABLE" ||
    state === "RECOVERY_REQUIRED" ||
    state === "STOPPED"
  );
}

export interface TailscaleGuidance {
  loopbackPort: number;
  loopbackUrl: string;
  command: string;
  status: "configured" | "unconfigured";
  instructions: string[];
}
