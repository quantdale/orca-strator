import type { DatabaseSync } from "node:sqlite";
import type { ExecutorCapabilitySnapshot, ProbeLevel } from "@orca/shared";

export interface StoredCapabilityProbe {
  id: string;
  repositoryId: string;
  cli: string;
  model: string;
  environment: "windows" | "wsl";
  probeLevel: ProbeLevel;
  overall: string;
  snapshot: ExecutorCapabilitySnapshot;
  probedAt: string;
}

interface CapabilityRow {
  id: string;
  repository_id: string;
  cli: string;
  model: string;
  environment: "windows" | "wsl";
  probe_level: ProbeLevel;
  overall: string;
  snapshot_json: string;
  probed_at: string;
}

export class CapabilityStore {
  constructor(private readonly db: DatabaseSync) {}

  save(probe: StoredCapabilityProbe): void {
    this.db.prepare(`
      INSERT INTO executor_capability_probes (
        id, repository_id, cli, model, environment, probe_level, overall,
        snapshot_json, probed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      probe.id,
      probe.repositoryId,
      probe.cli,
      probe.model,
      probe.environment,
      probe.probeLevel,
      probe.overall,
      JSON.stringify(probe.snapshot),
      probe.probedAt
    );
  }

  latest(repositoryId: string): StoredCapabilityProbe | null {
    const row = this.db.prepare(`
      SELECT * FROM executor_capability_probes
      WHERE repository_id = ?
      ORDER BY probed_at DESC
      LIMIT 1
    `).get(repositoryId) as unknown as CapabilityRow | undefined;
    return row ? this.map(row) : null;
  }

  list(repositoryId: string, limit = 20): StoredCapabilityProbe[] {
    const rows = this.db.prepare(`
      SELECT * FROM executor_capability_probes
      WHERE repository_id = ?
      ORDER BY probed_at DESC
      LIMIT ?
    `).all(repositoryId, limit) as unknown as CapabilityRow[];
    return rows.map((row) => this.map(row));
  }

  markUsageTelemetry(repositoryId: string, readiness: "READY" | "UNKNOWN"): void {
    const latest = this.latest(repositoryId);
    if (!latest) return;
    const snapshot = {
      ...latest.snapshot,
      rich: { ...latest.snapshot.rich, usageTelemetry: readiness }
    };
    this.db.prepare(`
      UPDATE executor_capability_probes
      SET snapshot_json = ?
      WHERE id = ?
    `).run(JSON.stringify(snapshot), latest.id);
  }

  private map(row: CapabilityRow): StoredCapabilityProbe {
    let snapshot: ExecutorCapabilitySnapshot;
    try {
      snapshot = JSON.parse(row.snapshot_json) as ExecutorCapabilitySnapshot;
    } catch {
      snapshot = {
        schemaVersion: 1,
        cli: row.cli,
        profile: "unknown",
        installed: false,
        version: null,
        executablePath: null,
        environment: row.environment,
        wslDistribution: null,
        workingDirectoryAccessible: "UNKNOWN",
        gitAvailable: "UNKNOWN",
        fetchUsable: "UNKNOWN",
        pushUsable: "UNKNOWN",
        remoteMainUsable: "UNKNOWN",
        headlessSupported: "UNKNOWN",
        commandProfileValid: "UNKNOWN",
        resumeSupported: "UNKNOWN",
        cancellationSupported: "UNKNOWN",
        authStatus: "UNKNOWN",
        configuredModel: row.model,
        modelRecognition: "UNKNOWN",
        rich: {
          structuredEvents: "UNKNOWN", sessionResume: "UNKNOWN", subagents: "UNKNOWN",
          permissionApi: "UNKNOWN", nativeCancellation: "UNKNOWN", sessionHistory: "UNKNOWN",
          usageTelemetry: "UNKNOWN", nativeStatus: "UNKNOWN"
        },
        overall: "UNKNOWN",
        probeLevel: row.probe_level,
        probedAt: row.probed_at,
        issues: [{ class: "UNKNOWN", message: "Stored capability snapshot could not be parsed.", retryable: false }]
      };
    }
    return {
      id: row.id,
      repositoryId: row.repository_id,
      cli: row.cli,
      model: row.model,
      environment: row.environment,
      probeLevel: row.probe_level,
      overall: row.overall,
      snapshot,
      probedAt: row.probed_at
    };
  }
}
