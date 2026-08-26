import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CampaignTraceEvent, TracePhase, TraceStatus } from "@orca/shared";
import { preparedStatement } from "../db/statement-cache.js";

interface TraceRow {
  id: string;
  repository_id: string;
  run_id: string | null;
  iteration: number | null;
  phase: TracePhase;
  event_type: string;
  dispatch_id: string | null;
  result_id: string | null;
  control_id: string | null;
  at: string;
  duration_ms: number | null;
  status: TraceStatus;
  failure_reason: string | null;
  data_json: string;
}

export interface RecordTraceEventInput {
  repositoryId: string;
  runId?: string | null;
  iteration?: number | null;
  phase: TracePhase;
  eventType: string;
  dispatchId?: string | null;
  resultId?: string | null;
  controlId?: string | null;
  at: string;
  durationMs?: number | null;
  status?: TraceStatus;
  failureReason?: string | null;
  data?: Record<string, unknown>;
}

export class CampaignLedgerStore {
  constructor(private readonly db: DatabaseSync) {}

  record(input: RecordTraceEventInput): CampaignTraceEvent {
    const event: CampaignTraceEvent = {
      id: crypto.randomUUID(),
      repositoryId: input.repositoryId,
      runId: input.runId ?? null,
      iteration: input.iteration ?? null,
      phase: input.phase,
      eventType: input.eventType,
      dispatchId: input.dispatchId ?? null,
      resultId: input.resultId ?? null,
      controlId: input.controlId ?? null,
      at: input.at,
      durationMs: input.durationMs ?? null,
      status: input.status ?? "INFO",
      failureReason: input.failureReason ?? null,
      data: input.data ?? {}
    };
    preparedStatement(this.db, `
      INSERT INTO campaign_trace_events (
        id, repository_id, run_id, iteration, phase, event_type,
        dispatch_id, result_id, control_id, at, duration_ms, status,
        failure_reason, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.repositoryId,
      event.runId,
      event.iteration,
      event.phase,
      event.eventType,
      event.dispatchId,
      event.resultId,
      event.controlId,
      event.at,
      event.durationMs,
      event.status,
      event.failureReason,
      JSON.stringify(event.data)
    );
    return event;
  }

  listByRepository(repositoryId: string, limit = 500): CampaignTraceEvent[] {
    const rows = preparedStatement(this.db, `
      SELECT * FROM campaign_trace_events
      WHERE repository_id = ?
      ORDER BY at DESC
      LIMIT ?
    `).all(repositoryId, limit) as unknown as TraceRow[];
    return rows.reverse().map((row) => this.map(row));
  }

  listByRun(runId: string, limit = 2000): CampaignTraceEvent[] {
    const rows = preparedStatement(this.db, `
      SELECT * FROM campaign_trace_events
      WHERE run_id = ?
      ORDER BY at ASC
      LIMIT ?
    `).all(runId, limit) as unknown as TraceRow[];
    return rows.map((row) => this.map(row));
  }

  listByIteration(runId: string, iteration: number): CampaignTraceEvent[] {
    const rows = preparedStatement(this.db, `
      SELECT * FROM campaign_trace_events
      WHERE run_id = ? AND iteration = ?
      ORDER BY at ASC
    `).all(runId, iteration) as unknown as TraceRow[];
    return rows.map((row) => this.map(row));
  }

  countByRun(runId: string): number {
    const row = preparedStatement(this.db, "SELECT COUNT(*) AS count FROM campaign_trace_events WHERE run_id = ?").get(runId) as unknown as { count: number };
    return Number(row?.count ?? 0);
  }

  countIterations(runId: string): number {
    const row = preparedStatement(this.db, "SELECT COUNT(DISTINCT iteration) AS count FROM campaign_trace_events WHERE run_id = ? AND iteration IS NOT NULL").get(runId) as unknown as { count: number };
    return Number(row?.count ?? 0);
  }

  private map(row: TraceRow): CampaignTraceEvent {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.data_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = { parseError: true };
    }
    return {
      id: row.id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      phase: row.phase,
      eventType: row.event_type,
      dispatchId: row.dispatch_id,
      resultId: row.result_id,
      controlId: row.control_id,
      at: row.at,
      durationMs: row.duration_ms,
      status: row.status,
      failureReason: row.failure_reason,
      data
    };
  }
}
