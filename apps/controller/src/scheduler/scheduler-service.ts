import crypto from "node:crypto";
import { schedulerAdmissionRequestSchema, schedulerPolicySchema, type SchedulerAdmissionRequest, type SchedulerDecision, type SchedulerLimitDimension, type SchedulerPolicy } from "@orca/shared";
import type { SchedulerPolicyStore } from "./scheduler-policy-store.js";

export class SchedulerService {
  private readonly active = new Map<string, SchedulerAdmissionRequest>();
  private readonly queued = new Map<string, SchedulerAdmissionRequest>();

  constructor(private readonly store: SchedulerPolicyStore) {}

  getPolicy(): SchedulerPolicy { return this.store.getPolicy(); }

  setPolicy(input: unknown): SchedulerPolicy {
    const parsed = schedulerPolicySchema.parse(input);
    return this.store.savePolicy(parsed);
  }

  admit(input: SchedulerAdmissionRequest): SchedulerDecision {
    const request = schedulerAdmissionRequestSchema.parse(input);
    const existing = this.store.getDecision(request.requestId);
    if (existing?.status === "ADMITTED" && this.active.has(request.requestId)) return existing;
    const policy = this.getPolicy();
    const now = request.requestedAt ?? new Date().toISOString();
    const blockedBy = policy.enabled ? this.firstLimit(request) : null;
    const status = blockedBy ? (policy.queueWhenLimited ? "QUEUED" : "REJECTED") : "ADMITTED";
    const historicalBlockedBy = existing?.blockedBy ?? blockedBy;
    const wasQueued = existing?.queuedAt !== null && existing?.queuedAt !== undefined;
    const decision: SchedulerDecision = {
      id: existing?.id ?? crypto.randomUUID(),
      requestId: request.requestId,
      repositoryId: request.repositoryId,
      runId: request.runId ?? null,
      iteration: request.iteration ?? null,
      executor: request.executor,
      provider: request.provider ?? null,
      model: request.model,
      kind: request.kind,
      status,
      blockedBy: historicalBlockedBy,
      reason: blockedBy
        ? `Queued by explicit ${blockedBy} limit.`
        : wasQueued
          ? `Admitted after the explicit scheduler limit ${existing?.blockedBy ?? "configured"} became available.`
          : "Admitted: no configured scheduler limit blocks this request.",
      queuedAt: existing?.queuedAt ?? (blockedBy && status === "QUEUED" ? now : null),
      runnableAt: status === "ADMITTED" && wasQueued ? now : null,
      resolvedAt: status === "REJECTED" ? now : null,
      policySnapshot: policy,
      createdAt: existing?.createdAt ?? now
    };
    if (!existing) this.store.saveDecision(decision);
    else this.store.updateDecision(request.requestId, decision);
    if (status === "ADMITTED") this.active.set(request.requestId, request);
    if (status === "QUEUED") this.queued.set(request.requestId, request);
    return decision;
  }

  release(requestId: string): SchedulerDecision | null {
    this.active.delete(requestId);
    this.queued.delete(requestId);
    const current = this.store.getDecision(requestId);
    if (current) this.store.updateDecision(requestId, { status: "RELEASED", reason: "Released by the owning execution strategy.", resolvedAt: new Date().toISOString() });
    this.admitQueued();
    return this.store.getDecision(requestId);
  }

  recover(activeRequestIds: string[] = []): SchedulerDecision[] {
    const activeSet = new Set(activeRequestIds);
    const recovered: SchedulerDecision[] = [];
    for (const decision of this.store.listDecisions(1000)) {
      if (decision.status !== "ADMITTED") continue;
      if (activeSet.has(decision.requestId)) {
        this.active.set(decision.requestId, {
          requestId: decision.requestId,
          repositoryId: decision.repositoryId,
          runId: decision.runId,
          iteration: decision.iteration,
          executor: decision.executor,
          provider: decision.provider,
          model: decision.model,
          kind: decision.kind
        });
        continue;
      }
      this.store.updateDecision(decision.requestId, {
        status: "STALE_RECOVERABLE",
        reason: "Admission lease was not confirmed after controller restart; execution strategy must reconcile it.",
        resolvedAt: new Date().toISOString()
      });
      const next = this.store.getDecision(decision.requestId);
      if (next) recovered.push(next);
    }
    return recovered;
  }

  listDecisions(limit = 200): SchedulerDecision[] { return this.store.listDecisions(limit); }

  private admitQueued(): void {
    for (const [requestId, request] of this.queued) {
      const policy = this.getPolicy();
      const blockedBy = policy.enabled ? this.firstLimit(request) : null;
      if (blockedBy) continue;
      this.active.set(requestId, request);
      this.queued.delete(requestId);
      const current = this.store.getDecision(requestId);
      this.store.updateDecision(requestId, {
        status: "ADMITTED",
        blockedBy: current?.blockedBy ?? null,
        reason: current?.blockedBy
          ? `Admitted after the explicit scheduler limit ${current.blockedBy} became available.`
          : "Admitted after the explicit scheduler limit became available.",
        runnableAt: new Date().toISOString()
      });
    }
  }

  private firstLimit(request: SchedulerAdmissionRequest): SchedulerLimitDimension | null {
    const policy = this.getPolicy();
    const active = [...this.active.values()];
    if (policy.totalActiveInferenceSessions !== null && active.length >= policy.totalActiveInferenceSessions) return "TOTAL_ACTIVE_INFERENCE_SESSIONS";
    if (policy.perProviderConcurrency !== null && request.provider && active.filter((item) => item.provider === request.provider).length >= policy.perProviderConcurrency) return "PER_PROVIDER_CONCURRENCY";
    if (policy.perModelConcurrency !== null && active.filter((item) => item.model === request.model).length >= policy.perModelConcurrency) return "PER_MODEL_CONCURRENCY";
    if (policy.perRepositorySubagentConcurrency !== null && request.kind === "SUBAGENT" && active.filter((item) => item.repositoryId === request.repositoryId && item.kind === "SUBAGENT").length >= policy.perRepositorySubagentConcurrency) return "PER_REPOSITORY_SUBAGENT_CONCURRENCY";
    if (policy.machineCpuPercent !== null && (request.requestedCpuPercent ?? 0) > policy.machineCpuPercent) return "MACHINE_CPU_PERCENT";
    if (policy.machineMemoryMb !== null && (request.requestedMemoryMb ?? 0) > policy.machineMemoryMb) return "MACHINE_MEMORY_MB";
    if (policy.campaignTokenBudget !== null && (request.requestedTokens ?? 0) > policy.campaignTokenBudget) return "CAMPAIGN_TOKEN_BUDGET";
    if (policy.campaignSpendBudget !== null && (request.requestedSpend ?? 0) > policy.campaignSpendBudget) return "CAMPAIGN_SPEND_BUDGET";
    return null;
  }
}
