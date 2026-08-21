import { z } from "zod";
import type {
 IntegrationReport,
 WorkPacket,
 WorkPacketResult,
} from "./work-packets.js";

export type ExecutionStrategy = "SINGLE_AGENT" | "SWARM" | "DAG";
export const executionStrategySchema = z.enum(["SINGLE_AGENT", "SWARM", "DAG"]);

export type StrategyRunStatus =
 | "QUEUED"
 | "RUNNING"
 | "PAUSED"
 | "STOPPING"
 | "COMPLETED"
 | "PARTIAL"
 | "BLOCKED"
 | "FAILED"
 | "CANCELLED"
 | "RECOVERY_REQUIRED";

export const strategyRunStatusSchema = z.enum([
 "QUEUED",
 "RUNNING",
 "PAUSED",
 "STOPPING",
 "COMPLETED",
 "PARTIAL",
 "BLOCKED",
 "FAILED",
 "CANCELLED",
 "RECOVERY_REQUIRED",
]);

export type StrategyControlDecision = "PAUSE" | "STOP" | "KILL" | "RESUME";
export const strategyControlDecisionSchema = z.enum([
 "PAUSE",
 "STOP",
 "KILL",
 "RESUME",
]);

export type StrategyControlState =
 | "NONE"
 | "PAUSE_REQUESTED"
 | "STOP_REQUESTED"
 | "KILL_REQUESTED";
export const strategyControlStateSchema = z.enum([
 "NONE",
 "PAUSE_REQUESTED",
 "STOP_REQUESTED",
 "KILL_REQUESTED",
]);

export interface StrategyRunRecord {
 schemaVersion: 1;
 strategyRunId: string;
 repositoryId: string;
 campaignId: string;
 runId: string;
 iteration: number;
 strategy: ExecutionStrategy;
 status: StrategyRunStatus;
 maxConcurrency: number;
 packetIds: string[];
 controlState: StrategyControlState;
 /** The explicit dispatch that authorized this strategy iteration, if any. */
 dispatchId: string | null;
 /** Immutable deterministic base SHA the strategy was started against. */
 strategyBaseSha: string | null;
 startedAt: string | null;
 finishedAt: string | null;
 lastError: string | null;
 report: StrategyExecutionReport | null;
 createdAt: string;
 updatedAt: string;
}

/**
 * Durable authorization + definition referenced by a dispatch for a non-default
 * execution strategy. Old V1 dispatches (no strategy field) resolve to
 * SINGLE_AGENT and carry no execution plan.
 */
export interface DispatchExecutionPlan {
 packetIds?: string[];
 dagNodes?: DagNodeDefinition[];
 maxConcurrency?: number;
}

export type DagNodeStatus =
 | "QUEUED"
 | "STARTING"
 | "RUNNING"
 | "WAITING_DEPENDENCY"
 | "WAITING_PERMISSION"
 | "RETRYING"
 | "COMPLETED"
 | "FAILED"
 | "BLOCKED"
 | "SKIPPED"
 | "CANCELLED"
 | "INTEGRATING";

export const dagNodeStatusSchema = z.enum([
 "QUEUED",
 "STARTING",
 "RUNNING",
 "WAITING_DEPENDENCY",
 "WAITING_PERMISSION",
 "RETRYING",
 "COMPLETED",
 "FAILED",
 "BLOCKED",
 "SKIPPED",
 "CANCELLED",
 "INTEGRATING",
]);

export interface DagNodeDefinition {
 nodeId: string;
 packetId: string;
 dependsOn: string[];
}

export interface DagNodeRecord extends DagNodeDefinition {
 schemaVersion: 1;
 strategyRunId: string;
 status: DagNodeStatus;
 budget: WorkPacket["budget"];
 attempt: number;
 maxRetries: number;
 waitingReason: string | null;
 /** Integrated commit SHAs of dependencies captured when the node became runnable. */
 dependencyInputShas: string[];
 /**
  * Change 018 (additive, optional): node worktree HEAD after authorized
  * dependency replay — the last replayed staged dependency commit on top of
  * the immutable strategy base. Null until the worktree is allocated.
  * Optional so pre-existing record literals remain valid.
  */
 nodeBaseSha?: string | null;
 startedAt: string | null;
 finishedAt: string | null;
 resultId: string | null;
 createdAt: string;
 updatedAt: string;
}

