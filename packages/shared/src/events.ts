import type { RepositoryRecord } from "./repository.js";
import type { DispatchRecord, WatcherState } from "./dispatch.js";

export type EventType =
  | "repository.created"
  | "repository.updated"
  | "repository.deleted"
  | "watcher.dispatch_detected"
  | "watcher.dispatch_rejected"
  | "watcher.control_detected"
  | "watcher.control_rejected"
  | "watcher.poll_completed"
  | "executor.log"
  | "executor.started"
  | "executor.completed"
  | "sol.wake_submitted"
  | "sol.wake_busy"
  | "sol.wake_retrying"
  | "sol.wake_failed"
  | "sol.operation_completed"
  | "loop.state_changed"
  | "executor.capability_probed"
  | "executor.usage_recorded"
  | "permission.decision"
  | "budget.expired"
  | "strategy.started"
  | "strategy.worker_queued"
  | "strategy.worker_started"
  | "strategy.worker_completed"
  | "strategy.permission_required"
  | "strategy.control"
  | "strategy.integration_completed"
  | "strategy.completed"
  | "strategy.recovery";

export interface RepositoryMutationEvent {
  type: EventType;
  at: string;
  repositoryId: string;
  data?: {
    repository?: RepositoryRecord;
    dispatch?: DispatchRecord;
    watcherState?: WatcherState;
    reason?: string;
    loopState?: string;
    runId?: string;
    controlId?: string;
    decision?: string;
    logMessage?: string;
    iteration?: number;
    dispatchId?: string;
    resultId?: string;
    durationMs?: number;
    phase?: string;
    failureReason?: string;
    [key: string]: unknown;
  };
}
