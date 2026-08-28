import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "./run-store.js";
import type { StrategyRunStore } from "../strategy/strategy-run-store.js";
import type { DispatchStore } from "../watcher/dispatch-store.js";
import type { ExecutorService } from "../executor/executor-service.js";
import type { SwarmExecutionService } from "../strategy/swarm-execution-service.js";
import type { DagExecutionService } from "../strategy/dag-execution-service.js";
import type { IntegrationService } from "../packets/integration-service.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { LoopService } from "./loop-service.js";
import type { RepositoryMutationEvent } from "@orca/shared";
import { BadRequestError, DomainError } from "@orca/shared";
import type {
  DispatchMarker,
  DispatchExecutionPlan,
  ExecutionStrategy,
  RemotePublishResult,
  RunRecord,
  StrategyControlDecision,
  StrategyRunRecord,
  StrategyRunStatus,
  LoopState,
} from "@orca/shared";
import {
  POSTFLIGHT_BLOCKED_PREFIX,
  StrategyConflictError,
  formatPostflightBlocker,
  isRemotePublishConfirmed,
  isStrategyTerminal,
  type IterationActor,
  type OwnershipCheckOptions,
} from "./strategy-ownership.js";

/** Bounded wait for a strategy record to reach the PAUSED boundary (R3). */
const PAUSE_SETTLE_TIMEOUT_MS = 10_000;
/**
 * Bounded wait for kill settlement evidence. `svc.control(KILL)` already
 * awaits child-process termination, so this only covers the engine's async
 * final-status write; the transition to KILL_REQUESTED settles it early.
 */
const KILL_SETTLE_TIMEOUT_MS = 15_000;
/** Overall shutdown grace for strategy settlement before proceeding anyway. */
const SHUTDOWN_SETTLE_GRACE_MS = 30_000;
/** Bounded wait for in-flight completion callbacks during shutdown (R5). */
const COMPLETION_SETTLE_TIMEOUT_MS = 10_000;
const CONTROL_POLL_INTERVAL_MS = 200;

export interface IterationExecutionCoordinatorOptions {
  repositoryStore: RepositoryStore;
  runStore: RunStore;
  strategyRunStore: StrategyRunStore;
  dispatchStore?: DispatchStore | null;
  executorService: ExecutorService;
  swarmExecutionService: SwarmExecutionService;
  dagExecutionService: DagExecutionService;
  integrationService: IntegrationService;
  loopService: LoopService;
  browserManager: BrowserManager;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

/** Outcome summary of a postflight-only retry sweep (R2). */
export interface PendingPostflightRetrySummary {
  repositoryId: string;
  /** Completed-but-unconfirmed strategies found (dispatch never consumed). */
  candidates: StrategyRunRecord[];
  republished: number;
  confirmed: number;
  blocked: number;
  failures: string[];
}

/** Hooks a strategy engine invokes around a dispatch-authorized start. */
export interface StrategyStartHooks {
  onCompleted?: (record: StrategyRunRecord) => void | Promise<void>;
}

/**
 * The single authoritative execution actor for one repository/campaign
 * iteration. Normalizes start/pause/resume/stop/kill/status/completion/recovery
 * across `SINGLE_AGENT`, `SWARM`, and `DAG`.
 */
export class IterationExecutionCoordinator {
  private readonly repositoryStore: RepositoryStore;
  private readonly runStore: RunStore;
  private readonly strategyRunStore: StrategyRunStore;
  private readonly dispatchStore: DispatchStore | null;
  private readonly executorService: ExecutorService;
  private readonly swarmExecutionService: SwarmExecutionService;
  private readonly dagExecutionService: DagExecutionService;
  private readonly integrationService: IntegrationService;
  private readonly loopService: LoopService;
  private readonly browserManager: BrowserManager;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  /** R5: once set, no new strategy/executor starts are admitted. */
  private shuttingDown = false;
  /** R5: in-flight completion callbacks, awaited (bounded) by shutdown(). */
  private readonly pendingCompletions = new Set<Promise<void>>();
  /**
   * F-MED: serializes postflight retry sweeps per repository. Two rapid
   * retries must never pass the not-consumed gate concurrently and republish
   * the same manifest twice onto remote main.
   */
  private readonly postflightRetryLocks = new Map<
    string,
    Promise<PendingPostflightRetrySummary>
  >();

