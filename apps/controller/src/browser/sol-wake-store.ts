import type { DatabaseSync } from "node:sqlite";
import type { SolWakeRecord, SolWakeStatus } from "@orca/shared";

interface SolWakeRow {
  id: string;
  repository_id: string;
  run_id: string;
  dispatch_id: string;
  conversation_url: string;
  message: string;
  status: SolWakeStatus;
  error_message: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SolWakeStore {
  constructor(private readonly db: DatabaseSync) {}

  private mapRow(row: SolWakeRow): SolWakeRecord {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      dispatchId: row.dispatch_id,
      conversationUrl: row.conversation_url,
      message: row.message,
      status: row.status,
      errorMessage: row.error_message,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  create(record: SolWakeRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO sol_wakes (
        id, repository_id, run_id, dispatch_id,
        conversation_url, message, status, error_message,
        submitted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.repositoryId,
      record.runId,
      record.dispatchId,
      record.conversationUrl,
      record.message,
      record.status,
      record.errorMessage ?? null,
      record.submittedAt ?? null,
      record.createdAt,
      record.updatedAt
    );
  }

  get(id: string): SolWakeRecord | null {
    const stmt = this.db.prepare("SELECT * FROM sol_wakes WHERE id = ?");
    const row = stmt.get(id) as unknown as SolWakeRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByRepository(repositoryId: string): SolWakeRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM sol_wakes WHERE repository_id = ? ORDER BY created_at DESC"
    );
    const rows = stmt.all(repositoryId) as unknown as SolWakeRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getByDispatch(dispatchId: string): SolWakeRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM sol_wakes WHERE dispatch_id = ? ORDER BY created_at DESC"
    );
    const rows = stmt.all(dispatchId) as unknown as SolWakeRow[];
    return rows.map((r) => this.mapRow(r));
  }

  updateStatus(
    id: string,
    status: SolWakeStatus,
    updates: {
      errorMessage?: string | null;
      submittedAt?: string | null;
    } = {}
  ): void {
    const now = new Date().toISOString();
    const existing = this.get(id);
    if (!existing) return;

    const errorMessage =
      updates.errorMessage !== undefined ? updates.errorMessage : existing.errorMessage;
    const submittedAt =
      updates.submittedAt !== undefined ? updates.submittedAt : existing.submittedAt;

    const stmt = this.db.prepare(`
      UPDATE sol_wakes
      SET status = ?, error_message = ?, submitted_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, errorMessage, submittedAt, now, id);
  }
}
