import React from "react";
import type {
  CampaignDetail,
  CampaignTraceEvent,
  ExecutionStrategy,
  StrategyExecutionReport,
  StrategyRunRecord,
  WorkPacketResult
} from "@orca/shared";
import { EXECUTION_STRATEGY_PRESETS } from "@orca/shared";

interface TopologyCardModel {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  detail?: string;
  dependencies?: string[];
  metadata: string[];
  durationMs?: number | null;
}

interface ExecutionTopologyPanelProps {
  campaign: CampaignDetail | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const timestamp = (value: unknown): string | null => text(value);

const rowTimestamp = (row: Record<string, unknown> | undefined, ...keys: string[]): string | null => {
  if (!row) return null;
  for (const key of keys) {
    const value = timestamp(row[key]);
    if (value) return value;
  }
  return null;
};

const durationBetween = (startedAt: string | null, finishedAt: string | null): number | null => {
  if (!startedAt || !finishedAt) return null;
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
};

const formatDuration = (durationMs: number | null | undefined): string => {
  if (durationMs === null || durationMs === undefined) return "duration unknown";
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`;
};

const short = (value: string | null): string => value ? value.slice(0, 12) : "unknown";

const statusClass = (status: string): string => {
  const normalized = status.toUpperCase();
  if (/COMPLETED|SUCCEEDED|CONSUMED|READY|GOAL_COMPLETE/.test(normalized)) return "border-emerald-800 bg-emerald-950/40 text-emerald-200";
  if (/FAILED|BLOCKED|CONFLICT|CANCELLED|KILLED|DENY|RECOVERY_REQUIRED|SKIPPED/.test(normalized)) return "border-rose-800 bg-rose-950/40 text-rose-200";
  if (/RUNNING|STARTING|QUEUED|WAITING|RETRYING|PAUSED|STOPPING|INTEGRATING|PENDING|UNKNOWN|PARTIAL/.test(normalized)) return "border-amber-800 bg-amber-950/40 text-amber-200";
  return "border-slate-700 bg-slate-900 text-slate-300";
};

const traceData = (event: CampaignTraceEvent | undefined): Record<string, unknown> => event?.data ?? {};

const latestByTime = (rows: Record<string, unknown>[]): Record<string, unknown> | undefined =>
  [...rows].sort((left, right) => Date.parse(rowTimestamp(right, "created_at", "started_at", "at") ?? "") - Date.parse(rowTimestamp(left, "created_at", "started_at", "at") ?? ""))[0];

const reportOf = (strategy: StrategyRunRecord | undefined): StrategyExecutionReport | null => {
  const report = strategy?.report;
  return report && typeof report === "object" ? report : null;
};

const resultsOf = (report: StrategyExecutionReport | null): WorkPacketResult[] =>
  report && Array.isArray(report.results) ? report.results : [];

const usageLabel = (campaign: CampaignDetail, metricIds: string[] | undefined): string => {
  if (!metricIds || metricIds.length === 0) return "usage UNKNOWN";
  const metrics = campaign.usage.filter((metric) => metricIds.includes(metric.id));
  if (metrics.length === 0) return "usage UNKNOWN";
  const inputKnown = metrics.some((metric) => metric.inputTokens !== null);
  const outputKnown = metrics.some((metric) => metric.outputTokens !== null);
  const input = metrics.reduce((sum, metric) => sum + (metric.inputTokens ?? 0), 0);
  const output = metrics.reduce((sum, metric) => sum + (metric.outputTokens ?? 0), 0);
  const exact = metrics.reduce((sum, metric) => sum + (metric.exactCost ?? 0), 0);
  const estimated = metrics.reduce((sum, metric) => sum + (metric.estimatedCost ?? 0), 0);
  const hasExact = metrics.some((metric) => metric.exactCost !== null);
  const hasEstimated = metrics.some((metric) => metric.estimatedCost !== null);
  const cost = hasExact ? `exact cost ${exact}` : hasEstimated ? `estimated cost ${estimated}` : "cost UNKNOWN";
  return `${inputKnown ? input : "?"} in / ${outputKnown ? output : "?"} out · ${cost}`;
};

const resultMetadata = (campaign: CampaignDetail, result: WorkPacketResult | undefined): string[] => {
  if (!result) return ["result not recorded", "usage UNKNOWN"];
  return [
    result.worktree?.commitSha ? `commit ${short(result.worktree.commitSha)}` : "commit UNKNOWN",
    `${result.filesChanged.length} files · ${result.verification.length} verification entries`,
    usageLabel(campaign, result.usageMetricIds)
  ];
};

const Card: React.FC<{ card: TopologyCardModel }> = ({ card }) => (
  <article className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950/80 p-3" data-testid={`topology-card-${card.id}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h5 className="truncate text-xs font-semibold text-slate-100">{card.title}</h5>
        <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{card.subtitle}</p>
      </div>
      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(card.status)}`}>{card.status}</span>
    </div>
    {card.detail && <p className="mt-2 text-[11px] leading-4 text-slate-400">{card.detail}</p>}
    {card.dependencies && card.dependencies.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-1" data-testid={`topology-dependencies-${card.id}`}>
        <span className="text-[10px] text-slate-600">depends on</span>
        {card.dependencies.map((dependency) => <span key={dependency} className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">{dependency}</span>)}
      </div>
    )}
    <div className="mt-2 space-y-1 text-[10px] text-slate-500">
      <div>{formatDuration(card.durationMs)}</div>
      {card.metadata.map((item) => <div key={item} className="truncate">{item}</div>)}
    </div>
  </article>
);

const Flow: React.FC<{ cards: TopologyCardModel[] }> = ({ cards }) => (
  <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center" data-testid="topology-flow">
    {cards.map((card, index) => (
      <React.Fragment key={card.id}>
        <Card card={card} />
        {index < cards.length - 1 && <span className="hidden shrink-0 text-center text-slate-600 md:block" aria-hidden="true">→</span>}
      </React.Fragment>
    ))}
  </div>
);

function singleAgentCards(campaign: CampaignDetail): TopologyCardModel[] {
  const dispatch = latestByTime(campaign.dispatches);
  const executor = latestByTime(campaign.executorRuns);
  const resultEvent = [...campaign.timeline].reverse().find((event) => event.phase === "RESULT" || event.eventType === "executor.completed");
  const resultData = traceData(resultEvent);
  const dispatchId = text(dispatch?.id) ?? text(resultData.dispatchId);
  const resultId = text(resultData.resultId) ?? text(resultData.resultSha);
  const dispatchStarted = rowTimestamp(dispatch, "created_at", "started_at");
  const dispatchFinished = rowTimestamp(dispatch, "finished_at", "updated_at");
  const executorStarted = rowTimestamp(executor, "started_at", "created_at");
  const executorFinished = rowTimestamp(executor, "finished_at", "updated_at");
  return [
    {
      id: "sol-wake",
      title: "Sol wake",
      subtitle: `iteration ${campaign.run.currentIteration}`,
      status: campaign.run.status === "SOL_REVIEWING" || campaign.run.status === "SOL_PENDING" ? campaign.run.status : "COMPLETED",
      detail: "Sol owns review, replanning, and high-level completion.",
      metadata: [campaign.run.goal],
      durationMs: null
    },
    {
      id: "dispatch",
      title: "Dispatch",
      subtitle: dispatchId ? short(dispatchId) : "not recorded",
      status: text(dispatch?.status) ?? (dispatch ? "RECORDED" : "QUEUED"),
      detail: dispatch ? "Durable main dispatch observed by the repository watcher." : "Waiting for a durable dispatch record.",
      metadata: [dispatchId ? `dispatch ${short(dispatchId)}` : "dispatch UNKNOWN"],
      durationMs: durationBetween(dispatchStarted, dispatchFinished)
    },
    {
      id: "executor",
      title: "Executor",
      subtitle: `${campaign.repository.executorCli} · ${campaign.repository.environment}`,
      status: text(executor?.status) ?? (campaign.run.status === "EXECUTING" ? "RUNNING" : "QUEUED"),
      detail: campaign.repository.executorModel,
      metadata: [executor?.id ? `run ${short(text(executor.id))}` : "executor run UNKNOWN", `model ${campaign.repository.executorModel}`],
      durationMs: durationBetween(executorStarted, executorFinished)
    },
    {
      id: "result",
      title: "Result + Git",
      subtitle: resultId ? short(resultId) : "not recorded",
      status: text(resultData.resultStatus) ?? (resultEvent?.status ?? "QUEUED"),
      detail: text(resultData.summary) ?? (resultEvent ? "Structured result event recorded." : "Waiting for executor result and Git postflight."),
      metadata: [resultId ? `reference ${short(resultId)}` : "result UNKNOWN", resultEvent?.failureReason ? `failure ${resultEvent.failureReason}` : "postflight evidence follows durable Git"],
      durationMs: resultEvent?.durationMs
    },
    {
      id: "sol-review",
      title: "Sol review",
      subtitle: campaign.run.status,
      status: campaign.run.status,
      detail: "Executor/result completion is not GOAL_COMPLETE; Sol decides the next campaign action.",
      metadata: [`campaign ${short(campaign.run.id)}`],
      durationMs: null
    }
  ];
}

function strategyCards(campaign: CampaignDetail, strategy: StrategyRunRecord): { head: TopologyCardModel; workers: TopologyCardModel[]; tail: TopologyCardModel[] } {
  const report = reportOf(strategy);
  const results = resultsOf(report);
  const resultByPacket = new Map(results.map((result) => [result.packetId, result]));
  const dagNodes = campaign.dagNodes.filter((node) => node.strategyRunId === strategy.strategyRunId);
  const packetIds = strategy.strategy === "DAG" && dagNodes.length > 0 ? dagNodes.map((node) => node.packetId) : strategy.packetIds;
  const nodeByPacket = new Map(dagNodes.map((node) => [node.packetId, node]));
  const workerCards = packetIds.map((packetId): TopologyCardModel => {
    const node = nodeByPacket.get(packetId);
    const result = resultByPacket.get(packetId);
    const status = node?.status ?? result?.status ?? (strategy.status === "QUEUED" ? "QUEUED" : strategy.status === "RUNNING" ? "RUNNING" : "UNKNOWN");
    return {
      id: `packet-${packetId}`,
      title: node ? `Node ${node.nodeId}` : "Worker packet",
      subtitle: short(packetId),
      status,
      detail: result?.blocker ?? node?.waitingReason ?? result?.summary ?? (node ? "Durable DAG node awaiting worker evidence." : "Typed packet identity recorded; result not yet available."),
      dependencies: node?.dependsOn,
      metadata: [
        `configured primary ${campaign.repository.executorCli}`,
        `configured model ${campaign.repository.executorModel}`,
        resultMetadata(campaign, result)[0] ?? "commit UNKNOWN",
        ...(resultMetadata(campaign, result).slice(1))
      ],
      durationMs: node ? durationBetween(node.startedAt, node.finishedAt) : result ? durationBetween(result.createdAt, report?.finishedAt ?? null) : null
    };
  });
  const integration = report?.integration;
  const integrationCard: TopologyCardModel = {
    id: "integration",
    title: "Integration",
    subtitle: integration?.finalCommitSha ? short(integration.finalCommitSha) : "main reconciliation",
    status: integration?.status ?? (strategy.status === "RUNNING" ? "INTEGRATING" : "UNKNOWN"),
    detail: integration?.blocker ?? "Worker branches are not iteration completion until reconciliation is durable.",
    metadata: [
      integration?.finalCommitSha ? `main ${short(integration.finalCommitSha)}` : "main commit UNKNOWN",
      integration ? `${integration.integratedPacketIds.length} packets integrated` : "integration result UNKNOWN"
    ],
    durationMs: null
  };
  return {
    head: {
      id: "strategy-dispatch",
      title: "Sol dispatch",
      subtitle: `${strategy.strategy} · ${short(strategy.strategyRunId)}`,
      status: strategy.status,
      detail: "Explicit intra-iteration strategy; results return to Sol for review.",
      metadata: [`bound ${strategy.maxConcurrency}`, `${strategy.packetIds.length} packet${strategy.packetIds.length === 1 ? "" : "s"}`],
      durationMs: durationBetween(strategy.startedAt, strategy.finishedAt)
    },
    workers: workerCards,
    tail: [
      integrationCard,
      {
        id: "strategy-sol-review",
        title: "Sol review",
        subtitle: campaign.run.status,
        status: campaign.run.status,
        detail: "Strategy completion does not mark the high-level campaign complete.",
        metadata: ["next action remains Sol-owned"],
        durationMs: null
      }
    ]
  };
}

export const ExecutionTopologyPanel: React.FC<ExecutionTopologyPanelProps> = ({ campaign }) => {
  const strategy = campaign?.strategyRuns.length
    ? [...campaign.strategyRuns].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0]
    : undefined;
  const strategyMode: ExecutionStrategy = strategy?.strategy ?? "SINGLE_AGENT";
  const presetDefault = EXECUTION_STRATEGY_PRESETS.find((preset) => preset.recommendedStrategy === strategyMode) ?? EXECUTION_STRATEGY_PRESETS[0];

  if (!campaign) {
    return (
      <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-4" data-testid="execution-topology-panel">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Execution topology</h4>
        <p className="mt-3 text-xs text-slate-600">No campaign detail is available yet.</p>
      </section>
    );
  }

  const singleCards = !strategy ? singleAgentCards(campaign) : null;
  const strategyView = strategy ? strategyCards(campaign, strategy) : null;
  return (
    <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4" data-testid="execution-topology-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Execution topology</h4>
            <span className="rounded border border-cyan-800 bg-cyan-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300" data-testid="topology-strategy">{strategyMode}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Actual durable campaign/strategy evidence. This is observability, not graph authoring.</p>
        </div>
        <div className="text-left text-[10px] text-slate-600 sm:text-right">
          <div>campaign {short(campaign.run.id)}</div>
          <div>usage {campaign.usageSummary.metricCount} metrics · {campaign.usageSummary.unknownMetricCount} unknown</div>
        </div>
      </div>

      {!strategy && singleCards && <Flow cards={singleCards} />}
      {strategyView && (
        <>
          <Flow cards={[strategyView.head]} />
          <div className="rounded-lg border border-slate-800/80 bg-slate-900/40 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Actual {strategyMode} workers / nodes</span>
              <span className="text-[10px] text-slate-600">{strategyView.workers.length} recorded</span>
            </div>
            {strategyView.workers.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">{strategyView.workers.map((card) => <Card key={card.id} card={card} />)}</div>
            ) : <p className="p-2 text-xs text-slate-600">No worker/node records are available yet; no workers are inferred.</p>}
          </div>
          <Flow cards={strategyView.tail} />
        </>
      )}

      <details className="rounded-lg border border-slate-800/80 bg-slate-900/30 p-3" data-testid="strategy-presets">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-400">Strategy presets · reference only</summary>
        <p className="mt-2 text-[11px] leading-4 text-slate-500">Presets never auto-start, decompose goals, select a model, or create packets/nodes. Repository + goal with SINGLE_AGENT remains the default.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {EXECUTION_STRATEGY_PRESETS.map((preset) => (
            <div key={preset.id} className={`rounded border p-2 ${preset.id === presetDefault?.id ? "border-cyan-900 bg-cyan-950/20" : "border-slate-800 bg-slate-950/60"}`}>
              <div className="text-[11px] font-semibold text-slate-200">{preset.label}</div>
              <div className="mt-1 text-[10px] text-cyan-300">{preset.recommendedStrategy}</div>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">{preset.summary}</p>
              <div className="mt-1 text-[10px] text-slate-600">{preset.requiresTypedWork ? "typed packets/nodes required" : "single-agent friendly"}</div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
};