  /**
   * F-MED-3: admissions predicate for raw executor starts (HTTP seam). The
   * coordinator's own start() enforces this internally; routes that call
   * executorService directly must check it explicitly.
   */
  isAdmittingStarts(): boolean {
    return !this.shuttingDown;
  }

  constructor(options: IterationExecutionCoordinatorOptions) {
    this.repositoryStore = options.repositoryStore;
    this.runStore = options.runStore;
    this.strategyRunStore = options.strategyRunStore;
    this.dispatchStore = options.dispatchStore ?? null;
    this.executorService = options.executorService;
    this.swarmExecutionService = options.swarmExecutionService;
    this.dagExecutionService = options.dagExecutionService;
    this.integrationService = options.integrationService;
    this.loopService = options.loopService;
    this.browserManager = options.browserManager;
    this.eventPublisher = options.eventPublisher;
  }

  /** Resolve the selected strategy from an explicit/durable source. */
  resolveStrategy(dispatch?: DispatchMarker | null): ExecutionStrategy {
    return dispatch?.strategy ?? "SINGLE_AGENT";
  }

  /**
   * Start the iteration's execution strategy. Caller (LoopService or a manual
   * strategy API) MUST have validated the campaign/iteration ownership
   * boundary first via `assertCampaignIterationOwnership`.
   */
  async start(
    repositoryId: string,
    run: RunRecord,
    dispatch: DispatchMarker | null,
    plan: DispatchExecutionPlan = {},
    strategy?: ExecutionStrategy,
  ): Promise<StrategyRunRecord | undefined> {
    // R5 admissions gate: no new actors once shutdown has begun.
    if (this.shuttingDown) {
      throw new BadRequestError(
        `Controller is shutting down; new strategy/executor starts are rejected for repository ${repositoryId}.`,
      );
    }
    // Explicit selection wins (manual advanced starts); otherwise the durable
    // dispatch selection; SINGLE_AGENT remains the default.
    const selected = strategy ?? this.resolveStrategy(dispatch);
    const dispatchId = dispatch?.dispatchId ?? run.activeDispatchId ?? null;

    this.runStore.updateStatus(run.id, "EXECUTOR_PENDING", {
      activeDispatchId: dispatchId,
      currentIteration: dispatch?.iteration ?? run.currentIteration,
    });
    this.publishStateChange(repositoryId, run.id, "EXECUTOR_PENDING");

    this.runStore.updateStatus(run.id, "EXECUTING");
    this.publishStateChange(repositoryId, run.id, "EXECUTING");

    if (selected === "SINGLE_AGENT") {
      await this.executorService.startRun(repositoryId, dispatchId as string);
      return;
    }

    const svc =
      selected === "SWARM"
        ? this.swarmExecutionService
        : this.dagExecutionService;
    const marker: DispatchMarker =
      dispatch ??
      ({
        schemaVersion: 1,
        type: "dispatch",
        runId: run.id,
        dispatchId: dispatchId as string,
        iteration: run.currentIteration,
        createdAt: new Date().toISOString(),
        baseSha: "",
        // No durable dispatch authorizes this manual start; unknown change
        // provenance stays empty (same convention as watcher synthetic records).
        changePath: "",
        goal: run.goal,
        instructionsVersion: 1,
        strategy: selected,
        executionPlan: plan,
      } as DispatchMarker);
    return svc.startStrategyForDispatch(
      repositoryId,
      run.id,
      marker.iteration,
      marker,
      plan,
      {
        onCompleted: (record: StrategyRunRecord) => {
          // R5: track the callback so shutdown can await (bounded) settlement.
          const completion = this.handleStrategyCompleted(repositoryId, record)
            .catch(() => {})
            .finally(() => {
              this.pendingCompletions.delete(completion);
            });
          this.pendingCompletions.add(completion);
          return completion;
        },
      },
      selected === "DAG" ? "DAG" : undefined,
    );
  }

