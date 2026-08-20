import crypto from "node:crypto";
import {
  type LoopState,
  type RunRecord,
  type LoopStatusResponse,
  type RepositoryMutationEvent,
  type ExecutorResult,
  type SolWakeResultStatus,
  type SolControlDecision,
  createPhaseBudgetPolicy,
  getActiveActor,
  ValidationError,
  BadRequestError,
  RepositoryNotFoundError
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { SolControlStore, SolControlRecord } from "../watcher/sol-control-store.js";
import type { WatcherService } from "../watcher/watcher-service.js";
import type { ExecutorService } from "../executor/executor-service.js";
import { BUSY_MAX_RETRIES, BUSY_RETRY_MS, type BrowserManager } from "../browser/browser-manager.js";
import type { RunStore } from "./run-store.js";
import type { RunPolicyStore } from "./run-policy-store.js";

export interface LoopServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore?: DispatchStore;
  runStore: RunStore;
  watcherService?: WatcherService;
  executorService: ExecutorService;
  browserManager: BrowserManager;
  solControlStore?: SolControlStore | null;
  runPolicyStore?: RunPolicyStore;
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
  private readonly runPolicyStore?: RunPolicyStore;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  /** Wall-clock ceiling timers per repository (item #3). */
  private readonly wallClockTimers = new Map<string, NodeJS.Timeout>();
  /** Ceiling pending while actor active – drain at boundary without killing. */
  private readonly ceilingPending = new Set<string>();
  /** User stop pending drain – graceful. */
  private readonly stopPending = new Set<string>();
  /** Busy backpressure retry timers per repository (item #3). Counts live durably in the Sol operation store. */
  private readonly busyRetryTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: LoopServiceOptions) {
    this.repoStore = options.repoStore;
    this.dispatchStore = options.dispatchStore ?? null;
    this.runStore = options.runStore;
    this.executorService = options.executorService;
    this.browserManager = options.browserManager;
    this.solControlStore = options.solControlStore ?? null;
    this.runPolicyStore = options.runPolicyStore;
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
    const effectivePolicy = createPhaseBudgetPolicy({ ...repo, maxIterations });

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
      updatedAt: now,
      drainReason: null
    };

    this.runStore.create(runRecord);
    this.runPolicyStore?.save(runId, effectivePolicy, now);
    this.publishStateChange(repositoryId, runId, "SOL_PENDING");
    this.scheduleWallClockCeiling(repositoryId, runRecord);

    // Initial Sol wake carries INITIAL result status: it must NOT pretend an
    // executor result is COMPLETED (G: initial wake truthfulness).
    await this.submitSolWakeForRun(repositoryId, runRecord, "INITIAL");

    return this.runStore.get(runId)!;
  }

  private isDrainPending(repositoryId: string, run: RunRecord | null): boolean {
    if (!run) return false;
    if (this.stopPending.has(repositoryId) || this.ceilingPending.has(repositoryId)) return true;
    const dr = run.drainReason ?? this.runStore.getDrainReason(run.id);
    return dr === 'USER_STOP' || dr === 'WALL_CLOCK_CEILING' || dr === 'ITERATION_CEILING';
  }
  private isStopPendingEffective(repositoryId: string, run: RunRecord | null): boolean {
    if (this.stopPending.has(repositoryId)) return true;
    const dr = run?.drainReason ?? (run ? this.runStore.getDrainReason(run.id) : null);
    return dr === 'USER_STOP';
  }
  private isCeilingPendingEffective(repositoryId: string, run: RunRecord | null): boolean {
    if (this.ceilingPending.has(repositoryId)) return true;
    const dr = run?.drainReason ?? (run ? this.runStore.getDrainReason(run.id) : null);
    return dr === 'WALL_CLOCK_CEILING' || dr === 'ITERATION_CEILING';
  }

  /** Rehydrate wall-clock timers and drain Sets from persisted drainReason after restart (Fix #3/#4). */
  rehydrateWallClockCeilings(): void {
    // Restore in-memory drain mirrors from DB for DRAINING runs
    for (const repo of this.repoStore.list()) {
      const activeRun = this.runStore.getActiveRun(repo.id);
      if (!activeRun) continue;
      const dr = activeRun.drainReason ?? this.runStore.getDrainReason(activeRun.id);
      if (activeRun.status === 'DRAINING') {
        if (dr === 'USER_STOP') this.stopPending.add(repo.id);
        else if (dr === 'WALL_CLOCK_CEILING' || dr === 'ITERATION_CEILING') this.ceilingPending.add(repo.id);
      }
      // Re-arm wall-clock ceiling for every resumable active run
      if (["SOL_PENDING","SOL_REVIEWING","EXECUTOR_PENDING","EXECUTING","DRAINING","PAUSED"].includes(activeRun.status)) {
        this.scheduleWallClockCeiling(repo.id, activeRun);
        // If deadline already expired, schedule will have handled DRAINING; ensure drainReason persisted
        if (this.isWallClockCeilingExceeded(activeRun) && activeRun.status !== 'DRAINING' && activeRun.status !== 'CEILING_REACHED' && activeRun.status !== 'STOPPED') {
          // handleWallClockCeiling would have been called synchronously via schedule if remaining<=0
          // But if it wasn't due to timing, check again
          this.handleWallClockCeiling(repo.id);
        }
      }
    }
  }

  /** Production wiring entry point: watcher detected a durable dispatch commit. */
  async onDispatchDetected(repositoryId: string, dispatchId: string): Promise<void> {
    const preActive = this.runStore.getActiveRun(repositoryId);
    const drainIsStop = preActive ? this.isStopPendingEffective(repositoryId, preActive) : false;
    const drainIsCeiling = preActive ? this.isCeilingPendingEffective(repositoryId, preActive) : false;
    const wasDraining = preActive?.status === "DRAINING" || this.isDrainPending(repositoryId, preActive);

    // Strict correlation: dispatch must belong to the active run and expected iteration
    // Do this inside a guard that catches DB-closed errors after teardown (Fix #11)
    if (preActive && this.dispatchStore) {
      let validCorrelation: boolean;
      try {
        const d = this.dispatchStore.get(dispatchId);
        validCorrelation = !!d &&
          d.repositoryId === repositoryId &&
          d.runId === preActive.id &&
          d.status === "detected" &&
          d.iteration === preActive.currentIteration + 1;
      } catch {
        return;
      }
      if (!validCorrelation) {
        this.publishEvent({
          type: "watcher.dispatch_rejected",
          at: new Date().toISOString(),
          repositoryId,
          data: {
            dispatchId,
            reason: `Stale dispatch correlation rejected: dispatch ${dispatchId} does not match active run ${preActive.id} iteration ${preActive.currentIteration + 1}`,
          },
        } as any);
        return;
      }
    }

    // Draining: a valid dispatch IS the actor boundary for Sol. Complete the boundary without launching executor.
    if (wasDraining) {
      try {
        const dIter = this.dispatchStore?.get(dispatchId)?.iteration;
        await this.browserManager.completeSolOperation(repositoryId, preActive!.id, dIter);
      } catch {}
      const drainRun = this.runStore.getActiveRun(repositoryId) ?? this.runStore.get(preActive!.id);
      if (!drainRun) return;
      if (this.dispatchStore) {
        try { this.dispatchStore.updateStatus(dispatchId, "consumed"); } catch {}
      }
      if (drainIsCeiling || (drainRun.drainReason === 'WALL_CLOCK_CEILING' || drainRun.drainReason === 'ITERATION_CEILING')) {
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(drainRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(drainRun.id, "CEILING_REACHED", { lastError: "Wall-clock ceiling reached (drained at Sol boundary)", finishedAt: new Date().toISOString(), drainReason: null });
        this.publishStateChange(repositoryId, drainRun.id, "CEILING_REACHED");
      } else if (drainIsStop || drainRun.drainReason === 'USER_STOP') {
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(drainRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(drainRun.id, "STOPPED", { lastError: "Stopped by user (drained at Sol boundary)", finishedAt: new Date().toISOString(), drainReason: null });
        this.publishStateChange(repositoryId, drainRun.id, "STOPPED");
      } else {
        // Generic DRAINING without explicit reason: treat as ceiling-style
        this.ceilingPending.delete(repositoryId);
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(drainRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(drainRun.id, "CEILING_REACHED", { lastError: "Drained at Sol boundary", finishedAt: new Date().toISOString(), drainReason: null });
        this.publishStateChange(repositoryId, drainRun.id, "CEILING_REACHED");
      }
      return;
    }

    // Non-draining: close Sol operation then proceed
    try {
      const cur = this.runStore.getActiveRun(repositoryId);
      const dIter = this.dispatchStore?.get(dispatchId)?.iteration;
      await this.browserManager.completeSolOperation(repositoryId, cur?.id, dIter);
    } catch {}

    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    if (!DISPATCH_RECEPTIVE_STATES.includes(activeRun.status)) {
      return;
    }

    // Re-validate correlation against the refreshed active run (race guard)
    try {
      if (this.dispatchStore) {
        const d2 = this.dispatchStore.get(dispatchId);
        if (!d2 || d2.runId !== activeRun.id || d2.iteration !== activeRun.currentIteration + 1) return;
      }
    } catch { return; }

    const dispatch = this.dispatchStore?.get(dispatchId)!;
    const nextIteration = dispatch.iteration;

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
    let activeRun: RunRecord | null;
    try {
      activeRun = this.runStore.getActiveRun(repositoryId);
    } catch {
      return; // DB closed during teardown (Fix #11: surfaced but we gracefully exit)
    }
    if (!activeRun) return;

    // A stop or other terminal transition may have landed while the executor ran.
    if (activeRun.status === "STOPPED" || activeRun.status === "RECOVERY_REQUIRED") {
      return;
    }

    // Drain pending: handle at actor boundary without killing executor (items #3/#4).
    const isDrainingCeiling = activeRun.status === "DRAINING" && this.isCeilingPendingEffective(repositoryId, activeRun);
    const isDrainingStop = activeRun.status === "DRAINING" && this.isStopPendingEffective(repositoryId, activeRun);

    if (isDrainingCeiling || isDrainingStop) {
      // Persist valid result if present; do NOT wake Sol.
      if (result) {
        this.dispatchStore?.updateStatus(dispatchId, "consumed");
      }
      if (isDrainingCeiling) {
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
            lastError: "Wall-clock ceiling reached (drained at executor boundary)",
            finishedAt: new Date().toISOString(),
            drainReason: null
          });
          this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        }
      } else {
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "STOPPED", {
            lastError: "Stopped by user (drained at executor boundary)",
            finishedAt: new Date().toISOString(),
            drainReason: null
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
        this.publishBudgetExpired(repositoryId, activeRun, "CAMPAIGN_ITERATION_CEILING", "EXECUTOR_ACTIVITY");
        this.runStore.updateStatus(activeRun.id, "DRAINING", { drainReason: 'ITERATION_CEILING' });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Iteration ceiling reached (drained at executor boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        this.cancelWallClockCeiling(repositoryId);
        return;
      }

      // Wall-clock may have been exceeded during this turn – if so, drain now
      // even if iteration not yet exceeded (accelerated-clock test path).
      if (this.isWallClockCeilingExceeded(activeRun)) {
        this.publishBudgetExpired(repositoryId, activeRun, "CAMPAIGN_WALL_CLOCK_CEILING", "EXECUTOR_ACTIVITY");
        this.runStore.updateStatus(activeRun.id, "DRAINING", { drainReason: 'WALL_CLOCK_CEILING' });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at executor boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
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
    runId: string,
    _iteration?: number,
    _relatedDispatchId?: string | null
  ): Promise<void> {
    // 1. Fetch the durable control record — authoritative for correlation + validation (item #2/#4).
    let control: SolControlRecord | null = null;
    if (this.solControlStore) {
      try {
        control = this.solControlStore.get(controlId);
      } catch {}
    }

    // 2. Resolve the active run for this repository.
    let activeRun: RunRecord | null;
    try {
      activeRun = this.runStore.getActiveRun(repositoryId);
    } catch {
      return;
    }

    // 3. Idempotency: an already-applied/rejected control must not be re-applied or re-consumed.
    if (control && (control.status === "consumed" || control.status === "rejected")) {
      return;
    }

    // 4. STRICT validation BEFORE any mutation/consumption (items #2/#4). A stale control from an
    //    older iteration of the SAME run must not close the current Sol page, be consumed as a valid
    //    current decision, or change run state. Invalid/stale controls remain auditable (rejected).
    const rejectionReason = this.validateSolControl(repositoryId, control, activeRun, decision);
    if (rejectionReason) {
      if (this.solControlStore && control) {
        try {
          this.solControlStore.updateStatus(controlId, "rejected", rejectionReason);
        } catch {}
      }
      this.publishEvent({
        type: "watcher.control_rejected",
        at: new Date().toISOString(),
        repositoryId,
        data: { controlId, runId, decision, reason: rejectionReason }
      } as any);
      return;
    }

    // 5. Only now: close the Sol operation and mark the control consumed.
    try {
      await this.browserManager.completeSolOperation(repositoryId, runId);
    } catch {}
    if (this.solControlStore && control) {
      try {
        this.solControlStore.updateStatus(controlId, "consumed");
      } catch {}
    }

    if (!activeRun) return;

    // If draining due to ceiling/stop while Sol active, honor drain at Sol boundary.
    if (this.isDrainPending(repositoryId, activeRun) || activeRun.status === "DRAINING") {
      const isCeiling = this.isCeilingPendingEffective(repositoryId, activeRun);
      const isStop = this.isStopPendingEffective(repositoryId, activeRun);
      if (isCeiling) {
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at Sol boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null
        });
        this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
        return;
      }
      if (isStop) {
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(activeRun.id, "STOPPED", {
          lastError: "Stopped by user (drained at Sol boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null
        });
        this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
        return;
      }
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

  /**
   * Validate a Sol control strictly before consumption (items #2/#4). Mirror of the
   * dispatch correlation contract: the control must belong to the active run, the
   * expected Sol iteration, the correct repository, and (when set) the active dispatch.
   * Returns a rejection reason, or null when the control is valid.
   */
  private validateSolControl(
    repositoryId: string,
    control: SolControlRecord | null,
    activeRun: RunRecord | null,
    _decision: SolControlDecision
  ): string | null {
    if (!control) return "control record not found (cannot validate or consume)";
    if (control.status !== "detected") return `control is already ${control.status}, not consumable`;
    if (control.repositoryId !== repositoryId) {
      return `control.repositoryId ${control.repositoryId} does not match ${repositoryId}`;
    }
    if (!activeRun) return "no active run for repository (control references an unknown run)";
    if (control.runId !== activeRun.id) {
      return `control.runId ${control.runId} does not match active run ${activeRun.id}`;
    }
    if (control.iteration !== activeRun.currentIteration) {
      return `control.iteration ${control.iteration} does not match expected Sol iteration ${activeRun.currentIteration}`;
    }
    if (control.relatedDispatchId !== null && control.relatedDispatchId !== activeRun.activeDispatchId) {
      return `control.relatedDispatchId ${control.relatedDispatchId} does not match active dispatch ${activeRun.activeDispatchId}`;
    }
    return null;
  }

  /** Resume BUSY backpressure scheduling after a restart (item #3). Uses the durable budget. */
  rehydrateBusyBackpressure(): void {
    for (const [repoId, op] of this.browserManager.getSolOperations().entries()) {
      if (op.status === "stalled" || op.status === "completed") continue;
      const activeOp = this.browserManager.getActiveOperation(repoId);
      const count = activeOp?.busyRetryCount ?? 0;
      const activeRun = this.runStore.getActiveRun(repoId);
      if (!activeRun) continue;
      const busyRetryMax = this.runPolicyStore?.get(activeRun.id)?.sol.busyRetryMax ?? BUSY_MAX_RETRIES;
      if (count >= busyRetryMax) continue; // exhausted; timeout/stall path handles it
      if (activeRun.status !== "SOL_REVIEWING" && activeRun.status !== "SOL_PENDING") continue;
      if (this.busyRetryTimers.has(repoId)) continue;
      const run = activeRun;
      const resultStatus = activeOp?.resultStatus ?? "INITIAL";
      const handle = setTimeout(() => {
        this.busyRetryTimers.delete(repoId);
        void this.submitSolWakeForRun(repoId, run, resultStatus).catch(() => {});
      }, this.runPolicyStore?.get(run.id)?.sol.busyRetryDelayMs ?? BUSY_RETRY_MS);
      if ((handle as any).unref) (handle as any).unref();
      this.busyRetryTimers.set(repoId, handle);
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
      activeRun.status !== "NEEDS_HUMAN" &&
      activeRun.status !== "ATTENTION_REQUIRED"
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

  private clearBusyRetry(repositoryId: string): void {
    const t = this.busyRetryTimers.get(repositoryId);
    if (t) { clearTimeout(t); this.busyRetryTimers.delete(repositoryId); }
  }
  private publishEvent(event: RepositoryMutationEvent): void {
    if (this.eventPublisher) {
      try { this.eventPublisher(event); } catch (err) { console.warn("[LoopService] publishEvent failed:", err); }
    }
  }
  private async submitSolWakeForRun(
    repositoryId: string,
    run: RunRecord,
    resultStatus: SolWakeResultStatus
  ): Promise<void> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) return;
    const policy = this.runPolicyStore?.get(run.id);

    try {
      const wake = await this.browserManager.submitSolWake(repositoryId, {
        repositoryName: repo.displayName,
        runId: run.id,
        iteration: run.currentIteration,
        dispatchId: run.activeDispatchId || null,
        resultStatus,
        conversationUrl: repo.solConversationUrl,
        completionWaitMs: policy?.sol.completionWaitMs
      });

      // Race check: re-read run before writing SOL_REVIEWING — if drain landed while browser was in-flight, respect it
      const curRun = this.runStore.get(run.id);
      if (!curRun) return;
      if (curRun.status === "DRAINING" || curRun.status === "STOPPED" || curRun.status === "CEILING_REACHED" || this.isDrainPending(repositoryId, curRun)) {
        return;
      }

      if (wake.status === "submitted") {
        this.clearBusyRetry(repositoryId);
        this.runStore.updateStatus(run.id, "SOL_REVIEWING");
        this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
      } else if (wake.status === "busy") {
        // BUSY budget is persisted durably in the Sol operation store (item #3); the
        // browser already incremented busyRetryCount before returning 'busy'. Read it back.
        const count = this.browserManager.getActiveOperation(repositoryId)?.busyRetryCount ?? 0;
        if (count >= (policy?.sol.busyRetryMax ?? BUSY_MAX_RETRIES)) {
          this.clearBusyRetry(repositoryId);
          this.runStore.updateStatus(run.id, "SOL_STALLED", {
            lastError: wake.errorMessage || "ChatGPT busy: backpressure (retries exhausted)",
            finishedAt: new Date().toISOString()
          });
          this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
          return;
        }
        const cur = this.runStore.get(run.id);
        if (cur && cur.status === 'SOL_PENDING') {
          this.runStore.updateStatus(run.id, "SOL_REVIEWING");
          this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
        }
        const handle = setTimeout(() => {
          this.busyRetryTimers.delete(repositoryId);
          void this.submitSolWakeForRun(repositoryId, this.runStore.get(run.id) ?? run, resultStatus);
        }, policy?.sol.busyRetryDelayMs ?? BUSY_RETRY_MS);
        if ((handle as any).unref) (handle as any).unref();
        this.busyRetryTimers.set(repositoryId, handle);
      } else {
        this.clearBusyRetry(repositoryId);
        this.runStore.updateStatus(run.id, "SOL_STALLED", {
          lastError: wake.errorMessage || "Wake submission failed",
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      // Race: don't resurrect draining/terminal run
      const curRun = this.runStore.get(run.id);
      if (curRun && (curRun.status === "STOPPED" || curRun.status === "CEILING_REACHED" || this.isDrainPending(repositoryId, curRun))) return;
      const isAttention = /^(ATTENTION_REQUIRED|CHATGPT_AUTH_REQUIRED)/.test(errorMessage) || /ATTENTION_REQUIRED/.test(errorMessage);
      if (isAttention) {
        this.clearBusyRetry(repositoryId);
        this.runStore.updateStatus(run.id, "ATTENTION_REQUIRED", {
          lastError: errorMessage,
          finishedAt: new Date().toISOString()
        });
        this.publishStateChange(repositoryId, run.id, "ATTENTION_REQUIRED");
        return;
      }
      if (/^BUSY:/.test(errorMessage)) {
        const count = this.browserManager.getActiveOperation(repositoryId)?.busyRetryCount ?? 0;
        if (count >= (policy?.sol.busyRetryMax ?? BUSY_MAX_RETRIES)) {
          this.clearBusyRetry(repositoryId);
          this.runStore.updateStatus(run.id, "SOL_STALLED", {
            lastError: errorMessage,
            finishedAt: new Date().toISOString()
          });
          this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
          return;
        }
        const cur = this.runStore.get(run.id);
        if (cur && cur.status === 'SOL_PENDING') {
          this.runStore.updateStatus(run.id, "SOL_REVIEWING");
          this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
        }
        const handle = setTimeout(() => {
          this.busyRetryTimers.delete(repositoryId);
          void this.submitSolWakeForRun(repositoryId, this.runStore.get(run.id) ?? run, resultStatus);
        }, policy?.sol.busyRetryDelayMs ?? BUSY_RETRY_MS);
        if ((handle as any).unref) (handle as any).unref();
        this.busyRetryTimers.set(repositoryId, handle);
        return;
      }
      this.clearBusyRetry(repositoryId);
      this.runStore.updateStatus(run.id, "SOL_STALLED", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString()
      });
      this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
    }
  }

  /** Pause: terminate the executor promptly to stop inference usage, preserve tree, PAUSED (I). Executor-only. */
  async pauseRun(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;
    const actor = getActiveActor(activeRun.status as any);
    if (actor !== 'EXECUTOR') {
      throw new BadRequestError(`Pause is only allowed while executor is active (current: ${activeRun.status})`);
    }
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
          lastError: "Stopped by user (draining)",
          drainReason: 'USER_STOP'
        });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      } else {
        this.runStore.setDrainReason(activeRun.id, 'USER_STOP');
      }
      this.stopPending.add(repositoryId);
      // Do NOT kill executor; let it finish via onExecutorCompleted/onControlDetected.
      return;
    }

    // No active actor (e.g., idle boundary) – immediate stop.
    this.runStore.updateStatus(activeRun.id, "STOPPED", {
      lastError: "Stopped by user",
      finishedAt: new Date().toISOString(),
      drainReason: null
    });
    this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
    this.runStore.clearDrainReason(activeRun.id);
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
    if (activeRun) this.runStore.clearDrainReason(activeRun.id);
    for (const t of this.busyRetryTimers.values()) clearTimeout(t);
    this.busyRetryTimers.clear();
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
    const maxRuntimeMinutes = this.runPolicyStore?.get(run.id)?.campaign.maxRuntimeMinutes ?? repo.maxRuntimeMinutes;
    const maxMs = (maxRuntimeMinutes || 0) * 60 * 1000;
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
    this.publishBudgetExpired(repositoryId, activeRun, "CAMPAIGN_WALL_CLOCK_CEILING", actor === "EXECUTOR" ? "EXECUTOR_ACTIVITY" : "SOL_REVIEW");
    if (actor === "EXECUTOR" || actor === "SOL") {
      if (activeRun.status !== "DRAINING") {
        this.runStore.updateStatus(activeRun.id, "DRAINING", {
          lastError: "Wall-clock ceiling reached (draining)",
          drainReason: 'WALL_CLOCK_CEILING'
        });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      } else {
        this.runStore.setDrainReason(activeRun.id, 'WALL_CLOCK_CEILING');
      }
      this.ceilingPending.add(repositoryId);
      // Do NOT kill executor; let it finish naturally and handle at boundary.
      return;
    }
    // No active actor – drain immediately to CEILING_REACHED.
    if (activeRun.status !== "DRAINING") {
      this.runStore.updateStatus(activeRun.id, "DRAINING", {
        lastError: "Wall-clock ceiling reached (draining)",
        drainReason: 'WALL_CLOCK_CEILING'
      });
      this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
    }
    this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
      lastError: "Wall-clock ceiling reached (drained at boundary)",
      finishedAt: new Date().toISOString(),
      drainReason: null
    });
    this.publishStateChange(repositoryId, activeRun.id, "CEILING_REACHED");
    this.ceilingPending.delete(repositoryId);
    this.runStore.clearDrainReason(activeRun.id);
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
    const maxRuntimeMinutes = this.runPolicyStore?.get(run.id)?.campaign.maxRuntimeMinutes ?? repo.maxRuntimeMinutes;
    const maxMs = (maxRuntimeMinutes || 0) * 60 * 1000;
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
        const run = this.runStore.get(runId);
        this.eventPublisher({
          type: "loop.state_changed",
          at: new Date().toISOString(),
          repositoryId,
          data: {
            runId,
            loopState,
            iteration: run?.currentIteration,
            dispatchId: run?.activeDispatchId ?? undefined
          }
        });
      } catch (err) {
        console.warn("[LoopService] Failed to publish event:", err);
      }
    }
  }

  private publishBudgetExpired(repositoryId: string, run: RunRecord, reason: string, phase: string): void {
    this.publishEvent({
      type: "budget.expired",
      at: new Date().toISOString(),
      repositoryId,
      data: {
        runId: run.id,
        iteration: run.currentIteration,
        failureReason: reason,
        reason,
        phase
      }
    });
  }
}
