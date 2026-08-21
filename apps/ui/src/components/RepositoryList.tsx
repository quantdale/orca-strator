import React, { useState } from "react";
import type { RepositoryRecord } from "@orca/shared";
import { RepositoryCard } from "./RepositoryCard.js";
import type { ConnectionStatus } from "../lib/events-client.js";
import type { LoopStateView } from "../lib/use-repositories.js";

interface RepositoryListProps {
  repositories: RepositoryRecord[];
  status: ConnectionStatus;
  isLoading: boolean;
  onSelectRepo: (id: string) => void;
  onEditRepo: (id: string) => void;
  onAddRepo: () => void;
  onRetry: () => void;
  /** Live loop-state snapshots by repository id, forwarded to the cards (#spec §4). */
  runStatesByRepo?: Record<string, LoopStateView>;
  /** Overrides the derived event-stream health when provided. */
  eventsConnected?: boolean;
}

export const RepositoryList: React.FC<RepositoryListProps> = ({
  repositories,
  status,
  isLoading,
  onSelectRepo,
  onEditRepo,
  onAddRepo,
  onRetry,
  runStatesByRepo,
  eventsConnected
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const eventsUp = eventsConnected ?? status !== "disconnected";

  const filtered = repositories.filter(
    (repo) =>
      repo.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.localPath.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.githubRemote.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Offline Warning Banner */}
      {status === "disconnected" && (
        <div
          className="flex flex-col gap-2 rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-200 sm:flex-row sm:items-center sm:justify-between"
          data-testid="offline-banner"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span>
              <strong>Controller offline.</strong> Unable to reach the Orca controller through this origin.
            </span>
          </div>
          <button
            onClick={onRetry}
            className="self-start rounded-lg bg-rose-900/60 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-800 transition-colors sm:self-auto"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Header bar: Title and Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white sm:text-2xl">
            Configured Repositories
          </h2>
          <p className="text-sm text-slate-400">
            Local repositories orchestrated by Orca-Strator on branch <code className="text-cyan-400 font-mono">main</code>
          </p>
        </div>

        {repositories.length > 0 && (
          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              data-testid="search-repos-input"
            />
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent mb-3" />
          <p className="text-sm">Connecting to Orca Controller...</p>
        </div>
      )}

      {/* Empty State (when online and no repositories) */}
      {!isLoading && repositories.length === 0 && status !== "disconnected" && (
        <div
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center"
          data-testid="empty-repos-state"
        >
          <div className="mb-4 text-4xl">📂</div>
          <h3 className="text-lg font-semibold text-white">No repositories configured yet</h3>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            Add your first local repository with its GitHub remote, target execution environment, and executor model.
          </p>
          <button
            onClick={onAddRepo}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-cyan-600/20 hover:bg-cyan-500 transition-colors"
            data-testid="add-first-repo-button"
          >
            <span>+</span>
            <span>Add Repository</span>
          </button>
        </div>
      )}

      {/* Filtered empty state */}
      {!isLoading && repositories.length > 0 && filtered.length === 0 && (
        <div className="py-12 text-center text-slate-400">
          <p>No repositories matching &quot;{searchQuery}&quot;.</p>
        </div>
      )}

      {/* Repository Grid */}
      {!isLoading && filtered.length > 0 && (
        <div
          className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3"
          data-testid="repos-grid"
        >
          {filtered.map((repo) => (
            <RepositoryCard
              key={repo.id}
              repository={repo}
              onSelect={onSelectRepo}
              onEdit={onEditRepo}
              runState={runStatesByRepo?.[repo.id]}
              eventsConnected={eventsUp}
            />
          ))}
        </div>
      )}
    </div>
  );
};
