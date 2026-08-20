import { ValidationError, usageMetricInputSchema, type RepositoryMutationEvent, type UsageMetric, type UsageMetricInput, type UsageSummary, summarizeUsage } from "@orca/shared";
import type { ExecutorAdapter } from "../executor/adapters/executor-adapter.js";
import type { UsageTelemetryStore } from "./usage-telemetry-store.js";

export interface AdapterUsageContext {
  repositoryId: string;
  runId: string;
  iteration: number;
  dispatchId: string;
  executorRunId: string;
  executor: string;
  model: string;
  provider?: string | null;
}

export class UsageTelemetryService {
  constructor(
    private readonly store: UsageTelemetryStore,
    private readonly eventPublisher?: (event: RepositoryMutationEvent) => void,
    private readonly capabilityUsageMarker?: (repositoryId: string) => void
  ) {}

  record(input: UsageMetricInput): UsageMetric {
    const parsed = usageMetricInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("Usage telemetry is invalid or incomplete.", parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })));
    }
    const metric = this.store.save(parsed.data);
    if (metric.source !== "UNKNOWN") this.capabilityUsageMarker?.(metric.repositoryId);
    this.eventPublisher?.({
      type: "executor.usage_recorded",
      at: metric.recordedAt,
      repositoryId: metric.repositoryId,
      data: {
        runId: metric.runId ?? undefined,
        iteration: metric.iteration ?? undefined,
        dispatchId: metric.dispatchId ?? undefined,
        usageId: metric.id,
        executor: metric.executor,
        provider: metric.provider ?? undefined,
        model: metric.model,
        source: metric.source,
        costStatus: metric.costStatus
      }
    });
    return metric;
  }

  async captureAdapterUsage(adapter: ExecutorAdapter, context: AdapterUsageContext): Promise<UsageMetric | null> {
    if (!adapter.usage) return null;
    let raw: Record<string, number | string | null>;
    try {
      raw = await adapter.usage();
    } catch {
      return null;
    }
    const numeric = (key: string): number | null => {
      const value = raw[key];
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    };
    const stringValue = (key: string): string | null => typeof raw[key] === "string" && raw[key] ? raw[key] as string : null;
    const exactCost = numeric("exactCost");
    const estimatedCost = numeric("estimatedCost");
    const hasUsefulValue = [
      "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens",
      "requestCount", "latencyMs", "retryCount", "rateLimitEvents", "exactCost", "estimatedCost"
    ].some((key) => raw[key] !== null && raw[key] !== undefined);
    if (!hasUsefulValue || exactCost !== null && estimatedCost !== null) return null;
    const costStatus = exactCost !== null ? "EXACT" : estimatedCost !== null ? "ESTIMATED" : "UNKNOWN";
    return this.record({
      ...context,
      provider: stringValue("provider") ?? context.provider ?? null,
      inputTokens: numeric("inputTokens"),
      cachedInputTokens: numeric("cachedInputTokens"),
      outputTokens: numeric("outputTokens"),
      reasoningTokens: numeric("reasoningTokens"),
      requestCount: numeric("requestCount"),
      latencyMs: numeric("latencyMs"),
      retryCount: numeric("retryCount"),
      rateLimitEvents: numeric("rateLimitEvents"),
      exactCost,
      estimatedCost,
      currency: stringValue("currency"),
      costStatus,
      source: "NATIVE_EXECUTOR",
      notes: stringValue("notes")
    });
  }

  listByRepository(repositoryId: string, limit = 500): UsageMetric[] {
    return this.store.listByRepository(repositoryId, limit);
  }

  listByRun(runId: string): UsageMetric[] {
    return this.store.listByRun(runId);
  }

  listByIteration(runId: string, iteration: number): UsageMetric[] {
    return this.store.listByIteration(runId, iteration);
  }

  summarize(metrics: UsageMetric[]): UsageSummary {
    return summarizeUsage(metrics);
  }
}
