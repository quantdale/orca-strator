import { z } from "zod";
import type { ExecutorResultStatus } from "./executor-result.js";

export type SolWakeStatus = "pending" | "submitted" | "failed" | "busy";

/**
 * "INITIAL" is used for the first Sol wake of a run, when no executor result
 * exists yet. It MUST NOT be reported as "COMPLETED" — doing so would falsely
 * assert a successful executor turn that never happened.
 */
export type SolWakeResultStatus = ExecutorResultStatus | "INITIAL";

export interface SolWakeMessageParams {
  repositoryName: string;
  runId: string;
  iteration: number;
  dispatchId: string;
  resultStatus: SolWakeResultStatus;
}

export function generateSolWakeMessage(params: SolWakeMessageParams): string {
  const resultLine =
    params.resultStatus === "INITIAL"
      ? "Result status: (initial wake — no prior executor result)"
      : `Result status: ${params.resultStatus}`;
  return [
    `Orca-Strator${params.resultStatus === "INITIAL" ? " initial autonomy wake" : " executor turn completed"} for ${params.repositoryName}.`,
    `Run: ${params.runId}`,
    `Iteration: ${params.iteration}`,
    `Dispatch: ${params.dispatchId}`,
    resultLine,
    ``,
    `Review the latest GitHub main state, the active OpenSpec change, and .orca/results/${params.dispatchId}.json.`,
    `Make any review/spec/code corrections that are useful.`,
    `Then either:`,
    `1. create and push the next focused OpenSpec work and finally an isolated new dispatch marker, or`,
    `2. publish a durable terminal/control decision.`,
    `Follow the repository's agent/Orca protocol.`
  ].join("\n");
}

export interface SolWakeRecord {
  id: string;
  repositoryId: string;
  runId: string;
  dispatchId: string | null;
  conversationUrl: string;
  message: string;
  status: SolWakeStatus;
  errorMessage: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserStatus {
  isRunning: boolean;
  isSetupOpen: boolean;
  activePages: number;
  profilePath: string;
  lockHolderPid: number | null;
}

export const solWakeMessageParamsSchema = z
  .object({
    repositoryName: z.string().trim().min(1, "repositoryName is required"),
    runId: z.string().trim().min(1, "runId is required"),
    iteration: z.number().int().min(1, "iteration must be >= 1"),
    dispatchId: z.string().trim().min(1, "dispatchId is required"),
    resultStatus: z.enum(["COMPLETED", "BLOCKED", "NEEDS_HUMAN", "FAILED", "INITIAL"])
  })
  .strict();
