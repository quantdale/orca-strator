import type { DatabaseSync } from "node:sqlite";
import type { DagNodeRecord, DagNodeStatus, WorkPacket } from "@orca/shared";

interface DagNodeRow {
  strategy_run_id: string;
  node_id: string;
  packet_id: string;
  depends_on_json: string;
  status: DagNodeStatus;
  budget_json: string;
  attempt: number;
  max_retries: number;
  waiting_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  result_id: string | null;
  created_at: string;
  updated_at: string;
}

export class DagNodeStore {
  constructor(private readonly db: DatabaseSync) {}

  create(record: DagNodeRecord): DagNodeRecord {
    this.db.prepare(`
      INSERT INTO execution_dag_nodes (
        strategy_run_id, node_id, packet_id, depends_on_json, status,
        budget_json, attempt, max_retries, waiting_reason, started_at,
        finished_at, result_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.strategyRunId,
      record.nodeId,
      record.packetId,
      JSON.stringify(record.dependsOn),
      record.status,
      JSON.stringify(record.budget),
      record.attempt,
      record.maxRetries,
      record.waitingReason,
      record.startedAt,
      record.finishedAt,
      record.resultId,
      record.createdAt,
      record.updatedAt
    );
    return record;
  }

  get(strategyRunId: string, nodeId: string): DagNodeRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM execution_dag_nodes
      WHERE strategy_run_id = ? AND node_id = ?
    `).get(strategyRunId, nodeId) as unknown as DagNodeRow | undefined;
    return row ? this.map(row) : null;
  }

  getByPacket(strategyRunId: string, packetId: string): DagNodeRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM execution_dag_nodes
      WHERE strategy_run_id = ? AND packet_id = ?
    `).get(strategyRunId, packetId) as unknown as DagNodeRow | undefined;
    return row ? this.map(row) : null;
  }

  list(strategyRunId: string): DagNodeRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM execution_dag_nodes
      WHERE strategy_run_id = ?
      ORDER BY created_at ASC, node_id ASC
    `).all(strategyRunId) as unknown as DagNodeRow[];
    return rows.map((row) => this.map(row));
  }

  listByStatus(strategyRunId: string, statuses: DagNodeStatus[]): DagNodeRecord[] {
    const values = statuses.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM execution_dag_nodes
      WHERE strategy_run_id = ? AND status IN (${values})
      ORDER BY created_at ASC, node_id ASC
    `).all(strategyRunId, ...statuses) as unknown as DagNodeRow[];
    return rows.map((row) => this.map(row));
  }

  update(
    strategyRunId: string,
    nodeId: string,
    patch: Partial<Pick<DagNodeRecord, "status" | "waitingReason" | "startedAt" | "finishedAt" | "resultId" | "attempt" | "maxRetries">>
  ): DagNodeRecord | null {
    const current = this.get(strategyRunId, nodeId);
    if (!current) return null;
    const next: DagNodeRecord = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`
      UPDATE execution_dag_nodes
      SET status = ?, attempt = ?, max_retries = ?, waiting_reason = ?,
          started_at = ?, finished_at = ?, result_id = ?, updated_at = ?
      WHERE strategy_run_id = ? AND node_id = ?
    `).run(
      next.status,
      next.attempt,
      next.maxRetries,
      next.waitingReason,
      next.startedAt,
      next.finishedAt,
      next.resultId,
      next.updatedAt,
      strategyRunId,
      nodeId
    );
    return next;
  }

  private map(row: DagNodeRow): DagNodeRecord {
    return {
      schemaVersion: 1,
      strategyRunId: row.strategy_run_id,
      nodeId: row.node_id,
      packetId: row.packet_id,
      dependsOn: this.parseArray(row.depends_on_json),
      status: row.status,
      budget: this.parseBudget(row.budget_json),
      attempt: row.attempt,
      maxRetries: row.max_retries,
      waitingReason: row.waiting_reason,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      resultId: row.result_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private parseArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  private parseBudget(value: string): WorkPacket["budget"] {
    try {
      return JSON.parse(value) as WorkPacket["budget"];
    } catch {
      return { maxRuntimeMs: 0, maxRetries: 0, maxTokens: null, maxSpend: null };
    }
  }
}
