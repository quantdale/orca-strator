import path from "node:path";
import crypto from "node:crypto";
import {
  generateBootstrapPrompt,
  type ExecutorRunRecord,
  type ExecutorStatusResponse,
  type RepositoryMutationEvent,
  ValidationError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { ExecutorStore } from "./executor-store.js";
import type { ExecutorAdapter } from "./adapters/executor-adapter.js";
import { WindowsPowerShellAdapter } from "./adapters/windows-adapter.js";
import { WslAdapter } from "./adapters/wsl-adapter.js";
import { ExecutorRunner } from "./executor-runner.js";

export interface ExecutorServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore: DispatchStore;
  executorStore: ExecutorStore;
  dataDir?: string;
  windowsAdapter?: ExecutorAdapter;
  wslAdapter?: ExecutorAdapter;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

export class ExecutorService {
  private readonly repoStore: RepositoryStore;
  private readonly dispatchStore: DispatchStore;
  private readonly executorStore: ExecutorStore;
  private readonly dataDir: string;
  private readonly windowsAdapter: ExecutorAdapter;
  private readonly wslAdapter: ExecutorAdapter;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  private readonly activeRunners = new Map<string, ExecutorRunner>();

  constructor(options: ExecutorServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore;
    this.executorStore = options.executorStore;
    this.dataDir = options.dataDir || path.resolve(".orca-data");
    this.windowsAdapter = options.windowsAdapter || new WindowsPowerShellAdapter();
    this.wslAdapter = options.wslAdapter || new WslAdapter();
    this.eventPublisher = options.eventPublisher;
  }

  async startRun(
    repositoryId: string,
    dispatchId: string,
    overrideCommand?: string,
    overrideArgs?: string[]
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

    const adapter = repo.environment === "wsl" ? this.wslAdapter : this.windowsAdapter;
    const prompt = generateBootstrapPrompt({
      repositoryName: repo.displayName,
      dispatchId: dispatch.id,
      changePath: dispatch.changePath,
      goal: dispatch.goal,
      iteration: dispatch.iteration
    });

    const command = overrideCommand || repo.executorCli;
    const args = overrideArgs || ["--model", repo.executorModel, prompt];
    const timeoutMs = (repo.maxRuntimeMinutes || 480) * 60 * 1000;

    const runner = new ExecutorRunner({
      adapter,
      context: {
        command,
        args,
        cwd: repo.localPath,
        env: {
          ORCA_RUN_ID: dispatch.runId,
          ORCA_DISPATCH_ID: dispatch.id,
          ORCA_DISPATCH_PATH: `.orca/dispatch/${dispatch.id}.json`,
          ORCA_CHANGE_PATH: dispatch.changePath,
          ORCA_ITERATION: dispatch.iteration.toString(),
          ORCA_EXECUTOR_MODEL: repo.executorModel
        },
        wslDistribution: repo.wslDistribution
      },
      logPath,
      timeoutMs,
      onLog: (_line) => {
        // Broadcast log event
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

        if (finalStatus === "completed") {
          this.dispatchStore.updateStatus(dispatchId, "consumed");
        }

        this.publishEvent({
          type: "repository.updated",
          at: finishedAt,
          repositoryId
        });
      }
    });

    this.activeRunners.set(repositoryId, runner);
    runner.start();

    return runRecord;
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
