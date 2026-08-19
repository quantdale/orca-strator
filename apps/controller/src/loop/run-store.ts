import type { DatabaseSync } from "node:sqlite";
import type { RunRecord, LoopState } from "@orca/shared";

interface RunRow {
  id: string;
  repository_id: string;
  goal: string;
  status: LoopState;
  current_iteration: number;
  max_iterations: number;
  active_dispatch_id: string | null;
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export class RunStore {
  constructor(private readonly db: DatabaseSync) {}

  private mapRow(row: RunRow): RunRecord {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      goal: row.goal,
      status: row.status,
      currentIteration: row.current_iteration,
      maxIterations: row.max_iterations,
      activeDispatchId: row.active_dispatch_id,
      lastError: row.last_error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  create(run: RunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (
        id, repository_id, goal, status,
        current_iteration, max_iterations,
        active_dispatch_id, last_error,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.repositoryId,
      run.goal,
      run.status,
      run.currentIteration,
      run.maxIterations,
      run.activeDispatchId ?? null,
      run.lastError ?? null,
      run.startedAt,
      run.finishedAt ?? null,
      run.createdAt,
      run.updatedAt
    );
  }

  get(id: string): RunRecord | null {
    try {
      const stmt = this.db.prepare("SELECT * FROM runs WHERE id = ?");
      const row = stmt.get(id) as unknown as RunRow | undefined;
      return row ? this.mapRow(row) : null;
    } catch {
      return null;
    }
  }

  getByRepository(repositoryId: string): RunRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM runs WHERE repository_id = ? ORDER BY started_at DESC"
    );
    const rows = stmt.all(repositoryId) as unknown as RunRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getActiveRun(repositoryId: string): RunRecord | null {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM runs
        WHERE repository_id = ?
          AND status NOT IN ('GOAL_COMPLETE', 'BLOCKED', 'NEEDS_HUMAN', 'STOPPED', 'SOL_STALLED', 'EXECUTOR_UNAVAILABLE', 'ATTENTION_REQUIRED', 'RECOVERY_REQUIRED', 'CEILING_REACHED')
        ORDER BY started_at DESC
        LIMIT 1
      `);
      const row = stmt.get(repositoryId) as unknown as RunRow | undefined;
      return row ? this.mapRow(row) : null;
    } catch {
      return null;
    }
  }

  /** Most recent run for a repository, regardless of whether it is still active. */
  getLatestRun(repositoryId: string): RunRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM runs
      WHERE repository_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(repositoryId) as unknown as RunRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  updateStatus(
    id: string,
    status: LoopState,
    updates: {
      currentIteration?: number;
      activeDispatchId?: string | null;
      lastError?: string | null;
      finishedAt?: string | null;
    } = {}
  ): void {
    const now = new Date().toISOString();
    const existing = this.get(id);
    if (!existing) return;

    const currentIteration =
      updates.currentIteration !== undefined ? updates.currentIteration : existing.currentIteration;
    const activeDispatchId =
      updates.activeDispatchId !== undefined ? updates.activeDispatchId : existing.activeDispatchId;
    const lastError =
      updates.lastError !== undefined ? updates.lastError : existing.lastError;
    const finishedAt =
      updates.finishedAt !== undefined ? updates.finishedAt : existing.finishedAt;

    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = ?, current_iteration = ?, active_dispatch_id = ?, last_error = ?, finished_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, currentIteration, activeDispatchId, lastError, finishedAt, now, id);
  }
}
