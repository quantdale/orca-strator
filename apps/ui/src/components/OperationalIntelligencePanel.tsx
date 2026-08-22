import React, { useCallback, useEffect, useState } from "react";
import type { CampaignDetail, CampaignSummary, ExecutorCapabilitySnapshot, PhaseBudgetPolicy, AutonomyPermissionPolicy, PermissionDecision, SchedulerDecision, SchedulerPolicy, RoleModelPolicy, UsageSummary } from "@orca/shared";
import { apiClient } from "../lib/api-client.js";
import { ExecutionTopologyPanel } from "./ExecutionTopologyPanel.js";

interface OperationalIntelligencePanelProps {
  repositoryId: string;
}

const badge = (value: string | null | undefined) => value === "READY" || value === "ALLOW" || value === "ORCA_ENFORCED"
  ? "text-emerald-300 bg-emerald-950/50 border-emerald-800"
  : value === "NOT_READY" || value === "DENY"
    ? "text-rose-300 bg-rose-950/50 border-rose-800"
    : "text-amber-300 bg-amber-950/50 border-amber-800";

export const OperationalIntelligencePanel: React.FC<OperationalIntelligencePanelProps> = ({ repositoryId }) => {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [capability, setCapability] = useState<ExecutorCapabilitySnapshot | null>(null);
  const [policy, setPolicy] = useState<PhaseBudgetPolicy | null>(null);
  const [permissionPolicy, setPermissionPolicy] = useState<AutonomyPermissionPolicy | null>(null);
  const [decisions, setDecisions] = useState<PermissionDecision[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [schedulerPolicy, setSchedulerPolicy] = useState<SchedulerPolicy | null>(null);
  const [schedulerDecisions, setSchedulerDecisions] = useState<SchedulerDecision[]>([]);
  const [rolePolicy, setRolePolicy] = useState<RoleModelPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [campaignResult, capabilityResult, policyResult, permissionResult, usageResult, schedulerResult, schedulerDecisionResult, roleResult] = await Promise.all([
        apiClient.listCampaigns(repositoryId),
        apiClient.getExecutorCapabilities(repositoryId),
        apiClient.getPhasePolicy(repositoryId),
        apiClient.getPermissions(repositoryId),
        apiClient.getUsage(repositoryId),
        apiClient.getSchedulerPolicy(),
        apiClient.getSchedulerDecisions(),
        apiClient.getRoleModelPolicy(repositoryId)
      ]);
      setCampaigns(campaignResult.campaigns);
      setCapability(capabilityResult.capability);
      setPolicy(policyResult.policy);
      setPermissionPolicy(permissionResult.policy);
      setDecisions(permissionResult.decisions);
      setUsage(usageResult.summary);
      setSchedulerPolicy(schedulerResult.policy);
      setSchedulerDecisions(schedulerDecisionResult.decisions.filter((decision) => decision.repositoryId === repositoryId));
      setRolePolicy(roleResult.policy);
      const latest = campaignResult.campaigns[0];
      if (latest) {
        const detail = await apiClient.getCampaign(repositoryId, latest.run.id);
        setCampaign(detail.campaign);
      } else {
        setCampaign(null);
      }
    } catch (err: any) {
      setError(err?.message || "Operational intelligence is unavailable");
    }
  }, [repositoryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const testExecutor = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.probeExecutor(repositoryId, "NON_INFERENCE");
      setCapability(result.capability);
    } catch (err: any) {
      setError(err?.message || "Executor probe failed");
    } finally {
      setLoading(false);
    }
  };

  const resolveDecision = async (decisionId: string, outcome: "ALLOW" | "ALLOW_ONCE" | "DENY") => {
    setResolvingId(decisionId);
    setResolveError(null);
    try {
      await apiClient.resolvePermissionDecision(repositoryId, decisionId, outcome);
      await refresh();
    } catch (err: any) {
      setResolveError(err?.message || "Resolving the permission decision failed");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <section className="space-y-4" data-testid="operational-intelligence-panel">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Operational Intelligence</h3>
          <p className="mt-1 text-xs text-slate-500">Durable trace, readiness, effective policy, and permission evidence.</p>
        </div>
        <button
          type="button"
          onClick={testExecutor}
          disabled={loading}
          className="rounded-lg border border-cyan-800 bg-cyan-950/40 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-900/50 disabled:opacity-50"
          data-testid="test-executor-button"
        >
          {loading ? "Testing..." : "Test executor (no inference)"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-xs text-amber-200">{error}</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Executor readiness</h4>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${badge(capability?.overall)}`}>{capability?.overall ?? "NOT_PROBED"}</span>
          </div>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-slate-500">CLI</dt><dd className="max-w-[65%] truncate font-mono text-slate-200">{capability?.cli ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Version</dt><dd className="text-slate-200">{capability?.version ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Working tree</dt><dd className={badge(capability?.workingDirectoryAccessible)}>{capability?.workingDirectoryAccessible ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Git / remote</dt><dd className="text-right text-slate-200">{capability?.gitAvailable ?? "—"} / {capability?.remoteMainUsable ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Auth / model</dt><dd className="text-right text-slate-200">{capability?.authStatus ?? "—"} / {capability?.modelRecognition ?? "—"}</dd></div>
          </dl>
          <p className="mt-3 text-[10px] text-slate-600">Probe: {capability?.probeLevel ?? "not run"} · no implicit model request</p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Effective run policy</h4>
          {policy ? (
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-slate-500">Campaign</dt><dd className="text-slate-200">{policy.campaign.maxIterations} iterations / {policy.campaign.maxRuntimeMinutes} min</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Sol completion</dt><dd className="text-slate-200">{Math.round(policy.sol.completionWaitMs / 60000)} min · {policy.sol.completionRetryCount} retry</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Executor launch</dt><dd className="text-slate-200">{policy.executor.launchAttempts} attempts</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Git command</dt><dd className="text-slate-200">{Math.round(policy.git.commandTimeoutMs / 1000)} sec</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Recovery</dt><dd className="text-slate-200">{policy.recovery.retryCeiling} retries</dd></div>
            </dl>
          ) : <p className="mt-3 text-xs text-slate-500">No campaign policy captured yet.</p>}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Permission policy</h4>
            <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{permissionPolicy?.preset ?? "—"}</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">{decisions.filter((decision) => decision.actionable).length} actionable attention decisions · {decisions.length} recorded</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {decisions.slice(0, 4).map((decision) => <span key={decision.id} className={`rounded border px-1.5 py-0.5 text-[10px] ${badge(decision.outcome)}`}>{decision.action}: {decision.outcome}</span>)}
            {decisions.length === 0 && <span className="text-xs text-slate-600">No decisions recorded.</span>}
          </div>
          {decisions.some((decision) => decision.actionable && !decision.resolvedAt) && (
            <div className="mt-3 space-y-2" data-testid="pending-permission-decisions">
              {decisions.filter((decision) => decision.actionable && !decision.resolvedAt).map((decision) => (
                <div key={decision.id} className="rounded border border-amber-900/70 bg-amber-950/30 p-2">
                  <div className="text-[11px] font-medium text-amber-200">Pending ask · {decision.action} · iteration {decision.iteration ?? "—"}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(["ALLOW", "ALLOW_ONCE", "DENY"] as const).map((outcome) => (
                      <button
                        key={outcome}
                        type="button"
                        disabled={resolvingId === decision.id}
                        onClick={() => void resolveDecision(decision.id, outcome)}
                        data-testid={`resolve-${decision.id}-${outcome}`}
                        className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {resolveError && <p className="mt-2 text-[10px] text-rose-300" data-testid="permission-resolve-error">{resolveError}</p>}
          <p className="mt-3 text-[10px] text-slate-600">Generic CLIs are advisory unless a native permission API is advertised.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Usage telemetry</h4>
          <p className="mt-3 text-xs text-slate-500">Only structured provider/executor values are counted.</p>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex justify-between"><dt className="text-slate-500">Metrics</dt><dd className="text-slate-200">{usage?.metricCount ?? 0} · {usage?.unknownMetricCount ?? 0} unknown</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tokens</dt><dd className="text-slate-200">{usage?.inputTokens === null || usage?.inputTokens === undefined ? "UNKNOWN" : usage.inputTokens} in / {usage?.outputTokens === null || usage?.outputTokens === undefined ? "UNKNOWN" : usage.outputTokens} out</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Cost</dt><dd className="text-right text-slate-200">{usage?.exactCost !== null && usage?.exactCost !== undefined ? `EXACT ${usage.exactCost}` : usage?.estimatedCost !== null && usage?.estimatedCost !== undefined ? `ESTIMATED ${usage.estimatedCost}` : "UNKNOWN"}</dd></div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Scheduler policy</h4>
            <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{schedulerPolicy?.preset ?? "—"}</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">Null limits are unlimited; independent repositories are not globally capped.</p>
          <div className="mt-3 space-y-1.5 text-xs text-slate-300">
            <div>Total sessions: {schedulerPolicy?.totalActiveInferenceSessions ?? "UNLIMITED"}</div>
            <div>Provider/model: {schedulerPolicy?.perProviderConcurrency ?? "UNLIMITED"} / {schedulerPolicy?.perModelConcurrency ?? "UNLIMITED"}</div>
            <div>Decisions: {schedulerDecisions.length} · queued {schedulerDecisions.filter((decision) => decision.status === "QUEUED").length}</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Explicit role/model policy</h4>
          <p className="mt-3 text-xs text-slate-500">No rule means the repository configuration remains primary.</p>
          <div className="mt-3 space-y-1.5 text-xs text-slate-300">
            <div>Primary: repository default</div>
            <div>Explicit roles: {rolePolicy?.rules.length ?? 0}</div>
            {rolePolicy?.rules.slice(0, 3).map((rule) => <div key={rule.role} className="font-mono text-[10px] text-cyan-300">{rule.role} → {rule.executorCli} / {rule.model}</div>)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent campaigns and trace</h4>
          <span className="text-[10px] text-slate-600">{campaigns.length} retained</span>
        </div>
        {campaigns.length === 0 ? <p className="mt-3 text-xs text-slate-500">No campaign history yet.</p> : (
          <div className="mt-3 space-y-3">
            {campaigns.slice(0, 3).map((item) => (
              <div key={item.run.id} className="rounded border border-slate-800/80 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs font-semibold text-slate-200">{item.run.status} · {item.eventCount} events · {item.iterationCount} iterations</span>
                  <span className="font-mono text-[10px] text-slate-600">{item.run.id.slice(0, 12)}</span>
                </div>
                {campaign?.run.id === item.run.id && <div className="mt-2 space-y-1.5">
                  {campaign.timeline.slice(-6).reverse().map((event) => (
                    <div key={event.id} className="flex flex-col gap-0.5 text-[11px] sm:flex-row sm:items-center sm:gap-2">
                      <span className="font-mono text-slate-600">{new Date(event.at).toLocaleTimeString()}</span>
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-cyan-300">{event.phase}</span>
                      <span className="text-slate-400">{event.eventType}</span>
                      {event.durationMs !== null && <span className="text-slate-600">{(event.durationMs / 1000).toFixed(1)}s</span>}
                      {event.failureReason && <span className="text-rose-300">{event.failureReason}</span>}
                    </div>
                  ))}
                </div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <ExecutionTopologyPanel campaign={campaign} />
    </section>
  );
};
