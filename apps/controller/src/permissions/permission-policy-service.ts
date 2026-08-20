import crypto from "node:crypto";
import {
  autonomyPermissionPolicySchema,
  createPermissionPreset,
  getPermissionRule,
  type AutonomyPermissionPolicy,
  type PermissionAction,
  type PermissionDecision,
  type PermissionEnforcement,
  type PermissionEvaluation,
  type PermissionPreset
} from "@orca/shared";
import type { PermissionStore } from "./permission-store.js";

export interface PermissionPolicyServiceOptions {
  store: PermissionStore;
  /** Optional adapter capability lookup. False means no native enforcement claim. */
  hasNativePermissionApi?: (repositoryId: string) => boolean;
  attentionHandler?: (decision: PermissionDecision) => void;
  eventPublisher?: (event: {
    type: "permission.decision";
    at: string;
    repositoryId: string;
    data?: Record<string, unknown>;
  }) => void;
}

export class PermissionPolicyService {
  constructor(private readonly options: PermissionPolicyServiceOptions) {}

  getPolicy(repositoryId: string): AutonomyPermissionPolicy {
    const existing = this.options.store.getPolicy(repositoryId);
    if (existing) return existing;
    const policy = createPermissionPreset(repositoryId, "BALANCED");
    this.options.store.savePolicy(policy);
    return policy;
  }

  setPolicy(repositoryId: string, input: unknown): AutonomyPermissionPolicy {
    const parsed = autonomyPermissionPolicySchema.parse({ ...(input as Record<string, unknown>), repositoryId });
    const rules = parsed.rules.map((rule) => {
      const absolute = getPermissionRule(createPermissionPreset(repositoryId, "BALANCED"), rule.action);
      return ["GIT_FORCE_PUSH", "OUTSIDE_REPOSITORY_FILESYSTEM", "ENVIRONMENT_SECRETS_READ"].includes(rule.action)
        ? absolute
        : rule;
    });
    const policy: AutonomyPermissionPolicy = { ...parsed, rules, updatedAt: new Date().toISOString() };
    this.options.store.savePolicy(policy);
    return policy;
  }

  setPreset(repositoryId: string, preset: Exclude<PermissionPreset, "CUSTOM">): AutonomyPermissionPolicy {
    const policy = createPermissionPreset(repositoryId, preset);
    this.options.store.savePolicy(policy);
    return policy;
  }

  evaluate(params: {
    repositoryId: string;
    action: PermissionAction;
    runId?: string | null;
    iteration?: number | null;
  }): PermissionEvaluation {
    const policy = this.getPolicy(params.repositoryId);
    const rule = getPermissionRule(policy, params.action);
    const absolute = ["GIT_FORCE_PUSH", "OUTSIDE_REPOSITORY_FILESYSTEM", "ENVIRONMENT_SECRETS_READ"].includes(params.action);
    const native = this.options.hasNativePermissionApi?.(params.repositoryId) === true;
    const enforcement: PermissionEnforcement = absolute
      ? "ORCA_ENFORCED"
      : native
        ? "NATIVE_EXECUTOR"
        : "ADVISORY_ONLY";
    const actionable = rule.outcome === "ASK";
    const rationale = absolute
      ? "Absolute Orca safety invariant; presets cannot relax this action."
      : native
        ? "The selected executor advertises a native permission API."
        : "The selected executor cannot technically enforce this policy; Orca records it as advisory and surfaces ASK decisions.";
    const createdAt = new Date().toISOString();
    const decision: PermissionDecision = {
      id: crypto.randomUUID(),
      repositoryId: params.repositoryId,
      runId: params.runId ?? null,
      iteration: params.iteration ?? null,
      action: params.action,
      outcome: rule.outcome,
      enforcement,
      rationale,
      actionable,
      createdAt,
      resolvedAt: null
    };
    this.options.store.saveDecision(decision);
    if (actionable) this.options.attentionHandler?.(decision);
    this.options.eventPublisher?.({
      type: "permission.decision",
      at: createdAt,
      repositoryId: params.repositoryId,
      data: {
        runId: params.runId ?? null,
        iteration: params.iteration ?? null,
        action: params.action,
        outcome: rule.outcome,
        enforcement,
        actionable,
        reason: rationale
      }
    });
    return { action: params.action, outcome: rule.outcome, enforcement, rationale, actionable, decision };
  }

  listDecisions(repositoryId: string): PermissionDecision[] {
    return this.options.store.listDecisions(repositoryId);
  }
}
