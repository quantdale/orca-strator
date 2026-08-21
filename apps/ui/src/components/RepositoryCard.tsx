import React from "react";
import type { RepositoryRecord } from "@orca/shared";
import type { LoopStateView } from "../lib/use-repositories.js";
import { isProblemLoopState, loopStateBadgeClasses } from "./loop-state-ui.js";

interface RepositoryCardProps {
  repository: RepositoryRecord;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  /** Live loop-state snapshot for this repository, if one has been seen on the event stream. */
  runState?: LoopStateView;
  /** False while the event stream is down; absent data then means "unknown", not idle. */
  eventsConnected?: boolean;
}

export const RepositoryCard: React.FC<RepositoryCardProps> = ({
  repository,
  onSelect,
  onEdit,
  runState,
  eventsConnected = true
}) => {
  return (
    <div
      className="group relative flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-md transition-all hover:border-cyan-500/50 hover:shadow-cyan-500/5"
      data-testid={`repo-card-${repository.id}`}
    >
      <div>
        {/* Top bar: Title and Environment */}
        <div className="flex items-start justify-between gap-3">
          <h3
            onClick={() => onSelect(repository.id)}
            className="cursor-pointer font-semibold text-white hover:text-cyan-400 transition-colors text-base sm:text-lg"
          >
            {repository.displayName}
          </h3>
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

        {/* Local Path */}
        <p className="mt-2 text-xs text-slate-400 font-mono truncate" title={repository.localPath}>
          📁 {repository.localPath}
        </p>

        {/* Remote */}
        <p className="mt-1 text-xs text-slate-400 truncate" title={repository.githubRemote}>
          🔗 {repository.githubRemote}
        </p>

        {/* Live run state (#spec §4) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {runState ? (
            <>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium font-mono ${loopStateBadgeClasses(runState.state)}`}
                title={runState.reason}
                data-testid={`run-state-${repository.id}`}
              >
                {isProblemLoopState(runState.state) && (
                  <span aria-hidden="true">⚠️</span>
                )}
                {runState.state}
              </span>
              {typeof runState.iteration === "number" && (
                <span className="rounded bg-slate-800 px-2 py-1 text-xs font-mono text-slate-300">
                  Iter {runState.iteration} / {repository.maxIterations}
                </span>
              )}
            </>
          ) : !eventsConnected ? (
            <span
              className="inline-flex items-center rounded-md border border-slate-800 bg-slate-800/50 px-2 py-0.5 text-xs font-medium italic text-slate-500"
              data-testid={`run-state-unavailable-${repository.id}`}
            >
              No live data
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded-md border border-slate-800 bg-slate-800 px-2 py-0.5 text-xs font-medium font-mono text-slate-400"
              data-testid={`run-state-${repository.id}`}
            >
              IDLE
            </span>
          )}
        </div>

        {/* Details snippet */}
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-slate-800 px-2 py-1 text-slate-300 font-mono">
            {repository.executorCli} • {repository.executorModel}
          </span>
          <span className="rounded bg-slate-800/80 px-2 py-1 text-slate-400">
            {repository.maxIterations} iter / {repository.maxRuntimeMinutes}m
          </span>
          <span className="rounded bg-slate-800/50 px-2 py-1 text-slate-500">
            main
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs">
        <a
          href={repository.solConversationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          Open Sol Chat ↗
        </a>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(repository.id)}
            className="rounded px-2.5 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
            data-testid={`edit-button-${repository.id}`}
          >
            Edit
          </button>
          <button
            onClick={() => onSelect(repository.id)}
            className="rounded bg-slate-800 px-3 py-1 font-medium text-slate-200 hover:bg-slate-700 transition-colors"
            data-testid={`view-button-${repository.id}`}
          >
            View
          </button>
        </div>
      </div>
    </div>
  );
};