  /**
   * Completion callback fired by the strategy engine when a SWARM/DAG run
   * finishes. Makes integrated `main` durable on the remote, writes the canonical
   * result manifest, and hands the normalized result back to the loop.
   *
   * R1: the engine outcome alone is not authoritative. A COMPLETED strategy
   * whose publication is not confirmed (or that failed) never consumes the
   * dispatch as success; durable `POSTFLIGHT_BLOCKED` evidence is persisted on
   * the strategy record first (the report/provenance stays untouched), then the
   * loop applies the remote-aware decision.
   */
  async handleStrategyCompleted(
    repositoryId: string,
    record: StrategyRunRecord,
  ): Promise<void> {
    const dispatchId = record.dispatchId;
    if (!dispatchId) {
      // Manual/inspection path without an authorizing dispatch: durable remote
      // publish is skipped; the run is left for inspection.
      return;
    }
    let repo: ReturnType<RepositoryStore["get"]> = null;
    try {
      repo = this.repositoryStore.get(repositoryId);
    } catch {
      return; // DB closed during teardown (Fix #11: gracefully exit)
    }
    if (!repo) return;
    let remote: RemotePublishResult | null = null;
    if (record.report) {
      try {
        remote = await this.integrationService.publishToRemote(
          repo,
          record.runId,
          record.iteration,
          dispatchId,
          record.report,
        );
      } catch (err: any) {
        remote = {
          status: "BLOCKED",
          pushedSha: null,
          resultSha: null,
          remoteVerified: false,
          blocker: err?.message ? String(err.message) : String(err),
          details: {},
        };
      }
    }

    if (
      (record.status === "COMPLETED" ||
        record.status === "PARTIAL" ||
        record.status === "BLOCKED") &&
      !isRemotePublishConfirmed(remote)
    ) {
      // Durable publication evidence on the strategy record itself, symmetric
      // for COMPLETED-but-unconfirmed and PARTIAL/BLOCKED outcomes. The
      // record's report (worker/integration/result provenance) is intentionally
      // kept.
      try {
        this.strategyRunStore.update(record.strategyRunId, {
          lastError: `${POSTFLIGHT_BLOCKED_PREFIX} ${formatPostflightBlocker(remote)}`,
        });
      } catch {
        /* teardown-safe: the loop still records run-level evidence */
      }
    }

    try {
      await this.loopService.onStrategyCompleted(
        repositoryId,
        dispatchId,
        record.status,
        record,
        remote,
      );
    } catch {
      // Teardown raced the completion handoff; durable state stays recoverable.
    }
  }

  /**
   * R2: postflight-only retry without any worker rerun. Derives pending
   * publications durably: a strategy record with status COMPLETED whose
   * authorizing dispatch was never consumed represents a completed-but-
   * unconfirmed iteration. Re-invokes `publishToRemote` with the SAME persisted
   * report and re-applies the R1 decision.
   */
  async retryPendingPostflight(
    repositoryId: string,
  ): Promise<PendingPostflightRetrySummary> {
    // F-MED: chain sweeps per repository so only one runs at a time. Two
    // rapid retries both passing the not-consumed gate would republish the
    // same manifest twice (second commit on remote main); serialized, the
    // second sweep re-reads the consumed dispatches and observes the
    // ALREADY_APPLIED/no-op outcome instead.
    const previous =
      this.postflightRetryLocks.get(repositoryId) ?? Promise.resolve();
    const sweep = previous
      .catch(() => {})
      .then(() => this.sweepPendingPostflights(repositoryId));
    this.postflightRetryLocks.set(repositoryId, sweep);
    try {
      return await sweep;
    } finally {
      if (this.postflightRetryLocks.get(repositoryId) === sweep) {
        this.postflightRetryLocks.delete(repositoryId);
      }
    }
  }

