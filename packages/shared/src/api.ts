import type { RepositoryRecord } from "./repository.js";

export interface HealthResponse {
  status: "ok";
  service: "orca-controller";
  version: string;
}

export interface RepositoryListResponse {
  repositories: RepositoryRecord[];
}

export interface RepositoryResponse {
  repository: RepositoryRecord;
}
