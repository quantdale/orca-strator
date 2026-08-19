import { DatabaseSync } from "node:sqlite";
import type { RepositoryRecord } from "@orca/shared";
import { toRepositoryRecord, type RepositoryRow } from "./repository-mapper.js";

export class RepositoryStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): RepositoryRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM repositories ORDER BY created_at DESC"
    );
    const rows = stmt.all() as unknown as RepositoryRow[];
    return rows.map(toRepositoryRecord);
  }

  get(id: string): RepositoryRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM repositories WHERE id = ?"
    );
    const row = stmt.get(id) as unknown as RepositoryRow | undefined;
    return row ? toRepositoryRecord(row) : null;
  }

  create(record: RepositoryRecord): RepositoryRecord {
    const stmt = this.db.prepare(`
      INSERT INTO repositories (
        id,
        display_name,
        github_remote,
        local_path,
        environment,
        wsl_distribution,
        executor_cli,
        executor_model,
        sol_conversation_url,
        max_iterations,
        max_runtime_minutes,
        enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.displayName,
      record.githubRemote,
      record.localPath,
      record.environment,
      record.wslDistribution,
      record.executorCli,
      record.executorModel,
      record.solConversationUrl,
      record.maxIterations,
      record.maxRuntimeMinutes,
      record.enabled ? 1 : 0,
      record.createdAt,
      record.updatedAt
    );

    return record;
  }

  update(record: RepositoryRecord): RepositoryRecord {
    const stmt = this.db.prepare(`
      UPDATE repositories SET
        display_name = ?,
        github_remote = ?,
        local_path = ?,
        environment = ?,
        wsl_distribution = ?,
        executor_cli = ?,
        executor_model = ?,
        sol_conversation_url = ?,
        max_iterations = ?,
        max_runtime_minutes = ?,
        enabled = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      record.displayName,
      record.githubRemote,
      record.localPath,
      record.environment,
      record.wslDistribution,
      record.executorCli,
      record.executorModel,
      record.solConversationUrl,
      record.maxIterations,
      record.maxRuntimeMinutes,
      record.enabled ? 1 : 0,
      record.updatedAt,
      record.id
    );

    return record;
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare(
      "DELETE FROM repositories WHERE id = ?"
    );
    const result = stmt.run(id);
    return Number(result.changes) > 0;
  }
}
