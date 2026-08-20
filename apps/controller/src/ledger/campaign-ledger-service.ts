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

interface DispatchLike { id?: string; runId?: string; iteration?: number; }
interface ControlLike { id?: string; controlId?: string; runId?: string; iteration?: number; relatedDispatchId?: string | null; }

export class CampaignLedgerService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly repositoryStore: RepositoryStore,
    private readonly runStore: RunStore,
    private readonly runPolicyStore: RunPolicyStore,
    private readonly ledgerStore: CampaignLedgerStore
  ) {}

  /** EventBus already redacts secrets before this listener receives the event. */
  recordEvent(event: RepositoryMutationEvent): CampaignTraceEvent | null {
    try {
      const data = event.data ?? {};
      const dispatch = this.asObject(data.dispatch) as DispatchLike | null;
      const control = this.asObject(data.control) as ControlLike | null;
      const eventDispatchId = this.stringValue(data.dispatchId) ??
        (event.type === "executor.log" ? this.stringValue(data.runId) : null) ??
        dispatch?.id ?? control?.relatedDispatchId ?? null;
      const dispatchRow = eventDispatchId
        ? this.db.prepare("SELECT run_id, iteration FROM dispatches WHERE id = ?").get(eventDispatchId) as { run_id?: string; iteration?: number } | undefined
        : undefined;
      const inferredRunId = event.type.startsWith("repository.") ? null : this.runStore.getLatestRun(event.repositoryId)?.id ?? null;
      const runId = this.stringValue(data.runId) ?? dispatch?.runId ?? control?.runId ?? dispatchRow?.run_id ?? inferredRunId;
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
        controlId: this.stringValue(data.controlId) ?? control?.controlId ?? null,
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
    const rows = (table: string) => this.db.prepare(`SELECT * FROM ${table} WHERE run_id = ? ORDER BY created_at ASC`).all(runId) as unknown as Record<string, unknown>[];
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
      effectivePolicy: this.runPolicyStore.get(runId)
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
      latestEventAt: null
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
    return {
      repositoryId: run.repositoryId,
      run,
      eventCount: timeline.length,
      iterationCount: new Set(timeline.map((event) => event.iteration).filter((value): value is number => value !== null)).size,
      durationMs: this.durationBetween(run.startedAt, run.finishedAt ?? (latest?.at ?? null)),
      latestEventAt: latest?.at ?? null,
      latestPhase: latest?.phase ?? null,
      latestFailureReason: latestFailure
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
        latestEventAt: events[events.length - 1]?.at ?? null
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
    if (event.type === "permission.decision") return "PERMISSION";
    if (event.type === "budget.expired") return "BUDGET";
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
