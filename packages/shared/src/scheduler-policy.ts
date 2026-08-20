import { z } from "zod";

export type SchedulerPreset = "ECONOMY" | "BALANCED" | "MAXIMUM" | "CUSTOM";
export type SchedulerAdmissionStatus = "ADMITTED" | "QUEUED" | "REJECTED" | "RELEASED" | "STALE_RECOVERABLE";
export type SchedulerLimitDimension =
  | "TOTAL_ACTIVE_INFERENCE_SESSIONS"
  | "PER_PROVIDER_CONCURRENCY"
  | "PER_MODEL_CONCURRENCY"
  | "PER_REPOSITORY_SUBAGENT_CONCURRENCY"
  | "MACHINE_CPU_PERCENT"
  | "MACHINE_MEMORY_MB"
  | "CAMPAIGN_TOKEN_BUDGET"
  | "CAMPAIGN_SPEND_BUDGET";

export interface SchedulerPolicy {
  schemaVersion: 1;
  preset: SchedulerPreset;
  enabled: boolean;
  queueWhenLimited: boolean;
  totalActiveInferenceSessions: number | null;
  perProviderConcurrency: number | null;
  perModelConcurrency: number | null;
  perRepositorySubagentConcurrency: number | null;
  machineCpuPercent: number | null;
  machineMemoryMb: number | null;
  campaignTokenBudget: number | null;
  campaignSpendBudget: number | null;
  updatedAt: string;
}

export interface SchedulerAdmissionRequest {
  requestId: string;
  repositoryId: string;
  runId?: string | null;
  iteration?: number | null;
  executor: string;
  provider?: string | null;
  model: string;
  kind: "PRIMARY_EXECUTOR" | "SUBAGENT";
  requestedTokens?: number | null;
  requestedSpend?: number | null;
  requestedCpuPercent?: number | null;
  requestedMemoryMb?: number | null;
  requestedAt?: string;
}

export interface SchedulerDecision {
  id: string;
  requestId: string;
  repositoryId: string;
  runId: string | null;
  iteration: number | null;
  executor: string;
  provider: string | null;
  model: string;
  kind: SchedulerAdmissionRequest["kind"];
  status: SchedulerAdmissionStatus;
  blockedBy: SchedulerLimitDimension | null;
  reason: string;
  queuedAt: string | null;
  runnableAt: string | null;
  resolvedAt: string | null;
  policySnapshot: SchedulerPolicy;
  createdAt: string;
}

export const schedulerPolicySchema = z.object({
  schemaVersion: z.literal(1),
  preset: z.enum(["ECONOMY", "BALANCED", "MAXIMUM", "CUSTOM"]),
  enabled: z.boolean(),
  queueWhenLimited: z.boolean(),
  totalActiveInferenceSessions: z.number().int().positive().nullable(),
  perProviderConcurrency: z.number().int().positive().nullable(),
  perModelConcurrency: z.number().int().positive().nullable(),
  perRepositorySubagentConcurrency: z.number().int().positive().nullable(),
  machineCpuPercent: z.number().finite().positive().max(100).nullable(),
  machineMemoryMb: z.number().finite().positive().nullable(),
  campaignTokenBudget: z.number().finite().positive().nullable(),
  campaignSpendBudget: z.number().finite().positive().nullable(),
  updatedAt: z.string().datetime()
}).strict();

export const schedulerAdmissionRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  repositoryId: z.string().trim().min(1).max(200),
  runId: z.string().trim().max(200).nullable().optional(),
  iteration: z.number().int().positive().nullable().optional(),
  executor: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().min(1).max(300),
  kind: z.enum(["PRIMARY_EXECUTOR", "SUBAGENT"]),
  requestedTokens: z.number().finite().positive().nullable().optional(),
  requestedSpend: z.number().finite().positive().nullable().optional(),
  requestedCpuPercent: z.number().finite().positive().max(100).nullable().optional(),
  requestedMemoryMb: z.number().finite().positive().nullable().optional(),
  requestedAt: z.string().datetime().optional()
}).strict();

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  schemaVersion: 1,
  preset: "BALANCED",
  enabled: true,
  queueWhenLimited: true,
  // Null means unlimited. Ordinary independent repositories are not capped.
  totalActiveInferenceSessions: null,
  perProviderConcurrency: null,
  perModelConcurrency: null,
  perRepositorySubagentConcurrency: null,
  machineCpuPercent: null,
  machineMemoryMb: null,
  campaignTokenBudget: null,
  campaignSpendBudget: null,
  updatedAt: "1970-01-01T00:00:00.000Z"
};
