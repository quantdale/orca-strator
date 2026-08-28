import crypto from "node:crypto";
import {
  type LoopState,
  type RunRecord,
  type LoopStatusResponse,
  type RepositoryMutationEvent,
  type ExecutorResult,
  type SolWakeResultStatus,
  type SolControlDecision,
  type StrategyRunStatus,
  type ExecutionStrategy,
  type StrategyRunRecord,
  type RemotePublishResult,
  createPhaseBudgetPolicy,
  getActiveActor,
  ValidationError,
  BadRequestError,
  RepositoryNotFoundError,
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type {
  SolControlStore,
  SolControlRecord,
} from "../watcher/sol-control-store.js";
import type { WatcherService } from "../watcher/watcher-service.js";
import type { ExecutorService } from "../executor/executor-service.js";
import {
  BUSY_MAX_RETRIES,
  BUSY_RETRY_MS,
  type BrowserManager,
} from "../browser/browser-manager.js";
import type { RunStore } from "./run-store.js";
import type { RunPolicyStore } from "./run-policy-store.js";
import type { StrategyRunStore } from "../strategy/strategy-run-store.js";
import type { IterationExecutionCoordinator } from "./iteration-execution-coordinator.js";
import {
  POSTFLIGHT_BLOCKED_PREFIX,
  formatPostflightBlocker,
  isRemotePublishConfirmed,
} from "./strategy-ownership.js";
import type { OrchestrationTransitionService } from "../ownership/transition-service.js";
import type { OutboxItem } from "../ownership/ownership-store.js";

export interface LoopServiceOptions {
  repoStore: RepositoryStore;
  dispatchStore?: DispatchStore;
  runStore: RunStore;
  watcherService?: WatcherService;
  executorService: ExecutorService;
  browserManager: BrowserManager;
  solControlStore?: SolControlStore | null;
  runPolicyStore?: RunPolicyStore;
  strategyRunStore?: StrategyRunStore | null;
  coordinator?: IterationExecutionCoordinator;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
  /** Change 028 (D7/D8/D9/D10): durable transition processor. When present,
   * dispatch consumption + run transition are committed in one transaction and
   * the Sol wake is delivered afterward from a replayable outbox. Absent in
   * legacy/test wiring, which preserves the prior inline behavior.
   */
  transition?: OrchestrationTransitionService;
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
  private readonly strategyRunStore: StrategyRunStore | null;
  private readonly transition?: OrchestrationTransitionService;
  private coordinator?: IterationExecutionCoordinator;
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
    this.strategyRunStore = options.strategyRunStore ?? null;
    this.transition = options.transition;
    this.coordinator = options.coordinator;
    this.eventPublisher = options.eventPublisher;
  }

  /** Wire the coordinator after both services are constructed (app.ts order). */
  setCoordinator(coordinator: IterationExecutionCoordinator): void {
    this.coordinator = coordinator;
  }

  async startRun(
    repositoryId: string,
    params: { goal: string; maxIterations?: number },
  ): Promise<RunRecord> {
    const repo = this.repoStore.get(repositoryId);
    if (!repo) {
      throw new RepositoryNotFoundError(`Repository ${repositoryId} not found`);
    }

    const existingActive = this.runStore.getActiveRun(repositoryId);
    if (existingActive) {
      throw new ValidationError(
        `Run ${existingActive.id} is already active for repository ${repositoryId}`,
      );
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
      drainReason: null,
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
    if (
      this.stopPending.has(repositoryId) ||
      this.ceilingPending.has(repositoryId)
    )
      return true;
    const dr = run.drainReason ?? this.runStore.getDrainReason(run.id);
    return (
      dr === "USER_STOP" ||
      dr === "WALL_CLOCK_CEILING" ||
      dr === "ITERATION_CEILING"
    );
  }
  private isStopPendingEffective(
    repositoryId: string,
    run: RunRecord | null,
  ): boolean {
    if (this.stopPending.has(repositoryId)) return true;
    const dr =
      run?.drainReason ?? (run ? this.runStore.getDrainReason(run.id) : null);
    return dr === "USER_STOP";
  }
  private isCeilingPendingEffective(
    repositoryId: string,
    run: RunRecord | null,
  ): boolean {
    if (this.ceilingPending.has(repositoryId)) return true;
    const dr =
      run?.drainReason ?? (run ? this.runStore.getDrainReason(run.id) : null);
    return dr === "WALL_CLOCK_CEILING" || dr === "ITERATION_CEILING";
  }

  /**
   * Public seam for campaign controls (coordinator pause): true when a
   * graceful drain (user stop or ceiling boundary) is pending or the campaign
   * is already DRAINING. RUNTIME-MODEL §13 makes Stop graceful and therefore
   * not cancellable by Pause.
   */
  hasPendingDrain(repositoryId: string): boolean {
    let activeRun: RunRecord | null = null;
    try {
      activeRun = this.runStore.getActiveRun(repositoryId);
    } catch {
      return false; // DB closed during teardown
    }
    return (
      activeRun?.status === "DRAINING" ||
      this.isDrainPending(repositoryId, activeRun)
    );
  }

  /** Rehydrate wall-clock timers and drain Sets from persisted drainReason after restart (Fix #3/#4). */
  rehydrateWallClockCeilings(): void {
    // Restore in-memory drain mirrors from DB for DRAINING runs
    for (const repo of this.repoStore.list()) {
      const activeRun = this.runStore.getActiveRun(repo.id);
      if (!activeRun) continue;
      const dr =
        activeRun.drainReason ?? this.runStore.getDrainReason(activeRun.id);
      if (activeRun.status === "DRAINING") {
        if (dr === "USER_STOP") this.stopPending.add(repo.id);
        else if (dr === "WALL_CLOCK_CEILING" || dr === "ITERATION_CEILING")
          this.ceilingPending.add(repo.id);
      }
      // Re-arm wall-clock ceiling for every resumable active run
      if (
        [
          "SOL_PENDING",
          "SOL_REVIEWING",
          "EXECUTOR_PENDING",
          "EXECUTING",
          "DRAINING",
          "PAUSED",
        ].includes(activeRun.status)
      ) {
        this.scheduleWallClockCeiling(repo.id, activeRun);
        // If deadline already expired, schedule will have handled DRAINING; ensure drainReason persisted
        if (
          this.isWallClockCeilingExceeded(activeRun) &&
          activeRun.status !== "DRAINING" &&
          activeRun.status !== "CEILING_REACHED" &&
          activeRun.status !== "STOPPED"
        ) {
          // handleWallClockCeiling would have been called synchronously via schedule if remaining<=0
          // But if it wasn't due to timing, check again
          this.handleWallClockCeiling(repo.id);
        }
      }
    }
  }

  /** Production wiring entry point: watcher detected a durable dispatch commit. */
  async onDispatchDetected(
    repositoryId: string,
    dispatchId: string,
  ): Promise<void> {
    const preActive = this.runStore.getActiveRun(repositoryId);
    const drainIsStop = preActive
      ? this.isStopPendingEffective(repositoryId, preActive)
      : false;
    const drainIsCeiling = preActive
      ? this.isCeilingPendingEffective(repositoryId, preActive)
      : false;
    const wasDraining =
      preActive?.status === "DRAINING" ||
      this.isDrainPending(repositoryId, preActive);

    // Strict correlation: dispatch must belong to the active run and expected iteration
    // Do this inside a guard that catches DB-closed errors after teardown (Fix #11)
    if (preActive && this.dispatchStore) {
      let validCorrelation: boolean;
      try {
        const d = this.dispatchStore.get(dispatchId);
        validCorrelation =
          !!d &&
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
    // D9.5: if a durable transition is wired, make dispatch consumption +
    // run transition + Sol-close/actor-start outbox atomic. This is the
    // production path; the legacy inline path below remains for tests
    // without transition wiring.
    if (this.transition && this.dispatchStore && preActive) {
      // Draining branch: atomic dispatch consumed + drain state + outbox close
      if (wasDraining) {
        try {
          const dispatchIter = this.dispatchStore.get(dispatchId)?.iteration;
          const runIdForDrain = preActive.id;
          const pendingStop = drainIsStop || preActive.drainReason === "USER_STOP";
          const pendingCeiling = drainIsCeiling || preActive.drainReason === "WALL_CLOCK_CEILING" || preActive.drainReason === "ITERATION_CEILING";
          await this.transition.enqueueAndApply({
            sourceKind: "DISPATCH",
            sourceId: dispatchId,
            operation: "DISPATCH_DRAIN",
            repositoryId,
            runId: runIdForDrain,
            payloadJson: JSON.stringify({ dispatchIter, pendingStop, pendingCeiling }),
            apply: ({ enqueueOutbox }) => {
              try {
                const d = this.dispatchStore!.get(dispatchId);
                if (d && (d.status === "detected" || (d.status as string) === "pending")) (this.dispatchStore as any).updateStatus(dispatchId, "consumed");
              } catch {}
              const dr = this.runStore.get(runIdForDrain) ?? this.runStore.getActiveRun(repositoryId);
              if (!dr) return;
              if (pendingCeiling) {
                this.ceilingPending.delete(repositoryId);
                try { this.runStore.clearDrainReason(dr.id); } catch {}
                this.cancelWallClockCeiling(repositoryId);
                this.runStore.updateStatus(dr.id, "CEILING_REACHED", { lastError: "Wall-clock ceiling reached (drained at Sol boundary)", finishedAt: new Date().toISOString(), drainReason: null });
              } else if (pendingStop) {
                this.stopPending.delete(repositoryId);
                try { this.runStore.clearDrainReason(dr.id); } catch {}
                this.cancelWallClockCeiling(repositoryId);
                this.runStore.updateStatus(dr.id, "STOPPED", { lastError: "Stopped by user (drained at Sol boundary)", finishedAt: new Date().toISOString(), drainReason: null });
              } else {
                this.ceilingPending.delete(repositoryId);
                this.stopPending.delete(repositoryId);
                try { this.runStore.clearDrainReason(dr.id); } catch {}
                this.cancelWallClockCeiling(repositoryId);
                this.runStore.updateStatus(dr.id, "CEILING_REACHED", { lastError: "Drained at Sol boundary", finishedAt: new Date().toISOString(), drainReason: null });
              }
              enqueueOutbox({ effectKey: `close-sol-${runIdForDrain}-${dispatchId}`, effectKind: "COMPLETE_SOL_OPERATION", repositoryId, runId: runIdForDrain, payloadJson: JSON.stringify({ runId: runIdForDrain, dispatchIter }) });
            },
          });
          await this.transition.replayOutbox((item) => this.deliverOutboxEffect(item));
          try {
            const after = this.runStore.get(runIdForDrain) ?? this.runStore.getActiveRun(repositoryId);
            if (after) this.publishStateChange(repositoryId, after.id, after.status as any);
            this.publishEvent({ type: "loop.drain_completed", at: new Date().toISOString(), repositoryId, data: { dispatchId, drainIsStop, drainIsCeiling } } as any);
          } catch {}
          return;
        } catch {}
      } else {
        // Non-draining: validate iteration + ownership before enqueueing (outside tx)
        const activeForCheck = this.runStore.getActiveRun(repositoryId);
        if (activeForCheck && DISPATCH_RECEPTIVE_STATES.includes(activeForCheck.status)) {
          try {
            const d2 = this.dispatchStore.get(dispatchId);
            if (d2 && d2.runId === activeForCheck.id && d2.iteration === activeForCheck.currentIteration + 1) {
              const dispatchSnap = d2;
              const nextIteration = dispatchSnap.iteration;
              const strategy = this.coordinator?.resolveStrategy(dispatchSnap) ?? "SINGLE_AGENT";
              let ownershipOk = true;
              try {
                this.coordinator?.assertCampaignIterationOwnership(repositoryId, activeForCheck, { requestedStrategy: strategy, allowSolBoundary: true, authorizedDispatchId: dispatchId, authorizedStrategy: strategy });
              } catch (err: any) {
                this.publishEvent({ type: "loop.strategy_conflict", at: new Date().toISOString(), repositoryId, data: { dispatchId, strategy, reason: err?.message ?? String(err) } } as any);
                ownershipOk = false;
              }
              if (ownershipOk) {
                try {
                  const dispatchIter = dispatchSnap.iteration;
                  const runIdToTransit = activeForCheck.id;
                  const executionPlan = (dispatchSnap as unknown as { executionPlan?: unknown }).executionPlan as Record<string, unknown> | undefined;
                  await this.transition.enqueueAndApply({
                    sourceKind: "DISPATCH",
                    sourceId: dispatchId,
                    operation: "DISPATCH_START",
                    repositoryId,
                    runId: runIdToTransit,
                    payloadJson: JSON.stringify({ dispatchIter, nextIteration, strategy }),
                    apply: ({ enqueueOutbox }) => {
                      try {
                        const d = this.dispatchStore!.get(dispatchId);
                        if (d && (d.status === "detected" || (d.status as string) === "pending")) (this.dispatchStore as any).updateStatus(dispatchId, "consumed");
                      } catch {}
                      const cur = this.runStore.get(runIdToTransit);
                      if (!cur || cur.id !== activeForCheck.id) return;
                      if (!DISPATCH_RECEPTIVE_STATES.includes(cur.status as any)) return;
                      this.runStore.updateStatus(cur.id, "EXECUTOR_PENDING", { activeDispatchId: dispatchId, currentIteration: nextIteration });
                      enqueueOutbox({ effectKey: `close-sol-${cur.id}-${dispatchId}`, effectKind: "COMPLETE_SOL_OPERATION", repositoryId, runId: cur.id, payloadJson: JSON.stringify({ runId: cur.id, dispatchIter }) });
                      enqueueOutbox({ effectKey: `start-actor-${cur.id}-${dispatchId}`, effectKind: "START_EXECUTION_ACTOR", repositoryId, runId: cur.id, payloadJson: JSON.stringify({ dispatchId, strategy, executionPlan }) });
                    },
                  });
                  await this.transition.replayOutbox((item) => this.deliverOutboxEffect(item));
                  try { this.publishStateChange(repositoryId, runIdToTransit, "EXECUTOR_PENDING"); } catch {}
                  return;
                } catch {}
              }
            }
          } catch {}
        }
      }
    }

    // Draining: a valid dispatch IS the actor boundary for Sol. Complete the boundary without launching executor.
    if (wasDraining) {
      try {
        const dIter = this.dispatchStore?.get(dispatchId)?.iteration;
        await this.browserManager.completeSolOperation(
          repositoryId,
          preActive!.id,
          dIter,
        );
      } catch {}
      const drainRun =
        this.runStore.getActiveRun(repositoryId) ??
        this.runStore.get(preActive!.id);
      if (!drainRun) return;
      if (this.dispatchStore) {
        try {
          this.dispatchStore.updateStatus(dispatchId, "consumed");
        } catch {}
      }
      if (
        drainIsCeiling ||
        drainRun.drainReason === "WALL_CLOCK_CEILING" ||
        drainRun.drainReason === "ITERATION_CEILING"
      ) {
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(drainRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(drainRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at Sol boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null,
        });
        this.publishStateChange(repositoryId, drainRun.id, "CEILING_REACHED");
      } else if (drainIsStop || drainRun.drainReason === "USER_STOP") {
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(drainRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(drainRun.id, "STOPPED", {
          lastError: "Stopped by user (drained at Sol boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null,
        });
        this.publishStateChange(repositoryId, drainRun.id, "STOPPED");
      } else {
        // Generic DRAINING without explicit reason: treat as ceiling-style
        this.ceilingPending.delete(repositoryId);
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(drainRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(drainRun.id, "CEILING_REACHED", {
          lastError: "Drained at Sol boundary",
          finishedAt: new Date().toISOString(),
          drainReason: null,
        });
        this.publishStateChange(repositoryId, drainRun.id, "CEILING_REACHED");
      }
      return;
    }

    // Non-draining: close Sol operation then proceed
    try {
      const cur = this.runStore.getActiveRun(repositoryId);
      const dIter = this.dispatchStore?.get(dispatchId)?.iteration;
      await this.browserManager.completeSolOperation(
        repositoryId,
        cur?.id,
        dIter,
      );
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
        if (
          !d2 ||
          d2.runId !== activeRun.id ||
          d2.iteration !== activeRun.currentIteration + 1
        )
          return;
      }
    } catch {
      return;
    }

    const dispatch = this.dispatchStore?.get(dispatchId)!;
    const nextIteration = dispatch.iteration;
    const strategy =
      this.coordinator?.resolveStrategy(dispatch) ?? "SINGLE_AGENT";

    // Item #3/#4: enforce the single-actor ownership boundary at the autonomous
    // dispatch seam too. Reject a strategy/executor start while an iteration
    // actor is already active, or when the dispatch does not authorize it.
    try {
      this.coordinator?.assertCampaignIterationOwnership(
        repositoryId,
        activeRun,
        {
          requestedStrategy: strategy,
          allowSolBoundary: true,
          authorizedDispatchId: dispatchId,
          authorizedStrategy: strategy,
        },
      );
    } catch (err: any) {
      this.publishEvent({
        type: "loop.strategy_conflict",
        at: new Date().toISOString(),
        repositoryId,
        data: { dispatchId, strategy, reason: err?.message ?? String(err) },
      } as any);
      return;
    }

    this.runStore.updateStatus(activeRun.id, "EXECUTOR_PENDING", {
      activeDispatchId: dispatchId,
      currentIteration: nextIteration,
    });
    this.publishStateChange(repositoryId, activeRun.id, "EXECUTOR_PENDING");

    try {
      if (!this.coordinator) {
        // Legacy single-agent flow for focused unit tests that have not wired the
        // unified coordinator. Production always wires it (app.ts).
        try {
          await this.executorService.startRun(repositoryId, dispatchId);
        } catch (err) {
          this.runStore.updateStatus(activeRun.id, "EXECUTOR_UNAVAILABLE", {
            lastError: (err as Error | null)?.message || String(err),
            finishedAt: new Date().toISOString(),
          });
          this.publishStateChange(repositoryId, activeRun.id, "EXECUTOR_UNAVAILABLE");
          this.cancelWallClockCeiling(repositoryId);
          return;
        }
        this.runStore.updateStatus(activeRun.id, "EXECUTING");
        this.publishStateChange(repositoryId, activeRun.id, "EXECUTING");
        return;
      }
      await this.coordinator.start(
        repositoryId,
        activeRun,
        dispatch,
        dispatch?.executionPlan ?? {},
      );
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      this.runStore.updateStatus(activeRun.id, "EXECUTOR_UNAVAILABLE", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(
        repositoryId,
        activeRun.id,
        "EXECUTOR_UNAVAILABLE",
      );
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
    result: ExecutorResult | null,
  ): Promise<void> {
    let activeRun: RunRecord | null;
    try {
      activeRun = this.runStore.getActiveRun(repositoryId);
    } catch {
      return; // DB closed during teardown (Fix #11: surfaced but we gracefully exit)
    }
    if (!activeRun) return;

    // A stop or other terminal transition may have landed while the executor ran.
    if (
      activeRun.status === "STOPPED" ||
      activeRun.status === "RECOVERY_REQUIRED"
    ) {
      return;
    }

    if (activeRun.status === "DRAINING") {
      await this.applyIterationCompletion(
        repositoryId,
        activeRun,
        dispatchId,
        false,
        "RECOVERY_REQUIRED",
        !!result,
      );
      return;
    }

    if (!result) {
      this.runStore.updateStatus(activeRun.id, "RECOVERY_REQUIRED", {
        lastError:
          "Executor turn completed without producing a valid, committed result manifest. Treat as invalid/incomplete, not success (E).",
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, activeRun.id, "RECOVERY_REQUIRED");
      return;
    }

    const isCompleted = result.status === "COMPLETED";
    const terminalState: LoopState =
      result.status === "BLOCKED"
        ? "BLOCKED"
        : result.status === "NEEDS_HUMAN"
          ? "NEEDS_HUMAN"
          : "RECOVERY_REQUIRED";

    await this.applyIterationCompletion(
      repositoryId,
      activeRun,
      dispatchId,
      isCompleted,
      terminalState,
      true,
    );
  }

  /**
   * Strategy-completion entry point (SWARM/DAG). Mirrors `onExecutorCompleted`:
   * consumes the authorizing dispatch, honors drain/ceiling boundaries, and
   * wakes Sol on `COMPLETED`. Never maps a strategy result to `GOAL_COMPLETE`.
   *
   * R1: the outcome is AUTHORITATIVE over postflight. An engine COMPLETED only
   * takes the success path when the remote publication is confirmed
   * (`PUBLISHED` + `remoteVerified`); otherwise the run goes to
   * RECOVERY_REQUIRED with durable evidence, the dispatch stays unconsumed,
   * and no COMPLETED wake is sent. PARTIAL/BLOCKED keep their BLOCKED review
   * mapping but reflect publication truthfully in run lastError/event data.
   * A late/duplicate callback for an already-applied completion (dispatch
   * consumed) is a no-op.
   */
  /**
   * Has the iteration authorized by this dispatch already been completed
   * durably?
   *
   * Before Change 028 the answer was `dispatch.status === "consumed"`, because
   * consumption happened AT completion. 028 moved consumption into the atomic
   * DISPATCH_START transition, so every in-flight iteration now has a consumed
   * dispatch and that test answers "yes" for every turn — which silently
   * swallowed every strategy completion and every postflight retry.
   *
   * With the transition processor wired, the durable completion/failure intent
   * for the dispatch is the honest answer. Legacy wiring without a transition
   * processor still consumes at completion, so the old test remains correct
   * there.
   */
  iterationAlreadyCompleted(dispatchId: string): boolean {
    if (this.transition) {
      return this.transition.hasCompletedIterationFor(dispatchId);
    }
    const dispatch = this.dispatchStore?.get(dispatchId) ?? null;
    return dispatch?.status === "consumed";
  }

  async onStrategyCompleted(
    repositoryId: string,
    dispatchId: string,
    status: StrategyRunStatus,
    record: StrategyRunRecord,
    remote: RemotePublishResult | null,
  ): Promise<void> {
    let activeRun: RunRecord | null;
    try {
      activeRun = this.runStore.getActiveRun(repositoryId);
    } catch {
      return;
    }
    if (!activeRun) return;
    if (
      activeRun.status === "STOPPED" ||
      activeRun.status === "RECOVERY_REQUIRED"
    ) {
      return;
    }

    // Idempotency: late/duplicate completion callbacks must not re-apply the
    // iteration. See `iterationAlreadyCompleted` — under Change 028 the
    // dispatch is consumed when the turn STARTS, so consumption alone no longer
    // answers this question.
    try {
      if (this.iterationAlreadyCompleted(dispatchId)) return;
    } catch {
      return; // DB closed during teardown (Fix #11)
    }

    const publicationConfirmed = isRemotePublishConfirmed(remote);

    if (activeRun.status === "DRAINING") {
      // Drain boundary: completion is honored only at the next Sol boundary.
      // F-MED-1: even while draining, an engine COMPLETED consumes the dispatch
      // as successful only when remote publication is confirmed; otherwise the
      // iteration routes to durable postflight-blocked evidence instead of a
      // false success. Non-COMPLETED outcomes keep the drain semantics below
      // (ceiling -> CEILING_REACHED, stop -> STOPPED).
      if (status === "COMPLETED" && !publicationConfirmed) {
        await this.markPostflightBlocked(repositoryId, record, remote);
        return;
      }
      await this.applyIterationCompletion(
        repositoryId,
        activeRun,
        dispatchId,
        status === "COMPLETED",
        "RECOVERY_REQUIRED",
        true,
      );
      return;
    }

    if (status === "COMPLETED") {
      if (publicationConfirmed) {
        // Success path exactly as before: consume dispatch, ceiling gates,
        // COMPLETED Sol wake -> SOL_REVIEWING.
        await this.applyIterationCompletion(
          repositoryId,
          activeRun,
          dispatchId,
          true,
          "RECOVERY_REQUIRED",
          true,
        );
        return;
      }
      // Engine success but unconfirmed/failed publication: do NOT consume the
      // dispatch as successful and do NOT send a COMPLETED wake.
      await this.markPostflightBlocked(repositoryId, record, remote);
      return;
    }

    // Non-COMPLETED outcomes only (COMPLETED is fully intercepted above by the
    // R1 remote-publication gate): PARTIAL/BLOCKED -> BLOCKED for review;
    // everything else -> RECOVERY_REQUIRED. Never GOAL_COMPLETE.
    const terminalState: LoopState =
      status === "PARTIAL" || status === "BLOCKED"
        ? "BLOCKED"
        : "RECOVERY_REQUIRED";
    await this.applyIterationCompletion(
      repositoryId,
      activeRun,
      dispatchId,
      false,
      terminalState,
      true,
      publicationConfirmed ? undefined : formatPostflightBlocker(remote),
    );
  }

  /**
   * R1: transition a run to RECOVERY_REQUIRED after a COMPLETED strategy whose
   * remote publication was not confirmed. Durable evidence lives on the
   * strategy record (written by the coordinator) and in the event stream; the
   * authorizing dispatch stays unconsumed so `retryPendingPostflight` can find
   * the iteration later.
   */
  async markPostflightBlocked(
    repositoryId: string,
    record: StrategyRunRecord,
    remote: RemotePublishResult | null,
  ): Promise<void> {
    const blocker = `${POSTFLIGHT_BLOCKED_PREFIX} ${formatPostflightBlocker(remote)}`;
    let run: RunRecord | null;
    try {
      run = this.runStore.get(record.runId);
    } catch {
      return; // DB closed during teardown (Fix #11)
    }
    if (!run) return;

    if (run.status === "EXECUTOR_PENDING" || run.status === "EXECUTING") {
      this.runStore.updateStatus(run.id, "RECOVERY_REQUIRED", {
        lastError: blocker,
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, run.id, "RECOVERY_REQUIRED");
      this.cancelWallClockCeiling(repositoryId);
    } else if (run.status === "RECOVERY_REQUIRED") {
      // Retry attempt failed again: refresh the recovery evidence in place.
      this.runStore.updateStatus(run.id, "RECOVERY_REQUIRED", {
        lastError: blocker,
      });
    } else if (run.status === "DRAINING") {
      // A COMPLETED-but-unconfirmed publication landing mid-drain must not
      // strand the campaign DRAINING forever: recoverRun rejects DRAINING and
      // the actor is terminal, so nothing could ever settle it. Mirror
      // applyIterationCompletion's drain settlement — release the armed
      // stop/ceiling boundary and persisted drainReason, then route to
      // RECOVERY_REQUIRED with the same durable evidence so postflight
      // retry/recovery can proceed. The dispatch stays unconsumed-as-
      // successful (R1) so retryPendingPostflight can still find it.
      this.ceilingPending.delete(repositoryId);
      this.stopPending.delete(repositoryId);
      this.runStore.clearDrainReason(run.id);
      this.cancelWallClockCeiling(repositoryId);
      this.runStore.updateStatus(run.id, "RECOVERY_REQUIRED", {
        lastError: blocker,
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, run.id, "RECOVERY_REQUIRED");
    } else {
      // The campaign already moved past this iteration (terminal/review
      // state); strategy-record evidence remains the durable trace.
      return;
    }

    this.publishEvent({
      type: "loop.postflight_blocked",
      at: new Date().toISOString(),
      repositoryId,
      data: {
        runId: run.id,
        iteration: record.iteration,
        dispatchId: record.dispatchId ?? undefined,
        strategyRunId: record.strategyRunId,
        strategy: record.strategy,
        reason: blocker,
        remote: remote
          ? {
              status: remote.status,
              pushedSha: remote.pushedSha,
              resultSha: remote.resultSha,
              remoteVerified: remote.remoteVerified,
              blocker: remote.blocker,
            }
          : null,
      },
    } as any); // custom event type: follows the existing cast pattern
  }

  /**
   * R2: finish a completed-but-unconfirmed iteration after the coordinator
   * successfully republished it. Consumes the authorizing dispatch and runs
   * the exact live success continuation (ceiling gates + COMPLETED Sol wake).
   * No model worker is ever spawned here. Refuses as a no-op when the
   * campaign is mid-flight on a newer iteration, so a confirmed old
   * publication can never consume a stale dispatch.
   */
  async completePostflightRetry(
    repositoryId: string,
    record: StrategyRunRecord,
  ): Promise<"WAKE_SUBMITTED" | "CAMPAIGN_CLOSED" | "ALREADY_APPLIED"> {
    const dispatchId = record.dispatchId;
    if (!dispatchId) return "ALREADY_APPLIED";
    let dispatch: ReturnType<DispatchStore["get"]> = null;
    try {
      dispatch = this.dispatchStore?.get(dispatchId) ?? null;
    } catch {
      return "ALREADY_APPLIED"; // DB closed during teardown (Fix #11)
    }
    if (!dispatch) return "ALREADY_APPLIED";
    if (this.iterationAlreadyCompleted(dispatchId)) return "ALREADY_APPLIED";

    let run: RunRecord | null;
    try {
      run = this.runStore.get(record.runId);
    } catch {
      return "ALREADY_APPLIED";
    }
    if (!run) return "ALREADY_APPLIED";

    // R1 concurrency guard: while the campaign is mid-flight on a newer
    // iteration, a confirmed old publication must not consume its stale
    // dispatch or wake Sol. Refuse without consuming so the dispatch/retry
    // evidence stays intact for later reconciliation.
    if (
      [
        "EXECUTING",
        "EXECUTOR_PENDING",
        "SOL_PENDING",
        "SOL_REVIEWING",
      ].includes(run.status)
    ) {
      this.publishEvent({
        type: "loop.postflight_retry_refused",
        at: new Date().toISOString(),
        repositoryId,
        data: {
          runId: run.id,
          iteration: record.iteration,
          dispatchId,
          strategyRunId: record.strategyRunId,
          strategy: record.strategy,
          runStatus: run.status,
          reason:
            "postflight retry refused: campaign is mid-flight on a newer iteration",
        },
      } as any); // custom event type: follows the existing cast pattern
      return "ALREADY_APPLIED";
    }

    // The consumed-status check above proves the dispatch store is wired.
    this.dispatchStore?.updateStatus(dispatchId, "consumed");

    if (
      [
        "STOPPED",
        "CEILING_REACHED",
        "GOAL_COMPLETE",
        "BLOCKED",
        "NEEDS_HUMAN",
        "SOL_STALLED",
        "EXECUTOR_UNAVAILABLE",
        "ATTENTION_REQUIRED",
      ].includes(run.status)
    ) {
      return "CAMPAIGN_CLOSED";
    }
    if (run.status === "DRAINING") {
      // The drain boundary machinery owns closure for draining campaigns.
      return "CAMPAIGN_CLOSED";
    }

    const woke = await this.continueCompletedIteration(repositoryId, run);
    return woke ? "WAKE_SUBMITTED" : "CAMPAIGN_CLOSED";
  }

  /**
   * Shared terminal-boundary logic for both single-agent and strategy
   * completions: consume the dispatch, drain at ceiling/stop boundaries without
   * waking Sol, and on `COMPLETED` check iteration/wall-clock ceilings before
   * handing off to Sol.
   */
  private async applyIterationCompletion(
    repositoryId: string,
    activeRun: RunRecord,
    dispatchId: string,
    isCompleted: boolean,
    terminalState: LoopState,
    hasResult: boolean,
    failureDetail?: string,
  ): Promise<void> {
    // D9.5: drain-boundary strategy completion — make dispatch + run transition atomic when wired
    if (activeRun.status === "DRAINING" && this.transition && this.dispatchStore) {
      try {
        const isCeiling = this.isCeilingPendingEffective(repositoryId, activeRun);
        const isStop = this.isStopPendingEffective(repositoryId, activeRun);
        await this.transition.enqueueAndApply({
          sourceKind: "DISPATCH",
          sourceId: dispatchId,
          operation: hasResult ? "COMPLETE_DRAIN" : "FAIL_DRAIN",
          repositoryId,
          runId: activeRun.id,
          payloadJson: JSON.stringify({ hasResult, isCeiling, isStop }),
          apply: () => {
            if (hasResult) {
              try { this.dispatchStore!.updateStatus(dispatchId, "consumed"); } catch {}
            }
            const refreshed = this.runStore.get(activeRun.id);
            if (!refreshed || refreshed.status !== "DRAINING") return;
            if (isCeiling) {
              this.ceilingPending.delete(repositoryId);
              try { this.runStore.clearDrainReason(activeRun.id); } catch {}
              this.cancelWallClockCeiling(repositoryId);
              this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", { lastError: "Wall-clock ceiling reached (drained at boundary)", finishedAt: new Date().toISOString(), drainReason: null });
            } else if (isStop) {
              this.stopPending.delete(repositoryId);
              try { this.runStore.clearDrainReason(activeRun.id); } catch {}
              this.cancelWallClockCeiling(repositoryId);
              this.runStore.updateStatus(activeRun.id, "STOPPED", { lastError: "Stopped by user (drained at boundary)", finishedAt: new Date().toISOString(), drainReason: null });
            } else {
              this.ceilingPending.delete(repositoryId);
              this.stopPending.delete(repositoryId);
              try { this.runStore.clearDrainReason(activeRun.id); } catch {}
              this.cancelWallClockCeiling(repositoryId);
              this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", { lastError: "Drained at boundary", finishedAt: new Date().toISOString(), drainReason: null });
            }
          },
        });
        try {
          const after = this.runStore.get(activeRun.id);
          if (after) this.publishStateChange(repositoryId, after.id, after.status as any);
        } catch {}
        return;
      } catch {}
    }
    if (activeRun.status === "DRAINING") {
      const isCeiling = this.isCeilingPendingEffective(repositoryId, activeRun);
      const isStop = this.isStopPendingEffective(repositoryId, activeRun);
      if (hasResult) this.dispatchStore?.updateStatus(dispatchId, "consumed");
      if (isCeiling) {
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
            lastError: "Wall-clock ceiling reached (drained at boundary)",
            finishedAt: new Date().toISOString(),
            drainReason: null,
          });
          this.publishStateChange(
            repositoryId,
            activeRun.id,
            "CEILING_REACHED",
          );
        }
      } else if (isStop) {
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "STOPPED", {
            lastError: "Stopped by user (drained at boundary)",
            finishedAt: new Date().toISOString(),
            drainReason: null,
          });
          this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
        }
      } else {
        this.ceilingPending.delete(repositoryId);
        this.stopPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        const refreshed = this.runStore.get(activeRun.id);
        if (refreshed && refreshed.status === "DRAINING") {
          this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
            lastError: "Drained at boundary",
            finishedAt: new Date().toISOString(),
            drainReason: null,
          });
          this.publishStateChange(
            repositoryId,
            activeRun.id,
            "CEILING_REACHED",
          );
        }
      }
      return;
    }

    if (isCompleted) {
      // Change 028 (D10.2/D9): when a durable transition processor is wired,
      // consume the dispatch and enqueue the Sol-wake side effect in ONE
      // transaction; the wake is delivered after commit from a replayable
      // outbox. A crash between commit and delivery replays the wake, so a
      // dispatch can never be `consumed` while its run transition is missing.
      if (this.transition) {
        await this.transition.enqueueAndApply({
          sourceKind: "DISPATCH",
          sourceId: dispatchId,
          operation: "COMPLETE",
          repositoryId,
          runId: activeRun.id,
          payloadJson: JSON.stringify({ iteration: activeRun.currentIteration }),
          apply: ({ enqueueOutbox }) => {
            this.dispatchStore?.updateStatus(dispatchId, "consumed");
            enqueueOutbox({
              effectKey: `sol-wake:${repositoryId}:${activeRun.id}:${dispatchId}`,
              repositoryId,
              runId: activeRun.id,
              effectKind: "SUBMIT_SOL_WAKE",
              payloadJson: JSON.stringify({ resultStatus: "COMPLETED" }),
            });
          },
        });
        await this.transition.replayOutbox((item) => this.deliverOutboxEffect(item));
        return;
      }
      this.dispatchStore?.updateStatus(dispatchId, "consumed");
      await this.continueCompletedIteration(repositoryId, activeRun);
      return;
    }
    // D9.5: failure / non-COMPLETED terminal — make dispatch + run transition atomic when wired
    if (this.transition && this.dispatchStore) {
      try {
        const baseError = terminalState === "RECOVERY_REQUIRED" ? "Strategy turn completed without a valid result; treat as invalid/incomplete." : `Strategy reported ${terminalState}.`;
        const lastError = failureDetail ? `${baseError} (publication: ${failureDetail})` : baseError;
        const finishedAt = new Date().toISOString();
        await this.transition.enqueueAndApply({
          sourceKind: "DISPATCH",
          sourceId: dispatchId,
          operation: `FAIL_${terminalState}`,
          repositoryId,
          runId: activeRun.id,
          payloadJson: JSON.stringify({ terminalState, hasResult, lastError, finishedAt }),
          apply: () => {
            try { if (hasResult) this.dispatchStore!.updateStatus(dispatchId, "consumed"); } catch {}
            const cur = this.runStore.get(activeRun.id);
            if (!cur) return;
            this.runStore.updateStatus(cur.id, terminalState, { lastError, finishedAt, drainReason: null });
            this.cancelWallClockCeiling(repositoryId);
          },
        });
        try { this.publishStateChange(repositoryId, activeRun.id, terminalState as any); } catch {}
        return;
      } catch {}
    }

    const baseError =
      terminalState === "RECOVERY_REQUIRED"
        ? "Strategy turn completed without a valid result; treat as invalid/incomplete."
        : `Strategy reported ${terminalState}.`;
    this.runStore.updateStatus(activeRun.id, terminalState, {
      lastError: failureDetail
        ? `${baseError} (publication: ${failureDetail})`
        : baseError,
      finishedAt: new Date().toISOString(),
    });
    this.publishStateChange(repositoryId, activeRun.id, terminalState);
    this.cancelWallClockCeiling(repositoryId);
  }

  /**
   * Success continuation shared by the live completion path and the R2
   * postflight retry: iteration/wall-clock ceiling gates followed by the
   * COMPLETED Sol wake. Returns true when Sol was woken for the iteration.
   */
  private async continueCompletedIteration(
    repositoryId: string,
    activeRun: RunRecord,
  ): Promise<boolean> {
    const maxIterations = activeRun.maxIterations;
    if (activeRun.currentIteration >= maxIterations) {
      this.publishBudgetExpired(
        repositoryId,
        activeRun,
        "CAMPAIGN_ITERATION_CEILING",
        "EXECUTOR_ACTIVITY",
      );
      this.runStore.updateStatus(activeRun.id, "DRAINING", {
        drainReason: "ITERATION_CEILING",
      });
      this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      this.ceilingPending.add(repositoryId);
      const refreshed = this.runStore.get(activeRun.id);
      if (refreshed && refreshed.status === "DRAINING") {
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Iteration ceiling reached (drained at boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null,
        });
        this.publishStateChange(
          repositoryId,
          activeRun.id,
          "CEILING_REACHED",
        );
      }
      // Delete-symmetry with the wall-clock arm below: this boundary settles
      // synchronously, so the pending entry must not outlive it. The Sets are
      // repository-keyed and a stale entry would kill every future run on this
      // repository at its first dispatch (isDrainPending in
      // onDispatchDetected) until restart.
      this.ceilingPending.delete(repositoryId);
      this.runStore.clearDrainReason(activeRun.id);
      this.cancelWallClockCeiling(repositoryId);
      return false;
    }

    if (this.isWallClockCeilingExceeded(activeRun)) {
      this.publishBudgetExpired(
        repositoryId,
        activeRun,
        "CAMPAIGN_WALL_CLOCK_CEILING",
        "EXECUTOR_ACTIVITY",
      );
      this.runStore.updateStatus(activeRun.id, "DRAINING", {
        drainReason: "WALL_CLOCK_CEILING",
      });
      this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      this.ceilingPending.add(repositoryId);
      const refreshed = this.runStore.get(activeRun.id);
      if (refreshed && refreshed.status === "DRAINING") {
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null,
        });
        this.publishStateChange(
          repositoryId,
          activeRun.id,
          "CEILING_REACHED",
        );
      }
      this.ceilingPending.delete(repositoryId);
      this.runStore.clearDrainReason(activeRun.id);
      this.cancelWallClockCeiling(repositoryId);
      return false;
    }

    await this.submitSolWakeForRun(repositoryId, activeRun, "COMPLETED");
    return true;
  }

  /** Production wiring entry point: watcher detected a durable Sol control marker (H). */
  async onControlDetected(
    repositoryId: string,
    controlId: string,
    decision: SolControlDecision,
    runId: string,
    _iteration?: number,
    _relatedDispatchId?: string | null,
  ): Promise<void> {
    // 1. Fetch the durable control record — authoritative for correlation + validation (item #2/#4).
    let control: SolControlRecord | null = null;
    if (this.solControlStore) {
      try {
        control = this.solControlStore.get(controlId);
      } catch {}
    }

    // 2. Resolve the control target. Active ownership first (getActiveRun
    //    semantics unchanged; SOL_STALLED stays excluded from active
    //    ownership). Only when no active run exists may the LATEST
    //    exact-matching SOL_STALLED run of this repository become the target
    //    (Change 024): the control must reference that exact run, and a
    //    newer active campaign always wins, protecting an older stalled
    //    campaign from late mutation.
    let targetRun: RunRecord | null;
    try {
      targetRun = this.runStore.getActiveRun(repositoryId);
    } catch {
      return;
    }
    let targetIsStalled = false;
    if (!targetRun && control) {
      const stalled = this.runStore.getLatestStalledRun(repositoryId);
      if (stalled && stalled.id === control.runId) {
        targetRun = stalled;
        targetIsStalled = true;
      }
    }

    // 3. Idempotency: an already-applied/rejected control must not be re-applied or re-consumed.
    if (
      control &&
      (control.status === "consumed" || control.status === "rejected")
    ) {
      return;
    }

    // 4. STRICT validation BEFORE any mutation/consumption (items #2/#4). A stale control from an
    //    older iteration of the SAME run must not close the current Sol page, be consumed as a valid
    //    current decision, or change run state. Invalid/stale controls remain auditable (rejected).
    const rejectionReason = this.validateSolControl(
      repositoryId,
      control,
      targetRun,
      decision,
      targetIsStalled,
    );
    if (rejectionReason) {
      if (this.solControlStore && control) {
        try {
          this.solControlStore.updateStatus(
            controlId,
            "rejected",
            rejectionReason,
          );
        } catch {}
      }
      this.publishEvent({
        type: "watcher.control_rejected",
        at: new Date().toISOString(),
        repositoryId,
        data: { controlId, runId, decision, reason: rejectionReason },
      } as any);
      return;
    }

    // Item #11: Sol acts at Sol boundaries. A terminal control racing an
    // active execution actor is invalid external state: reject it without
    // damaging partial work; the actor finishes or is controlled through the
    // campaign controls, then Sol can re-issue at the boundary.
    if (decision === "GOAL_COMPLETE") {
      const actor = this.coordinator?.getActiveActor(repositoryId) ?? "NONE";
      if (actor === "SWARM" || actor === "DAG" || actor === "EXECUTOR") {
        if (this.solControlStore && control) {
          try {
            this.solControlStore.updateStatus(
              controlId,
              "rejected",
              "EXECUTION_ACTOR_ACTIVE",
            );
          } catch {}
        }
        this.publishEvent({
          type: "watcher.control_rejected",
          at: new Date().toISOString(),
          repositoryId,
          data: { controlId, runId, decision, reason: "EXECUTION_ACTOR_ACTIVE" },
        } as any);
        return;
      }
    }

    // 5. Atomically consume the Sol control, transition the run, and enqueue
    // the browser close as a replayable outbox effect (D9.4). External I/O
    // (browser) is never inside the transaction. If a durable transition
    // processor is wired (production), the control and run are committed
    // together; otherwise fall back to the legacy inline path (tests).
    if (this.transition && control && targetRun) {
      // Determine the target run state for each branch, mirroring the legacy
      // logic below but without performing any external I/O inside the
      // transaction. The actual state mutation happens inside enqueueAndApply.
      let atomicTargetState: LoopState | null = null;
      let atomicIsStalled = targetIsStalled;
      let atomicIsDrain = false;
      let atomicDrainKind: "CEILING" | "STOP" | null = null;
      let atomicNeedsPause = false;

      if (targetIsStalled) {
        const cur = this.runStore.get(targetRun.id);
        if (!cur || cur.status !== "SOL_STALLED") return;
        atomicTargetState = decision === "GOAL_COMPLETE" ? "GOAL_COMPLETE" : decision === "BLOCKED" ? "BLOCKED" : "NEEDS_HUMAN";
      } else if (this.isDrainPending(repositoryId, targetRun) || targetRun.status === "DRAINING") {
        const isCeiling = this.isCeilingPendingEffective(repositoryId, targetRun);
        const isStop = this.isStopPendingEffective(repositoryId, targetRun);
        if (isCeiling) {
          atomicTargetState = "CEILING_REACHED";
          atomicIsDrain = true;
          atomicDrainKind = "CEILING";
        } else if (isStop) {
          atomicTargetState = "STOPPED";
          atomicIsDrain = true;
          atomicDrainKind = "STOP";
        } else if (targetRun.status === "DRAINING") {
          return;
        }
      } else {
        atomicTargetState = decision === "GOAL_COMPLETE" ? "GOAL_COMPLETE" : decision === "BLOCKED" ? "BLOCKED" : decision === "NEEDS_HUMAN" ? "NEEDS_HUMAN" : "PAUSED";
        if (decision === "PAUSED") {
          atomicNeedsPause = true;
        }
      }

      if (!atomicTargetState) return;

      if (atomicNeedsPause) {
        try {
          await this.executorService.pauseRun(repositoryId);
        } catch {}
      }

      const controlIdToConsume = control.controlId;
      const runIdToTransition = targetRun.id;
      const repoId = repositoryId;
      const decisionCopy = decision;
      const targetStateCopy = atomicTargetState;
      const isStalledCopy = atomicIsStalled;
      const isDrainCopy = atomicIsDrain;
      const drainKindCopy = atomicDrainKind;

      await this.transition.enqueueAndApply({
        sourceKind: "SOL_CONTROL",
        sourceId: controlIdToConsume,
        operation: "APPLY_SOL_CONTROL",
        repositoryId: repoId,
        runId: runIdToTransition,
        payloadJson: JSON.stringify({ decision: decisionCopy, targetState: targetStateCopy }),
        apply: ({ enqueueOutbox }) => {
          if (!this.solControlStore) return;
          this.solControlStore.updateStatus(controlIdToConsume, "consumed");
          if (isStalledCopy) {
            const cur = this.runStore.get(runIdToTransition);
            if (!cur || cur.status !== "SOL_STALLED") return;
            this.releaseTerminalTimers(repoId);
            this.runStore.updateStatus(cur!.id, targetStateCopy, {
              finishedAt: targetStateCopy === "GOAL_COMPLETE" ? new Date().toISOString() : cur!.finishedAt,
              drainReason: null,
            });
          } else if (isDrainCopy) {
            if (drainKindCopy === "CEILING") {
              this.ceilingPending.delete(repoId);
              this.runStore.clearDrainReason(runIdToTransition);
              this.cancelWallClockCeiling(repoId);
              this.runStore.updateStatus(runIdToTransition, targetStateCopy, {
                lastError: "Wall-clock ceiling reached (drained at Sol boundary)",
                finishedAt: new Date().toISOString(),
                drainReason: null,
              });
            } else if (drainKindCopy === "STOP") {
              this.stopPending.delete(repoId);
              this.runStore.clearDrainReason(runIdToTransition);
              this.cancelWallClockCeiling(repoId);
              this.runStore.updateStatus(runIdToTransition, "STOPPED", {
                lastError: "Stopped by user (drained at Sol boundary)",
                finishedAt: new Date().toISOString(),
                drainReason: null,
              });
            }
          } else {
            const cur = this.runStore.get(runIdToTransition);
            this.runStore.updateStatus(runIdToTransition, targetStateCopy, {
              finishedAt: targetStateCopy === "GOAL_COMPLETE" ? new Date().toISOString() : cur?.finishedAt ?? null,
            });
            if (["GOAL_COMPLETE", "BLOCKED", "NEEDS_HUMAN", "PAUSED"].includes(targetStateCopy as string)) {
              this.cancelWallClockCeiling(repoId);
            }
          }
          enqueueOutbox({
            effectKey: `close-sol-${controlIdToConsume}`,
            repositoryId: repoId,
            runId: runIdToTransition,
            effectKind: "COMPLETE_SOL_OPERATION",
            payloadJson: JSON.stringify({ repositoryId: repoId, runId: runIdToTransition }),
          });
        },
      });
      await this.transition.replayOutbox((item) => this.deliverOutboxEffect(item));

      // Publish state change events after commit (outside transaction).
      const curAfter = this.runStore.get(runIdToTransition);
      if (curAfter) {
        if (isStalledCopy) {
          this.publishStateChange(repoId, curAfter.id, targetStateCopy);
          this.publishEvent({
            type: "loop.control_applied",
            at: new Date().toISOString(),
            repositoryId: repoId,
            data: { controlId: controlIdToConsume, runId: runIdToTransition, decision: decisionCopy, iteration: control?.iteration, targetWasStalled: true },
          } as unknown as RepositoryMutationEvent);
        } else if (isDrainCopy) {
          this.publishStateChange(repoId, curAfter.id, targetStateCopy);
        } else {
          this.publishStateChange(repoId, curAfter.id, targetStateCopy);
        }
      }
      return;
    }

    // Fallback: legacy non-atomic path for tests without transition wiring.
    try {
      await this.browserManager.completeSolOperation(repositoryId, runId);
    } catch {}
    if (this.solControlStore && control) {
      try {
        this.solControlStore.updateStatus(controlId, "consumed");
      } catch {}
    }

    if (!targetRun) return;

    if (targetIsStalled) {
      const cur = this.runStore.get(targetRun.id);
      if (!cur || cur.status !== "SOL_STALLED") return;
      const stalledTargetState: LoopState =
        decision === "GOAL_COMPLETE"
          ? "GOAL_COMPLETE"
          : decision === "BLOCKED"
            ? "BLOCKED"
            : "NEEDS_HUMAN";
      this.releaseTerminalTimers(repositoryId);
      this.runStore.updateStatus(cur.id, stalledTargetState, {
        finishedAt:
          stalledTargetState === "GOAL_COMPLETE"
            ? new Date().toISOString()
            : cur.finishedAt,
        drainReason: null,
      });
      this.publishStateChange(repositoryId, cur.id, stalledTargetState);
      this.publishEvent({
        type: "loop.control_applied",
        at: new Date().toISOString(),
        repositoryId,
        data: {
          controlId,
          runId: cur.id,
          decision,
          iteration: control?.iteration,
          targetWasStalled: true,
        },
      } as unknown as RepositoryMutationEvent);
      return;
    }

    const activeRun = targetRun;

    if (
      this.isDrainPending(repositoryId, activeRun) ||
      activeRun.status === "DRAINING"
    ) {
      const isCeiling = this.isCeilingPendingEffective(repositoryId, activeRun);
      const isStop = this.isStopPendingEffective(repositoryId, activeRun);
      if (isCeiling) {
        this.ceilingPending.delete(repositoryId);
        this.runStore.clearDrainReason(activeRun.id);
        this.cancelWallClockCeiling(repositoryId);
        this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
          lastError: "Wall-clock ceiling reached (drained at Sol boundary)",
          finishedAt: new Date().toISOString(),
          drainReason: null,
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
          drainReason: null,
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
      finishedAt:
        targetState === "GOAL_COMPLETE"
          ? new Date().toISOString()
          : activeRun.finishedAt,
    });
    this.publishStateChange(repositoryId, activeRun.id, targetState);
    if (
      targetState === "GOAL_COMPLETE" ||
      targetState === "BLOCKED" ||
      targetState === "NEEDS_HUMAN" ||
      targetState === "PAUSED"
    ) {
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
    targetRun: RunRecord | null,
    decision: SolControlDecision,
    targetIsStalled = false,
  ): string | null {
    // An execution strategy actor is authoritative for the iteration while it
    // runs. Sol must not act (terminal or pause) until the strategy completes
    // (Change 017 item 11). Reject as stale/invalid.
    const activeStrategy =
      this.coordinator?.getActiveStrategyRun(repositoryId) ?? null;
    if (activeStrategy) {
      return `an execution strategy actor (${activeStrategy.strategy}) is still active for this iteration; Sol control '${decision}' cannot be applied while an execution actor is running`;
    }
    if (!control)
      return "control record not found (cannot validate or consume)";
    if (control.status !== "detected")
      return `control is already ${control.status}, not consumable`;
    if (control.repositoryId !== repositoryId) {
      return `control.repositoryId ${control.repositoryId} does not match ${repositoryId}`;
    }
    if (!targetRun)
      return "no active run for repository (control references an unknown run)";
    if (targetIsStalled) {
      // Change 024: the fallback target must be the exact referenced stalled
      // run, and only terminal decisions may close a stalled campaign.
      if (decision === "PAUSED") {
        return "PAUSED cannot be applied to a SOL_STALLED run (SOL_STALLED_PAUSE_UNSUPPORTED)";
      }
      if (control.runId !== targetRun.id) {
        return `control.runId ${control.runId} does not match the referenced SOL_STALLED run ${targetRun.id}`;
      }
    } else if (control.runId !== targetRun.id) {
      return `control.runId ${control.runId} does not match active run ${targetRun.id}`;
    }
    if (control.iteration !== targetRun.currentIteration) {
      return `control.iteration ${control.iteration} does not match expected Sol iteration ${targetRun.currentIteration}`;
    }
    if (
      control.relatedDispatchId !== null &&
      control.relatedDispatchId !== targetRun.activeDispatchId
    ) {
      return `control.relatedDispatchId ${control.relatedDispatchId} does not match active dispatch ${targetRun.activeDispatchId}`;
    }
    return null;
  }

  /** Resume BUSY backpressure scheduling after a restart (item #3). Uses the durable budget. */
  rehydrateBusyBackpressure(): void {
    for (const [repoId, op] of this.browserManager
      .getSolOperations()
      .entries()) {
      if (op.status === "stalled" || op.status === "completed") continue;
      const activeOp = this.browserManager.getActiveOperation(repoId);
      const count = activeOp?.busyRetryCount ?? 0;
      const activeRun = this.runStore.getActiveRun(repoId);
      if (!activeRun) continue;
      const busyRetryMax =
        this.runPolicyStore?.get(activeRun.id)?.sol.busyRetryMax ??
        BUSY_MAX_RETRIES;
      if (count >= busyRetryMax) continue; // exhausted; timeout/stall path handles it
      if (
        activeRun.status !== "SOL_REVIEWING" &&
        activeRun.status !== "SOL_PENDING"
      )
        continue;
      if (this.busyRetryTimers.has(repoId)) continue;
      const run = activeRun;
      const resultStatus = activeOp?.resultStatus ?? "INITIAL";
      const handle = setTimeout(() => {
        this.busyRetryTimers.delete(repoId);
        void this.submitSolWakeForRun(repoId, run, resultStatus).catch(
          () => {},
        );
      }, this.runPolicyStore?.get(run.id)?.sol.busyRetryDelayMs ??
        BUSY_RETRY_MS);
      if ((handle as any).unref) (handle as any).unref();
      this.busyRetryTimers.set(repoId, handle);
    }
  }

  /**
   * F-LOW-1: clear loop-owned timers (busy-retry backpressure + wall-clock
   * ceilings) so none can fire after coordinator shutdown / DB close.
   */
  shutdown(): void {
    for (const t of this.busyRetryTimers.values()) clearTimeout(t);
    this.busyRetryTimers.clear();
    for (const t of this.wallClockTimers.values()) clearTimeout(t);
    this.wallClockTimers.clear();
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
  async resubmitPendingWake(
    repositoryId: string,
    run: RunRecord,
  ): Promise<void> {
    await this.submitSolWakeForRun(repositoryId, run, "INITIAL");
  }

  async recoverRun(
    repositoryId: string,
    action: "retry" | "stop" | "complete",
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
        `Run ${activeRun.id} is in status ${activeRun.status}, recovery not applicable`,
      );
    }

    if (action === "stop") {
      this.runStore.updateStatus(activeRun.id, "STOPPED", {
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, activeRun.id, "STOPPED");
    } else if (action === "complete") {
      this.runStore.updateStatus(activeRun.id, "GOAL_COMPLETE", {
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, activeRun.id, "GOAL_COMPLETE");
    } else if (action === "retry") {
      // F-MED-2: a POSTFLIGHT_BLOCKED iteration must never rerun model workers.
      // Delegate to the coordinator's postflight-only retry (same persisted
      // report, publication re-applied); fall back to the legacy Sol
      // re-dispatch path when no postflight evidence exists / no coordinator
      // or strategy store is wired (focused unit tests).
      if (
        this.coordinator &&
        this.hasPostflightBlockedEvidence(activeRun.id)
      ) {
        await this.coordinator.retryPendingPostflight(repositoryId);
      } else {
        this.runStore.updateStatus(activeRun.id, "SOL_PENDING");
        this.publishStateChange(repositoryId, activeRun.id, "SOL_PENDING");
        await this.submitSolWakeForRun(repositoryId, activeRun, "INITIAL");
      }
    }

    return this.runStore.get(activeRun.id)!;
  }

  /**
   * True when any COMPLETED strategy record of the run carries
   * POSTFLIGHT_BLOCKED evidence — the retryable-postflight signature that
   * routes recovery to the postflight-only retry. PARTIAL/BLOCKED records
   * carry publication evidence too, but their recovery is a Sol review, never
   * a postflight-only retry.
   */
  private hasPostflightBlockedEvidence(runId: string): boolean {
    if (!this.strategyRunStore) return false;
    try {
      return this.strategyRunStore
        .listByRun(runId)
        .some(
          (record) =>
            record.status === "COMPLETED" &&
            typeof record.lastError === "string" &&
            record.lastError.startsWith(POSTFLIGHT_BLOCKED_PREFIX),
        );
    } catch {
      return false; // DB closed during teardown
    }
  }

  private clearBusyRetry(repositoryId: string): void {
    const t = this.busyRetryTimers.get(repositoryId);
    if (t) {
      clearTimeout(t);
      this.busyRetryTimers.delete(repositoryId);
    }
  }

  /**
   * Release loop-owned timers for a repository whose run reached a terminal/
   * problem state with no live actor (Change 024 audit): busy-backpressure
   * retries and the wall-clock ceiling timer must not outlive the stall.
   */
  releaseTerminalTimers(repositoryId: string): void {
    this.clearBusyRetry(repositoryId);
    this.cancelWallClockCeiling(repositoryId);
  }
  /**
   * Change 028 (D9): deliver one transition outbox side effect after its
   * transaction committed. External I/O (browser/network) lives here, never
   * inside the transition transaction. Currently the only effect is the Sol
   * wake that had been a premature inline call in the completion path.
   */
  private async deliverOutboxEffect(item: OutboxItem): Promise<void> {
    if (item.effectKind === "SUBMIT_SOL_WAKE") {
      const runId = item.runId;
      if (!runId) return;
      const run = this.runStore.get(runId);
      if (!run) return;
      let resultStatus: SolWakeResultStatus = "COMPLETED";
      try {
        const payload = JSON.parse(item.payloadJson || "{}");
        if (payload.resultStatus) resultStatus = payload.resultStatus as SolWakeResultStatus;
      } catch {
        /* default COMPLETED */
      }
      await this.submitSolWakeForRun(item.repositoryId, run, resultStatus);
    } else if (item.effectKind === "COMPLETE_SOL_OPERATION") {
      // Change 028 (D9.4): Sol control browser close is now an outbox effect
      // delivered after the control consumption + run transition commit.
      // Idempotent: completeSolOperation is safe to call when already closed.
      try {
        const payload = JSON.parse(item.payloadJson || "{}");
        const runId = (payload.runId as string) ?? item.runId ?? "";
        if (runId) {
          await this.browserManager.completeSolOperation(item.repositoryId, runId);
        } else {
          await this.browserManager.completeSolOperation(item.repositoryId, item.runId ?? "");
        }
      } catch {
        // best-effort: browser close is idempotent and will be retried via replay
      }
    } else if (item.effectKind === "START_EXECUTION_ACTOR") {
      await this.deliverStartExecutionActor(item);
    } else if (item.effectKind === "CLOSE_REPOSITORY_PAGE") {
      try {
        const payload = JSON.parse(item.payloadJson || "{}");
        const repoId = (payload.repositoryId as string) ?? item.repositoryId;
        await this.browserManager.closeRepositoryPage?.(repoId);
      } catch {
        // idempotent close
      }
    }
  }

  /**
   * Change 028 (D9.5): deliver the actor start committed alongside a
   * DISPATCH_START transition.
   *
   * The transition consumes the dispatch and moves the run to EXECUTOR_PENDING
   * inside one transaction; launching the executor is the post-commit effect.
   * Without this branch the effect was silently marked DELIVERED and the run
   * stalled in EXECUTOR_PENDING forever with its dispatch already consumed —
   * exactly the consumed-without-effect state this campaign exists to prevent.
   *
   * Exactly-once boundary (spec: "actor-start replay does not double-spawn"):
   * a run that is no longer EXECUTOR_PENDING, or no longer points at this
   * dispatch, has already had its actor started (or been superseded), so replay
   * is a no-op. The coordinator's campaign/iteration ownership assertion is the
   * durable second gate; a rejection there means another actor already owns the
   * iteration and must not be duplicated.
   */
  private async deliverStartExecutionActor(item: OutboxItem): Promise<void> {
    const runId = item.runId;
    if (!runId) return;
    let dispatchId = "";
    let strategy: ExecutionStrategy | undefined;
    let executionPlan: Record<string, unknown> | undefined;
    try {
      const payload = JSON.parse(item.payloadJson || "{}");
      dispatchId = (payload.dispatchId as string) ?? "";
      strategy = payload.strategy as ExecutionStrategy | undefined;
      executionPlan = payload.executionPlan as Record<string, unknown> | undefined;
    } catch {
      return;
    }
    if (!dispatchId) return;

    const run = this.runStore.get(runId);
    if (!run) return;
    // Already started, superseded, or terminal: never spawn a second actor.
    if (run.status !== "EXECUTOR_PENDING") return;
    if (run.activeDispatchId !== dispatchId) return;

    // A strategy record already exists for this run: the actor was started and
    // only the delivery acknowledgement was lost. Reconcile, never re-spawn.
    try {
      if (this.strategyRunStore?.getActiveForRun(run.id)) return;
    } catch {
      // Store unavailable: the run-status boundary above still holds.
    }

    const dispatch = this.dispatchStore?.get(dispatchId) ?? null;

    try {
      if (!this.coordinator) {
        // Legacy single-agent flow for focused unit tests that have not wired
        // the unified coordinator. Production always wires it (app.ts).
        await this.executorService.startRun(item.repositoryId, dispatchId);
        this.runStore.updateStatus(run.id, "EXECUTING");
        this.publishStateChange(item.repositoryId, run.id, "EXECUTING");
        return;
      }
      await this.coordinator.start(
        item.repositoryId,
        run,
        dispatch as never,
        (executionPlan ?? (dispatch as unknown as { executionPlan?: unknown })?.executionPlan ?? {}) as never,
        strategy,
      );
    } catch (err: any) {
      // The durable failure belongs on the run, not on the outbox: a retry
      // would risk a second spawn against an unverifiable first attempt.
      const errorMessage = err?.message || String(err);
      this.runStore.updateStatus(run.id, "EXECUTOR_UNAVAILABLE", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(item.repositoryId, run.id, "EXECUTOR_UNAVAILABLE");
      this.cancelWallClockCeiling(item.repositoryId);
    }
  }

  /** Startup replay of outbox effects left PENDING by a controller crash. */
  async replayPendingTransitionOutbox(): Promise<void> {
    if (!this.transition) return;
    await this.transition.replayOutbox((item) => this.deliverOutboxEffect(item));
  }

  private publishEvent(event: RepositoryMutationEvent): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher(event);
      } catch (err) {
        console.warn("[LoopService] publishEvent failed:", err);
      }
    }
  }
  private async submitSolWakeForRun(
    repositoryId: string,
    run: RunRecord,
    resultStatus: SolWakeResultStatus,
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
        completionWaitMs: policy?.sol.completionWaitMs,
      });

      // Race check: re-read run before writing SOL_REVIEWING — if drain landed while browser was in-flight, respect it
      const curRun = this.runStore.get(run.id);
      if (!curRun) return;
      if (
        curRun.status === "DRAINING" ||
        curRun.status === "STOPPED" ||
        curRun.status === "CEILING_REACHED" ||
        this.isDrainPending(repositoryId, curRun)
      ) {
        return;
      }

      if (wake.status === "submitted") {
        this.clearBusyRetry(repositoryId);
        this.runStore.updateStatus(run.id, "SOL_REVIEWING");
        this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
      } else if (wake.status === "busy") {
        // BUSY budget is persisted durably in the Sol operation store (item #3); the
        // browser already incremented busyRetryCount before returning 'busy'. Read it back.
        const count =
          this.browserManager.getActiveOperation(repositoryId)
            ?.busyRetryCount ?? 0;
        if (count >= (policy?.sol.busyRetryMax ?? BUSY_MAX_RETRIES)) {
          this.releaseTerminalTimers(repositoryId);
          this.runStore.updateStatus(run.id, "SOL_STALLED", {
            lastError:
              wake.errorMessage ||
              "ChatGPT busy: backpressure (retries exhausted)",
            finishedAt: new Date().toISOString(),
          });
          this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
          return;
        }
        const cur = this.runStore.get(run.id);
        if (cur && cur.status === "SOL_PENDING") {
          this.runStore.updateStatus(run.id, "SOL_REVIEWING");
          this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
        }
        const handle = setTimeout(() => {
          this.busyRetryTimers.delete(repositoryId);
          void this.submitSolWakeForRun(
            repositoryId,
            this.runStore.get(run.id) ?? run,
            resultStatus,
          );
        }, policy?.sol.busyRetryDelayMs ?? BUSY_RETRY_MS);
        if ((handle as any).unref) (handle as any).unref();
        this.busyRetryTimers.set(repositoryId, handle);
      } else {
        this.releaseTerminalTimers(repositoryId);
        this.runStore.updateStatus(run.id, "SOL_STALLED", {
          lastError: wake.errorMessage || "Wake submission failed",
          finishedAt: new Date().toISOString(),
        });
        this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      // Race: don't resurrect draining/terminal run
      const curRun = this.runStore.get(run.id);
      if (
        curRun &&
        (curRun.status === "STOPPED" ||
          curRun.status === "CEILING_REACHED" ||
          this.isDrainPending(repositoryId, curRun))
      )
        return;
      const isAttention =
        /^(ATTENTION_REQUIRED|CHATGPT_AUTH_REQUIRED)/.test(errorMessage) ||
        /ATTENTION_REQUIRED/.test(errorMessage);
      if (isAttention) {
        this.clearBusyRetry(repositoryId);
        this.runStore.updateStatus(run.id, "ATTENTION_REQUIRED", {
          lastError: errorMessage,
          finishedAt: new Date().toISOString(),
        });
        this.publishStateChange(repositoryId, run.id, "ATTENTION_REQUIRED");
        return;
      }
      if (/^BUSY:/.test(errorMessage)) {
        const count =
          this.browserManager.getActiveOperation(repositoryId)
            ?.busyRetryCount ?? 0;
        if (count >= (policy?.sol.busyRetryMax ?? BUSY_MAX_RETRIES)) {
          this.releaseTerminalTimers(repositoryId);
          this.runStore.updateStatus(run.id, "SOL_STALLED", {
            lastError: errorMessage,
            finishedAt: new Date().toISOString(),
          });
          this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
          return;
        }
        const cur = this.runStore.get(run.id);
        if (cur && cur.status === "SOL_PENDING") {
          this.runStore.updateStatus(run.id, "SOL_REVIEWING");
          this.publishStateChange(repositoryId, run.id, "SOL_REVIEWING");
        }
        const handle = setTimeout(() => {
          this.busyRetryTimers.delete(repositoryId);
          void this.submitSolWakeForRun(
            repositoryId,
            this.runStore.get(run.id) ?? run,
            resultStatus,
          );
        }, policy?.sol.busyRetryDelayMs ?? BUSY_RETRY_MS);
        if ((handle as any).unref) (handle as any).unref();
        this.busyRetryTimers.set(repositoryId, handle);
        return;
      }
      this.releaseTerminalTimers(repositoryId);
      this.runStore.updateStatus(run.id, "SOL_STALLED", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, run.id, "SOL_STALLED");
    }
  }

  /** Pause: route through the coordinator so the active strategy actor is paused. */
  async pauseRun(repositoryId: string): Promise<void> {
    if (this.coordinator) {
      await this.coordinator.pause(repositoryId);
      return;
    }
    return this.pauseRunInternal(repositoryId);
  }

  /** Pause the single-agent executor (used by the coordinator). Executor-only. */
  private async pauseRunInternal(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;
    const actor = getActiveActor(activeRun.status as any);
    if (actor !== "EXECUTOR") {
      throw new BadRequestError(
        `Pause is only allowed while executor is active (current: ${activeRun.status})`,
      );
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
    if (this.coordinator) {
      await this.coordinator.resume(repositoryId);
      return;
    }
    return this.resumeRunInternal(repositoryId);
  }

  /** Resume the single-agent executor for the same unfinished dispatch. */
  async resumeRunInternal(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun || activeRun.status !== "PAUSED") return;
    if (!activeRun.activeDispatchId) return;

    this.runStore.updateStatus(activeRun.id, "EXECUTING");
    this.publishStateChange(repositoryId, activeRun.id, "EXECUTING");

    try {
      await this.executorService.startRun(
        repositoryId,
        activeRun.activeDispatchId,
        { recovery: true },
      );
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      this.runStore.updateStatus(activeRun.id, "EXECUTOR_UNAVAILABLE", {
        lastError: errorMessage,
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(
        repositoryId,
        activeRun.id,
        "EXECUTOR_UNAVAILABLE",
      );
    }
  }

  /**
   * Stop: graceful drain (item #4). Do NOT immediately kill the executor.
   * Mark DRAINING with reason USER_STOP; persist executor result but do NOT
   * hand off to Sol; stop at boundary. Only after active actor boundary is
   * reached transition STOPPED. EMERGENCY KILL remains immediate.
   */
  async stopRun(repositoryId: string): Promise<void> {
    if (this.coordinator) {
      await this.coordinator.stop(repositoryId);
      return;
    }
    return this.stopRunInternal(repositoryId);
  }

  /** Graceful drain for the single-agent executor (used by the coordinator). */
  async stopRunInternal(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;

    const actor = getActiveActor(activeRun.status as any);
    if (
      actor === "EXECUTOR" ||
      actor === "SOL" ||
      activeRun.status === "DRAINING"
    ) {
      // Graceful: drain at boundary, truthfully show DRAINING until then.
      if (activeRun.status === "DRAINING") {
        this.runStore.setDrainReason(activeRun.id, "USER_STOP");
      } else {
        this.runStore.updateStatus(activeRun.id, "DRAINING", {
          lastError: "Stopped by user (draining)",
          drainReason: "USER_STOP",
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
      finishedAt: new Date().toISOString(),
      drainReason: null,
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
    if (this.coordinator) {
      await this.coordinator.kill(repositoryId);
      return;
    }
    return this.emergencyKillInternal(repositoryId);
  }

  /** Immediate kill of the single-agent executor (used by the coordinator). */
  private async emergencyKillInternal(repositoryId: string): Promise<void> {
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
        lastError:
          "Run interrupted by emergency kill. Manual recovery required.",
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, activeRun.id, "RECOVERY_REQUIRED");
    }
  }

  // ---- Wall-clock ceiling tracking (item #3) ----

  private scheduleWallClockCeiling(repositoryId: string, run: RunRecord): void {
    this.cancelWallClockCeiling(repositoryId);
    const repo = this.repoStore.get(repositoryId);
    if (!repo) return;
    const maxRuntimeMinutes =
      this.runPolicyStore?.get(run.id)?.campaign.maxRuntimeMinutes ??
      repo.maxRuntimeMinutes;
    const maxMs = (maxRuntimeMinutes || 0) * 60 * 1000;
    if (maxMs <= 0) return;
    const started = new Date(run.startedAt).getTime();
    const now = Date.now();
    const remaining = started + maxMs - now;
    if (remaining <= 0) {
      this.handleWallClockCeiling(repositoryId);
      return;
    }
    const timer = setTimeout(
      () => this.handleWallClockCeiling(repositoryId),
      remaining,
    );
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

  private async handleWallClockCeiling(repositoryId: string): Promise<void> {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return;
    // Terminal already?
    if (
      [
        "STOPPED",
        "CEILING_REACHED",
        "GOAL_COMPLETE",
        "RECOVERY_REQUIRED",
      ].includes(activeRun.status)
    ) {
      this.ceilingPending.delete(repositoryId);
      return;
    }
    const actor = getActiveActor(activeRun.status as any);
    this.publishBudgetExpired(
      repositoryId,
      activeRun,
      "CAMPAIGN_WALL_CLOCK_CEILING",
      actor === "EXECUTOR" ? "EXECUTOR_ACTIVITY" : "SOL_REVIEW",
    );
    if (actor === "EXECUTOR" || actor === "SOL") {
      if (activeRun.status === "DRAINING") {
        this.runStore.setDrainReason(activeRun.id, "WALL_CLOCK_CEILING");
      } else {
        this.runStore.updateStatus(activeRun.id, "DRAINING", {
          lastError: "Wall-clock ceiling reached (draining)",
          drainReason: "WALL_CLOCK_CEILING",
        });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      }
      this.ceilingPending.add(repositoryId);
      // Propagate the drain to a live strategy actor (graceful stop at boundary).
      this.coordinator?.drainActiveStrategy(repositoryId);
      // Do NOT kill executor; let it finish naturally and handle at boundary.
      return;
    }
    // A PAUSED strategy actor has no live engine loop; settle it through the
    // paused-actor path so it cannot be stranded PAUSED under a terminal
    // campaign (Change 018 review F4). The completion callback applies the
    // durable WALL_CLOCK_CEILING drain boundary.
    const pausedStrategy = this.coordinator?.getActiveStrategyRun(repositoryId);
    if (pausedStrategy && pausedStrategy.status === "PAUSED") {
      if (activeRun.status !== "DRAINING") {
        this.runStore.updateStatus(activeRun.id, "DRAINING", {
          lastError: "Wall-clock ceiling reached (draining)",
          drainReason: "WALL_CLOCK_CEILING",
        });
        this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
      }
      this.ceilingPending.add(repositoryId);
      await this.coordinator?.stopPausedStrategy(repositoryId);
      return;
    }
    // No active actor – drain immediately to CEILING_REACHED.
    if (activeRun.status !== "DRAINING") {
      this.runStore.updateStatus(activeRun.id, "DRAINING", {
        lastError: "Wall-clock ceiling reached (draining)",
        drainReason: "WALL_CLOCK_CEILING",
      });
      this.publishStateChange(repositoryId, activeRun.id, "DRAINING");
    }
    this.runStore.updateStatus(activeRun.id, "CEILING_REACHED", {
      lastError: "Wall-clock ceiling reached (drained at boundary)",
      finishedAt: new Date().toISOString(),
      drainReason: null,
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
    const maxRuntimeMinutes =
      this.runPolicyStore?.get(run.id)?.campaign.maxRuntimeMinutes ??
      repo.maxRuntimeMinutes;
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
      activeActor: getActiveActor(state),
    };
  }

  private idleStatus(repositoryId: string): LoopStatusResponse {
    return {
      repositoryId,
      state: "IDLE",
      activeRun: null,
      currentIteration: 0,
      maxIterations: 0,
      activeActor: "NONE",
    };
  }

  private publishStateChange(
    repositoryId: string,
    runId: string,
    loopState: LoopState,
  ): void {
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
            dispatchId: run?.activeDispatchId ?? undefined,
          },
        });
      } catch (err) {
        console.warn("[LoopService] Failed to publish event:", err);
      }
    }
  }

  private publishBudgetExpired(
    repositoryId: string,
    run: RunRecord,
    reason: string,
    phase: string,
  ): void {
    this.publishEvent({
      type: "budget.expired",
      at: new Date().toISOString(),
      repositoryId,
      data: {
        runId: run.id,
        iteration: run.currentIteration,
        failureReason: reason,
        reason,
        phase,
      },
    });
  }
}
