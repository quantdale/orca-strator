import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  IsolatedWorktreeRecord,
  WorkPacket,
  WorkPacketResult,
  WorkPacketStatus,
  WorktreeLifecycleStatus,
  IntegrationReport,
} from "@orca/shared";
import { preparedStatement } from "../db/statement-cache.js";

export class WorkPacketStore {
  constructor(private readonly db: DatabaseSync) {}

  save(packet: WorkPacket, repositoryId: string): WorkPacket {
    preparedStatement(this.db, `
    INSERT INTO work_packets (
      packet_id, repository_id, campaign_id, run_id, iteration,
      parent_dispatch_id, workstream, status, packet_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      .run(
        packet.packetId,
        repositoryId,
        packet.campaignId,
        packet.runId,
        packet.iteration,
        packet.parentDispatchId,
        packet.workstream,
        packet.status,
        JSON.stringify(packet),
        packet.createdAt,
        packet.updatedAt,
      );
    return packet;
  }

  get(packetId: string): WorkPacket | null {
    const row = preparedStatement(this.db, "SELECT packet_json FROM work_packets WHERE packet_id = ?")
      .get(packetId) as { packet_json?: string } | undefined;
    return this.parse<WorkPacket>(row?.packet_json);
  }

  getRepositoryId(packetId: string): string | null {
    const row = preparedStatement(this.db, "SELECT repository_id FROM work_packets WHERE packet_id = ?")
      .get(packetId) as { repository_id?: string } | undefined;
    return row?.repository_id ?? null;
  }

  listByRun(runId: string): WorkPacket[] {
    const rows = preparedStatement(this.db, "SELECT packet_json FROM work_packets WHERE run_id = ? ORDER BY iteration ASC, created_at ASC")
      .all(runId) as { packet_json: string }[];
    return rows
      .map((row) => this.parse<WorkPacket>(row.packet_json))
      .filter((packet): packet is WorkPacket => packet !== null);
  }

  updateStatus(packetId: string, status: WorkPacketStatus): WorkPacket | null {
    const packet = this.get(packetId);
    if (!packet) return null;
    const updated = { ...packet, status, updatedAt: new Date().toISOString() };
    preparedStatement(this.db, "UPDATE work_packets SET status = ?, packet_json = ?, updated_at = ? WHERE packet_id = ?")
      .run(status, JSON.stringify(updated), updated.updatedAt, packetId);
    return updated;
  }

  saveResult(result: WorkPacketResult, repositoryId: string): WorkPacketResult {
    preparedStatement(this.db, `
    INSERT INTO work_packet_results (packet_id, repository_id, run_id, iteration, status, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(packet_id) DO UPDATE SET status = excluded.status, result_json = excluded.result_json, created_at = excluded.created_at
        `)
      .run(
        result.packetId,
        repositoryId,
        result.runId,
        result.iteration,
        result.status,
        JSON.stringify(result),
        result.createdAt,
      );
    return result;
  }

  getResult(packetId: string): WorkPacketResult | null {
    const row = preparedStatement(this.db, "SELECT result_json FROM work_packet_results WHERE packet_id = ?")
      .get(packetId) as { result_json?: string } | undefined;
    return this.parse<WorkPacketResult>(row?.result_json);
  }

  listResults(runId: string): WorkPacketResult[] {
    const rows = preparedStatement(this.db, "SELECT result_json FROM work_packet_results WHERE run_id = ? ORDER BY iteration ASC, created_at ASC")
      .all(runId) as { result_json: string }[];
    return rows
      .map((row) => this.parse<WorkPacketResult>(row.result_json))
      .filter((result): result is WorkPacketResult => result !== null);
  }

  saveWorktree(record: IsolatedWorktreeRecord): IsolatedWorktreeRecord {
    preparedStatement(this.db, `
    INSERT INTO isolated_worktrees (
      worktree_id, repository_id, packet_id, campaign_id, run_id, iteration,
      path, branch, environment, wsl_distribution, base_sha, dependency_input_shas_json,
      status, created_at, released_at, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      .run(
        record.worktreeId,
        record.repositoryId,
        record.packetId,
        record.campaignId,
        record.runId,
        record.iteration,
        record.path,
        record.branch,
        record.environment,
        record.wslDistribution,
        record.baseSha,
        JSON.stringify(record.dependencyInputShas ?? []),
        record.status,
        record.createdAt,
        record.releasedAt,
        record.lastError,
      );
    return record;
  }

  getWorktree(worktreeId: string): IsolatedWorktreeRecord | null {
    const row = preparedStatement(this.db, "SELECT * FROM isolated_worktrees WHERE worktree_id = ?")
      .get(worktreeId) as Record<string, unknown> | undefined;
    return row ? this.mapWorktree(row) : null;
  }

  getWorktreeByPacket(packetId: string): IsolatedWorktreeRecord | null {
    const row = preparedStatement(this.db, "SELECT * FROM isolated_worktrees WHERE packet_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(packetId) as Record<string, unknown> | undefined;
    return row ? this.mapWorktree(row) : null;
  }

  listWorktrees(
    repositoryId: string,
    statuses?: WorktreeLifecycleStatus[],
  ): IsolatedWorktreeRecord[] {
    const rows = preparedStatement(this.db, "SELECT * FROM isolated_worktrees WHERE repository_id = ? ORDER BY created_at DESC")
      .all(repositoryId) as Record<string, unknown>[];
    return rows
      .map((row) => this.mapWorktree(row))
      .filter((record) => !statuses || statuses.includes(record.status));
  }

  updateWorktree(
    worktreeId: string,
    patch: Partial<
      Pick<
        IsolatedWorktreeRecord,
        "status" | "releasedAt" | "lastError" | "dependencyInputShas"
      >
    >,
  ): IsolatedWorktreeRecord | null {
    const current = this.getWorktree(worktreeId);
    if (!current) return null;
    const next = { ...current, ...patch };
    preparedStatement(this.db, "UPDATE isolated_worktrees SET status = ?, released_at = ?, last_error = ?, dependency_input_shas_json = ? WHERE worktree_id = ?")
      .run(
        next.status,
        next.releasedAt,
        next.lastError,
        JSON.stringify(next.dependencyInputShas ?? []),
        worktreeId,
      );
    return next;
  }

  saveIntegration(
    report: IntegrationReport,
    repositoryId: string,
  ): IntegrationReport {
    const id = crypto.randomUUID();
    preparedStatement(this.db, `
    INSERT INTO integration_reports (id, repository_id, run_id, iteration, status, report_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
      .run(
        id,
        repositoryId,
        report.runId,
        report.iteration,
        report.status,
        JSON.stringify(report),
        report.createdAt,
      );
    return report;
  }

  listIntegrations(runId: string): IntegrationReport[] {
    const rows = preparedStatement(this.db, "SELECT report_json FROM integration_reports WHERE run_id = ? ORDER BY created_at DESC")
      .all(runId) as { report_json: string }[];
    return rows
      .map((row) => this.parse<IntegrationReport>(row.report_json))
      .filter((report): report is IntegrationReport => report !== null);
  }

  private mapWorktree(row: Record<string, unknown>): IsolatedWorktreeRecord {
    return {
      worktreeId: String(row.worktree_id),
      repositoryId: String(row.repository_id),
      packetId: String(row.packet_id),
      campaignId: String(row.campaign_id),
      runId: String(row.run_id),
      iteration: Number(row.iteration),
      path: String(row.path),
      branch: String(row.branch),
      environment: row.environment as "windows" | "wsl",
      wslDistribution: row.wsl_distribution as string | null,
      baseSha: String(row.base_sha),
      dependencyInputShas: this.parseArray(row.dependency_input_shas_json),
      status: row.status as WorktreeLifecycleStatus,
      createdAt: String(row.created_at),
      releasedAt: row.released_at as string | null,
      lastError: row.last_error as string | null,
    };
  }

  private parse<T>(value: string | undefined): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private parseArray(value: unknown): string[] {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }
}
