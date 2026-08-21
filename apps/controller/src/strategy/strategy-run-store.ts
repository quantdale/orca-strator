import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  StrategyControlDecision,
  StrategyControlRecord,
  StrategyControlState,
  StrategyRunRecord,
  StrategyRunStatus,
  StrategyExecutionReport,
} from "@orca/shared";

interface StrategyRunRow {
  strategy_run_id: string;
  repository_id: string;
  campaign_id: string;
  run_id: string;
  iteration: number;
  strategy: StrategyRunRecord["strategy"];
  status: StrategyRunStatus;
  max_concurrency: number;
  packet_ids_json: string;
  control_state: StrategyControlState;
  dispatch_id: string | null;
  strategy_base_sha: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  report_json: string | null;
  created_at: string;
  updated_at: string;
}

interface StrategyControlRow {
  control_id: string;
  strategy_run_id: string;
  repository_id: string;
  run_id: string;
  iteration: number;
  decision: StrategyControlDecision;
  reason: string | null;
  created_at: string;
}

export class StrategyRunStore {
  constructor(private readonly db: DatabaseSync) {}

  create(record: StrategyRunRecord): StrategyRunRecord {
    this.db
      .prepare(`
      INSERT INTO execution_strategy_runs (
        strategy_run_id, repository_id, campaign_id, run_id, iteration,
        strategy, status, max_concurrency, packet_ids_json, control_state,
        dispatch_id, strategy_base_sha,
        started_at, finished_at, last_error, report_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        record.strategyRunId,
        record.repositoryId,
        record.campaignId,
        record.runId,
        record.iteration,
        record.strategy,
        record.status,
        record.maxConcurrency,
        JSON.stringify(record.packetIds),
        record.controlState,
        record.dispatchId ?? null,
        record.strategyBaseSha ?? null,
        record.startedAt,
        record.finishedAt,
        record.lastError,
        record.report ? JSON.stringify(record.report) : null,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  get(strategyRunId: string): StrategyRunRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM execution_strategy_runs WHERE strategy_run_id = ?",
      )
      .get(strategyRunId) as unknown as StrategyRunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  getActiveForRun(runId: string): StrategyRunRecord | null {
    const row = this.db
      .prepare(`
      SELECT * FROM execution_strategy_runs
      WHERE run_id = ? AND status IN ('QUEUED', 'RUNNING', 'PAUSED', 'STOPPING', 'RECOVERY_REQUIRED')
      ORDER BY created_at DESC
      LIMIT 1
    `)
      .get(runId) as unknown as StrategyRunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  listByRun(runId: string): StrategyRunRecord[] {
    const rows = this.db
      .prepare(`
      SELECT * FROM execution_strategy_runs
      WHERE run_id = ?
      ORDER BY iteration ASC, created_at ASC
    `)
      .all(runId) as unknown as StrategyRunRow[];
    return rows.map((row) => this.mapRun(row));
  }

  listRecoverable(): StrategyRunRecord[] {
    const rows = this.db
      .prepare(`
      SELECT * FROM execution_strategy_runs
      WHERE status IN ('QUEUED', 'RUNNING', 'STOPPING')
      ORDER BY created_at ASC
    `)
      .all() as unknown as StrategyRunRow[];
    return rows.map((row) => this.mapRun(row));
  }

  update(
    strategyRunId: string,
    patch: Partial<
      Pick<
        StrategyRunRecord,
        | "status"
        | "controlState"
        | "startedAt"
        | "finishedAt"
        | "lastError"
        | "report"
        | "dispatchId"
        | "strategyBaseSha"
      >
    >,
  ): StrategyRunRecord | null {
    const current = this.get(strategyRunId);
    if (!current) return null;
    const next: StrategyRunRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(`
      UPDATE execution_strategy_runs
      SET status = ?, control_state = ?, started_at = ?, finished_at = ?,
          last_error = ?, report_json = ?, dispatch_id = ?, strategy_base_sha = ?,
          updated_at = ?
      WHERE strategy_run_id = ?
    `)
      .run(
        next.status,
        next.controlState,
        next.startedAt,
        next.finishedAt,
        next.lastError,
        next.report ? JSON.stringify(next.report) : null,
        next.dispatchId ?? null,
        next.strategyBaseSha ?? null,
        next.updatedAt,
        strategyRunId,
      );
    return next;
  }

  createControl(
    input: Omit<StrategyControlRecord, "controlId"> & { controlId?: string },
  ): StrategyControlRecord {
    const record: StrategyControlRecord = {
      ...input,
      controlId: input.controlId ?? crypto.randomUUID(),
    };
    this.db
      .prepare(`
      INSERT INTO execution_strategy_controls (
        control_id, strategy_run_id, repository_id, run_id, iteration,
        decision, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        record.controlId,
        record.strategyRunId,
        record.repositoryId,
        record.runId,
        record.iteration,
        record.decision,
        record.reason,
        record.createdAt,
      );
    return record;
  }

  listControls(strategyRunId: string): StrategyControlRecord[] {
    const rows = this.db
      .prepare(`
      SELECT * FROM execution_strategy_controls
      WHERE strategy_run_id = ?
      ORDER BY created_at ASC
    `)
      .all(strategyRunId) as unknown as StrategyControlRow[];
    return rows.map((row) => ({
      controlId: row.control_id,
      strategyRunId: row.strategy_run_id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      decision: row.decision,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  private mapRun(row: StrategyRunRow): StrategyRunRecord {
    let packetIds: string[] = [];
    let report: StrategyExecutionReport | null = null;
    try {
      const parsed = JSON.parse(row.packet_ids_json);
      if (Array.isArray(parsed))
        packetIds = parsed.filter(
          (value): value is string => typeof value === "string",
        );
    } catch {
      /* corrupt packet ids json is treated as empty */
    }
    try {
      report = row.report_json
        ? (JSON.parse(row.report_json) as StrategyExecutionReport)
        : null;
    } catch {
      /* corrupt report json is treated as null */
    }
    return {
      schemaVersion: 1,
      strategyRunId: row.strategy_run_id,
      repositoryId: row.repository_id,
      campaignId: row.campaign_id,
      runId: row.run_id,
      iteration: row.iteration,
      strategy: row.strategy,
      status: row.status,
      maxConcurrency: row.max_concurrency,
      packetIds,
      controlState: row.control_state,
      dispatchId: row.dispatch_id ?? null,
      strategyBaseSha: row.strategy_base_sha ?? null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastError: row.last_error,
      report,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
