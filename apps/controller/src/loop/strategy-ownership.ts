import type { ExecutionStrategy } from "@orca/shared";

/** Rich actor identity for one repository/campaign iteration. */
export type IterationActor = "NONE" | "SOL" | "EXECUTOR" | "SWARM" | "DAG";

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
