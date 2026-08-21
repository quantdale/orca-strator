import { z } from "zod";
import { ValidationError, type FieldError } from "./errors.js";
import {
  executionStrategySchema,
  type DispatchExecutionPlan,
  type ExecutionStrategy
} from "./execution-strategy.js";

export interface DispatchMarker {
  schemaVersion: 1;
  type: "dispatch";
  runId: string;
  dispatchId: string;
  iteration: number;
  createdAt: string;
  baseSha: string;
  changePath: string;
  goal: string;
  instructionsVersion: number;
  /**
   * Explicit, durable execution-strategy selection. Absent on legacy V1
   * dispatches, which resolve to SINGLE_AGENT. Never an opaque heuristic.
   */
  strategy?: ExecutionStrategy;
  /**
   * For SWARM/DAG dispatches, the durable packet/DAG definition the strategy
   * must run. Absent for SINGLE_AGENT.
   */
  executionPlan?: DispatchExecutionPlan;
}

export type DispatchStatus = "detected" | "consumed" | "rejected";

export interface DispatchRecord extends DispatchMarker {
  id: string;
  repositoryId: string;
  commitSha: string;
  status: DispatchStatus;
  rejectionReason: string | null;
  updatedAt: string;
}

export interface WatcherState {
  repositoryId: string;
  lastObservedSha: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface WatcherStatusResponse {
  repositoryId: string;
  isWatching: boolean;
  lastObservedSha: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  activeDispatchId: string | null;
}

// Validates that path does not have leading slash and does not contain .. segments
export function isSafeRelativePath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  const segments = path.replace(/\\/g, "/").split("/");
  return !segments.some((seg) => seg === "..");
}

export const dispatchMarkerSchema = z
  .object({
    schemaVersion: z.literal(1, {
      errorMap: () => ({ message: "schemaVersion must be 1" })
    }),
    type: z.literal("dispatch", {
      errorMap: () => ({ message: "type must be 'dispatch'" })
    }),
    runId: z.string().trim().min(1, "runId is required").max(200, "runId cannot exceed 200 characters"),
    dispatchId: z.string().trim().min(1, "dispatchId is required").max(200, "dispatchId cannot exceed 200 characters"),
    iteration: z.number().int("iteration must be an integer").min(1, "iteration must be >= 1"),
    createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 date-time string" }),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/i, "baseSha must be a 40-character hex SHA"),
    changePath: z
      .string()
      .trim()
      .min(1, "changePath is required")
      .max(500, "changePath cannot exceed 500 characters")
      .refine(isSafeRelativePath, {
        message: "changePath must be a safe repository-relative path and cannot escape repository root"
      }),
    goal: z.string().trim().min(1, "goal is required").max(1000, "goal cannot exceed 1000 characters"),
    instructionsVersion: z.number().int("instructionsVersion must be an integer").min(1, "instructionsVersion must be >= 1"),
    strategy: executionStrategySchema.optional(),
    executionPlan: z
      .object({
        packetIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
        dagNodes: z.array(z.object({
          nodeId: z.string().trim().min(1).max(200),
          packetId: z.string().trim().min(1).max(200),
          dependsOn: z.array(z.string().trim().min(1).max(200)).max(100)
        })).min(1).max(100).optional(),
        maxConcurrency: z.number().int().min(1).max(32).optional()
      })
      .strict()
      .optional()
  })
  .strict("Unknown properties are not allowed in dispatch marker");

export function validateDispatchMarker(input: unknown): DispatchMarker {
  const result = dispatchMarkerSchema.safeParse(input);
  if (!result.success) {
    const details: FieldError[] = result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message
    }));
    throw new ValidationError("Dispatch marker is invalid.", details);
  }
  return result.data as DispatchMarker;
}

export function isDispatchFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  return /^.orca\/dispatch\/[a-zA-Z0-9_-]+\.json$/.test(normalized);
}

export function extractDispatchIdFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");
  const match = normalized.match(/^.orca\/dispatch\/([a-zA-Z0-9_-]+)\.json$/);
  return match && match[1] ? match[1] : null;
}
