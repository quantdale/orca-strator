import type { DatabaseSync } from "node:sqlite";
import type { PhaseBudgetPolicy } from "@orca/shared";
import { preparedStatement } from "../db/statement-cache.js";

export class RunPolicyStore {
  constructor(private readonly db: DatabaseSync) {}

  save(runId: string, policy: PhaseBudgetPolicy, capturedAt = new Date().toISOString()): void {
    preparedStatement(this.db, `
      INSERT INTO run_policies (run_id, policy_json, captured_at)
      VALUES (?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET policy_json = excluded.policy_json, captured_at = excluded.captured_at
    `).run(runId, JSON.stringify(policy), capturedAt);
  }

  get(runId: string): PhaseBudgetPolicy | null {
    const row = preparedStatement(this.db, "SELECT policy_json FROM run_policies WHERE run_id = ?").get(runId) as unknown as { policy_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.policy_json) as PhaseBudgetPolicy;
    } catch {
      return null;
    }
  }
}
