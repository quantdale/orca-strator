import { z } from "zod";
import type { RepositoryRecord } from "./repository.js";
import type { RunRecord } from "./loop.js";

export type TracePhase =
  | "CAMPAIGN"
  | "SOL_WAKE"
  | "SOL_REVIEW"
  | "DISPATCH"
  | "EXECUTOR_LAUNCH"
  | "EXECUTOR_ACTIVITY"
  | "GIT_PREFLIGHT"
  | "RESULT"
  | "GIT_POSTFLIGHT"
  | "CONTROL"
  | "RECOVERY"
  | "PERMISSION"
  | "BUDGET";

export type TraceStatus = "INFO" | "STARTED" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "RETRYING";

export interface CampaignTraceEvent {
  id: string;
  repositoryId: string;
  runId: string | null;
  iteration: number | null;
  phase: TracePhase;
  eventType: string;
  dispatchId: string | null;
  resultId: string | null;
  controlId: string | null;
  at: string;
  durationMs: number | null;
  status: TraceStatus;
  failureReason: string | null;
  data: Record<string, unknown>;
}

export interface CampaignSummary {
  repositoryId: string;
  run: RunRecord;
  eventCount: number;
  iterationCount: number;
  durationMs: number | null;
  latestEventAt: string | null;
  latestPhase: TracePhase | null;
  latestFailureReason: string | null;
}

export interface CampaignIterationSummary {
  iteration: number;
  eventCount: number;
  durationMs: number | null;
  phases: TracePhase[];
  status: TraceStatus;
  latestEventAt: string | null;
}

export interface CampaignDetail {
  repository: RepositoryRecord;
  run: RunRecord;
  summary: CampaignSummary;
  iterations: CampaignIterationSummary[];
  timeline: CampaignTraceEvent[];
  dispatches: Record<string, unknown>[];
  executorRuns: Record<string, unknown>[];
  wakes: Record<string, unknown>[];
  controls: Record<string, unknown>[];
  effectivePolicy: PhaseBudgetPolicy | null;
}

export type BudgetFailureReason =
  | "CAMPAIGN_WALL_CLOCK_CEILING"
  | "CAMPAIGN_ITERATION_CEILING"
  | "SOL_PROFILE_ACQUISITION_TIMEOUT"
  | "SOL_WAKE_SUBMISSION_TIMEOUT"
  | "SOL_BUSY_RETRY_EXHAUSTED"
  | "SOL_COMPLETION_TIMEOUT"
  | "EXECUTOR_START_TIMEOUT"
  | "EXECUTOR_CONTACT_TIMEOUT"
  | "EXECUTOR_WATCHDOG_TIMEOUT"
  | "EXECUTOR_PAUSE_GRACE_EXCEEDED"
  | "EXECUTOR_KILL_GRACE_EXCEEDED"
  | "GIT_COMMAND_TIMEOUT"
  | "GIT_PREFLIGHT_TIMEOUT"
  | "GIT_POSTFLIGHT_TIMEOUT"
  | "RECOVERY_RETRY_CEILING";

export interface PhaseBudgetPolicy {
  schemaVersion: 1;
  campaign: {
    maxRuntimeMinutes: number;
    maxIterations: number;
  };
  sol: {
    profileAcquisitionMs: number;
    wakeSubmissionMs: number;
    busyRetryMax: number;
    busyRetryDelayMs: number;
    completionWaitMs: number;
    completionRetryCount: number;
  };
  executor: {
    launchAttempts: number;
    startTimeoutMs: number;
    contactTimeoutMs: number;
    watchdogMs: number;
    pauseGraceMs: number;
    killGraceMs: number;
  };
  git: {
    commandTimeoutMs: number;
    preflightTimeoutMs: number;
    postflightTimeoutMs: number;
  };
  recovery: {
    retryCeiling: number;
  };
}

export const DEFAULT_PHASE_BUDGET_POLICY: PhaseBudgetPolicy = {
  schemaVersion: 1,
  campaign: { maxRuntimeMinutes: 480, maxIterations: 20 },
  sol: {
    profileAcquisitionMs: 15_000,
    wakeSubmissionMs: 30_000,
    busyRetryMax: 3,
    busyRetryDelayMs: 3_500,
    completionWaitMs: 20 * 60 * 1000,
    completionRetryCount: 1
  },
  executor: {
    launchAttempts: 3,
    startTimeoutMs: 30_000,
    contactTimeoutMs: 30_000,
    watchdogMs: 0,
    pauseGraceMs: 5_000,
    killGraceMs: 5_000
  },
  git: {
    commandTimeoutMs: 30_000,
    preflightTimeoutMs: 30_000,
    postflightTimeoutMs: 30_000
  },
  recovery: { retryCeiling: 3 }
};

