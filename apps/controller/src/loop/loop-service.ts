import crypto from "node:crypto";
import {
  type LoopState,
  type RunRecord,
  type LoopStatusResponse,
  type RepositoryMutationEvent,
  getActiveActor,
  ValidationError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { WatcherService } from "../watcher/watcher-service.js";
import type { ExecutorService } from "../executor/executor-service.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { RunStore } from "./run-store.js";

export interface LoopServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore?: DispatchStore;
  runStore: RunStore;
  watcherService?: WatcherService;
  executorService: ExecutorService;
  browserManager: BrowserManager;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

export class LoopService {
  private readonly repoStore: RepositoryStore;
  private readonly runStore: RunStore;
  private readonly executorService: ExecutorService;
  private readonly browserManager: BrowserManager;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  constructor(options: LoopServiceOptions) {
    this.repoStore = options.repoStore;
    this.runStore = options.runStore;
    this.executorService = options.executorService;
    this.browserManager = options.browserManager;
    this.eventPublisher = options.eventPublisher;
  }

  async startRun(
    repositoryId: string,
    params: { goal: string; maxIterations?: number }
  ): Promise<RunRecord> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) {
      throw new RepositoryNotFoundError(`Repository ${repositoryId} not found`);
    }

    const existingActive = this.runStore.getActiveRun(repositoryId);
    if (existingActive) {
      throw new ValidationError(`Run ${existingActive.id} is already active for repository ${repositoryId}`);
    }

    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const maxIterations = params.maxIterations || repo.maxIterations || 20;

    const runRecord: RunRecord = {
      id: runId,
      repositoryId,
      goal: params.goal,
      status: "SOL_PENDING",
      currentIteration: 1,
      maxIterations,
      activeDispatchId: null,
      lastError: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.runStore.create(runRecord);
    this.publishStateChange(repositoryId, runId, "SOL_PENDING");

    // Submit initial wake to Sol
    await this.submitSolWakeForRun(repositoryId, runRecord);

    return this.runStore.get(runId)!;
  }

  async onDispatchDetected(repositoryId: string, dispatchId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    if (activeRun.status !== "SOL_REVIEWING" && activeRun.status !== "SOL_PENDING") {
      return;
    }

    // Move to EXECUTOR_PENDING
    this.runStore.updateStatus(activeRun.id, "EXECUTOR_PENDING", {
      activeDispatchId: dispatchId
    });
    this.publishStateChange(repositoryId, activeRun.id, "EXECUTOR_PENDING");

    // Launch executor
    try {
      this.runStore.updateStatus(activeRun.id, "EXECUTING");
      this.publishStateChange(repositoryId, activeRun.id, "EXECUTING");

      await this.executorService.startRun(repositoryId, dispatchId);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      this.runStore.updateStatus(activeRun.id, "EXECUTOR_UNAVAILABLE", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "EXECUTOR_UNAVAILABLE");
    }
  }

  async onExecutorCompleted(repositoryId: string, _dispatchId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    if (activeRun.currentIteration >= activeRun.maxIterations) {
      // Reached iteration ceiling
      this.runStore.updateStatus(activeRun.id, "GOAL_COMPLETE", {
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "GOAL_COMPLETE");
      return;
    }

    // Increment iteration and prepare next Sol wake
    const nextIteration = activeRun.currentIteration + 1;
    this.runStore.updateStatus(activeRun.id, "SOL_PENDING", {
      currentIteration: nextIteration
    });
    this.publishStateChange(repositoryId, activeRun.id, "SOL_PENDING");

    await this.submitSolWakeForRun(repositoryId, {
      ...activeRun,
      currentIteration: nextIteration
    });
  }

  private async submitSolWakeForRun(repositoryId: string, run: RunRecord): Promise<void> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) return;

    try {
      const wake = await this.browserManager.submitSolWake(repositoryId, {
        repositoryName: repo.displayName,
        runId: run.id,
        iteration: run.currentIteration,
        dispatchId: run.activeDispatchId || null,
        resultStatus: "COMPLETED",
        conversationUrl: repo.solConversationUrl
      });

      if (wake.status === "submitted") {
        this.runStore.updateStatus(run.id, "SOL_REVIEWING");
        this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
      } else {
        this.runStore.updateStatus(run.id, "SOL_STALLED", {
          lastError: wake.errorMessage || "Wake submission failed",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      this.runStore.updateStatus(run.id, "SOL_STALLED", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
    }
  }

  async pauseRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    await this.executorService.pauseRun(repositoryId);

    this.runStore.updateStatus(activeRun.id, "PAUSED");
    this.publishStateChange(repositoryId, activeRun.id, "PAUSED");
  }

  async resumeRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun || activeRun.status !== "PAUSED") return;

    this.runStore.updateStatus(activeRun.id, "SOL_REVIEWING");
    this.publishStateChange(repositoryId, activeRun.id, "SOL_REVIEWING");
  }

  async stopRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    await this.executorService.killRun(repositoryId);

    this.runStore.updateStatus(activeRun.id, "STOPPED", {
      finishedAt: new Date().toISOString()
    });
    this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
  }

  getStatus(repositoryId: string): LoopStatusResponse {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    const state: LoopState = activeRun ? activeRun.status : "IDLE";
    const activeActor = getActiveActor(state);

    return {
      repositoryId,
      state,
      activeRun,
      currentIteration: activeRun ? activeRun.currentIteration : 0,
      maxIterations: activeRun ? activeRun.maxIterations : 0,
      activeActor
    };
  }

  private publishStateChange(repositoryId: string, runId: string, loopState: LoopState): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher({
          type: "loop.state_changed",
          at: new Date().toISOString(),
          repositoryId,
          data: {
            runId,
            loopState
          }
        });
      } catch (err) {
        console.warn("[LoopService] Failed to publish event:", err);
      }
    }
  }
}
