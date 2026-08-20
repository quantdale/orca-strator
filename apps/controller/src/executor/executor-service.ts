import path from "node:path";
import crypto from "node:crypto";
import {
  generateBootstrapPrompt,
  isResultFilePath,
  validateExecutorResult,
  type ExecutorResult,
  type ExecutorRunRecord,
  type ExecutorStatusResponse,
  type RepositoryMutationEvent,
  type RepositoryRecord,
  type PhaseBudgetPolicy,
  ValidationError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { GitClient, GitContext } from "../watcher/git-client.js";
import type { ExecutorStore } from "./executor-store.js";
import type { RunPolicyStore } from "../loop/run-policy-store.js";
import type { ExecutorAdapter } from "./adapters/executor-adapter.js";
import { WindowsPowerShellAdapter } from "./adapters/windows-adapter.js";
import { WslAdapter } from "./adapters/wsl-adapter.js";
import { ExecutorRunner } from "./executor-runner.js";
import { buildExecutorInvocation, resolveProfile } from "./profiles.js";
import { toWslPath } from "../wsl-path.js";

export interface ExecutorStartOptions {
  /** Resume an interrupted dispatch; instructs the executor to preserve partial work. */
  recovery?: boolean;
}

export interface ExecutorServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  executorStore: ExecutorStore;
  gitClient?: GitClient;
  dataDir?: string;
  windowsAdapter?: ExecutorAdapter;
  wslAdapter?: ExecutorAdapter;
  /** Separate executor watchdog in ms; 0/disabled by default. Wall-clock ceiling does NOT kill executor. */
  executorWatchdogMs?: number;
  runPolicyStore?: RunPolicyStore;
  /** Production wiring: called when an executor turn finishes (valid result or null). */
  onExecutorCompleted?: (
    repositoryId: string,
    dispatchId: string,
    result: ExecutorResult | null
  ) => void;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

const MAX_LAUNCH_ATTEMPTS = 3;
const LAUNCH_RETRY_BASE_MS = 1500;

export class ExecutorService {
  private readonly repoStore: RepositoryStore;
  private readonly dispatchStore: DispatchStore;
  private readonly executorStore: ExecutorStore;
  private readonly gitClient: GitClient | null;
  private readonly dataDir: string;
  private readonly windowsAdapter: ExecutorAdapter;
  private readonly wslAdapter: ExecutorAdapter;
  private readonly executorWatchdogMs: number;
  private readonly runPolicyStore?: RunPolicyStore;
  private readonly onExecutorCompleted?: (
    repositoryId: string,
    dispatchId: string,
    result: ExecutorResult | null
  ) => void;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  private readonly activeRunners = new Map<string, ExecutorRunner>();

  constructor(options: ExecutorServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore;
    this.executorStore = options.executorStore;
    this.gitClient = options.gitClient ?? null;
    this.dataDir = options.dataDir || path.resolve(".orca-data");
    this.windowsAdapter = options.windowsAdapter || new WindowsPowerShellAdapter();
    this.wslAdapter = options.wslAdapter || new WslAdapter();
    this.executorWatchdogMs = options.executorWatchdogMs ?? 0;
    this.runPolicyStore = options.runPolicyStore;
    this.onExecutorCompleted = options.onExecutorCompleted;
    this.eventPublisher = options.eventPublisher;
  }

  async startRun(
    repositoryId: string,
    dispatchId: string,
    options: ExecutorStartOptions = {}
  ): Promise<ExecutorRunRecord> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) {
      throw new RepositoryNotFoundError(`Repository ${repositoryId} not found`);
    }

    if (this.activeRunners.has(repositoryId)) {
      throw new ValidationError(`Executor is already running for repository ${repositoryId}`);
    }

    const dispatch = this.dispatchStore.get(dispatchId);
    if (!dispatch) {
      throw new ValidationError(`Dispatch ${dispatchId} not found`);
    }

    const preflightEvidence = await this.runPreflight(repo);
    const policy: PhaseBudgetPolicy | null = this.runPolicyStore?.get(dispatch.runId) ?? null;

    const now = new Date().toISOString();
    const runAttemptId = crypto.randomUUID();
    const logPath = path.join(this.dataDir, "logs", repositoryId, `${runAttemptId}.log`);

    const runRecord: ExecutorRunRecord = {
      id: runAttemptId,
      repositoryId,
      dispatchId,
      runId: dispatch.runId,
      iteration: dispatch.iteration,
      status: "running",
      exitCode: null,
      logPath,
      errorMessage: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.executorStore.create(runRecord);
    this.publishEvent({
      type: "executor.started",
      at: now,
      repositoryId,
      data: {
        runId: dispatch.runId,
        dispatchId: dispatch.id,
        iteration: dispatch.iteration,
        executorCli: repo.executorCli,
        executorModel: repo.executorModel,
        environment: repo.environment
      }
    });

    const prompt = generateBootstrapPrompt({
      repositoryName: repo.displayName,
      dispatchId: dispatch.id,
      changePath: dispatch.changePath,
      goal: dispatch.goal,
      iteration: dispatch.iteration,
      recovery: options.recovery
    });

    const profile = resolveProfile(repo.executorCli);
    const invocation = buildExecutorInvocation(profile, {
      cli: repo.executorCli,
      model: repo.executorModel,
      prompt,
      environment: repo.environment
    });

    const runner = new ExecutorRunner({
      adapter: repo.environment === "wsl" ? this.wslAdapter : this.windowsAdapter,
      context: {
        command: invocation.command,
        args: invocation.args,
        cwd: repo.localPath,
        env: {
          ORCA_RUN_ID: dispatch.runId,
          ORCA_DISPATCH_ID: dispatch.id,
          ORCA_DISPATCH_PATH: `.orca/dispatch/${dispatch.id}.json`,
          ORCA_CHANGE_PATH: dispatch.changePath,
          ORCA_ITERATION: dispatch.iteration.toString(),
          ORCA_EXECUTOR_MODEL: repo.executorModel,
          ORCA_ENVIRONMENT: repo.environment,
          ORCA_PREFLIGHT_EVIDENCE: JSON.stringify({ dirty: preflightEvidence.dirty, localHead: preflightEvidence.localHead, remoteHead: preflightEvidence.remoteHead, statusSummary: preflightEvidence.statusSummary }),
          // Propagate deterministic harness controls (qualification tier only)
          ...(process.env.ORCA_SLOW_MS ? { ORCA_SLOW_MS: process.env.ORCA_SLOW_MS } : {}),
          ...(process.env.ORCA_HARNESS_STATUS ? { ORCA_HARNESS_STATUS: process.env.ORCA_HARNESS_STATUS } : {}),
          ...(process.env.ORCA_HARNESS_EXIT_CODE ? { ORCA_HARNESS_EXIT_CODE: process.env.ORCA_HARNESS_EXIT_CODE } : {}),
          ...(options.recovery ? { ORCA_RECOVERY: "true" } : {})
        },
        wslDistribution: repo.wslDistribution
      },
      logPath,
      watchdogMs: policy?.executor.watchdogMs ?? this.executorWatchdogMs,
      onLog: (line) => {
        this.publishLog(repositoryId, dispatch.id, line);
      },
      onExit: (exitCode, details) => {
        this.activeRunners.delete(repositoryId);
        const finishedAt = new Date().toISOString();

        let finalStatus: "completed" | "failed" | "timed_out" | "paused" | "killed" = "completed";
        let errorMessage: string | null = null;

        // First-class exit reasons: PAUSED must not become RECOVERY_REQUIRED (item #5).
        if (details.reason === "PAUSED" || details.wasPaused) {
          finalStatus = "paused";
        } else if (details.reason === "EMERGENCY_KILLED" || details.wasKilled) {
          finalStatus = "killed";
        } else if (details.reason === "WATCHDOG_TIMEOUT" || details.timedOut) {
          finalStatus = "timed_out";
          errorMessage = "Executor watchdog timeout";
          this.publishEvent({
            type: "budget.expired",
            at: finishedAt,
            repositoryId,
            data: {
              runId: dispatch.runId,
              dispatchId: dispatch.id,
              iteration: dispatch.iteration,
              failureReason: "EXECUTOR_WATCHDOG_TIMEOUT",
              reason: "EXECUTOR_WATCHDOG_TIMEOUT",
              phase: "EXECUTOR_ACTIVITY"
            }
          });
        } else if (exitCode !== null && exitCode !== 0) {
          // Nonzero exit is not authoritative – still attempt result validation (item #7).
          // Keep failed status for now; result validation may still surface a FAILED/BLOCKED manifest.
          finalStatus = "failed";
          errorMessage = `Executor process exited with non-zero code ${exitCode}`;
        }

        this.executorStore.updateStatus(runAttemptId, finalStatus, {
          exitCode,
          errorMessage,
          finishedAt
        });

        // PAUSED is not an error completion; do not trigger RECOVERY_REQUIRED path.
        // Handle async completion with safe guard against closed DB (test teardown).
        if (details.reason === "PAUSED" || details.wasPaused) {
          // Persist result if present but do NOT wake Sol; leave PAUSED for resume.
          this.handleTurnCompletion(repositoryId, dispatchId, finalStatus, details, exitCode).catch(() => {});
          return;
        }

        this.handleTurnCompletion(repositoryId, dispatchId, finalStatus, details, exitCode).catch(() => {});
      }
    });

    const launchAttempts = policy?.executor.launchAttempts ?? MAX_LAUNCH_ATTEMPTS;
    const started = await this.launchWithRetry(repo, runner, launchAttempts);
    if (!started) {
      this.activeRunners.delete(repositoryId);
      this.executorStore.updateStatus(runAttemptId, "failed", {
        errorMessage: `Executor failed to start after ${launchAttempts} attempts (contact/launch unavailable).`,
        finishedAt: new Date().toISOString()
      });
      throw new ValidationError(
        `Executor failed to start for repository ${repositoryId} after ${launchAttempts} attempts`
      );
    }

    this.activeRunners.set(repositoryId, runner);
    return runRecord;
  }

  /**
   * Launch the runner, retrying up to 3 times on inability to START the process
   * (e.g., missing executor CLI / async ENOENT). This is NOT retrying merely
   * because an executor turn reports a failure (D). A process that starts and
   * then exits quickly has genuinely completed its (possibly failed) turn and is
   * handled via the normal onExit result-contract path.
   */
  private async launchWithRetry(
    repo: RepositoryRecord,
    runner: ExecutorRunner,
    maxAttempts = MAX_LAUNCH_ATTEMPTS
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await runner.start();
        return true;
      } catch (err: any) {
        const message = err?.message || String(err);
        if (attempt < maxAttempts) {
          this.publishEvent({
            type: "executor.log",
            at: new Date().toISOString(),
            repositoryId: repo.id,
            data: {
              logMessage: `[system] Launch attempt ${attempt}/${maxAttempts} failed: ${message}; retrying`
            }
          });
          await new Promise<void>((resolve) =>
            setTimeout(resolve, LAUNCH_RETRY_BASE_MS * attempt)
          );
          continue;
        }
        this.publishEvent({
          type: "executor.log",
          at: new Date().toISOString(),
          repositoryId: repo.id,
          data: {
            logMessage: `[system] Launch failed after ${maxAttempts} attempts: ${message}`
          }
        });
        return false;
      }
    }
    return false;
  }

  /**
   * Result-contract handling (E) + postflight (F).
   * A process exit 0 with no valid committed result manifest is INVALID, not success.
   * Item #7: nonzero exit does NOT discard a valid BLOCKED/NEEDS_HUMAN/FAILED manifest.
   */
  private async handleTurnCompletion(
    repositoryId: string,
    dispatchId: string,
    finalStatus: "completed" | "failed" | "timed_out" | "paused" | "killed",
    _details: { timedOut: boolean; wasKilled: boolean; wasPaused: boolean; reason?: string },
    exitCode?: number | null
  ): Promise<void> {
    // PAUSED is not an error completion path – just persist if present, do not trigger recovery.
    if (finalStatus === "paused") {
      const persisted = this.gitClient ? await this.readAndValidateResult(repositoryId, dispatchId) : null;
      if (persisted) this.dispatchStore.updateStatus(dispatchId, "consumed");
      // Do not call onExecutorCompleted for PAUSED – LoopService will handle via pauseRun state.
      return;
    }

    // For any ordinary exit (including nonzero), inspect for a valid durable manifest when safe.
    let result: ExecutorResult | null = null;
    const shouldInspect = this.gitClient && (finalStatus === "completed" || finalStatus === "failed");
    if (shouldInspect) {
      result = await this.readAndValidateResult(repositoryId, dispatchId, { exitCode });
    } else if (finalStatus === "timed_out" || finalStatus === "killed") {
      result = null;
    }

    if (result) {
      // Mark consumed only when a valid, committed result exists (E).
      this.dispatchStore.updateStatus(dispatchId, "consumed");
    }

    const completionDispatch = this.dispatchStore.get(dispatchId);
    this.publishEvent({
      type: "executor.completed",
      at: new Date().toISOString(),
      repositoryId,
      data: {
        runId: completionDispatch?.runId,
        dispatchId,
        iteration: completionDispatch?.iteration,
        resultStatus: result?.status ?? null,
        resultSha: result?.resultSha ?? null,
        summary: result?.summary ?? null,
        failureReason: result ? undefined : "INVALID_OR_INCOMPLETE_RESULT"
      }
    });

    if (this.onExecutorCompleted) {
      this.onExecutorCompleted(repositoryId, dispatchId, result);
    }
  }

  /** Read, validate, and postflight-verify the durable result manifest (E/F, item #6/#7). */
  private async readAndValidateResult(
    repositoryId: string,
    dispatchId: string,
    _opts: { exitCode?: number | null } = {}
  ): Promise<ExecutorResult | null> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo || !this.gitClient) return null;

    const dispatch = this.dispatchStore.get(dispatchId);
    if (!dispatch) return null;

    const ctx: GitContext =
      repo.environment === "wsl"
        ? {
            environment: "wsl",
            workingPath: repo.localPath,
            linuxPath: toWslPath(repo.localPath),
            wslDistribution: repo.wslDistribution
          }
        : { environment: "windows", workingPath: repo.localPath };

    const resultPath = `.orca/results/${dispatchId}.json`;
    if (!isResultFilePath(resultPath)) return null;

    let raw: string;
    try {
      raw = await this.gitClient.readWorkingTreeFile(ctx, resultPath);
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    let validated: ExecutorResult;
    try {
      validated = validateExecutorResult(parsed);
    } catch {
      return null;
    }

    // Item #6 hard checks: exact correlation required.
    // baseSha: dispatch.baseSha is the parent of the dispatch commit; harness captures baseSha
    // as current HEAD before work (i.e., the dispatch commit SHA itself). Accept either to
    // enforce dispatch correlation without brittle mismatch while still preventing cross-dispatch reuse.
    if (validated.dispatchId !== dispatch.id) return null;
    if (validated.runId !== dispatch.runId) return null;
    if (validated.iteration !== dispatch.iteration) return null;
    if (validated.baseSha !== dispatch.baseSha && validated.baseSha !== dispatch.commitSha) return null;
    if (validated.executor.cli !== repo.executorCli) return null;
    if (validated.executor.model !== repo.executorModel) return null;
    if (validated.executor.environment !== repo.environment) return null;

    // Postflight (F): resultSha ancestry, manifest committed, remote reached.
    const head = await this.gitClient.getCurrentSha(ctx);
    if (!head) return null;
    const headOk = head === validated.resultSha || (await this.gitClient.isAncestor(validated.resultSha, head, ctx));
    if (!headOk) return null;
    // Manifest itself must be committed (not just working tree).
    try {
      await this.gitClient.getFileContentAtCommit(ctx, head, resultPath);
    } catch {
      return null;
    }
    // Remote verification: if remote is reachable, require resultSha ancestry in remote main.
    // Do NOT silently accept local-only proof when remote verification is possible but failed (item #6).
    try {
      await this.gitClient.fetch(ctx, "origin", "main");
      // Under WSL the remote URL must be the Linux mount path, not the Windows path (Finding C).
      const remoteUrl = repo.environment === "wsl" ? toWslPath(repo.githubRemote) : repo.githubRemote;
      const remoteHead = await this.gitClient.getRemoteHeadSha(remoteUrl, "main", ctx);
      if (remoteHead) {
        const remoteOk =
          remoteHead === validated.resultSha ||
          (await this.gitClient.isAncestor(validated.resultSha, remoteHead, ctx));
        const manifestOnRemoteOk = await this.gitClient.isAncestor(head, remoteHead, ctx).catch(() => false);
        if (!remoteOk || !manifestOnRemoteOk) return null;
      }
      // remoteHead === null => no remote branch yet (test repo without origin); accept local proof.
    } catch {
      // Transient fetch/remote failure while git client is present: treat as retryable postflight,
      // not silent local success (item #6). Caller surfaces RECOVERY_REQUIRED and can retry later.
      return null;
    }

    return validated;
  }

  /** Preflight (#15): inspect and record dirty tree / local HEAD / remote HEAD / ahead-behind-diverged; never reset/clean; safe fast-forward/rebase where possible; pass evidence to bootstrap. */
  private async runPreflight(repo: RepositoryRecord): Promise<{ dirty: boolean; localHead: string | null; remoteHead: string | null; statusSummary: string }> {
    if (!this.gitClient) return { dirty: false, localHead: null, remoteHead: null, statusSummary: "no-git-client" };
    const ctx: GitContext =
      repo.environment === "wsl"
        ? { environment: "wsl", workingPath: repo.localPath, linuxPath: toWslPath(repo.localPath), wslDistribution: repo.wslDistribution }
        : { environment: "windows", workingPath: repo.localPath };

    const result: { dirty: boolean; localHead: string | null; remoteHead: string | null; statusSummary: string } = { dirty: false, localHead: null, remoteHead: null, statusSummary: "" };
    try {
      // #12: WSL remote probe must route through WSL git so WSL-only credentials work
      const remoteUrl = repo.environment === "wsl" ? toWslPath(repo.githubRemote) : repo.githubRemote;
      let remoteHead: string | null = null;
      try {
        remoteHead = await this.gitClient.getRemoteHeadSha(remoteUrl, "main", ctx);
      } catch (e: any) {
        this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] remote HEAD probe failed: ${e?.message ?? String(e)}` } });
      }
      result.remoteHead = remoteHead;

      result.localHead = await this.gitClient.getCurrentSha(ctx);
      try { result.dirty = await this.gitClient.hasUncommittedChanges(ctx); } catch {}

      // Fetch so referenced commits exist; never force-fetch or reset.
      try { await this.gitClient.fetch(ctx, "origin", "main"); } catch (err: any) {
        this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] fetch warning: ${err?.message ?? String(err)}` } });
      }

      // Determine relation
      let relation = "unknown";
      if (result.localHead && result.remoteHead) {
        const local = result.localHead;
        const remote = result.remoteHead;
        const isAncestor = await this.gitClient.isAncestor(local, remote, ctx).catch(() => false);
        const remoteIsAncestor = await this.gitClient.isAncestor(remote, local, ctx).catch(() => false);
        if (local === remote) relation = "up-to-date";
        else if (remoteIsAncestor) relation = "ahead";
        else if (isAncestor) relation = "behind (fast-forwardable)";
        else relation = "diverged";
      } else if (result.localHead) relation = "no-remote";
      else relation = "no-local-head";

      result.statusSummary = `dirty=${result.dirty} local=${result.localHead?.slice(0, 7) ?? "none"} remote=${result.remoteHead?.slice(0, 7) ?? "none"} relation=${relation}`;
      // Attempt safe fast-forward/rebase only if clean and behind; if dirty or diverged, leave to executor (evidence passed via env)
      if (!result.dirty && relation === "behind (fast-forwardable)") {
        try {
          await this.gitClient.fetch(ctx, "origin", "main");
          this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] fast-forwardable: ${result.statusSummary}` } });
        } catch {}
      } else if (relation !== "up-to-date") {
        this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] ${result.statusSummary}` } });
      }

      return result;
    } catch (err: any) {
      this.publishEvent({ type: "executor.log", at: new Date().toISOString(), repositoryId: repo.id, data: { logMessage: `[preflight] inspection failed: ${err?.message ?? String(err)}` } });
      return result;
    }
  }

  async pauseRun(repositoryId: string): Promise<void> {
    const runner = this.activeRunners.get(repositoryId);
    if (!runner) return;

    await runner.pause();
    this.activeRunners.delete(repositoryId);

    const activeRun = this.executorStore.getActiveRun(repositoryId);
    if (activeRun) {
      this.executorStore.updateStatus(activeRun.id, "paused", {
        finishedAt: new Date().toISOString()
      });
    }
  }

  async killRun(repositoryId: string): Promise<void> {
    const runner = this.activeRunners.get(repositoryId);
    if (!runner) return;

    await runner.kill();
    this.activeRunners.delete(repositoryId);

    const activeRun = this.executorStore.getActiveRun(repositoryId);
    if (activeRun) {
      this.executorStore.updateStatus(activeRun.id, "killed", {
        finishedAt: new Date().toISOString()
      });
    }
  }

  getStatus(repositoryId: string): ExecutorStatusResponse {
    const isRunning = this.activeRunners.has(repositoryId);
    const activeRun = this.executorStore.getActiveRun(repositoryId);
    const runner = this.activeRunners.get(repositoryId);
    const recentLogs = runner ? runner.getLogs() : [];

    return {
      repositoryId,
      isRunning,
      activeRun,
      recentLogs
    };
  }

  getLogs(repositoryId: string): string[] {
    const runner = this.activeRunners.get(repositoryId);
    return runner ? runner.getLogs() : [];
  }

  private publishLog(repositoryId: string, dispatchId: string, line: string): void {
    this.publishEvent({
      type: "executor.log",
      at: new Date().toISOString(),
      repositoryId,
      data: { logMessage: line, dispatchId }
    });
  }

  private publishEvent(event: RepositoryMutationEvent): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher(event);
      } catch (err) {
        console.warn("[ExecutorService] Failed to publish event:", err);
      }
    }
  }
}
