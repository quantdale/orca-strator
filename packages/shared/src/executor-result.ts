import { z } from "zod";
import { ValidationError, type FieldError } from "./errors.js";

export type ExecutorResultStatus = "COMPLETED" | "BLOCKED" | "NEEDS_HUMAN" | "FAILED";
export type VerificationStatus = "PASS" | "FAIL" | "NOT_RUN";

export interface VerificationItem {
  name: string;
  status: VerificationStatus;
  summary: string;
}

export interface BlockerItem {
  code: string;
  summary: string;
  evidence?: string | null;
}

export interface ExecutorInfo {
  cli: string;
  model: string;
  environment: "windows" | "wsl";
}

export interface ExecutorResult {
  schemaVersion: 1;
  type: "executor-result";
  runId: string;
  dispatchId: string;
  iteration: number;
  status: ExecutorResultStatus;
  startedAt: string;
  finishedAt: string;
  baseSha: string;
  resultSha: string;
  executor: ExecutorInfo;
  verification: VerificationItem[];
  blockers: BlockerItem[];
  summary: string;
}

export type ExecutorRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "paused"
  | "failed"
  | "killed"
  | "timed_out";

export interface ExecutorRunRecord {
  id: string;
  repositoryId: string;
  dispatchId: string;
  runId: string;
  iteration: number;
  status: ExecutorRunStatus;
  exitCode: number | null;
  logPath: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutorStatusResponse {
  repositoryId: string;
  isRunning: boolean;
  activeRun: ExecutorRunRecord | null;
  recentLogs: string[];
}

export const verificationItemSchema = z
  .object({
    name: z.string().trim().min(1, "verification name is required").max(300),
    status: z.enum(["PASS", "FAIL", "NOT_RUN"], {
      errorMap: () => ({ message: "status must be PASS, FAIL, or NOT_RUN" })
    }),
    summary: z.string().trim().min(1, "verification summary is required").max(2000)
  })
  .strict();

export const blockerItemSchema = z
  .object({
    code: z.string().trim().min(1, "blocker code is required").max(200),
    summary: z.string().trim().min(1, "blocker summary is required").max(2000),
    evidence: z.string().max(4000).nullable().optional()
  })
  .strict();

export const executorInfoSchema = z
  .object({
    cli: z.string().trim().min(1, "executor.cli is required").max(200),
    model: z.string().trim().min(1, "executor.model is required").max(300),
    environment: z.enum(["windows", "wsl"], {
      errorMap: () => ({ message: "executor.environment must be 'windows' or 'wsl'" })
    })
  })
  .strict();

export const executorResultSchema = z
  .object({
    schemaVersion: z.literal(1, {
      errorMap: () => ({ message: "schemaVersion must be 1" })
    }),
    type: z.literal("executor-result", {
      errorMap: () => ({ message: "type must be 'executor-result'" })
    }),
    runId: z.string().trim().min(1, "runId is required").max(200),
    dispatchId: z.string().trim().min(1, "dispatchId is required").max(200),
    iteration: z.number().int("iteration must be an integer").min(1, "iteration must be >= 1"),
    status: z.enum(["COMPLETED", "BLOCKED", "NEEDS_HUMAN", "FAILED"], {
      errorMap: () => ({ message: "status must be COMPLETED, BLOCKED, NEEDS_HUMAN, or FAILED" })
    }),
    startedAt: z.string().datetime({ message: "startedAt must be an ISO 8601 date-time string" }),
    finishedAt: z.string().datetime({ message: "finishedAt must be an ISO 8601 date-time string" }),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/i, "baseSha must be a 40-character hex SHA"),
    resultSha: z.string().regex(/^[0-9a-f]{40}$/i, "resultSha must be a 40-character hex SHA"),
    executor: executorInfoSchema,
    verification: z.array(verificationItemSchema),
    blockers: z.array(blockerItemSchema),
    summary: z.string().trim().min(1, "summary is required").max(4000)
  })
  .strict("Unknown properties are not allowed in executor result");

export function validateExecutorResult(input: unknown): ExecutorResult {
  const result = executorResultSchema.safeParse(input);
  if (!result.success) {
    const details: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }));
    throw new ValidationError("Executor result is invalid.", details);
  }
  return result.data as ExecutorResult;
}

export function isResultFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  return /^.orca\/results\/[a-zA-Z0-9_-]+\.json$/.test(normalized);
}

export function extractResultDispatchId(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  const match = normalized.match(/^.orca\/results\/([a-zA-Z0-9_-]+)\.json$/);
  return match && match[1] ? match[1] : null;
}
