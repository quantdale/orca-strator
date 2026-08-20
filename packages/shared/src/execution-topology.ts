import type { ExecutionStrategy } from "./execution-strategy.js";

export type ExecutionTopologyCardKind =
  | "SOL_WAKE"
  | "DISPATCH"
  | "EXECUTOR"
  | "RESULT"
  | "WORKER"
  | "NODE"
  | "INTEGRATION"
  | "SOL_REVIEW";

/** Small UI/read-model vocabulary; durable records remain the source of truth. */
export interface ExecutionTopologyCard {
  id: string;
  kind: ExecutionTopologyCardKind;
  strategy: ExecutionStrategy;
  status: string;
  dependencyIds: string[];
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  executor: string | null;
  model: string | null;
  environment: "windows" | "wsl" | null;
  usageMetricIds: string[];
  references: string[];
}

export interface ExecutionTopologyView {
  schemaVersion: 1;
  strategy: ExecutionStrategy;
  cards: ExecutionTopologyCard[];
  integrationStatus: string | null;
  source: "CAMPAIGN_DETAIL";
}