  /** Mutex-held body of `retryPendingPostflight` — never call directly. */
  private async sweepPendingPostflights(
    repositoryId: string,
  ): Promise<PendingPostflightRetrySummary> {
    const summary: PendingPostflightRetrySummary = {
      repositoryId,
      candidates: [],
      republished: 0,
      confirmed: 0,
      blocked: 0,
      failures: [],
    };
    let repo: ReturnType<RepositoryStore["get"]> = null;
    try {
      repo = this.repositoryStore.get(repositoryId);
    } catch {
      summary.failures.push("repository store unavailable (DB closed?)");
      return summary;
    }
    if (!repo) return summary;

    let runs: RunRecord[];
    try {
      runs = this.runStore.getByRepository(repositoryId);
    } catch {
      summary.failures.push("run store unavailable (DB closed?)");
      return summary;
    }

    for (const run of runs) {
      let records: StrategyRunRecord[];
      try {
        records = this.strategyRunStore.listByRun(run.id);
      } catch {
        break; // DB closed mid-sweep
      }
      for (const record of records) {
        if (record.status !== "COMPLETED" || !record.report) continue;
        const dispatchId = record.dispatchId;
        if (!dispatchId) continue;
        let alreadyApplied: boolean;
        try {
          // Change 028 moved dispatch consumption to the START of a turn, so a
          // consumed dispatch no longer means the iteration finished. Ask the
          // durable completion record instead, or no postflight retry candidate
          // could ever be found.
          const dispatch = this.dispatchStore?.get(dispatchId) ?? null;
          alreadyApplied =
            dispatch === null || this.loopService.iterationAlreadyCompleted(dispatchId);
        } catch {
          break; // DB closed mid-sweep
        }
        if (alreadyApplied) continue;

        summary.candidates.push(record);
        let remote: RemotePublishResult | null = null;
        try {
          remote = await this.integrationService.publishToRemote(
            repo,
            record.runId,
            record.iteration,
            dispatchId,
            record.report,
          );
        } catch (err: any) {
          remote = {
            status: "BLOCKED",
            pushedSha: null,
            resultSha: null,
            remoteVerified: false,
            blocker: err?.message ? String(err.message) : String(err),
            details: {},
          };
        }
        summary.republished++;

        if (isRemotePublishConfirmed(remote)) {
          try {
            // Clear the stale postflight evidence; provenance stays in report.
            this.strategyRunStore.update(record.strategyRunId, {
              lastError: null,
            });
          } catch {
            /* non-fatal */
          }
          try {
            await this.loopService.completePostflightRetry(repositoryId, record);
            summary.confirmed++;
          } catch (err: any) {
            summary.failures.push(
              `${record.strategyRunId}: ${(err?.message ?? String(err))}`,
            );
          }
        } else {
          summary.blocked++;
          try {
            this.strategyRunStore.update(record.strategyRunId, {
              lastError: `${POSTFLIGHT_BLOCKED_PREFIX} ${formatPostflightBlocker(remote)}`,
            });
          } catch {
            /* non-fatal */
          }
          try {
            await this.loopService.markPostflightBlocked(
              repositoryId,
              record,
              remote,
            );
          } catch {
            /* non-fatal */
          }
        }
      }
    }
    return summary;
  }

  /** R2 startup seam: sweep every repository after restart reconciliation. */
  async retryAllPendingPostflights(): Promise<PendingPostflightRetrySummary[]> {
    const summaries: PendingPostflightRetrySummary[] = [];
    let repos: ReturnType<RepositoryStore["list"]> = [];
    try {
      repos = this.repositoryStore.list();
    } catch {
      return summaries;
    }
    for (const repo of repos) {
      summaries.push(await this.retryPendingPostflight(repo.id));
    }
    return summaries;
  }

  getActiveStrategyRun(repositoryId: string): StrategyRunRecord | null {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return null;
    return this.strategyRunStore.getActiveForRun(activeRun.id);
  }

  getActiveActor(repositoryId: string): IterationActor {
    const activeRun = this.runStore.getActiveRun(repositoryId);
    if (!activeRun) return "NONE";
    const actor =
      activeRun.status === "SOL_PENDING" || activeRun.status === "SOL_REVIEWING"
        ? "SOL"
        : null;
    if (actor) return actor;
    const strategy = this.strategyRunStore.getActiveForRun(activeRun.id);
    if (strategy) return strategy.strategy as IterationActor;
    if (
      activeRun.status === "EXECUTOR_PENDING" ||
      activeRun.status === "EXECUTING"
    )
      return "EXECUTOR";
    return "NONE";
  }

