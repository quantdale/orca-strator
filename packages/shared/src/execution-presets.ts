import type { ExecutionStrategy } from "./execution-strategy.js";

export type ExecutionPresetId =
  | "FEATURE_DEVELOPMENT"
  | "DEEP_AUDIT"
  | "BUG_HUNT"
  | "MIGRATION"
  | "RELEASE_HARDENING";

export interface ExecutionStrategyPreset {
  schemaVersion: 1;
  id: ExecutionPresetId;
  label: string;
  summary: string;
  recommendedStrategy: ExecutionStrategy;
  requiresTypedWork: boolean;
  recommendedConcurrency: number | null;
  defaultExperience: "SINGLE_AGENT";
  autoStart: false;
}

/**
 * Policy/reference data only. A preset never creates packets, selects a model,
 * starts a run, or changes the repository's default SINGLE_AGENT experience.
 */
export const EXECUTION_STRATEGY_PRESETS: readonly ExecutionStrategyPreset[] = [
  {
    schemaVersion: 1,
    id: "FEATURE_DEVELOPMENT",
    label: "Feature Development",
    summary: "Primary Sol/executor loop for a focused change.",
    recommendedStrategy: "SINGLE_AGENT",
    requiresTypedWork: false,
    recommendedConcurrency: null,
    defaultExperience: "SINGLE_AGENT",
    autoStart: false
  },
  {
    schemaVersion: 1,
    id: "DEEP_AUDIT",
    label: "Deep Audit",
    summary: "Use explicit independent audit packets when the work is separable.",
    recommendedStrategy: "SWARM",
    requiresTypedWork: true,
    recommendedConcurrency: 2,
    defaultExperience: "SINGLE_AGENT",
    autoStart: false
  },
  {
    schemaVersion: 1,
    id: "BUG_HUNT",
    label: "Bug Hunt",
    summary: "Keep diagnosis and repair under one primary executor by default.",
    recommendedStrategy: "SINGLE_AGENT",
    requiresTypedWork: false,
    recommendedConcurrency: null,
    defaultExperience: "SINGLE_AGENT",
    autoStart: false
  },
  {
    schemaVersion: 1,
    id: "MIGRATION",
    label: "Migration",
    summary: "Use explicit dependency-linked packets/nodes for staged changes.",
    recommendedStrategy: "DAG",
    requiresTypedWork: true,
    recommendedConcurrency: 2,
    defaultExperience: "SINGLE_AGENT",
    autoStart: false
  },
  {
    schemaVersion: 1,
    id: "RELEASE_HARDENING",
    label: "Release Hardening",
    summary: "Primary executor with explicit verification and Sol review.",
    recommendedStrategy: "SINGLE_AGENT",
    requiresTypedWork: false,
    recommendedConcurrency: null,
    defaultExperience: "SINGLE_AGENT",
    autoStart: false
  }
];
