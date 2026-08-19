import React, { useState } from "react";
import type {
  RepositoryRecord,
  CreateRepositoryInput,
  UpdateRepositoryInput,
  ExecutionEnvironment
} from "@orca/shared";
import { DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_RUNTIME_MINUTES } from "@orca/shared";

interface RepositoryFormProps {
  initialValues?: RepositoryRecord;
  onSubmit: (data: CreateRepositoryInput | UpdateRepositoryInput) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
}

export const RepositoryForm: React.FC<RepositoryFormProps> = ({
  initialValues,
  onSubmit,
  onCancel,
  isEditing = false
}) => {
  const [displayName, setDisplayName] = useState(initialValues?.displayName ?? "");
  const [githubRemote, setGithubRemote] = useState(initialValues?.githubRemote ?? "");
  const [localPath, setLocalPath] = useState(initialValues?.localPath ?? "");
  const [environment, setEnvironment] = useState<ExecutionEnvironment>(
    initialValues?.environment ?? "windows"
  );
  const [wslDistribution, setWslDistribution] = useState(
    initialValues?.wslDistribution ?? ""
  );
  const [executorCli, setExecutorCli] = useState(initialValues?.executorCli ?? "codex");
  const [executorModel, setExecutorModel] = useState(
    initialValues?.executorModel ?? "gpt-5.6-luna-xhigh"
  );
  const [solConversationUrl, setSolConversationUrl] = useState(
    initialValues?.solConversationUrl ?? ""
  );
  const [maxIterations, setMaxIterations] = useState(
    initialValues?.maxIterations ?? DEFAULT_MAX_ITERATIONS
  );
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState(
    initialValues?.maxRuntimeMinutes ?? DEFAULT_MAX_RUNTIME_MINUTES
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    const payload: CreateRepositoryInput = {
      displayName: displayName.trim(),
      githubRemote: githubRemote.trim(),
      localPath: localPath.trim(),
      environment,
      wslDistribution: environment === "wsl" ? wslDistribution.trim() : null,
      executorCli: executorCli.trim(),
      executorModel: executorModel.trim(),
      solConversationUrl: solConversationUrl.trim(),
      maxIterations: Number(maxIterations),
      maxRuntimeMinutes: Number(maxRuntimeMinutes)
    };

    try {
      await onSubmit(payload);
    } catch (err: any) {
      if (err.details && Array.isArray(err.details)) {
        const errorMap: Record<string, string> = {};
        for (const detail of err.details) {
          if (detail.field) {
            errorMap[detail.field] = detail.message;
          }
        }
        setFieldErrors(errorMap);
      }
      setGeneralError(err.message || "Failed to save repository configuration.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="repo-form-view">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white sm:text-2xl">
            {isEditing ? `Edit ${initialValues?.displayName}` : "Add New Repository"}
          </h2>
          <p className="text-sm text-slate-400">
            Configure local repository details and orchestration parameters.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>

      {generalError && (
        <div
          className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-4 text-sm text-rose-300"
          data-testid="form-general-error"
        >
          {generalError}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-6"
        data-testid="repository-form"
      >
        {/* Basic info section */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Repository Identity
          </h3>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Display Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. TabDock"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              data-testid="input-displayName"
            />
            {fieldErrors.displayName && (
              <p className="mt-1 text-xs text-rose-400" data-testid="error-displayName">
                {fieldErrors.displayName}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              GitHub Remote URL <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={githubRemote}
              onChange={(e) => setGithubRemote(e.target.value)}
              placeholder="e.g. https://github.com/quantdale/tabdock.git"
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-xs"
              data-testid="input-githubRemote"
            />
            {fieldErrors.githubRemote && (
              <p className="mt-1 text-xs text-rose-400" data-testid="error-githubRemote">
                {fieldErrors.githubRemote}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Local Working Tree Path <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder={
                environment === "wsl"
                  ? "/home/username/projects/tabdock"
                  : "D:\\Projects\\TabDock"
              }
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-xs"
              data-testid="input-localPath"
            />
            {fieldErrors.localPath && (
              <p className="mt-1 text-xs text-rose-400" data-testid="error-localPath">
                {fieldErrors.localPath}
              </p>
            )}
          </div>
        </div>

        {/* Environment section */}
        <div className="border-t border-slate-800 pt-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Execution Environment
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Operating Environment <span className="text-rose-400">*</span>
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as ExecutionEnvironment)}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                data-testid="select-environment"
              >
                <option value="windows">Native Windows</option>
                <option value="wsl">WSL (Windows Subsystem for Linux)</option>
              </select>
            </div>

            {environment === "wsl" && (
              <div>
                <label className="block text-xs font-medium text-slate-300">
                  WSL Distribution Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={wslDistribution}
                  onChange={(e) => setWslDistribution(e.target.value)}
                  placeholder="e.g. Ubuntu-24.04"
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  data-testid="input-wslDistribution"
                />
                {fieldErrors.wslDistribution && (
                  <p className="mt-1 text-xs text-rose-400" data-testid="error-wslDistribution">
                    {fieldErrors.wslDistribution}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Executor & Sol section */}
        <div className="border-t border-slate-800 pt-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Agent & Sol Integration
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Executor CLI <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={executorCli}
                onChange={(e) => setExecutorCli(e.target.value)}
                placeholder="e.g. codex, kimi, sol"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-xs"
                data-testid="input-executorCli"
              />
              {fieldErrors.executorCli && (
                <p className="mt-1 text-xs text-rose-400" data-testid="error-executorCli">
                  {fieldErrors.executorCli}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                Executor Model <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={executorModel}
                onChange={(e) => setExecutorModel(e.target.value)}
                placeholder="e.g. gpt-5.6-luna-xhigh"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-xs"
                data-testid="input-executorModel"
              />
              {fieldErrors.executorModel && (
                <p className="mt-1 text-xs text-rose-400" data-testid="error-executorModel">
                  {fieldErrors.executorModel}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300">
                Sol ChatGPT Conversation URL <span className="text-rose-400">*</span>
              </label>
              <input
                type="url"
                required
                value={solConversationUrl}
                onChange={(e) => setSolConversationUrl(e.target.value)}
                placeholder="e.g. https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono text-xs"
                data-testid="input-solConversationUrl"
              />
              {fieldErrors.solConversationUrl && (
                <p className="mt-1 text-xs text-rose-400" data-testid="error-solConversationUrl">
                  {fieldErrors.solConversationUrl}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Safety ceilings section */}
        <div className="border-t border-slate-800 pt-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Safety Ceilings
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Max Iterations Ceiling <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                data-testid="input-maxIterations"
              />
              {fieldErrors.maxIterations && (
                <p className="mt-1 text-xs text-rose-400" data-testid="error-maxIterations">
                  {fieldErrors.maxIterations}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                Max Runtime Ceiling (Minutes) <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                value={maxRuntimeMinutes}
                onChange={(e) => setMaxRuntimeMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                data-testid="input-maxRuntimeMinutes"
              />
              {fieldErrors.maxRuntimeMinutes && (
                <p className="mt-1 text-xs text-rose-400" data-testid="error-maxRuntimeMinutes">
                  {fieldErrors.maxRuntimeMinutes}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
            data-testid="form-cancel-button"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 hover:bg-cyan-500 transition-colors disabled:opacity-50"
            data-testid="form-submit-button"
          >
            {isSubmitting && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <span>{isEditing ? "Save Changes" : "Create Repository"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
