import crypto from "node:crypto";
import {
  type LoopState,
  type RunRecord,
  type LoopStatusResponse,
  type RepositoryMutationEvent,
  type ExecutorResult,
  type SolWakeResultStatus,
  type SolControlDecision,
  getActiveActor,
  ValidationError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { SolControlStore } from "../watcher/sol-control-store.js";
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
  solControlStore?: SolControlStore | null;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

/** Canonical loop states from which a new dispatch/executor cycle may begin. */
const DISPATCH_RECEPTIVE_STATES: LoopState[] = ["SOL_PENDING", "SOL_REVIEWING"];

export class LoopService {
  private readonly repoStore: RepositoryStore;
  private readonly dispatchStore: DispatchStore | null;
  private readonly runStore: RunStore;
  private readonly executorService: ExecutorService;
  private readonly browserManager: BrowserManager;
  private readonly solControlStore: SolControlStore | null;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  constructor(options: LoopServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore ?? null;
    this.runStore = options.runStore;
    this.executorService = options.executorService;
    this.browserManager = options.browserManager;
    this.solControlStore = options.solControlStore ?? null;
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
      currentIteration: 0,
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

    // Initial Sol wake carries INITIAL result status: it must NOT pretend an
    // executor result is COMPLETED (G: initial wake truthfulness).
    await this.submitSolWakeForRun(repositoryId, runRecord, "INITIAL");

    return this.runStore.get(runId)!;
  }

  /** Production wiring entry point: watcher detected a durable dispatch commit. */
  async onDispatchDetected(repositoryId: string, dispatchId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    if (!DISPATCH_RECEPTIVE_STATES.includes(activeRun.status)) {
      return;
    }

    // Reflect the iteration the dispatch actually represents (G: truthful
    // iteration counting). Fall back to local progression only if the dispatch
    // record is unavailable.
    const dispatch = this.dispatchStore?.get(dispatchId);
    const nextIteration = dispatch?.iteration ?? activeRun.currentIteration + 1;

    this.runStore.updateStatus(activeRun.id, "EXECUTOR_PENDING", {
      activeDispatchId: dispatchId,
      currentIteration: nextIteration
    });
    this.publishStateChange(repositoryId, activeRun.id, "EXECUTOR_PENDING");

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

  /**
   * Production wiring entry point: executor finished a turn.
   * `result` is the validated durable result manifest, or null when the executor
   * exited 0 without producing/committing the required durable state (E).
   */
  async onExecutorCompleted(
    repositoryId: string,
    dispatchId: string,
    result: ExecutorResult | null
  ): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    // A stop or other terminal transition may have landed while the executor ran.
    if (activeRun.status === "STOPPED" || activeRun.status === "RECOVERY_REQUIRED") {
      return;
    }

    if (!result) {
      this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
        lastError:
          "Executor turn completed without producing a valid, committed result manifest. Treat as invalid/incomplete, not success (E).",
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "RECOVERY_REQUIRED");
      return;
    }

    if (result.status === "COMPLETED") {
      this.dispatchStore?.updateStatus(dispatchId, "consumed");

      const maxIterations = activeRun.maxIterations;
      if (activeRun.currentIteration >= maxIterations) {
        // Ceiling crossed while actor was active => DRAINING, then STOPPED/CEILING_REACHED.
        // Never GOAL_COMPLETE merely from a ceiling (G).
        this.runStore.updateStatus(activeRun.id, "DRAINING");
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        return;
      }

      // Sol alone is authoritative for GOAL_COMPLETE. Wake Sol with the real
      // result status; Sol decides completion via a control marker (G/H).
      await this.submitSolWakeForRun(repositoryId, activeRun, result.status);
      return;
    }

    // BLOCKED / NEEDS_HUMAN / FAILED: truthful problem or failure state.
    const terminalState: LoopState =
      result.status === "BLOCKED"
        ? "BLOCKED"
        : result.status === "NEEDS_HUMAN"
        ? "NEEDS_HUMAN"
        : "RECOVERY_REQUIRED";

    this.runStore.updateStatus(activeRun.id, terminalState, {
      lastError:
        result.status === "FAILED"
          ? `Executor reported FAILED: ${result.summary}`
          : `Executor reported ${result.status}: ${result.summary}`,
      finishedAt: new Date().toISOString()
    });
    this.publishStateChange(repositoryId, activeRun.id, terminalState);
  }

  /** Production wiring entry point: watcher detected a durable Sol control marker (H). */
  async onControlDetected(
    repositoryId: string,
    controlId: string,
    decision: SolControlDecision,
    runId: string
  ): Promise<void> {
    if (this.solControlStore) {
      const existing = this.solControlStore.get(controlId);
      if (existing && existing.status === "consumed") {
        return; // idempotent
      }
      this.solControlStore.updateStatus(controlId, "consumed");
    }

    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    // Only the run this control references is authoritative.
    if (activeRun.id !== runId) return;

    const targetState: LoopState =
      decision === "GOAL_COMPLETE"
        ? "GOAL_COMPLETE"
        : decision === "BLOCKED"
        ? "BLOCKED"
        : decision === "NEEDS_HUMAN"
        ? "NEEDS_HUMAN"
        : "PAUSED";

    if (decision === "PAUSED") {
      await this.executorService.pauseRun(repositoryId);
    }

    this.runStore.updateStatus(activeRun.id, targetState, {
      finishedAt: targetState === "GOAL_COMPLETE" ? new Date().toISOString() : activeRun.finishedAt
    });
    this.publishStateChange(repositoryId, activeRun.id, targetState);
  }

  async drainRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    this.runStore.updateStatus(activeRun.id, "DRAINING");
    this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
  }

  /**
   * Idempotent wake resubmission for rehydration (M). Must NOT create a new run;
   * it resumes the existing SOL_PENDING run's pending wake.
   */
  async resubmitPendingWake(repositoryId: string, run: RunRecord): Promise<void> {
    await this.submitSolWakeForRun(repositoryId, run, "INITIAL");
  }

  async recoverRun(
    repositoryId: string,
    action: "retry" | "stop" | "complete"
  ): Promise<RunRecord> {
    // Recovery applies to runs in terminal/problem states that are intentionally
    // excluded from the "active" view, so resolve by most-recent run (M).
    const activeRun = this.runStore.getLatestRun(repositoryId);
    if (!activeRun) {
      throw new ValidationError(`No run for repository ${repositoryId}`);
    }

    if (
      activeRun.status !== "RECOVERY_REQUIRED" &&
      activeRun.status !== "BLOCKED" &&
      activeRun.status !== "NEEDS_HUMAN"
    ) {
      throw new ValidationError(
        `Run ${activeRun.id} is in status ${activeRun.status}, recovery not applicable`
      );
    }

    if (action === "stop") {
      this.runStore.updateStatus(activeRun.id, "STOPPED", {
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
    } else if (action === "complete") {
      this.runStore.updateStatus(activeRun.id, "GOAL_COMPLETE", {
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "GOAL_COMPLETE");
    } else if (action === "retry") {
      this.runStore.updateStatus(activeRun.id, "SOL_PENDING");
      this.publishStateChange(repositoryId, activeRun.id, "SOL_PENDING");
      await this.submitSolWakeForRun(repositoryId, activeRun, "INITIAL");
    }

    return this.runStore.get(activeRun.id)!;
  }

  private async submitSolWakeForRun(
    repositoryId: string,
    run: RunRecord,
    resultStatus: SolWakeResultStatus
  ): Promise<void> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) return;

    try {
      const wake = await this.browserManager.submitSolWake(repositoryId, {
        repositoryName: repo.displayName,
        runId: run.id,
        iteration: run.currentIteration,
        dispatchId: run.activeDispatchId || null,
        resultStatus,
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

  /** Pause: terminate the executor promptly to stop inference usage, preserve tree, PAUSED (I). */
  async pauseRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    await this.executorService.pauseRun(repositoryId);

    this.runStore.updateStatus(activeRun.id, "PAUSED");
    this.publishStateChange(repositoryId, activeRun.id, "PAUSED");
  }

  /**
   * Resume: restart the SAME unfinished dispatch with a recovery bootstrap that
   * instructs the executor to inspect/preserve partial work and continue (I).
   */
  async resumeRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun || activeRun.status !== "PAUSED") return;
    if (!activeRun.activeDispatchId) return;

    this.runStore.updateStatus(activeRun.id, "EXECUTING");
    this.publishStateChange(repositoryId, activeRun.id, "EXECUTING");

    try {
      await this.executorService.startRun(
        repositoryId,
        activeRun.activeDispatchId,
        { recovery: true }
      );
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      this.runStore.updateStatus(activeRun.id, "EXECUTOR_UNAVAILABLE", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "EXECUTOR_UNAVAILABLE");
    }
  }

  /**
   * Stop: graceful drain. Allow the current actor to finish; prevent the next
   * handoff; do NOT immediately kill the executor (I).
   */
  async stopRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    this.runStore.updateStatus(activeRun.id, "STOPPED", {
      finishedAt: new Date().toISOString()
    });
    this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
  }

  /**
   * Emergency Kill: separate destructive operation. Immediately terminate the
   * repository's active executor/browser page; preserve a truthful
   * RECOVERY_REQUIRED / interrupted state (I).
   */
  async emergencyKill(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);

    await this.executorService.killRun(repositoryId).catch(() => {});
    await this.browserManager.closeRepositoryPage(repositoryId).catch(() => {});

    if (activeRun) {
      this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
        lastError: "Run interrupted by emergency kill. Manual recovery required.",
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "RECOVERY_REQUIRED");
    }
  }

  getStatus(repositoryId: string): LoopStatusResponse {
    const activeRun = this.runStore.getActiveRun(repositoryId);

    // N: separate active, latest-problem, and genuinely-idle. A clean stop or a
    // completed goal is a finished run; surface it as IDLE. Problem/terminal
    // states (BLOCKED, NEEDS_HUMAN, RECOVERY_REQUIRED, SOL_STALLED,
    // EXECUTOR_UNAVAILABLE, CEILING_REACHED, ATTENTION_REQUIRED) MUST remain
    // visible and must never be hidden as IDLE.
    if (activeRun) {
      return this.buildStatus(activeRun);
    }

    const latest = this.runStore.getLatestRun(repositoryId);
    if (!latest) {
      return this.idleStatus(repositoryId);
    }

    if (latest.status === "STOPPED" || latest.status === "GOAL_COMPLETE") {
      return this.idleStatus(repositoryId);
    }

    return this.buildStatus(latest);
  }

  private buildStatus(run: RunRecord): LoopStatusResponse {
    const state: LoopState = run.status;
    return {
      repositoryId: run.repositoryId,
      state,
      activeRun: run,
      currentIteration: run.currentIteration,
      maxIterations: run.maxIterations,
      activeActor: getActiveActor(state)
    };
  }

  private idleStatus(repositoryId: string): LoopStatusResponse {
    return {
      repositoryId,
      state: "IDLE",
      activeRun: null,
      currentIteration: 0,
      maxIterations: 0,
      activeActor: "NONE"
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
