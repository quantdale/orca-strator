import type { DatabaseSync } from "node:sqlite";
import type {
  AutonomyPermissionPolicy,
  PermissionDecision,
  PermissionEnforcement,
  PermissionOutcome,
  PermissionAction,
  PermissionPreset
} from "@orca/shared";

interface PolicyRow { repository_id: string; preset: PermissionPreset; policy_json: string; updated_at: string; }
interface DecisionRow {
  id: string;
  repository_id: string;
  run_id: string | null;
  iteration: number | null;
  action: PermissionAction;
  outcome: PermissionOutcome;
  enforcement: PermissionEnforcement;
  rationale: string;
  actionable: number;
  created_at: string;
  resolved_at: string | null;
}

export class PermissionStore {
  constructor(private readonly db: DatabaseSync) {}

  savePolicy(policy: AutonomyPermissionPolicy): void {
    this.db.prepare(`
      INSERT INTO permission_policies (repository_id, preset, policy_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repository_id) DO UPDATE SET
        preset = excluded.preset, policy_json = excluded.policy_json, updated_at = excluded.updated_at
    `).run(policy.repositoryId, policy.preset, JSON.stringify(policy), policy.updatedAt);
  }

  getPolicy(repositoryId: string): AutonomyPermissionPolicy | null {
    const row = this.db.prepare(
      "SELECT * FROM permission_policies WHERE repository_id = ?"
    ).get(repositoryId) as unknown as PolicyRow | undefined;
    if (!row) return null;
    try { return JSON.parse(row.policy_json) as AutonomyPermissionPolicy; } catch { return null; }
  }

  saveDecision(decision: PermissionDecision): void {
    this.db.prepare(`
      INSERT INTO permission_decisions (
        id, repository_id, run_id, iteration, action, outcome, enforcement,
        rationale, actionable, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.id, decision.repositoryId, decision.runId, decision.iteration,
      decision.action, decision.outcome, decision.enforcement, decision.rationale,
      decision.actionable ? 1 : 0, decision.createdAt, decision.resolvedAt
    );
  }

  listDecisions(repositoryId: string, limit = 100): PermissionDecision[] {
    const rows = this.db.prepare(`
      SELECT * FROM permission_decisions
      WHERE repository_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(repositoryId, limit) as unknown as DecisionRow[];
    return rows.map((row) => ({
      id: row.id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      action: row.action,
      outcome: row.outcome,
      enforcement: row.enforcement,
      rationale: row.rationale,
      actionable: Boolean(row.actionable),
      createdAt: row.created_at,
      resolvedAt: row.resolved_at
    }));
  }
}
