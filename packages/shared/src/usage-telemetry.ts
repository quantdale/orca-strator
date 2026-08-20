import { z } from "zod";

export type UsageSource = "NATIVE_EXECUTOR" | "PROVIDER_RESPONSE" | "STRUCTURED_RESULT" | "UNKNOWN";
export type UsageCostStatus = "EXACT" | "ESTIMATED" | "UNKNOWN";

export interface UsageMetric {
  schemaVersion: 1;
  id: string;
  repositoryId: string;
  runId: string | null;
  iteration: number | null;
  dispatchId: string | null;
  executorRunId: string | null;
  executor: string;
  provider: string | null;
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  requestCount: number | null;
  latencyMs: number | null;
  retryCount: number | null;
  rateLimitEvents: number | null;
  exactCost: number | null;
  estimatedCost: number | null;
  currency: string | null;
  costStatus: UsageCostStatus;
  source: UsageSource;
  recordedAt: string;
  notes: string | null;
}

export interface UsageMetricInput {
  repositoryId: string;
  runId?: string | null;
  iteration?: number | null;
  dispatchId?: string | null;
  executorRunId?: string | null;
  executor: string;
  provider?: string | null;
  model: string;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  requestCount?: number | null;
  latencyMs?: number | null;
  retryCount?: number | null;
  rateLimitEvents?: number | null;
  exactCost?: number | null;
  estimatedCost?: number | null;
  currency?: string | null;
  costStatus?: UsageCostStatus;
  source: UsageSource;
  recordedAt?: string;
  notes?: string | null;
}

export interface UsageSummary {
  metricCount: number;
  knownMetricCount: number;
  unknownMetricCount: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  requestCount: number | null;
  latencyMs: number | null;
  retryCount: number | null;
  rateLimitEvents: number | null;
  exactCost: number | null;
  estimatedCost: number | null;
  currencies: string[];
  providers: string[];
  models: string[];
}

const nullableNonNegative = z.number().finite().nonnegative().nullable().optional();

export const usageMetricInputSchema = z.object({
  repositoryId: z.string().trim().min(1).max(200),
  runId: z.string().trim().max(200).nullable().optional(),
  iteration: z.number().int().positive().nullable().optional(),
  dispatchId: z.string().trim().max(200).nullable().optional(),
  executorRunId: z.string().trim().max(200).nullable().optional(),
  executor: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().min(1).max(300),
  inputTokens: nullableNonNegative,
  cachedInputTokens: nullableNonNegative,
  outputTokens: nullableNonNegative,
  reasoningTokens: nullableNonNegative,
  requestCount: nullableNonNegative,
  latencyMs: nullableNonNegative,
  retryCount: nullableNonNegative,
  rateLimitEvents: nullableNonNegative,
  exactCost: nullableNonNegative,
  estimatedCost: nullableNonNegative,
  currency: z.string().trim().max(20).nullable().optional(),
  costStatus: z.enum(["EXACT", "ESTIMATED", "UNKNOWN"]).optional(),
  source: z.enum(["NATIVE_EXECUTOR", "PROVIDER_RESPONSE", "STRUCTURED_RESULT", "UNKNOWN"]),
  recordedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).nullable().optional()
}).strict().superRefine((value, context) => {
  if (value.exactCost !== null && value.exactCost !== undefined && value.estimatedCost !== null && value.estimatedCost !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["estimatedCost"], message: "exactCost and estimatedCost cannot both be set" });
  }
  const costStatus = value.costStatus ?? (value.exactCost !== null && value.exactCost !== undefined ? "EXACT" : value.estimatedCost !== null && value.estimatedCost !== undefined ? "ESTIMATED" : "UNKNOWN");
  if (costStatus === "EXACT" && value.exactCost === null || costStatus === "EXACT" && value.exactCost === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["exactCost"], message: "EXACT cost requires exactCost" });
  }
  if (costStatus === "ESTIMATED" && value.estimatedCost === null || costStatus === "ESTIMATED" && value.estimatedCost === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["estimatedCost"], message: "ESTIMATED cost requires estimatedCost" });
  }
  if (costStatus === "UNKNOWN" && (value.exactCost !== null && value.exactCost !== undefined || value.estimatedCost !== null && value.estimatedCost !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["costStatus"], message: "UNKNOWN cost cannot carry a numeric cost" });
  }
});

export function summarizeUsage(metrics: UsageMetric[]): UsageSummary {
  const sum = (key: keyof UsageMetric): number | null => {
    const values = metrics.map((metric) => metric[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    metricCount: metrics.length,
    knownMetricCount: metrics.filter((metric) => metric.source !== "UNKNOWN" || metric.costStatus !== "UNKNOWN").length,
    unknownMetricCount: metrics.filter((metric) => metric.source === "UNKNOWN" && metric.costStatus === "UNKNOWN").length,
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    requestCount: sum("requestCount"),
    latencyMs: sum("latencyMs"),
    retryCount: sum("retryCount"),
    rateLimitEvents: sum("rateLimitEvents"),
    exactCost: sum("exactCost"),
    estimatedCost: sum("estimatedCost"),
    currencies: [...new Set(metrics.map((metric) => metric.currency).filter((value): value is string => Boolean(value)))],
    providers: [...new Set(metrics.map((metric) => metric.provider).filter((value): value is string => Boolean(value)))],
    models: [...new Set(metrics.map((metric) => metric.model).filter(Boolean))]
  };
}
