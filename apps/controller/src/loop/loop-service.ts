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

  /** Wall-clock ceiling timers per repository (item #3). */
  private readonly wallClockTimers = new Map<string, NodeJS.Timeout>();
  /** Ceiling pending while actor active – drain at boundary without killing. */
  private readonly ceilingPending = new Set<string>();
  /** User stop pending drain – graceful. */
  private readonly stopPending = new Set<string>();

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
    this.scheduleWallClockCeiling(repositoryId, runRecord);

    // Initial Sol wake carries INITIAL result status: it must NOT pretend an
    // executor result is COMPLETED (G: initial wake truthfulness).
    await this.submitSolWakeForRun(repositoryId, runRecord, "INITIAL");

    return this.runStore.get(runId)!;
  }

  /** Production wiring entry point: watcher detected a durable dispatch commit. */
  async onDispatchDetected(repositoryId: string, dispatchId: string): Promise<void> {
    // FIX #9: Sol operation lifecycle — dispatch is the expected Git transition for the pending Sol operation.
    // Close the correct repository page only (one repo's transition must not close unrelated pages).
    try {
      await this.browserManager.completeSolOperation(repositoryId, this.runStore.getActiveRun(repositoryId)?.id);
    } catch {}

    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    // Graceful drain pending: do not dispatch executor (items #3/#4).
    if (activeRun.status === "DRAINING" || this.stopPending.has(repositoryId) || this.ceilingPending.has(repositoryId)) {
      // If ceiling/stop pending while Sol is boundary, dispatch must not launch.
      // Persist drain and transition at next boundary if needed; for now just ignore dispatch.
      return;
    }

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
      this.cancelWallClockCeiling(repositoryId);
    }
  }

  /**
   * Production wiring entry point: executor finished a turn.
   * `result` is the validated durable result manifest, or null when the executor
   * exited without producing/committing the required durable state (E).
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

    // Drain pending: handle at actor boundary without killing executor (items #3/#4).
    const isDrainingCeiling = activeRun.status === "DRAINING" && this.ceilingPending.has(repositoryId);
    const isDrainingStop = activeRun.status === "DRAINING" && this.stopPending.has(repositoryId);

    if (isDrainingCeiling || isDrainingStop) {
      // Persist valid result if present; do NOT wake Sol.
      if (result) {
        this.dispatchStore?.updateStatus(dispatchId, "consumed");
      }
      if (isDrainingCeiling) {
        this.ceilingPending.delete(repositoryId);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
            lastError: "Wall-clock ceiling reached (drained at executor boundary)",
            finishedAt: new Date().toISOString()
          });
          this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        }
      } else {
        this.stopPending.delete(repositoryId);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "STOPPED", {
            lastError: "Stopped by user (drained at executor boundary)",
            finishedAt: new Date().toISOString()
          });
          this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
        }
      }
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

      // Check iteration ceiling at boundary – drain semantics (already partially does).
      const maxIterations = activeRun.maxIterations;
      if (activeRun.currentIteration >= maxIterations) {
        this.runStore.updateStatus(activeRun.id, "DRAINING");
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Iteration ceiling reached (drained at executor boundary)",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        this.cancelWallClockCeiling(repositoryId);
        return;
      }

      // Wall-clock may have been exceeded during this turn – if so, drain now
      // even if iteration not yet exceeded (accelerated-clock test path).
      if (this.isWallClockCeilingExceeded(activeRun)) {
        this.runStore.updateStatus(activeRun.id, "DRAINING");
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at executor boundary)",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        this.ceilingPending.delete(repositoryId);
        this.cancelWallClockCeiling(repositoryId);
        return;
      }

      // Sol alone is authoritative for GOAL_COMPLETE. Wake Sol with the real
      // result status; Sol decides completion via a control marker (G/H).
      await this.submitSolWakeForRun(repositoryId, activeRun, result.status);
      return;
    }

    // BLOCKED / NEEDS_HUMAN / FAILED: truthful problem or failure state.
    // If drain was pending, FAILED still preserves truthfully but drain takes precedence.
    // For now, drain pending already handled above; here process normally.
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
    this.cancelWallClockCeiling(repositoryId);
  }

  /** Production wiring entry point: watcher detected a durable Sol control marker (H). */
  async onControlDetected(
    repositoryId: string,
    controlId: string,
    decision: SolControlDecision,
    runId: string
  ): Promise<void> {
    // FIX #9: Control marker is the expected Git transition for the pending Sol operation
    try {
      await this.browserManager.completeSolOperation(repositoryId, runId);
    } catch {}

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

    // If draining due to ceiling/stop while Sol active, honor drain at Sol boundary.
    if (this.ceilingPending.has(repositoryId) || this.stopPending.has(repositoryId) || activeRun.status === "DRAINING") {
      const isCeiling = this.ceilingPending.has(repositoryId);
      const isStop = this.stopPending.has(repositoryId);
      // If this control is GOAL_COMPLETE during drain, still prefer ceiling/stop semantics? Spec: ceiling takes precedence.
      if (isCeiling) {
        this.ceilingPending.delete(repositoryId);
        this.cancelWallClockCeiling(repositoryId);
        // Allow the control to be recorded as consumed but transition to CEILING_REACHED, not GOAL_COMPLETE.
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at Sol boundary)",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        return;
      }
      if (isStop) {
        this.stopPending.delete(repositoryId);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(activeRun.id, "STOPPED", {
          lastError: "Stopped by user (drained at Sol boundary)",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
        return;
      }
      // DRAINING without explicit pending set (e.g., iteration drain) – already terminal, ignore.
      if (activeRun.status === "DRAINING") return;
    }

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
    if (targetState === "GOAL_COMPLETE" || targetState === "BLOCKED" || targetState === "NEEDS_HUMAN" || targetState === "PAUSED") {
      this.cancelWallClockCeiling(repositoryId);
    }
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
      } else if (wake.status === "busy") {
        // FIX #10: busy/backpressure is not a hard stall; keep SOL_REVIEWING-like pending but surface busy
        // Bounded: caller already did lock backoff; run stays SOL_PENDING/REVIEWING is ok, but mark busy explicitly
        // Use SOL_STALLED with busy error so UI can show backpressure without closing page incorrectly.
        // Prefer to keep SOL_REVIEWING and let retry/timeout handle it; for now mark SOL_STALLED with retry hint.
        this.runStore.updateStatus(run.id, "SOL_STALLED", {
          lastError: wake.errorMessage || "ChatGPT busy: backpressure",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
      } else {
        this.runStore.updateStatus(run.id, "SOL_STALLED", {
          lastError: wake.errorMessage || "Wake submission failed",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      // Auth/attention is distinct from generic stall but both surface; keep as SOL_STALLED/ATTENTION_REQUIRED downstream
      // For now surface as SOL_STALLED; BrowserManager already prefixes ATTENTION_REQUIRED for loop routing if needed.
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
   * Stop: graceful drain (item #4). Do NOT immediately kill the executor.
   * Mark DRAINING with reason USER_STOP; persist executor result but do NOT
   * hand off to Sol; stop at boundary. Only after active actor boundary is
   * reached transition STOPPED. EMERGENCY KILL remains immediate.
   */
  async stopRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    const actor = getActiveActor(activeRun.status as any);
    if (actor === "EXECUTOR" || actor === "SOL" || activeRun.status === "DRAINING") {
      // Graceful: drain at boundary, truthfully show DRAINING until then.
      if (activeRun.status !== "DRAINING") {
        this.runStore.updateStatus(activeRun.id, "DRAINING", {
          lastError: "Stopped by user (draining)"
        });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      }
      this.stopPending.add(repositoryId);
      // Do NOT kill executor; let it finish via onExecutorCompleted/onControlDetected.
      return;
    }

    // No active actor (e.g., idle boundary) – immediate stop.
    this.runStore.updateStatus(activeRun.id, "STOPPED", {
      lastError: "Stopped by user",
      finishedAt: new Date().toISOString()
    });
    this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
    this.cancelWallClockCeiling(repositoryId);
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

    this.stopPending.delete(repositoryId);
    this.ceilingPending.delete(repositoryId);
    this.cancelWallClockCeiling(repositoryId);

    if (activeRun) {
      this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
        lastError: "Run interrupted by emergency kill. Manual recovery required.",
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, activeRun.id, "RECOVERY_REQUIRED");
    }
  }

  // ---- Wall-clock ceiling tracking (item #3) ----

  private scheduleWallClockCeiling(repositoryId: string, run: RunRecord): void {
    this.cancelWallClockCeiling(repositoryId);
    const repo = this.repoStore.get(repositoryId);
    if (!repo) return;
    const maxMs = (repo.maxRuntimeMinutes || 0) * 60 * 1000;
    if (maxMs <= 0) return;
    const started = new Date(run.startedAt).getTime();
    const now = Date.now();
    const remaining = started + maxMs - now;
    if (remaining <= 0) {
      this.handleWallClockCeiling(repositoryId);
      return;
    }
    const timer = setTimeout(() => this.handleWallClockCeiling(repositoryId), remaining);
    // Allow process to exit without waiting for ceiling timer.
    if ((timer as any).unref) (timer as any).unref();
    this.wallClockTimers.set(repositoryId, timer);
  }

  private cancelWallClockCeiling(repositoryId: string): void {
    const t = this.wallClockTimers.get(repositoryId);
    if (t) {
      clearTimeout(t);
      this.wallClockTimers.delete(repositoryId);
    }
  }

  private handleWallClockCeiling(repositoryId: string): void {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;
    // Terminal already?
    if (["STOPPED", "CEILING_REACHED", "GOAL_COMPLETE", "RECOVERY_REQUIRED"].includes(activeRun.status)) {
      this.ceilingPending.delete(repositoryId);
      return;
    }
    const actor = getActiveActor(activeRun.status as any);
    if (actor === "EXECUTOR" || actor === "SOL") {
      if (activeRun.status !== "DRAINING") {
        this.runStore.updateStatus(activeRun.id, "DRAINING", {
          lastError: "Wall-clock ceiling reached (draining)"
        });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      }
      this.ceilingPending.add(repositoryId);
      // Do NOT kill executor; let it finish naturally and handle at boundary.
      return;
    }
    // No active actor – drain immediately to CEILING_REACHED.
    if (activeRun.status !== "DRAINING") {
      this.runStore.updateStatus(activeRun.id, "DRAINING", {
        lastError: "Wall-clock ceiling reached (draining)"
      });
      this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
    }
    this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
      lastError: "Wall-clock ceiling reached (drained at boundary)",
      finishedAt: new Date().toISOString()
    });
    this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
    this.ceilingPending.delete(repositoryId);
  }

  /** Driven by fake timers in tests: evaluate wall-clock ceiling synchronously. */
  checkWallClockCeiling(repositoryId: string): boolean {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return false;
    if (!this.isWallClockCeilingExceeded(activeRun)) return false;
    this.handleWallClockCeiling(repositoryId);
    return true;
  }

  private isWallClockCeilingExceeded(run: RunRecord): boolean {
    const repo = this.repoStore.get(run.repositoryId);
    if (!repo) return false;
    const maxMs = (repo.maxRuntimeMinutes || 0) * 60 * 1000;
    if (maxMs <= 0) return false;
    const elapsed = Date.now() - new Date(run.startedAt).getTime();
    return elapsed >= maxMs;
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
