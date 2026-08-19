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
  ValidationError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { GitClient, GitContext } from "../watcher/git-client.js";
import type { ExecutorStore } from "./executor-store.js";
import type { ExecutorAdapter } from "./adapters/executor-adapter.js";
import { WindowsPowerShellAdapter } from "./adapters/windows-adapter.js";
import { WslAdapter } from "./adapters/wsl-adapter.js";
import { ExecutorRunner } from "./executor-runner.js";
import { buildExecutorInvocation, resolveProfile } from "./profiles.js";

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

    await this.runPreflight(repo);

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
      prompt
    });

    const timeoutMs = (repo.maxRuntimeMinutes || 480) * 60 * 1000;

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
          ORCA_ENVIRONMENT: repo.environment
        },
        wslDistribution: repo.wslDistribution
      },
      logPath,
      timeoutMs,
      onLog: (line) => {
        this.publishLog(repositoryId, dispatch.id, line);
      },
      onExit: (exitCode, details) => {
        this.activeRunners.delete(repositoryId);
        const finishedAt = new Date().toISOString();

        let finalStatus: "completed" | "failed" | "timed_out" | "paused" | "killed" = "completed";
        let errorMessage: string | null = null;

        if (details.wasPaused) {
          finalStatus = "paused";
        } else if (details.wasKilled) {
          finalStatus = "killed";
        } else if (details.timedOut) {
          finalStatus = "timed_out";
          errorMessage = "Execution exceeded runtime ceiling";
        } else if (exitCode !== 0) {
          finalStatus = "failed";
          errorMessage = `Executor process exited with non-zero code ${exitCode}`;
        }

        this.executorStore.updateStatus(runAttemptId, finalStatus, {
          exitCode,
          errorMessage,
          finishedAt
        });

        this.handleTurnCompletion(repositoryId, dispatchId, finalStatus, details).catch((err) => {
          console.warn("[ExecutorService] Turn completion handling failed:", err);
        });
      }
    });

    const started = await this.launchWithRetry(repo, runner);
    if (!started) {
      this.activeRunners.delete(repositoryId);
      this.executorStore.updateStatus(runAttemptId, "failed", {
        errorMessage: "Executor failed to start after retry (contact/launch unavailable).",
        finishedAt: new Date().toISOString()
      });
      throw new ValidationError(
        `Executor failed to start for repository ${repositoryId} after ${MAX_LAUNCH_ATTEMPTS} attempts`
      );
    }

    this.activeRunners.set(repositoryId, runner);
    return runRecord;
  }

  /**
   * Launch the runner, retrying up to 3 times on inability to START the process
   * (e.g., missing executor CLI / spawn failure). This is NOT retrying merely
   * because an executor turn reports a failure (D). A process that starts and
   * then exits quickly has genuinely completed its (possibly failed) turn and is
   * handled via the normal onExit result-contract path.
   */
  private async launchWithRetry(
    repo: RepositoryRecord,
    runner: ExecutorRunner
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
      try {
        runner.start();
        return true;
      } catch (err: any) {
        const message = err?.message || String(err);
        if (attempt < MAX_LAUNCH_ATTEMPTS) {
          this.publishEvent({
            type: "executor.log",
            at: new Date().toISOString(),
            repositoryId: repo.id,
            data: {
              logMessage: `[system] Launch attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS} failed: ${message}; retrying`
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
            logMessage: `[system] Launch failed after ${MAX_LAUNCH_ATTEMPTS} attempts: ${message}`
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
   */
  private async handleTurnCompletion(
    repositoryId: string,
    dispatchId: string,
    finalStatus: "completed" | "failed" | "timed_out" | "paused" | "killed",
    _details: { timedOut: boolean; wasKilled: boolean; wasPaused: boolean }
  ): Promise<void> {
    const isNormalCompletion = finalStatus === "completed";

    let result: ExecutorResult | null = null;
    if (isNormalCompletion && this.gitClient) {
      result = await this.readAndValidateResult(repositoryId, dispatchId);
    }

    if (result) {
      // Mark consumed only when a valid, committed result exists (E).
      this.dispatchStore.updateStatus(dispatchId, "consumed");
    }

    if (this.onExecutorCompleted) {
      this.onExecutorCompleted(repositoryId, dispatchId, result);
    }
  }

  /** Read, validate, and postflight-verify the durable result manifest (E/F). */
  private async readAndValidateResult(
    repositoryId: string,
    dispatchId: string
  ): Promise<ExecutorResult | null> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo || !this.gitClient) return null;

    const ctx: GitContext =
      repo.environment === "wsl"
        ? {
            environment: "wsl",
            workingPath: repo.localPath,
            linuxPath: repo.localPath,
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

    // Postflight (F): the resultSha must match the actually committed HEAD, and
    // the dispatchId must match. If the executor did not commit/push real state,
    // this is an incomplete turn, not a success.
    try {
      const head = await this.gitClient.getCurrentSha(ctx);
      if (!head) {
        return null;
      }
      // Finding E: the harness commits the work, then commits the result manifest
      // on top. So `resultSha` (the work commit) is an ANCESTOR of HEAD, not equal
      // to it. Accept exact match OR ancestor containment — never exact-only, which
      // would reject a valid real result.
      const headOk = head === validated.resultSha || (await this.gitClient.isAncestor(validated.resultSha, head, ctx));
      if (!headOk) {
        return null;
      }
      // Best-effort remote reconciliation: confirm the result commit reached main.
      await this.gitClient.fetch(ctx, "origin", "main");
      const remoteHead = await this.gitClient.getRemoteHeadSha(repo.githubRemote, "main");
      if (remoteHead) {
        const remoteOk =
          remoteHead === validated.resultSha ||
          (await this.gitClient.isAncestor(validated.resultSha, remoteHead, ctx));
        if (!remoteOk) {
          return null;
        }
      }
    } catch {
      // If remote reconciliation is unavailable, accept the local-HEAD proof.
    }

    return validated;
  }

  /** Preflight (F): inspect working tree, reconcile ordinary divergence; never reset --hard. */
  private async runPreflight(repo: RepositoryRecord): Promise<void> {
    if (!this.gitClient) return;
    const ctx: GitContext =
      repo.environment === "wsl"
        ? {
            environment: "wsl",
            workingPath: repo.localPath,
            linuxPath: repo.localPath,
            wslDistribution: repo.wslDistribution
          }
        : { environment: "windows", workingPath: repo.localPath };

    try {
      // Fetch so referenced commits exist; never force-fetch or reset.
      await this.gitClient.fetch(ctx, "origin", "main");
    } catch (err: any) {
      this.publishEvent({
        type: "executor.log",
        at: new Date().toISOString(),
        repositoryId: repo.id,
        data: { logMessage: `[preflight] fetch warning: ${err?.message ?? String(err)}` }
      });
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
      data: { logMessage: line, runId: dispatchId }
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
