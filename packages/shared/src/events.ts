import type { RepositoryRecord } from "./repository.js";
import type { DispatchRecord, WatcherState } from "./dispatch.js";

export type EventType =
  | "repository.created"
  | "repository.updated"
  | "repository.deleted"
  | "watcher.dispatch_detected"
  | "watcher.dispatch_rejected"
  | "watcher.control_detected"
  | "watcher.poll_completed"
  | "executor.log"
  | "loop.state_changed";

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
  };
}
