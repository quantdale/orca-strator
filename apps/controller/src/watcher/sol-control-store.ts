import type { DatabaseSync } from "node:sqlite";
import type { SolControlDecision } from "@orca/shared";

export type SolControlStatus = "detected" | "consumed" | "rejected";

export interface SolControlRecord {
  id: string;
  repositoryId: string;
  runId: string;
  controlId: string;
  decision: SolControlDecision;
  iteration: number;
  commitSha: string;
  relatedDispatchId: string | null;
  status: SolControlStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SolControlRow {
  id: string;
  repository_id: string;
  run_id: string;
  control_id: string;
  decision: SolControlDecision;
  iteration: number;
  commit_sha: string;
  related_dispatch_id: string | null;
  status: SolControlStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSolControlInput {
  id: string;
  repositoryId: string;
  runId: string;
  controlId: string;
  decision: SolControlDecision;
  iteration: number;
  commitSha: string;
  relatedDispatchId: string | null;
  status: SolControlStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export class SolControlStore {
  constructor(private readonly db: DatabaseSync) {}

  private mapRow(row: SolControlRow): SolControlRecord {
    return {
      id: row.id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      controlId: row.control_id,
      decision: row.decision,
      iteration: row.iteration,
      commitSha: row.commit_sha,
      relatedDispatchId: row.related_dispatch_id,
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  create(input: CreateSolControlInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO sol_controls (
        id, repository_id, run_id, control_id, decision, iteration,
        commit_sha, related_dispatch_id, status, rejection_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      input.id,
      input.repositoryId,
      input.runId,
      input.controlId,
      input.decision,
      input.iteration,
      input.commitSha,
      input.relatedDispatchId ?? null,
      input.status,
      input.rejectionReason ?? null,
      input.createdAt,
      input.updatedAt
    );
  }

  get(id: string): SolControlRecord | null {
    const stmt = this.db.prepare("SELECT * FROM sol_controls WHERE id = ?");
    const row = stmt.get(id) as unknown as SolControlRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByRepository(repositoryId: string): SolControlRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM sol_controls WHERE repository_id = ? ORDER BY created_at DESC"
    );
    const rows = stmt.all(repositoryId) as unknown as SolControlRow[];
    return rows.map((r) => this.mapRow(r));
  }

  hasControl(id: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM sol_controls WHERE id = ?");
    return Boolean(stmt.get(id));
  }

  updateStatus(id: string, status: SolControlStatus, rejectionReason: string | null = null): void {
    const stmt = this.db.prepare(`
      UPDATE sol_controls
      SET status = ?, rejection_reason = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, rejectionReason ?? null, new Date().toISOString(), id);
  }
}
