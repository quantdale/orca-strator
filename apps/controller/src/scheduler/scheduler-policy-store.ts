import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_SCHEDULER_POLICY, type SchedulerAdmissionRequest, type SchedulerDecision, type SchedulerPolicy, type SchedulerAdmissionStatus, type SchedulerLimitDimension } from "@orca/shared";
import { preparedStatement } from "../db/statement-cache.js";

interface DecisionRow {
  id: string;
  request_id: string;
  repository_id: string;
  run_id: string | null;
  iteration: number | null;
  executor: string;
  provider: string | null;
  model: string;
  kind: SchedulerAdmissionRequest["kind"];
  status: SchedulerAdmissionStatus;
  blocked_by: SchedulerLimitDimension | null;
  reason: string;
  queued_at: string | null;
  runnable_at: string | null;
  resolved_at: string | null;
  policy_json: string;
  created_at: string;
}

export class SchedulerPolicyStore {
  constructor(private readonly db: DatabaseSync) {}

  getPolicy(): SchedulerPolicy {
    const row = preparedStatement(this.db, "SELECT policy_json FROM scheduler_policies WHERE id = 'default'").get() as { policy_json?: string } | undefined;
    if (!row?.policy_json) {
      const policy = { ...DEFAULT_SCHEDULER_POLICY, updatedAt: new Date().toISOString() };
      return this.savePolicy(policy);
    }
    try { return JSON.parse(row.policy_json) as SchedulerPolicy; } catch { return { ...DEFAULT_SCHEDULER_POLICY, updatedAt: new Date().toISOString() }; }
  }

  savePolicy(policy: SchedulerPolicy): SchedulerPolicy {
    preparedStatement(this.db, `
      INSERT INTO scheduler_policies (id, policy_json, updated_at)
      VALUES ('default', ?, ?)
      ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(policy), policy.updatedAt);
    return policy;
  }

  saveDecision(decision: SchedulerDecision): SchedulerDecision {
    preparedStatement(this.db, `
      INSERT INTO scheduler_decisions (
        id, request_id, repository_id, run_id, iteration, executor, provider,
        model, kind, status, blocked_by, reason, queued_at, runnable_at,
        resolved_at, policy_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.id, decision.requestId, decision.repositoryId, decision.runId,
      decision.iteration, decision.executor, decision.provider, decision.model,
      decision.kind, decision.status, decision.blockedBy, decision.reason,
      decision.queuedAt, decision.runnableAt, decision.resolvedAt,
      JSON.stringify(decision.policySnapshot), decision.createdAt
    );
    return decision;
  }

  updateDecision(requestId: string, patch: Partial<Pick<SchedulerDecision, "status" | "blockedBy" | "reason" | "runnableAt" | "resolvedAt">>): void {
    const current = this.getDecision(requestId);
    if (!current) return;
    const next = { ...current, ...patch };
    preparedStatement(this.db, `
      UPDATE scheduler_decisions
      SET status = ?, blocked_by = ?, reason = ?, runnable_at = ?, resolved_at = ?
      WHERE request_id = ? AND id = ?
    `).run(next.status, next.blockedBy, next.reason, next.runnableAt, next.resolvedAt, requestId, current.id);
  }

  getDecision(requestId: string): SchedulerDecision | null {
    const row = preparedStatement(this.db, "SELECT * FROM scheduler_decisions WHERE request_id = ? ORDER BY created_at DESC LIMIT 1").get(requestId) as unknown as DecisionRow | undefined;
    return row ? this.map(row) : null;
  }

  listDecisions(limit = 200): SchedulerDecision[] {
    const rows = preparedStatement(this.db, "SELECT * FROM scheduler_decisions ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as DecisionRow[];
    return rows.map((row) => this.map(row));
  }

  newDecisionId(): string { return crypto.randomUUID(); }

  private map(row: DecisionRow): SchedulerDecision {
    let policy = DEFAULT_SCHEDULER_POLICY;
    try { policy = JSON.parse(row.policy_json) as SchedulerPolicy; } catch {}
    return {
      id: row.id,
      requestId: row.request_id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      executor: row.executor,
      provider: row.provider,
      model: row.model,
      kind: row.kind,
      status: row.status,
      blockedBy: row.blocked_by,
      reason: row.reason,
      queuedAt: row.queued_at,
      runnableAt: row.runnable_at,
      resolvedAt: row.resolved_at,
      policySnapshot: policy,
      createdAt: row.created_at
    };
  }
}
