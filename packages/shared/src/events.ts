import type { RepositoryRecord } from "./repository.js";

export type EventType = "repository.created" | "repository.updated" | "repository.deleted";

export interface RepositoryMutationEvent {
  type: EventType;
  at: string;
  repositoryId: string;
  data?: {
    repository?: RepositoryRecord;
  };
}