  /**
   * Enforce the campaign/iteration ownership boundary. Throws a structured
   * `StrategyConflictError` when the boundary is not free for a new strategy/
   * executor start. Shared by the autonomous loop and the manual strategy APIs.
   */
  assertCampaignIterationOwnership(
    _repositoryId: string,
    run: RunRecord,
    opts: OwnershipCheckOptions = {},
  ): void {
    const activeStrategyRecord = this.strategyRunStore.getActiveForRun(run.id);
    // A RECOVERY_REQUIRED record is ownership-terminal: it documents the
    // interrupted iteration but must not permanently block a new authorized
    // one (Change 018 review F3 recovery dead-end).
    const activeStrategy =
      activeStrategyRecord?.status === "RECOVERY_REQUIRED"
        ? null
        : activeStrategyRecord;
    const actorIsSol =
      run.status === "SOL_PENDING" || run.status === "SOL_REVIEWING";

    if (actorIsSol && !opts.allowSolBoundary && !opts.authorizedDispatchId) {
      throw new StrategyConflictError(
        "Sol is currently active and no dispatched strategy has been authorized for this iteration.",
        "SOL_ACTIVE_NO_DISPATCH",
        { runId: run.id, status: run.status },
      );
    }

    // A single-agent executor is mid-flight.
    if (
      (run.status === "EXECUTOR_PENDING" || run.status === "EXECUTING") &&
      !activeStrategy
    ) {
      throw new StrategyConflictError(
        "A SINGLE_AGENT executor is already active for this iteration.",
        "EXECUTOR_ACTIVE",
        { runId: run.id, status: run.status },
      );
    }

    if (activeStrategy) {
      throw new StrategyConflictError(
        `Another execution strategy (${activeStrategy.strategy}) is already active for campaign ${run.id}.`,
        "STRATEGY_ACTIVE",
        {
          runId: run.id,
          strategyRunId: activeStrategy.strategyRunId,
          strategy: activeStrategy.strategy,
          status: activeStrategy.status,
        },
      );
    }

    if (
      run.status === "DRAINING" ||
      run.status === "STOPPED" ||
      run.status === "CEILING_REACHED"
    ) {
      throw new StrategyConflictError(
        `Run ${run.id} is in terminal/draining state ${run.status}; no new strategy may start.`,
        "RUN_NOT_RECEPTIVE",
        { runId: run.id, status: run.status },
      );
    }

    // Authorization: dispatch must permit the requested strategy.
    if (opts.requestedStrategy && opts.requestedStrategy !== "SINGLE_AGENT") {
      if (!opts.authorizedDispatchId) {
        throw new StrategyConflictError(
          `Strategy ${opts.requestedStrategy} requires an authorizing dispatch with an execution plan.`,
          "STRATEGY_NOT_AUTHORIZED",
          { runId: run.id, requestedStrategy: opts.requestedStrategy },
        );
      }
      if (
        opts.authorizedStrategy &&
        opts.authorizedStrategy !== opts.requestedStrategy
      ) {
        throw new StrategyConflictError(
          `Dispatch authorizes ${opts.authorizedStrategy} but ${opts.requestedStrategy} was requested.`,
          "DISPATCH_STRATEGY_MISMATCH",
          {
            runId: run.id,
            authorizedStrategy: opts.authorizedStrategy,
            requestedStrategy: opts.requestedStrategy,
          },
        );
      }
    }
  }

  // ---- Campaign controls (compose with whatever strategy is active) ----
  // R3: every control awaits engine acceptance; R4 ordering is strategy-actor
  // state first, campaign state second, and re-applying a decision is a no-op.

