import type { DatabaseSync } from "node:sqlite";
import type { ExecutorRunRecord, ExecutorRunStatus } from "@orca/shared";

interface ExecutorRunRow {
  id: string;
  repository_id: string;
  dispatch_id: string;
  run_id: string;
  iteration: number;
  status: ExecutorRunStatus;
  exit_code: number | null;
  log_path: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ExecutorStore {
  constructor(private readonly db: DatabaseSync) {}

  private mapRow(row: ExecutorRunRow): ExecutorRunRecord {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      dispatchId: row.dispatch_id,
      runId: row.run_id,
      iteration: row.iteration,
      status: row.status,
      exitCode: row.exit_code,
      logPath: row.log_path,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  create(run: ExecutorRunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO executor_runs (
        id, repository_id, dispatch_id, run_id, iteration,
        status, exit_code, log_path, error_message,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.repositoryId,
      run.dispatchId,
      run.runId,
      run.iteration,
      run.status,
      run.exitCode ?? null,
      run.logPath ?? null,
      run.errorMessage ?? null,
      run.startedAt,
      run.finishedAt ?? null,
      run.createdAt,
      run.updatedAt
    );
  }

  get(id: string): ExecutorRunRecord | null {
    const stmt = this.db.prepare("SELECT * FROM executor_runs WHERE id = ?");
    const row = stmt.get(id) as unknown as ExecutorRunRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByRepository(repositoryId: string): ExecutorRunRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM executor_runs WHERE repository_id = ? ORDER BY started_at DESC"
    );
    const rows = stmt.all(repositoryId) as unknown as ExecutorRunRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getByDispatch(dispatchId: string): ExecutorRunRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM executor_runs WHERE dispatch_id = ? ORDER BY started_at DESC"
    );
    const rows = stmt.all(dispatchId) as unknown as ExecutorRunRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getActiveRun(repositoryId: string): ExecutorRunRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM executor_runs WHERE repository_id = ? AND status IN ('pending', 'running') ORDER BY started_at DESC LIMIT 1"
    );
    const row = stmt.get(repositoryId) as unknown as ExecutorRunRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  updateStatus(
    id: string,
    status: ExecutorRunStatus,
    updates: {
      exitCode?: number | null;
      errorMessage?: string | null;
      finishedAt?: string | null;
      logPath?: string | null;
    } = {}
  ): void {
    const now = new Date().toISOString();
    const existing = this.get(id);
    if (!existing) return;

    const exitCode = updates.exitCode !== undefined ? updates.exitCode : existing.exitCode;
    const errorMessage = updates.errorMessage !== undefined ? updates.errorMessage : existing.errorMessage;
    const finishedAt = updates.finishedAt !== undefined ? updates.finishedAt : existing.finishedAt;
    const logPath = updates.logPath !== undefined ? updates.logPath : existing.logPath;

    const stmt = this.db.prepare(`
      UPDATE executor_runs
      SET status = ?, exit_code = ?, error_message = ?, finished_at = ?, log_path = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, exitCode, errorMessage, finishedAt, logPath, now, id);
  }
}
