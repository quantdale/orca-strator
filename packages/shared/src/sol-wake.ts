import { z } from "zod";
import type { ExecutorResultStatus } from "./executor-result.js";

export type SolWakeStatus = "pending" | "submitted" | "failed" | "busy";

export interface SolWakeMessageParams {
  repositoryName: string;
  runId: string;
  iteration: number;
  dispatchId: string;
  resultStatus: ExecutorResultStatus;
}

export function generateSolWakeMessage(params: SolWakeMessageParams): string {
  return [
    `Orca-Strator executor turn completed for ${params.repositoryName}.`,
    `Run: ${params.runId}`,
    `Iteration: ${params.iteration}`,
    `Dispatch: ${params.dispatchId}`,
    `Result status: ${params.resultStatus}`,
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
  dispatchId: string;
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
    resultStatus: z.enum(["COMPLETED", "BLOCKED", "NEEDS_HUMAN", "FAILED"])
  })
  .strict();
