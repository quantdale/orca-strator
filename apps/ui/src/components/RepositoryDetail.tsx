import React from "react";
import type { RepositoryRecord } from "@orca/shared";

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
