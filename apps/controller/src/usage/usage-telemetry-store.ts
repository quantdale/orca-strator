import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { UsageMetric, UsageMetricInput, UsageSource, UsageCostStatus } from "@orca/shared";

interface UsageRow {
  id: string;
  repository_id: string;
  run_id: string | null;
  iteration: number | null;
  dispatch_id: string | null;
  executor_run_id: string | null;
  executor: string;
  provider: string | null;
  model: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  request_count: number | null;
  latency_ms: number | null;
  retry_count: number | null;
  rate_limit_events: number | null;
  exact_cost: number | null;
  estimated_cost: number | null;
  currency: string | null;
  cost_status: UsageCostStatus;
  source: UsageSource;
  recorded_at: string;
  notes: string | null;
}

export class UsageTelemetryStore {
  constructor(private readonly db: DatabaseSync) {}

  save(input: UsageMetricInput): UsageMetric {
    const metric: UsageMetric = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      repositoryId: input.repositoryId,
      runId: input.runId ?? null,
      iteration: input.iteration ?? null,
      dispatchId: input.dispatchId ?? null,
      executorRunId: input.executorRunId ?? null,
      executor: input.executor,
      provider: input.provider ?? null,
      model: input.model,
      inputTokens: input.inputTokens ?? null,
      cachedInputTokens: input.cachedInputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      reasoningTokens: input.reasoningTokens ?? null,
      requestCount: input.requestCount ?? null,
      latencyMs: input.latencyMs ?? null,
      retryCount: input.retryCount ?? null,
      rateLimitEvents: input.rateLimitEvents ?? null,
      exactCost: input.exactCost ?? null,
      estimatedCost: input.estimatedCost ?? null,
      currency: input.currency ?? null,
      costStatus: input.costStatus ?? (input.exactCost !== null && input.exactCost !== undefined ? "EXACT" : input.estimatedCost !== null && input.estimatedCost !== undefined ? "ESTIMATED" : "UNKNOWN"),
      source: input.source,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      notes: input.notes ?? null
    };
    this.db.prepare(`
      INSERT INTO usage_metrics (
        id, repository_id, run_id, iteration, dispatch_id, executor_run_id,
        executor, provider, model, input_tokens, cached_input_tokens,
        output_tokens, reasoning_tokens, request_count, latency_ms,
        retry_count, rate_limit_events, exact_cost, estimated_cost, currency,
        cost_status, source, recorded_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metric.id, metric.repositoryId, metric.runId, metric.iteration,
      metric.dispatchId, metric.executorRunId, metric.executor, metric.provider,
      metric.model, metric.inputTokens, metric.cachedInputTokens,
      metric.outputTokens, metric.reasoningTokens, metric.requestCount,
      metric.latencyMs, metric.retryCount, metric.rateLimitEvents,
      metric.exactCost, metric.estimatedCost, metric.currency, metric.costStatus,
      metric.source, metric.recordedAt, metric.notes
    );
    return metric;
  }

  listByRepository(repositoryId: string, limit = 500): UsageMetric[] {
    const rows = this.db.prepare(`
      SELECT * FROM usage_metrics
      WHERE repository_id = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(repositoryId, limit) as unknown as UsageRow[];
    return rows.map((row) => this.map(row));
  }

  listByRun(runId: string): UsageMetric[] {
    const rows = this.db.prepare(`
      SELECT * FROM usage_metrics
      WHERE run_id = ?
      ORDER BY recorded_at ASC
    `).all(runId) as unknown as UsageRow[];
    return rows.map((row) => this.map(row));
  }

  listByIteration(runId: string, iteration: number): UsageMetric[] {
    const rows = this.db.prepare(`
      SELECT * FROM usage_metrics
      WHERE run_id = ? AND iteration = ?
      ORDER BY recorded_at ASC
    `).all(runId, iteration) as unknown as UsageRow[];
    return rows.map((row) => this.map(row));
  }

  private map(row: UsageRow): UsageMetric {
    return {
      schemaVersion: 1,
      id: row.id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      iteration: row.iteration,
      dispatchId: row.dispatch_id,
      executorRunId: row.executor_run_id,
      executor: row.executor,
      provider: row.provider,
      model: row.model,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: row.reasoning_tokens,
      requestCount: row.request_count,
      latencyMs: row.latency_ms,
      retryCount: row.retry_count,
      rateLimitEvents: row.rate_limit_events,
      exactCost: row.exact_cost,
      estimatedCost: row.estimated_cost,
      currency: row.currency,
      costStatus: row.cost_status,
      source: row.source,
      recordedAt: row.recorded_at,
      notes: row.notes
    };
  }
}
