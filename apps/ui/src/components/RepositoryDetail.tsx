import React, { useState, useEffect } from "react";
import type { RepositoryRecord, LoopState } from "@orca/shared";
import { apiClient } from "../lib/api-client.js";

interface RepositoryDetailProps {
  repository: RepositoryRecord;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const RepositoryDetail: React.FC<RepositoryDetailProps> = ({
  repository,
  onBack,
  onEdit,
  onDelete
}) => {
  const [runStatus, setRunStatus] = useState<any>(null);
  const [goalInput, setGoalInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await apiClient.getRunStatus(repository.id);
      setRunStatus(res.status);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, [repository.id]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.startRun(repository.id, goalInput.trim());
      setGoalInput("");
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to start run");
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      await apiClient.pauseRun(repository.id);
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to pause");
    }
  };

  const handleResume = async () => {
    try {
      await apiClient.resumeRun(repository.id);
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to resume");
    }
  };

  const handleStop = async () => {
    try {
      await apiClient.stopRun(repository.id);
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to stop");
    }
  };

  const handleRecover = async (action: "retry" | "stop" | "complete") => {
    try {
      await apiClient.recoverRun(repository.id, action);
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to recover");
    }
  };

  const state: LoopState = runStatus?.state || "IDLE";

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="repo-detail-view">
      {/* Back button and title */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white transition-colors"
            title="Back to list"
            data-testid="back-to-list-button"
          >
            ←
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white sm:text-2xl">
                {repository.displayName}
              </h2>
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                  repository.environment === "wsl"
                    ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                    : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                }`}
              >
                {repository.environment === "wsl"
                  ? `WSL (${repository.wslDistribution})`
                  : "Windows"}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">ID: {repository.id}</p>
          </div>
        </div>

        {/* Top actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onEdit}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors"
            data-testid="detail-edit-button"
          >
            Edit Config
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg bg-rose-950/60 border border-rose-900 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-900/80 transition-colors"
            data-testid="detail-delete-button"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Autonomous Loop Run Card */}
      <div className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-6 space-y-4" data-testid="run-control-card">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">
            Autonomous Execution Loop
          </h3>
          <span
            className="rounded px-2.5 py-1 text-xs font-bold font-mono tracking-wide uppercase bg-slate-800 text-cyan-300"
            data-testid="loop-state-badge"
          >
            {state}
          </span>
        </div>

        {error && (
          <div className="rounded-lg bg-rose-950/50 border border-rose-900 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {state === "IDLE" ? (
          <form onSubmit={handleStart} className="flex flex-col sm:flex-row gap-3 pt-2">
            <input
              type="text"
              placeholder="Enter high-level development goal..."
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              data-testid="start-goal-input"
            />
            <button
              type="submit"
              disabled={loading || !goalInput.trim()}
              className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors"
              data-testid="start-run-button"
            >
              {loading ? "Starting..." : "Start Run"}
            </button>
          </form>
        ) : (
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap gap-4 text-xs text-slate-300">
              <div>
                <span className="text-slate-500">Active Actor: </span>
                <span className="font-semibold text-cyan-400">{runStatus?.activeActor || "NONE"}</span>
              </div>
              <div>
                <span className="text-slate-500">Iteration: </span>
                <span className="font-semibold">{runStatus?.currentIteration || 0} / {runStatus?.maxIterations || repository.maxIterations}</span>
              </div>
              {runStatus?.activeRun?.goal && (
                <div className="w-full">
                  <span className="text-slate-500">Goal: </span>
                  <span className="text-slate-200">{runStatus.activeRun.goal}</span>
                </div>
              )}
            </div>

            {/* Run Controls */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {state === "PAUSED" ? (
                <button
                  onClick={handleResume}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                  data-testid="resume-button"
                >
                  Resume
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors"
                  data-testid="pause-button"
                >
                  Pause
                </button>
              )}

              <button
                onClick={handleStop}
                className="rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 transition-colors"
                data-testid="stop-button"
              >
                Stop
              </button>

              {(state === "RECOVERY_REQUIRED" || state === "BLOCKED" || state === "NEEDS_HUMAN") && (
                <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
                  <button
                    onClick={() => handleRecover("retry")}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                    data-testid="recover-retry-button"
                  >
                    Retry Turn
                  </button>
                  <button
                    onClick={() => handleRecover("complete")}
                    className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
                    data-testid="recover-complete-button"
                  >
                    Mark Complete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Details Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
        {/* Core Git & Filesystem config */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Repository & Path
          </h3>
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">GitHub Remote</dt>
              <dd className="mt-1 text-sm font-mono text-cyan-400 break-all">
                <a
                  href={repository.githubRemote}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {repository.githubRemote} ↗
                </a>
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">Target Branch</dt>
              <dd className="mt-1 text-sm font-mono text-slate-300">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-cyan-400">main</span>
                <span className="ml-2 text-xs text-slate-500">(Automatic invariant)</span>
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Local Working Tree Path</dt>
              <dd className="mt-1 text-sm font-mono text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-slate-800 break-all">
                {repository.localPath}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-t border-slate-800 pt-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Execution & Model Configuration
          </h3>
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Execution Environment</dt>
              <dd className="mt-1 text-sm text-slate-200">
                {repository.environment === "wsl" ? "WSL (Linux)" : "Native Windows"}
                {repository.wslDistribution && (
                  <span className="text-xs text-slate-400 ml-1.5 font-mono">
                    [{repository.wslDistribution}]
                  </span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">Executor CLI & Model</dt>
              <dd className="mt-1 text-sm font-mono text-slate-200">
                <span className="font-semibold text-cyan-400">{repository.executorCli}</span>
                <span className="text-slate-500 mx-1.5">•</span>
                <span>{repository.executorModel}</span>
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Sol Conversation URL</dt>
              <dd className="mt-1 text-sm font-mono text-cyan-400 break-all">
                <a
                  href={repository.solConversationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {repository.solConversationUrl} ↗
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-t border-slate-800 pt-6">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Safety Ceilings
          </h3>
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Maximum Iterations</dt>
              <dd className="mt-1 text-base font-semibold text-slate-200">
                {repository.maxIterations} <span className="text-xs font-normal text-slate-400">iterations</span>
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500">Maximum Runtime</dt>
              <dd className="mt-1 text-base font-semibold text-slate-200">
                {repository.maxRuntimeMinutes} <span className="text-xs font-normal text-slate-400">minutes ({Math.floor(repository.maxRuntimeMinutes / 60)}h {repository.maxRuntimeMinutes % 60}m)</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-t border-slate-800 pt-4 text-xs text-slate-500 flex flex-wrap justify-between gap-2">
          <span>Created: {new Date(repository.createdAt).toLocaleString()}</span>
          <span>Updated: {new Date(repository.updatedAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};