  async pause(repositoryId: string): Promise<void> {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    if (active.status === "PAUSED") return; // idempotent re-apply
    // RUNTIME-MODEL §13: Stop is graceful ("allow current actor to finish"),
    // so a pending drain must not be cancellable by Pause. Pausing here would
    // flip DRAINING -> PAUSED with a stale drainReason, and a later resume()
    // would legitimately un-stop the stopping campaign while its completion
    // consumes the dispatch with a suppressed Sol wake.
    if (this.loopService.hasPendingDrain(repositoryId)) {
      throw new BadRequestError(
        `Cannot pause repository ${repositoryId}: a stop/ceiling drain is pending (campaign ${active.status}); Stop is not cancellable by Pause.`,
      );
    }
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) {
      await this.routeStrategyControl(repositoryId, strategy, "PAUSE");
      // No window where campaign=PAUSED while strategy=RUNNING indefinitely:
      // wait (bounded) for the actor boundary before moving the campaign.
      // On timeout/terminal settle this throws and the campaign stays
      // EXECUTING. The engine exposes no safe unwind of the routed PAUSE
      // (RESUME requires the record to already be PAUSED; STOP/KILL cancel
      // the iteration instead of reverting the request), so the latched
      // mismatch is left durable on the strategy record/control state — where
      // resume() below refuses it as an explicit 409 conflict instead of
      // reporting a false-positive success.
      await this.waitForStrategyBoundary(
        strategy.strategyRunId,
        "PAUSED",
        PAUSE_SETTLE_TIMEOUT_MS,
      );
      this.runStore.updateStatus(active.id, "PAUSED");
      this.publishStateChange(repositoryId, active.id, "PAUSED");
      return;
    }
    // Single-agent executor: preserve the original executor-only contract.
    if (active.status === "SOL_PENDING" || active.status === "SOL_REVIEWING") {
      throw new BadRequestError(
        "Pause is only allowed while executor is active.",
      );
    }
    await this.executorService.pauseRun(repositoryId);
    this.runStore.updateStatus(active.id, "PAUSED");
    this.publishStateChange(repositoryId, active.id, "PAUSED");
  }

