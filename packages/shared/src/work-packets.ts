import { z } from "zod";

export type WorkPacketStatus =
  | "QUEUED"
  | "STARTING"
  | "RUNNING"
  | "WAITING_PERMISSION"
  | "RETRYING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "SKIPPED_DEPENDENCY"
  | "CANCELLED";
export type WorkPacketResultStatus =
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED"
  | "SKIPPED"
  | "SKIPPED_DEPENDENCY"
  | "INTEGRATION_CONFLICT";
export type WorktreeLifecycleStatus =
  | "ALLOCATED"
  | "ACTIVE"
  | "RELEASED"
  | "STALE"
  | "CLEANUP_REQUIRED"
  | "ORPHANED";
export type IntegrationStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "INTEGRATION_CONFLICT"
  | "BLOCKED";

export interface WorkPacketExecutorPolicy {
  role: string;
  executorCli: string;
  model: string;
  provider: string | null;
  source: "REPOSITORY_DEFAULT" | "EXPLICIT_RULE";
}

export interface WorkPacketBudget {
  maxRuntimeMs: number;
  maxRetries: number;
  maxTokens: number | null;
  maxSpend: number | null;
}

export interface WorkPacketPermissionPolicy {
  preset: "CONSERVATIVE" | "BALANCED" | "UNATTENDED" | "CUSTOM";
  allowedActions: string[];
  deniedActions: string[];
}

export interface WorkPacket {
  schemaVersion: 1;
  packetId: string;
  campaignId: string;
  runId: string;
  iteration: number;
  parentDispatchId: string | null;
  workstream: string;
  goal: string;
  requirements: string[];
  allowedPaths: string[];
  readPaths: string[];
  dependencies: string[];
  executor: WorkPacketExecutorPolicy;
  verificationExpectations: string[];
  budget: WorkPacketBudget;
  permissionPolicy: WorkPacketPermissionPolicy;
  status: WorkPacketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeProvenance {
  worktreeId: string;
  path: string;
  branch: string;
  baseSha: string;
  commitSha: string | null;
}

export interface WorkPacketResult {
  schemaVersion: 1;
  packetId: string;
  campaignId: string;
  runId: string;
  iteration: number;
  status: WorkPacketResultStatus;
  worktree: WorktreeProvenance | null;
  filesChanged: string[];
  /** Paths that violated the packet allowedPaths policy after execution. */
  policyViolationPaths?: string[];
  verification: string[];
  findings: string[];
  risks: string[];
  artifacts: string[];
  dependenciesAffected: string[];
  usageMetricIds: string[];
  summary: string;
  blocker: string | null;
  createdAt: string;
}

export interface IsolatedWorktreeRecord {
  worktreeId: string;
  repositoryId: string;
  packetId: string;
  campaignId: string;
  runId: string;
  iteration: number;
  path: string;
  branch: string;
  environment: "windows" | "wsl";
  wslDistribution: string | null;
  baseSha: string;
  /** Dependency commit SHAs that were present on the base when the worktree was allocated. */
  dependencyInputShas: string[];
  status: WorktreeLifecycleStatus;
  createdAt: string;
  releasedAt: string | null;
  lastError: string | null;
}

export interface IntegrationReport {
  schemaVersion: 1;
  repositoryId: string;
  runId: string;
  iteration: number;
  status: IntegrationStatus;
  integratedPacketIds: string[];
  results: WorkPacketResult[];
  finalCommitSha: string | null;
  blocker: string | null;
  createdAt: string;
}

const pathList = z.array(z.string().trim().min(1).max(500)).max(500);
const packetExecutorSchema = z
  .object({
    role: z.string().trim().min(1).max(100),
    executorCli: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(300),
    provider: z.string().trim().max(200).nullable(),
    source: z.enum(["REPOSITORY_DEFAULT", "EXPLICIT_RULE"]),
  })
  .strict();

export const workPacketSchema = z
  .object({
    schemaVersion: z.literal(1),
    packetId: z.string().trim().min(1).max(200),
    campaignId: z.string().trim().min(1).max(200),
    runId: z.string().trim().min(1).max(200),
    iteration: z.number().int().positive(),
    parentDispatchId: z.string().trim().max(200).nullable(),
    workstream: z.string().trim().min(1).max(200),
    goal: z.string().trim().min(1).max(4000),
    requirements: z.array(z.string().trim().min(1).max(4000)).max(200),
    allowedPaths: pathList,
    readPaths: pathList,
    dependencies: z.array(z.string().trim().min(1).max(200)).max(100),
    executor: packetExecutorSchema,
    verificationExpectations: z
      .array(z.string().trim().min(1).max(1000))
      .max(100),
    budget: z
      .object({
        maxRuntimeMs: z.number().int().positive(),
        maxRetries: z.number().int().nonnegative(),
        maxTokens: z.number().finite().positive().nullable(),
        maxSpend: z.number().finite().positive().nullable(),
      })
      .strict(),
    permissionPolicy: z
      .object({
        preset: z.enum(["CONSERVATIVE", "BALANCED", "UNATTENDED", "CUSTOM"]),
        allowedActions: z.array(z.string().trim().min(1).max(100)).max(100),
        deniedActions: z.array(z.string().trim().min(1).max(100)).max(100),
      })
      .strict(),
    status: z.enum([
      "QUEUED",
      "STARTING",
      "RUNNING",
      "WAITING_PERMISSION",
      "RETRYING",
      "COMPLETED",
      "FAILED",
      "BLOCKED",
      "SKIPPED_DEPENDENCY",
      "CANCELLED",
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const worktreeSchema = z
  .object({
    worktreeId: z.string().trim().min(1).max(200),
    path: z.string().trim().min(1).max(1000),
    branch: z.string().trim().min(1).max(300),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/i),
    commitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/i)
      .nullable(),
  })
  .strict();

export const workPacketResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    packetId: z.string().trim().min(1).max(200),
    campaignId: z.string().trim().min(1).max(200),
    runId: z.string().trim().min(1).max(200),
    iteration: z.number().int().positive(),
    status: z.enum([
      "COMPLETED",
      "FAILED",
      "BLOCKED",
      "CANCELLED",
      "SKIPPED",
      "SKIPPED_DEPENDENCY",
      "INTEGRATION_CONFLICT",
    ]),
    worktree: worktreeSchema.nullable(),
    filesChanged: pathList,
    verification: z.array(z.string().trim().min(1).max(2000)).max(200),
    findings: z.array(z.string().trim().min(1).max(4000)).max(200),
    risks: z.array(z.string().trim().min(1).max(4000)).max(200),
    artifacts: z.array(z.string().trim().min(1).max(1000)).max(200),
    dependenciesAffected: z.array(z.string().trim().min(1).max(200)).max(100),
    usageMetricIds: z.array(z.string().trim().min(1).max(200)).max(100),
    summary: z.string().trim().min(1).max(4000),
    blocker: z.string().trim().max(4000).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
