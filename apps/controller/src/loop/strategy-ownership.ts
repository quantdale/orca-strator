import type {
  ExecutionStrategy,
  RemotePublishResult,
  StrategyRunStatus,
} from "@orca/shared";

/** Rich actor identity for one repository/campaign iteration. */
export type IterationActor = "NONE" | "SOL" | "EXECUTOR" | "SWARM" | "DAG";

/** Prefix persisted on a strategy record whose publication was not confirmed. */
export const POSTFLIGHT_BLOCKED_PREFIX = "POSTFLIGHT_BLOCKED:";

/** Strategy statuses that close the iteration actor boundary. */
export const STRATEGY_TERMINAL_STATUSES: readonly StrategyRunStatus[] = [
  "COMPLETED",
  "PARTIAL",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "RECOVERY_REQUIRED",
];

export function isStrategyTerminal(status: StrategyRunStatus): boolean {
  return STRATEGY_TERMINAL_STATUSES.includes(status);
}

/**
 * Authoritative postflight gate (Change 018 R1): an engine COMPLETED outcome
 * only counts as a successful iteration when integrated main is verifiably
 * durable on the remote.
 */
export function isRemotePublishConfirmed(
  remote: RemotePublishResult | null,
): boolean {
  return (
    !!remote && remote.status === "PUBLISHED" && remote.remoteVerified === true
  );
}

/** Human-readable publication outcome for durable evidence fields/events. */
export function formatPostflightBlocker(
  remote: RemotePublishResult | null,
): string {
  if (!remote) return "postflight did not produce a publication result";
  const blocker = remote.blocker
    ? String(remote.blocker)
    : "remote state could not be verified";
  return `${remote.status}: ${blocker}`;
}

/**
 * Structured conflict returned when a strategy/executor start is rejected
 * because the campaign/iteration ownership boundary is not free.
 */
export class StrategyConflictError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SOL_ACTIVE_NO_DISPATCH"
      | "EXECUTOR_ACTIVE"
      | "STRATEGY_ACTIVE"
      | "RUN_ITERATION_MISMATCH"
      | "RUN_NOT_RECEPTIVE"
      | "STRATEGY_NOT_AUTHORIZED"
      | "DISPATCH_STRATEGY_MISMATCH",
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "StrategyConflictError";
  }
}

export interface OwnershipCheckOptions {
  /** The strategy being requested (for manual API or dispatch). */
  requestedStrategy?: ExecutionStrategy;
  /** Allow a strategy start while Sol is the active actor (autonomous dispatch path). */
  allowSolBoundary?: boolean;
  /** The dispatch id that authorizes the strategy (autonomous path). */
  authorizedDispatchId?: string | null;
  /** The strategy the dispatch authorizes (autonomous path). */
  authorizedStrategy?: ExecutionStrategy | null;
}