  async resume(repositoryId: string): Promise<void> {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    if (active.status !== "PAUSED") {
      // Truthful refusal instead of the previous silent no-op that the resume
      // route reported as {status:"resumed"}. This also surfaces the
      // pause-boundary-timeout mismatch: the engine settled PAUSED while the
      // campaign stayed EXECUTING, and nothing else can reconcile it.
      const actor = this.strategyRunStore.getActiveForRun(active.id);
      throw new DomainError(
        "RUN_NOT_PAUSED",
        actor
          ? `Cannot resume repository ${repositoryId}: campaign is ${active.status} while strategy actor ${actor.strategyRunId} is ${actor.status}; expected a PAUSED campaign.`
          : `Cannot resume repository ${repositoryId}: campaign is ${active.status}, not PAUSED.`,
        409,
      );
    }
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) {
      if (strategy.status !== "PAUSED") {
        throw new BadRequestError(
          `Cannot resume: strategy ${strategy.strategyRunId} is ${strategy.status}, not PAUSED.`,
        );
      }
      // Engine RESUME acceptance moves the actor to QUEUED synchronously;
      // a rejection must leave the campaign PAUSED.
      await this.routeStrategyControl(repositoryId, strategy, "RESUME");
      this.runStore.updateStatus(active.id, "EXECUTING");
      this.publishStateChange(repositoryId, active.id, "EXECUTING");
      return;
    }
    await this.loopService.resumeRunInternal(repositoryId);
  }

  async stop(repositoryId: string): Promise<void> {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) {
      // Stamp the drain boundary BEFORE routing STOP: a paused actor settles
      // synchronously inside control() and fires its completion there, so the
      // completion must already observe DRAINING + USER_STOP to land STOPPED
      // truthfully (a post-routing stamp would use a stale PAUSED snapshot and
      // strand the campaign DRAINING). Running actors read the same durable
      // drainReason at their settle boundary.
      if (active.status !== "DRAINING") {
        this.runStore.updateStatus(active.id, "DRAINING", {
          lastError: "Stopped by user (draining)",
          drainReason: "USER_STOP",
        });
        this.publishStateChange(repositoryId, active.id, "DRAINING");
      }
      await this.routeStrategyControl(repositoryId, strategy, "STOP");
      return;
    }
    await this.loopService.stopRunInternal(repositoryId);
  }

  async kill(repositoryId: string): Promise<void> {
    const active = this.runStore.getActiveRun(repositoryId);
    const strategy = active
      ? this.strategyRunStore.getActiveForRun(active.id)
      : null;
    if (strategy) {
      // control(KILL) awaits child-process termination inside the engine; the
      // bounded settlement poll then covers the async final-status write.
      await this.routeStrategyControl(repositoryId, strategy, "KILL");
      await this.waitForStrategySettlement(
        strategy.strategyRunId,
        KILL_SETTLE_TIMEOUT_MS,
      );
    } else {
      await this.executorService.killRun(repositoryId).catch(() => {});
    }
    await this.browserManager.closeRepositoryPage(repositoryId).catch(() => {});
    if (active && active.status !== "RECOVERY_REQUIRED") {
      this.runStore.updateStatus(active.id, "RECOVERY_REQUIRED", {
        lastError:
          "Run interrupted by emergency kill. Manual recovery required.",
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, active.id, "RECOVERY_REQUIRED");
    }
  }

  /**
   * Route STOP to a PAUSED strategy actor without touching campaign state.
   * Used by drain paths (e.g. wall-clock ceiling) whose caller owns the
   * campaign stamps: the paused actor settles synchronously and its completion
   * callback applies the durable drain boundary.
   */
  async stopPausedStrategy(repositoryId: string): Promise<void> {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (!strategy || strategy.status !== "PAUSED") return;
    await this.routeStrategyControl(repositoryId, strategy, "STOP");
  }

  /** Propagate a campaign drain (ceiling/stop) to the active strategy. */
  drainActiveStrategy(repositoryId: string): void {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) {
      // Teardown/drain propagation stays fire-and-forget but never surfaces an
      // unhandled rejection.
      this.routeStrategyControl(repositoryId, strategy, "STOP").catch(
        () => {},
      );
    }
  }

  /**
   * Graceful controller shutdown (item #12, R5). Stop admitting new actors,
   * terminate live strategy child processes (control(KILL) awaits the kills),
   * bound-settle the engines, mark active runs RECOVERY_REQUIRED durably, and
   * settle in-flight completion callbacks before resolving. Durable state and
   * worktrees are preserved for deterministic restart reconstruction.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    interface ShutdownTarget {
      repositoryId: string;
      runId: string;
      strategyRunId?: string;
    }
    const targets: ShutdownTarget[] = [];
    const routed: Promise<void>[] = [];
    for (const repo of this.repositoryStore.list()) {
      let active: ReturnType<RunStore["getActiveRun"]> = null;
      try {
        active = this.runStore.getActiveRun(repo.id);
      } catch {
        break; // DB closed during teardown
      }
      if (!active) continue;
      let strategy: ReturnType<StrategyRunStore["getActiveForRun"]> = null;
      try {
        strategy = this.strategyRunStore.getActiveForRun(active.id);
      } catch {
        break;
      }
      if (!strategy) {
        // F-HIGH-1: a SINGLE_AGENT executor child has no strategy record.
        // Mirror kill()'s non-strategy branch so its process tree dies during
        // shutdown too and the run is marked RECOVERY_REQUIRED durably below.
        // shutdown() (not per-repo killRun) also sweeps runners still inside
        // their launch-retry window, which killRun cannot see.
        targets.push({ repositoryId: repo.id, runId: active.id });
        routed.push(this.executorService.shutdown().catch(() => {}));
        continue;
      }
      targets.push({
        repositoryId: repo.id,
        runId: active.id,
        strategyRunId: strategy.strategyRunId,
      });
      routed.push(
        this.routeStrategyControl(repo.id, strategy, "KILL")
          .then(() =>
            this.waitForStrategySettlement(
              strategy.strategyRunId,
              SHUTDOWN_SETTLE_GRACE_MS,
            ),
          )
          .catch(() => {}),
      );
    }

    // Await all routed control promises (children die inside control()/kill).
    // F-HIGH-2: every chain is bounded by the shutdown grace so a hung kill can
    // never exceed it; total shutdown always resolves.
    await Promise.allSettled(
      routed.map((p) =>
        Promise.race([p, this.delay(SHUTDOWN_SETTLE_GRACE_MS)]),
      ),
    );

    // Actor state first, campaign state second: mark runs for recovery only
    // after the engines settled. Re-applying to an already-recovered run is a
    // no-op.
    for (const target of targets) {
      try {
        const run = this.runStore.get(target.runId);
        if (!run || run.status === "RECOVERY_REQUIRED") continue;
        this.runStore.updateStatus(target.runId, "RECOVERY_REQUIRED", {
          lastError: target.strategyRunId
            ? "Controller shutdown: active strategy marked for recovery."
            : "Controller shutdown: active executor marked for recovery.",
          finishedAt: new Date().toISOString(),
        });
        this.publishStateChange(
          target.repositoryId,
          target.runId,
          "RECOVERY_REQUIRED",
        );
      } catch {
        /* best-effort during teardown */
      }
    }

    // Settle in-flight completion callbacks so their durable writes land while
    // the database is still open (bounded; teardown-safe either way).
    if (this.pendingCompletions.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.pendingCompletions]),
        this.delay(COMPLETION_SETTLE_TIMEOUT_MS),
      ]);
    }
  }

  private routeStrategyControl(
    repositoryId: string,
    strategy: StrategyRunRecord,
    decision: StrategyControlDecision,
  ): Promise<StrategyRunRecord> {
    const svc =
      strategy.strategy === "SWARM"
        ? this.swarmExecutionService
        : this.dagExecutionService;
    // R3: the engine control promise is returned to the caller, which awaits
    // it and owns error propagation (no swallowed rejections here).
    return svc.control(
      repositoryId,
      strategy.strategyRunId,
      decision,
      "orchestrated control",
    );
  }

  /**
   * Bounded poll until the strategy record reaches `targetStatus` (R3/R4).
   * Throws a structured error instead of letting the caller mark the campaign
   * when the boundary is not reached (terminal outcome or timeout).
   */
  private async waitForStrategyBoundary(
    strategyRunId: string,
    targetStatus: StrategyRunStatus,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let record: ReturnType<StrategyRunStore["get"]> = null;
      try {
        record = this.strategyRunStore.get(strategyRunId);
      } catch {
        throw new BadRequestError(
          `Strategy ${strategyRunId} could not be observed while waiting for ${targetStatus}.`,
        );
      }
      if (!record) {
        throw new BadRequestError(
          `Strategy ${strategyRunId} disappeared while waiting for ${targetStatus}.`,
        );
      }
      if (record.status === targetStatus) return;
      if (isStrategyTerminal(record.status)) {
        throw new BadRequestError(
          `Strategy ${strategyRunId} reached terminal status ${record.status} before the ${targetStatus} boundary.`,
        );
      }
      await this.delay(CONTROL_POLL_INTERVAL_MS);
    }
    throw new BadRequestError(
      `Strategy ${strategyRunId} did not reach ${targetStatus} within ${timeoutMs}ms.`,
    );
  }

  /**
   * Bounded kill/shutdown settlement: waits for terminal evidence or the
   * persisted KILL_REQUESTED transition (child processes are already dead —
   * control(KILL) awaited their termination). Never throws; proceeding is
   * always safe because recovery marking does not depend on live children.
   */
  private async waitForStrategySettlement(
    strategyRunId: string,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let record: ReturnType<StrategyRunStore["get"]> = null;
      try {
        record = this.strategyRunStore.get(strategyRunId);
      } catch {
        return; // DB closed during teardown
      }
      if (
        !record ||
        isStrategyTerminal(record.status) ||
        record.controlState === "KILL_REQUESTED"
      ) {
        return;
      }
      await this.delay(CONTROL_POLL_INTERVAL_MS);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private publishStateChange(
    repositoryId: string,
    runId: string,
    loopState: LoopState,
  ): void {
    // F-LOW-2: subscriber throws (e.g. ledger DB writes during teardown) must
    // never break execution flow (same guard style as swarm publish()).
    try {
      this.eventPublisher?.({
        type: "loop.state_changed",
        at: new Date().toISOString(),
        repositoryId,
        data: { runId, loopState, reason: "iteration execution coordinator" },
      } as RepositoryMutationEvent);
    } catch {}
  }
}
