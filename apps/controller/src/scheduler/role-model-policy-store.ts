import type { DatabaseSync } from "node:sqlite";
import type { RoleModelPolicy } from "@orca/shared";

export class RoleModelPolicyStore {
  constructor(private readonly db: DatabaseSync) {}

  save(policy: RoleModelPolicy): RoleModelPolicy {
    this.db.prepare(`
      INSERT INTO role_model_policies (repository_id, policy_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(repository_id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at
    `).run(policy.repositoryId, JSON.stringify(policy), policy.updatedAt);
    return policy;
  }

  get(repositoryId: string): RoleModelPolicy | null {
    const row = this.db.prepare("SELECT policy_json FROM role_model_policies WHERE repository_id = ?").get(repositoryId) as { policy_json?: string } | undefined;
    if (!row?.policy_json) return null;
    try { return JSON.parse(row.policy_json) as RoleModelPolicy; } catch { return null; }
  }
}
