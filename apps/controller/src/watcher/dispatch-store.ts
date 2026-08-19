import type { DatabaseSync } from "node:sqlite";
import type { DispatchRecord, DispatchStatus, WatcherState } from "@orca/shared";

interface DispatchRow {
  id: string;
  repository_id: string;
  run_id: string;
  iteration: number;
  commit_sha: string;
  base_sha: string;
  change_path: string;
  goal: string;
  instructions_version: number;
  status: DispatchStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface WatcherStateRow {
  repository_id: string;
  last_observed_sha: string | null;
  last_polled_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export class DispatchStore {
  constructor(private readonly db: DatabaseSync) {}

  private mapDispatchRow(row: DispatchRow): DispatchRecord {
    return {
      id: row.id,
      dispatchId: row.id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      commitSha: row.commit_sha,
      baseSha: row.base_sha,
      changePath: row.change_path,
      goal: row.goal,
      instructionsVersion: row.instructions_version,
      schemaVersion: 1,
      type: "dispatch",
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapWatcherStateRow(row: WatcherStateRow): WatcherState {
    return {
      repositoryId: row.repository_id,
      lastObservedSha: row.last_observed_sha,
      lastPolledAt: row.last_polled_at,
      lastError: row.last_error,
      updatedAt: row.updated_at
    };
  }

  create(dispatch: DispatchRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO dispatches (
        id, repository_id, run_id, iteration, commit_sha, base_sha,
        change_path, goal, instructions_version, status, rejection_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      dispatch.id,
      dispatch.repositoryId,
      dispatch.runId,
      dispatch.iteration,
      dispatch.commitSha,
      dispatch.baseSha,
      dispatch.changePath,
      dispatch.goal,
      dispatch.instructionsVersion,
      dispatch.status,
      dispatch.rejectionReason ?? null,
      dispatch.createdAt,
      dispatch.updatedAt
    );
  }

  get(id: string): DispatchRecord | null {
    const stmt = this.db.prepare("SELECT * FROM dispatches WHERE id = ?");
    const row = stmt.get(id) as unknown as DispatchRow | undefined;
    return row ? this.mapDispatchRow(row) : null;
  }

  getByRepository(repositoryId: string): DispatchRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM dispatches WHERE repository_id = ? ORDER BY iteration DESC, created_at DESC"
    );
    const rows = stmt.all(repositoryId) as unknown as DispatchRow[];
    return rows.map((r) => this.mapDispatchRow(r));
  }

  updateStatus(id: string, status: DispatchStatus, rejectionReason: string | null = null): void {
    const stmt = this.db.prepare(`
      UPDATE dispatches
      SET status = ?, rejection_reason = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, rejectionReason, new Date().toISOString(), id);
  }

  hasDispatch(id: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM dispatches WHERE id = ?");
    const row = stmt.get(id);
    return Boolean(row);
  }

  hasCommit(commitSha: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM dispatches WHERE commit_sha = ?");
    const row = stmt.get(commitSha);
    return Boolean(row);
  }

  getWatcherState(repositoryId: string): WatcherState | null {
    const stmt = this.db.prepare("SELECT * FROM watcher_state WHERE repository_id = ?");
    const row = stmt.get(repositoryId) as unknown as WatcherStateRow | undefined;
    return row ? this.mapWatcherStateRow(row) : null;
  }

  upsertWatcherState(params: {
    repositoryId: string;
    lastObservedSha?: string | null;
    lastPolledAt?: string | null;
    lastError?: string | null;
  }): WatcherState {
    const now = new Date().toISOString();
    const existing = this.getWatcherState(params.repositoryId);

    if (existing) {
      const updatedSha = params.lastObservedSha !== undefined ? params.lastObservedSha : existing.lastObservedSha;
      const updatedPolledAt = params.lastPolledAt !== undefined ? params.lastPolledAt : existing.lastPolledAt;
      const updatedError = params.lastError !== undefined ? params.lastError : existing.lastError;

      const stmt = this.db.prepare(`
        UPDATE watcher_state
        SET last_observed_sha = ?, last_polled_at = ?, last_error = ?, updated_at = ?
        WHERE repository_id = ?
      `);
      stmt.run(updatedSha, updatedPolledAt, updatedError, now, params.repositoryId);

      return {
        repositoryId: params.repositoryId,
        lastObservedSha: updatedSha,
        lastPolledAt: updatedPolledAt,
        lastError: updatedError,
        updatedAt: now
      };
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO watcher_state (
          repository_id, last_observed_sha, last_polled_at, last_error, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      const sha = params.lastObservedSha ?? null;
      const polledAt = params.lastPolledAt ?? null;
      const error = params.lastError ?? null;
      stmt.run(params.repositoryId, sha, polledAt, error, now);

      return {
        repositoryId: params.repositoryId,
        lastObservedSha: sha,
        lastPolledAt: polledAt,
        lastError: error,
        updatedAt: now
      };
    }
  }
}
