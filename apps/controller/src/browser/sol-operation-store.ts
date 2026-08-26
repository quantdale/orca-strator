import type { DatabaseSync } from "node:sqlite";
import type { SolWakeResultStatus } from "@orca/shared";
import { preparedStatement } from "../db/statement-cache.js";

export type SolOperationStatus = "active" | "stalled" | "completed";

/**
 * Canonical, durable representation of one in-flight Sol wake intent for a
 * repository. A repository has at most one active Sol operation at a time
 * (one Sol page / one active Sol turn). Persisting this record lets a
 * controller restart reproduce the EXACT wake intent byte-for-byte and resume
 * the same timeout/busy retry budgets without guessing reconstructed values.
 */
export interface SolOperationRecord {
  repositoryId: string;
  runId: string;
  iteration: number;
  wakeId: string;
  dispatchId: string | null;
  conversationUrl: string;
  repositoryName: string;
  resultStatus: SolWakeResultStatus;
  /** Deterministic wake message; reproducing it reproduces the exact intent. */
  message: string;
  submittedAt: string | null;
  /** Epoch ms; origin of the Sol-wait timeout. Persisted so restart reconstructs deadline. */
  deadline: number;
  /** One-time timeout retry budget — survives restart so controller restarts cannot reset it. */
  timeoutRetryCount: number;
  /** Effective per-run Sol completion wait; retained across timeout/restart. */
  completionWaitMs?: number;
  /** Bounded BUSY backpressure budget — survives restart. */
  busyRetryCount: number;
  status: SolOperationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SolOperationPatch {
  runId?: string;
  iteration?: number;
  wakeId?: string;
  dispatchId?: string | null;
  conversationUrl?: string;
  repositoryName?: string;
  resultStatus?: SolWakeResultStatus;
  message?: string;
  submittedAt?: string | null;
  deadline?: number;
  timeoutRetryCount?: number;
  completionWaitMs?: number;
  busyRetryCount?: number;
  status?: SolOperationStatus;
  updatedAt?: string;
}

export interface SolOperationStore {
  upsert(record: SolOperationRecord): void;
  get(repositoryId: string): SolOperationRecord | null;
  listActive(): SolOperationRecord[];
  update(repositoryId: string, patch: SolOperationPatch): void;
  delete(repositoryId: string): void;
}

interface SolOperationRow {
  repository_id: string;
  run_id: string;
  iteration: number;
  wake_id: string;
  dispatch_id: string | null;
  conversation_url: string;
  repository_name: string;
  result_status: string;
  message: string;
  submitted_at: string | null;
  deadline: number;
  timeout_retry_count: number;
  completion_wait_ms?: number;
  busy_retry_count: number;
  status: SolOperationStatus;
  created_at: string;
  updated_at: string;
}

export class SqliteSolOperationStore implements SolOperationStore {
  constructor(private readonly db: DatabaseSync) {}

  private mapRow(row: SolOperationRow): SolOperationRecord {
    return {
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      wakeId: row.wake_id,
      dispatchId: row.dispatch_id,
      conversationUrl: row.conversation_url,
      repositoryName: row.repository_name,
      resultStatus: row.result_status as SolWakeResultStatus,
      message: row.message,
      submittedAt: row.submitted_at,
      deadline: row.deadline,
      timeoutRetryCount: row.timeout_retry_count,
      completionWaitMs: row.completion_wait_ms ?? undefined,
      busyRetryCount: row.busy_retry_count,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  upsert(record: SolOperationRecord): void {
    const stmt = preparedStatement(this.db, `
      INSERT INTO sol_operations (
        repository_id, run_id, iteration, wake_id, dispatch_id, conversation_url,
        repository_name, result_status, message, submitted_at, deadline,
        timeout_retry_count, completion_wait_ms, busy_retry_count, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(repository_id) DO UPDATE SET
        run_id = excluded.run_id,
        iteration = excluded.iteration,
        wake_id = excluded.wake_id,
        dispatch_id = excluded.dispatch_id,
        conversation_url = excluded.conversation_url,
        repository_name = excluded.repository_name,
        result_status = excluded.result_status,
        message = excluded.message,
        submitted_at = excluded.submitted_at,
        deadline = excluded.deadline,
        timeout_retry_count = excluded.timeout_retry_count,
        completion_wait_ms = excluded.completion_wait_ms,
        busy_retry_count = excluded.busy_retry_count,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      record.repositoryId,
      record.runId,
      record.iteration,
      record.wakeId,
      record.dispatchId ?? null,
      record.conversationUrl,
      record.repositoryName,
      record.resultStatus,
      record.message,
      record.submittedAt ?? null,
      record.deadline,
      record.timeoutRetryCount,
      record.completionWaitMs ?? 20 * 60 * 1000,
      record.busyRetryCount,
      record.status,
      record.createdAt,
      record.updatedAt
    );
  }

  get(repositoryId: string): SolOperationRecord | null {
    const stmt = preparedStatement(this.db, "SELECT * FROM sol_operations WHERE repository_id = ?");
    const row = stmt.get(repositoryId) as unknown as SolOperationRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listActive(): SolOperationRecord[] {
    const stmt = preparedStatement(this.db, "SELECT * FROM sol_operations WHERE status = 'active'");
    const rows = stmt.all() as unknown as SolOperationRow[];
    return rows.map((r) => this.mapRow(r));
  }

  update(repositoryId: string, patch: SolOperationPatch): void {
    const existing = this.get(repositoryId);
    if (!existing) return;
    const merged: SolOperationRecord = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    this.upsert(merged);
  }

  delete(repositoryId: string): void {
    const stmt = preparedStatement(this.db, "DELETE FROM sol_operations WHERE repository_id = ?");
    stmt.run(repositoryId);
  }
}

/** In-memory fallback used by fast tests that do not exercise restart durability. */
export class MemorySolOperationStore implements SolOperationStore {
  private readonly map = new Map<string, SolOperationRecord>();

  upsert(record: SolOperationRecord): void {
    this.map.set(record.repositoryId, record);
  }

  get(repositoryId: string): SolOperationRecord | null {
    return this.map.get(repositoryId) ?? null;
  }

  listActive(): SolOperationRecord[] {
    return [...this.map.values()].filter((r) => r.status === "active");
  }

  update(repositoryId: string, patch: SolOperationPatch): void {
    const existing = this.map.get(repositoryId);
    if (!existing) return;
    this.map.set(repositoryId, {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    });
  }

  delete(repositoryId: string): void {
    this.map.delete(repositoryId);
  }
}