export interface StrategyControlRecord {
 controlId: string;
 strategyRunId: string;
 repositoryId: string;
 runId: string;
 iteration: number;
 decision: StrategyControlDecision;
 reason: string | null;
 createdAt: string;
}

export interface SwarmExecutionReport {
 schemaVersion: 1;
 strategyRunId: string;
 repositoryId: string;
 runId: string;
 iteration: number;
 strategy: "SWARM";
 status: Exclude<StrategyRunStatus, "QUEUED" | "RUNNING" | "STOPPING">;
 maxConcurrency: number;
 packetIds: string[];
 results: WorkPacketResult[];
 integration: IntegrationReport | null;
 schedulerDecisionIds: string[];
 controlIds: string[];
 blocker: string | null;
 startedAt: string;
 finishedAt: string;
}

export interface DagExecutionReport {
 schemaVersion: 1;
 strategyRunId: string;
 repositoryId: string;
 runId: string;
 iteration: number;
 strategy: "DAG";
 status: Exclude<StrategyRunStatus, "QUEUED" | "RUNNING" | "STOPPING">;
 maxConcurrency: number;
 packetIds: string[];
 nodeIds: string[];
 nodes: DagNodeRecord[];
 results: WorkPacketResult[];
 integration: IntegrationReport | null;
 schedulerDecisionIds: string[];
 controlIds: string[];
 blocker: string | null;
 startedAt: string;
 finishedAt: string;
}

export type StrategyExecutionReport = SwarmExecutionReport | DagExecutionReport;

/** Result of making integrated `main` durable on the remote after a strategy run. */
export interface RemotePublishResult {
 status: "PUBLISHED" | "BLOCKED";
 pushedSha: string | null;
 resultSha: string | null;
 remoteVerified: boolean;
 blocker: string | null;
 details: Record<string, unknown>;
}

export interface SwarmStartRequest {
 packetIds: string[];
 maxConcurrency?: number;
}

export interface DagStartRequest {
 nodes: DagNodeDefinition[];
 maxConcurrency?: number;
}

export const swarmStartRequestSchema = z
 .object({
  packetIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  maxConcurrency: z.number().int().min(1).max(32).optional(),
 })
 .strict();

export const dagNodeDefinitionSchema = z
 .object({
  nodeId: z.string().trim().min(1).max(200),
  packetId: z.string().trim().min(1).max(200),
  dependsOn: z.array(z.string().trim().min(1).max(200)).max(100),
 })
 .strict();

export const dagStartRequestSchema = z
 .object({
  nodes: z.array(dagNodeDefinitionSchema).min(1).max(100),
  maxConcurrency: z.number().int().min(1).max(32).optional(),
 })
 .strict();
export const strategyControlRequestSchema = z
 .object({
  decision: strategyControlDecisionSchema,
  reason: z.string().trim().max(2000).optional(),
 })
 .strict();

export const strategyRunRecordSchema = z
 .object({
  schemaVersion: z.literal(1),
  strategyRunId: z.string().trim().min(1).max(200),
  repositoryId: z.string().trim().min(1).max(200),
  campaignId: z.string().trim().min(1).max(200),
  runId: z.string().trim().min(1).max(200),
  iteration: z.number().int().positive(),
  strategy: executionStrategySchema,
  status: strategyRunStatusSchema,
  maxConcurrency: z.number().int().min(1).max(32),
  packetIds: z.array(z.string().trim().min(1).max(200)).max(100),
  controlState: strategyControlStateSchema,
  dispatchId: z.string().trim().min(1).max(200).nullable(),
  strategyBaseSha: z
   .string()
   .regex(/^[0-9a-f]{40}$/i)
   .nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  lastError: z.string().max(4000).nullable(),
  report: z.unknown().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
 })
 .strict();