export function createPhaseBudgetPolicy(
  repository: Pick<RepositoryRecord, "maxIterations" | "maxRuntimeMinutes">,
  overrides: Partial<PhaseBudgetPolicy> = {}
): PhaseBudgetPolicy {
  return {
    ...DEFAULT_PHASE_BUDGET_POLICY,
    campaign: {
      maxIterations: repository.maxIterations,
      maxRuntimeMinutes: repository.maxRuntimeMinutes,
      ...overrides.campaign
    },
    sol: { ...DEFAULT_PHASE_BUDGET_POLICY.sol, ...overrides.sol },
    executor: { ...DEFAULT_PHASE_BUDGET_POLICY.executor, ...overrides.executor },
    git: { ...DEFAULT_PHASE_BUDGET_POLICY.git, ...overrides.git },
    recovery: { ...DEFAULT_PHASE_BUDGET_POLICY.recovery, ...overrides.recovery }
  };
}

export const phaseBudgetPolicySchema = z.object({
  schemaVersion: z.literal(1),
  campaign: z.object({ maxRuntimeMinutes: z.number().int().positive(), maxIterations: z.number().int().positive() }).strict(),
  sol: z.object({
    profileAcquisitionMs: z.number().int().nonnegative(),
    wakeSubmissionMs: z.number().int().nonnegative(),
    busyRetryMax: z.number().int().nonnegative(),
    busyRetryDelayMs: z.number().int().nonnegative(),
    completionWaitMs: z.number().int().positive(),
    completionRetryCount: z.number().int().nonnegative()
  }).strict(),
  executor: z.object({
    launchAttempts: z.number().int().positive(),
    startTimeoutMs: z.number().int().nonnegative(),
    contactTimeoutMs: z.number().int().nonnegative(),
    watchdogMs: z.number().int().nonnegative(),
    pauseGraceMs: z.number().int().nonnegative(),
    killGraceMs: z.number().int().nonnegative()
  }).strict(),
  git: z.object({
    commandTimeoutMs: z.number().int().positive(),
    preflightTimeoutMs: z.number().int().positive(),
    postflightTimeoutMs: z.number().int().positive()
  }).strict(),
  recovery: z.object({ retryCeiling: z.number().int().nonnegative() }).strict()
}).strict();

export type ProbeLevel = "STATIC" | "NON_INFERENCE" | "INFERENCE";
export type CapabilityReadiness = "READY" | "NOT_READY" | "UNKNOWN" | "NOT_APPLICABLE" | "UNSUPPORTED";
export type AuthReadiness = "READY" | "NOT_READY" | "UNKNOWN" | "NOT_APPLICABLE";
export type ModelRecognition = "RECOGNIZED" | "UNRECOGNIZED" | "UNKNOWN";

export type CapabilityErrorClass =
  | "CLI_NOT_FOUND"
  | "CLI_VERSION_FAILED"
  | "WORKING_DIRECTORY_UNAVAILABLE"
  | "WSL_UNAVAILABLE"
  | "GIT_UNAVAILABLE"
  | "REMOTE_UNAVAILABLE"
  | "INVOCATION_UNSUPPORTED"
  | "AUTH_UNKNOWN"
  | "MODEL_UNKNOWN"
  | "PROBE_NOT_AUTHORIZED"
  | "UNKNOWN";

export interface CapabilityIssue {
  class: CapabilityErrorClass;
  message: string;
  retryable: boolean;
}

export interface ExecutorRichCapabilities {
  structuredEvents: CapabilityReadiness;
  sessionResume: CapabilityReadiness;
  subagents: CapabilityReadiness;
  permissionApi: CapabilityReadiness;
  nativeCancellation: CapabilityReadiness;
  sessionHistory: CapabilityReadiness;
  usageTelemetry: CapabilityReadiness;
  nativeStatus: CapabilityReadiness;
}

export interface ExecutorCapabilitySnapshot {
  schemaVersion: 1;
  cli: string;
  profile: string;
  installed: boolean;
  version: string | null;
  executablePath: string | null;
  environment: "windows" | "wsl";
  wslDistribution: string | null;
  workingDirectoryAccessible: CapabilityReadiness;
  gitAvailable: CapabilityReadiness;
  fetchUsable: CapabilityReadiness;
  pushUsable: CapabilityReadiness;
  remoteMainUsable: CapabilityReadiness;
  headlessSupported: CapabilityReadiness;
  commandProfileValid: CapabilityReadiness;
  resumeSupported: CapabilityReadiness;
  cancellationSupported: CapabilityReadiness;
  authStatus: AuthReadiness;
  configuredModel: string;
  modelRecognition: ModelRecognition;
  rich: ExecutorRichCapabilities;
  overall: CapabilityReadiness;
  probeLevel: ProbeLevel;
  probedAt: string;
  issues: CapabilityIssue[];
}

export interface CapabilityProbeRequest {
  level?: ProbeLevel;
  allowInference?: boolean;
}

export const capabilityProbeRequestSchema = z.object({
  level: z.enum(["STATIC", "NON_INFERENCE", "INFERENCE"]).optional(),
  allowInference: z.boolean().optional()
}).strict();
