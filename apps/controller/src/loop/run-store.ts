import type { DatabaseSync } from "node:sqlite";
import type { RunRecord, LoopState, DrainReason } from "@orca/shared";
import { preparedStatement } from "../db/statement-cache.js";

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
  drain_reason?: DrainReason | null;
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
      updatedAt: row.updated_at,
      drainReason: (row.drain_reason as DrainReason | null | undefined) ?? null
    };
  }

  create(run: RunRecord): void {
    const hasDrainReason = this.hasColumn("drain_reason");
    const stmt = preparedStatement(this.db, hasDrainReason
      ? `
    INSERT INTO runs (
      id, repository_id, goal, status,
      current_iteration, max_iterations,
      active_dispatch_id, last_error,
      started_at, finished_at, created_at, updated_at, drain_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      : `
    INSERT INTO runs (
      id, repository_id, goal, status,
      current_iteration, max_iterations,
      active_dispatch_id, last_error,
      started_at, finished_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

    if (hasDrainReason) {
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
        run.updatedAt,
        run.drainReason ?? null
      );
    } else {
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
  }

  get(id: string): RunRecord | null {
    // Fix #11: do NOT swallow DB errors — surface them so they aren't misread as IDLE
    const stmt = preparedStatement(this.db, "SELECT * FROM runs WHERE id = ?");
    const row = stmt.get(id) as unknown as RunRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByRepository(repositoryId: string): RunRecord[] {
    const stmt = preparedStatement(this.db, "SELECT * FROM runs WHERE repository_id = ? ORDER BY started_at DESC");
    const rows = stmt.all(repositoryId) as unknown as RunRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getActiveRun(repositoryId: string): RunRecord | null {
    const stmt = preparedStatement(this.db, `
        SELECT * FROM runs
        WHERE repository_id = ?
          AND status NOT IN ('GOAL_COMPLETE', 'BLOCKED', 'NEEDS_HUMAN', 'STOPPED', 'SOL_STALLED', 'EXECUTOR_UNAVAILABLE', 'ATTENTION_REQUIRED', 'RECOVERY_REQUIRED', 'CEILING_REACHED')
        ORDER BY started_at DESC
        LIMIT 1
      `);
    const row = stmt.get(repositoryId) as unknown as RunRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * All currently active runs across every repository (Change 026 lifecycle
   * quiescence reporting). Same terminal-state boundary as getActiveRun.
   */
  listActiveRuns(): RunRecord[] {
    const stmt = preparedStatement(this.db, `
      SELECT * FROM runs
      WHERE status NOT IN ('GOAL_COMPLETE', 'BLOCKED', 'NEEDS_HUMAN', 'STOPPED', 'SOL_STALLED', 'EXECUTOR_UNAVAILABLE', 'ATTENTION_REQUIRED', 'RECOVERY_REQUIRED', 'CEILING_REACHED')
      ORDER BY started_at ASC
    `);
    const rows = stmt.all() as unknown as RunRow[];
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Latest SOL_STALLED run for a repository (Change 024). Never returned by
   * getActiveRun; only onControlDetected's stalled-closure fallback consults it,
   * and only when no active run exists.
   */
  getLatestStalledRun(repositoryId: string): RunRecord | null {
    const stmt = preparedStatement(this.db, `
      SELECT * FROM runs
      WHERE repository_id = ? AND status = 'SOL_STALLED'
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(repositoryId) as unknown as RunRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  /** Most recent run for a repository, regardless of whether it is still active. */
  getLatestRun(repositoryId: string): RunRecord | null {
    const stmt = preparedStatement(this.db, `
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
      drainReason?: DrainReason | null;
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
    const drainReason =
      updates.drainReason !== undefined ? updates.drainReason : existing.drainReason;
    const hasCol = this.hasColumn("drain_reason");

    if (hasCol) {
      const stmt = preparedStatement(this.db, `
      UPDATE runs
      SET status = ?, current_iteration = ?, active_dispatch_id = ?, last_error = ?, finished_at = ?, updated_at = ?, drain_reason = ?
      WHERE id = ?
          `);
      stmt.run(status, currentIteration, activeDispatchId, lastError, finishedAt, now, drainReason, id);
    } else {
      const stmt = preparedStatement(this.db, `
      UPDATE runs
      SET status = ?, current_iteration = ?, active_dispatch_id = ?, last_error = ?, finished_at = ?, updated_at = ?
      WHERE id = ?
          `);
      stmt.run(status, currentIteration, activeDispatchId, lastError, finishedAt, now, id);
    }
  }

  setDrainReason(id: string, reason: DrainReason): void {
    if (!this.hasColumn("drain_reason")) return;
    const now = new Date().toISOString();
    const stmt = preparedStatement(this.db, `UPDATE runs SET drain_reason = ?, updated_at = ? WHERE id = ?`);
    stmt.run(reason, now, id);
  }

  clearDrainReason(id: string): void {
    this.setDrainReason(id, null);
  }

  getDrainReason(id: string): DrainReason {
    const row = this.get(id);
    return (row?.drainReason as DrainReason | null | undefined) ?? null;
  }

  /**
   * Schema capability probe, memoized per instance: migrations complete before
   * any store is constructed, so the column set cannot change under a live
   * store. PRAGMA table_info on every write was measured as this file's most
   * expensive per-call operation (~0.036ms vs ~0.002-0.005ms for cached DML).
   */
  private knownColumns: Set<string> | null = null;

  private hasColumn(col: string): boolean {
    if (!this.knownColumns) {
      try {
        const rows = preparedStatement(this.db, `PRAGMA table_info(runs)`).all() as { name: string }[];
        this.knownColumns = new Set(rows.map((r) => r.name));
      } catch {
        return false;
      }
    }
    return this.knownColumns.has(col);
  }
}
