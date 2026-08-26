import { summarizeUsage } from "@orca/shared";
import type {
  CampaignDetail,
  CampaignIterationSummary,
  CampaignSummary,
  CampaignTraceEvent,
  RepositoryMutationEvent,
  TracePhase,
  TraceStatus
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "../loop/run-store.js";
import type { RunPolicyStore } from "../loop/run-policy-store.js";
import type { CampaignLedgerStore } from "./campaign-ledger-store.js";
import type { DatabaseSync } from "node:sqlite";
import type { UsageTelemetryStore } from "../usage/usage-telemetry-store.js";
import type { StrategyRunStore } from "../strategy/strategy-run-store.js";
import type { DagNodeStore } from "../strategy/dag-node-store.js";
import { preparedStatement } from "../db/statement-cache.js";

interface DispatchLike { id?: string; runId?: string; iteration?: number; }
interface ControlLike { id?: string; controlId?: string; runId?: string; iteration?: number; relatedDispatchId?: string | null; }

/**
 * Sentinel persisted into dispatches/sol_controls rows for rejected records
 * that never had a campaign (watcher-service schema-invalid rejections). It is
 * not a durable run ID and must never satisfy the runs FK attribution.
 */
const UNKNOWN_RUN_SENTINEL = "unknown";

export class CampaignLedgerService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly repositoryStore: RepositoryStore,
    private readonly runStore: RunStore,
    private readonly runPolicyStore: RunPolicyStore,
    private readonly ledgerStore: CampaignLedgerStore,
    private readonly usageStore?: UsageTelemetryStore,
    private readonly strategyStore?: StrategyRunStore,
    private readonly dagNodeStore?: DagNodeStore
  ) {}

  /** EventBus already redacts secrets before this listener receives the event. */
  recordEvent(event: RepositoryMutationEvent): CampaignTraceEvent | null {
    try {
      // Scope boundary (documented data model): deleting a repository hard-deletes
      // its row and cascades away its campaign history. The terminal deletion
      // event therefore has no persistable parent in this read-model; it remains
      // fully delivered to WebSocket/UI/log listeners. Recording it here would
      // deterministically violate the repositories FK on every deletion.
      if (event.type === "repository.deleted") return null;

      const data = event.data ?? {};
      const dispatch = this.asObject(data.dispatch) as DispatchLike | null;
      const control = this.asObject(data.control) as ControlLike | null;
      const eventDispatchId = this.stringValue(data.dispatchId) ??
        (event.type === "executor.log" ? this.stringValue(data.runId) : null) ??
        dispatch?.id ?? control?.relatedDispatchId ?? null;
      // control_id carries an FK to sol_controls; strategy-control IDs live in
      // their own table and must stay inside data_json instead of this column.
      const solControlId = event.type === "watcher.control_detected" || event.type === "watcher.control_rejected"
        ? this.stringValue(data.controlId) ?? control?.controlId ?? null
        : null;
      // Attribution joins runs so only DURABLE campaigns are attributed; a
      // dispatch row alone can hold sentinel/pre-run IDs that would violate
      // the campaign_trace_events.run_id foreign key.
      const dispatchRow = eventDispatchId
        ? preparedStatement(this.db, `
            SELECT CASE WHEN r.id IS NULL THEN NULL ELSE d.run_id END AS run_id,
                   d.iteration AS iteration
            FROM dispatches d LEFT JOIN runs r ON r.id = d.run_id
            WHERE d.id = ?
          `).get(eventDispatchId) as { run_id?: string | null; iteration?: number } | undefined
        : undefined;
      // An explicitly carried but non-durable run reference must NOT be
      // silently re-attributed to an unrelated latest run: record truthfully
      // unattributed instead of fabricating correlation.
      const rawExplicitRunRef = this.stringValue(data.runId) ??
        this.stringValue(dispatch?.runId) ??
        this.stringValue(control?.runId) ??
        null;
      const explicitRunRef = rawExplicitRunRef && rawExplicitRunRef !== UNKNOWN_RUN_SENTINEL
        ? rawExplicitRunRef
        : null;
      let runId: string | null = null;
      let explicitReferenceUnresolved = false;
      if (explicitRunRef) {
        runId = this.runStore.get(explicitRunRef) ? explicitRunRef : null;
        explicitReferenceUnresolved = runId === null;
      }
      if (!runId && !explicitReferenceUnresolved) {
        runId = dispatchRow?.run_id ?? null;
      }
      // A dispatch-resolved event whose row has no durable run (sentinel/pre-run
      // rejection records) is likewise attributed to nothing rather than
      // re-attributed to an unrelated campaign.
      const attributionResolved =
        explicitReferenceUnresolved ||
        (runId === null && dispatchRow !== undefined);
      // Lazy fallback: getLatestRun costs a sorted SELECT, and nearly every
      // production event already carries an explicit runId/dispatch/control
      // reference (executor log lines carry dispatchId; loop/strategy events
      // carry runId), so only pay for the lookup when nothing earlier resolved.
      if (!attributionResolved && !runId && !event.type.startsWith("repository.")) {
        runId = this.runStore.getLatestRun(event.repositoryId)?.id ?? null;
      }
      const iteration = this.numberValue(data.iteration) ?? dispatch?.iteration ?? control?.iteration ?? dispatchRow?.iteration ?? null;
      const phase = this.mapPhase(event, data);
      const status = this.mapStatus(event, data);
      const failureReason = this.stringValue(data.failureReason) ?? this.stringValue(data.reason) ?? null;
      return this.ledgerStore.record({
        repositoryId: event.repositoryId,
        runId,
        iteration,
        phase,
        eventType: event.type,
        dispatchId: eventDispatchId,
        resultId: this.stringValue(data.resultId),
        controlId: solControlId,
        at: event.at,
        durationMs: this.numberValue(data.durationMs),
        status,
        failureReason,
        data: { ...data }
      });
    } catch (error) {
      // A telemetry write must not break the production event graph. The event
      // remains available in the normal event/log path for diagnosis.
      console.warn("[CampaignLedger] Failed to persist event:", error);
      return null;
    }
  }

  list(repositoryId: string, limit = 50): CampaignSummary[] {
    const repository = this.repositoryStore.get(repositoryId);
    if (!repository) return [];
    return this.runStore.getByRepository(repositoryId).slice(0, limit).map((run) => this.buildSummary(run.id));
  }

  getDetail(repositoryId: string, runId: string): CampaignDetail | null {
    const repository = this.repositoryStore.get(repositoryId);
    const run = this.runStore.get(runId);
    if (!repository || !run || run.repositoryId !== repositoryId) return null;

    const timeline = this.withPhaseDurations(this.ledgerStore.listByRun(runId), run.finishedAt);
    const summary = this.buildSummary(runId, timeline);
    const iterations = this.buildIterations(timeline);
    const usage = this.usageStore?.listByRun(runId) ?? [];
    const rows = (table: string) => preparedStatement(this.db, `SELECT * FROM ${table} WHERE run_id = ? ORDER BY created_at ASC`).all(runId) as unknown as Record<string, unknown>[];
    const strategyRuns = this.strategyStore?.listByRun(runId) ?? [];
    return {
      repository,
      run,
      summary,
      iterations,
      timeline,
      dispatches: rows("dispatches"),
      executorRuns: rows("executor_runs"),
      wakes: rows("sol_wakes"),
      controls: rows("sol_controls"),
      effectivePolicy: this.runPolicyStore.get(runId),
      usage,
      usageSummary: summarizeUsage(usage),
      strategyRuns,
      dagNodes: this.dagNodeStore
        ? strategyRuns.filter((strategy) => strategy.strategy === "DAG").flatMap((strategy) => this.dagNodeStore!.list(strategy.strategyRunId))
        : []
    };
  }

  getIteration(repositoryId: string, runId: string, iteration: number): CampaignIterationSummary | null {
    const detail = this.getDetail(repositoryId, runId);
    if (!detail) return null;
    return this.buildIterations(detail.timeline).find((item) => item.iteration === iteration) ?? {
      iteration,
      eventCount: 0,
      durationMs: null,
      phases: [],
      status: "INFO",
      latestEventAt: null,
      usageSummary: summarizeUsage([])
    };
  }

  getTimeline(repositoryId: string, runId: string, limit = 1000): CampaignTraceEvent[] {
    const detail = this.getDetail(repositoryId, runId);
    return detail ? detail.timeline.slice(-limit) : [];
  }

  private buildSummary(runId: string, timeline = this.ledgerStore.listByRun(runId)): CampaignSummary {
    const run = this.runStore.get(runId)!;
    const latest = timeline[timeline.length - 1] ?? null;
    const latestFailure = [...timeline].reverse().find((event) => event.failureReason)?.failureReason ?? null;
    const usage = this.usageStore?.listByRun(runId) ?? [];
    return {
      repositoryId: run.repositoryId,
      run,
      eventCount: timeline.length,
      iterationCount: new Set(timeline.map((event) => event.iteration).filter((value): value is number => value !== null)).size,
      durationMs: this.durationBetween(run.startedAt, run.finishedAt ?? (latest?.at ?? null)),
      latestEventAt: latest?.at ?? null,
      latestPhase: latest?.phase ?? null,
      latestFailureReason: latestFailure,
      usageSummary: summarizeUsage(usage)
    };
  }

  private buildIterations(timeline: CampaignTraceEvent[]): CampaignIterationSummary[] {
    const byIteration = new Map<number, CampaignTraceEvent[]>();
    for (const event of timeline) {
      if (event.iteration === null) continue;
      const list = byIteration.get(event.iteration) ?? [];
      list.push(event);
      byIteration.set(event.iteration, list);
    }
    return [...byIteration.entries()].sort(([a], [b]) => a - b).map(([iteration, events]) => {
      const statuses = new Set(events.map((event) => event.status));
      const status: TraceStatus = statuses.has("FAILED") ? "FAILED" : statuses.has("BLOCKED") ? "BLOCKED" : statuses.has("RETRYING") ? "RETRYING" : statuses.has("SUCCEEDED") ? "SUCCEEDED" : "INFO";
      return {
        iteration,
        eventCount: events.length,
        durationMs: this.durationBetween(events[0]?.at ?? null, events[events.length - 1]?.at ?? null),
        phases: [...new Set(events.map((event) => event.phase))],
        status,
        latestEventAt: events[events.length - 1]?.at ?? null,
        usageSummary: summarizeUsage(this.usageStore?.listByIteration(events[0]?.runId ?? "", iteration) ?? [])
      };
    });
  }

  /** Derive contiguous phase spans from durable event timestamps for the read model. */
  private withPhaseDurations(events: CampaignTraceEvent[], finishedAt: string | null): CampaignTraceEvent[] {
    if (events.length === 0) return events;
    const output = events.map((event) => ({ ...event }));
    let segmentStart = 0;
    for (let index = 1; index <= output.length; index++) {
      const previous = output[index - 1]!;
      const phaseChanged = index === output.length || output[index]!.phase !== previous.phase;
      if (!phaseChanged) continue;
      const endAt = index < output.length ? output[index]!.at : (finishedAt ?? previous.at);
      const duration = this.durationBetween(output[segmentStart]!.at, endAt);
      output[segmentStart]!.durationMs = duration;
      segmentStart = index;
    }
    return output;
  }

  private mapPhase(event: RepositoryMutationEvent, data: Record<string, unknown>): TracePhase {
    if (event.type === "watcher.dispatch_detected" || event.type === "watcher.dispatch_rejected") return "DISPATCH";
    if (event.type === "watcher.control_detected") return "CONTROL";
    if (event.type === "watcher.poll_completed") return "DISPATCH";
    if (event.type === "executor.log") return "EXECUTOR_ACTIVITY";
    if (event.type === "executor.started") return "EXECUTOR_LAUNCH";
    if (event.type === "executor.completed") return "RESULT";
    if (event.type === "sol.wake_submitted" || event.type === "sol.wake_busy" || event.type === "sol.wake_retrying") return "SOL_WAKE";
    if (event.type === "sol.wake_failed") return "RECOVERY";
    if (event.type === "sol.operation_completed") return "SOL_REVIEW";
    if (event.type === "executor.capability_probed") return "EXECUTOR_LAUNCH";
    if (event.type === "executor.usage_recorded") return "EXECUTOR_ACTIVITY";
    if (event.type === "permission.decision") return "PERMISSION";
    if (event.type === "strategy.permission_required") return "PERMISSION";
    if (event.type === "budget.expired") return "BUDGET";
    if (event.type === "strategy.control") return "CONTROL";
    if (event.type === "strategy.integration_completed") return "GIT_POSTFLIGHT";
    if (event.type === "strategy.recovery") return "RECOVERY";
    if (event.type === "strategy.worker_started" || event.type === "strategy.worker_completed" || event.type === "strategy.worker_queued") return "EXECUTOR_ACTIVITY";
    if (event.type === "strategy.started") return "EXECUTOR_LAUNCH";
    if (event.type === "strategy.completed") return "RESULT";
    if (event.type === "loop.state_changed") {
      const state = this.stringValue(data.loopState);
      if (state === "SOL_PENDING") return "SOL_WAKE";
      if (state === "SOL_REVIEWING") return "SOL_REVIEW";
      if (state === "EXECUTOR_PENDING") return "EXECUTOR_LAUNCH";
      if (state === "EXECUTING") return "EXECUTOR_ACTIVITY";
      if (["RECOVERY_REQUIRED", "ATTENTION_REQUIRED", "SOL_STALLED"].includes(state ?? "")) return "RECOVERY";
      if (["GOAL_COMPLETE", "BLOCKED", "NEEDS_HUMAN", "STOPPED", "CEILING_REACHED"].includes(state ?? "")) return "CONTROL";
    }
    return "CAMPAIGN";
  }

  private mapStatus(event: RepositoryMutationEvent, data: Record<string, unknown>): TraceStatus {
    if (event.type === "permission.decision") {
      if (data.outcome === "ASK") return "BLOCKED";
      if (data.outcome === "DENY") return "FAILED";
      return "SUCCEEDED";
    }
    if (event.type === "strategy.permission_required") return "BLOCKED";
    if (event.type === "watcher.dispatch_rejected" || data.failureReason || data.reason) return "FAILED";
    if (event.type === "watcher.dispatch_detected" || event.type === "watcher.control_detected") return "SUCCEEDED";
    if (event.type === "executor.started") return "STARTED";
    if (event.type === "executor.completed") {
      if (data.resultStatus === "COMPLETED") return "SUCCEEDED";
      if (data.resultStatus === "BLOCKED" || data.resultStatus === "NEEDS_HUMAN") return "BLOCKED";
      return "FAILED";
    }
    if (event.type === "sol.wake_submitted" || event.type === "sol.operation_completed") return "SUCCEEDED";
    if (event.type === "sol.wake_busy" || event.type === "sol.wake_retrying") return "RETRYING";
    if (event.type === "sol.wake_failed") return "FAILED";
    if (event.type === "budget.expired") return "FAILED";
    if (event.type === "strategy.control") return data.decision === "KILL" ? "FAILED" : "STARTED";
    if (event.type === "strategy.completed") {
      if (["COMPLETED", "PARTIAL"].includes(this.stringValue(data.strategyStatus) ?? "")) return "SUCCEEDED";
      if (["BLOCKED", "RECOVERY_REQUIRED"].includes(this.stringValue(data.strategyStatus) ?? "")) return "BLOCKED";
      return "FAILED";
    }
    if (event.type === "strategy.worker_completed") {
      return data.resultStatus === "COMPLETED" ? "SUCCEEDED" : "FAILED";
    }
    if (event.type === "strategy.worker_queued") return "RETRYING";
    if (event.type === "strategy.integration_completed") {
      return data.integrationStatus === "COMPLETED" || data.integrationStatus === "PARTIAL" ? "SUCCEEDED" : "BLOCKED";
    }
    if (event.type === "strategy.recovery") return "BLOCKED";
    if (event.type === "loop.state_changed" && ["BLOCKED", "NEEDS_HUMAN", "RECOVERY_REQUIRED", "SOL_STALLED", "ATTENTION_REQUIRED"].includes(this.stringValue(data.loopState) ?? "")) return "BLOCKED";
    return event.type === "loop.state_changed" ? "STARTED" : "INFO";
  }

  private durationBetween(start: string | null, end: string | null): number | null {
    if (!start || !end) return null;
    const value = Date.parse(end) - Date.parse(start);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private numberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
