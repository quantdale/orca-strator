import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "./run-store.js";
import type { StrategyRunStore } from "../strategy/strategy-run-store.js";
import type { ExecutorService } from "../executor/executor-service.js";
import type { SwarmExecutionService } from "../strategy/swarm-execution-service.js";
import type { DagExecutionService } from "../strategy/dag-execution-service.js";
import type { IntegrationService } from "../packets/integration-service.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { LoopService } from "./loop-service.js";
import type { RepositoryMutationEvent } from "@orca/shared";
import { BadRequestError } from "@orca/shared";
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
  StrategyConflictError,
  type IterationActor,
  type OwnershipCheckOptions,
} from "./strategy-ownership.js";

export interface IterationExecutionCoordinatorOptions {
  repositoryStore: RepositoryStore;
  runStore: RunStore;
  strategyRunStore: StrategyRunStore;
  executorService: ExecutorService;
  swarmExecutionService: SwarmExecutionService;
  dagExecutionService: DagExecutionService;
  integrationService: IntegrationService;
  loopService: LoopService;
  browserManager: BrowserManager;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
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
  private readonly executorService: ExecutorService;
  private readonly swarmExecutionService: SwarmExecutionService;
  private readonly dagExecutionService: DagExecutionService;
  private readonly integrationService: IntegrationService;
  private readonly loopService: LoopService;
  private readonly browserManager: BrowserManager;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;

  constructor(options: IterationExecutionCoordinatorOptions) {
    this.repositoryStore = options.repositoryStore;
    this.runStore = options.runStore;
    this.strategyRunStore = options.strategyRunStore;
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
        changePath: "openspec/changes/017-integration",
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
        onCompleted: (record: StrategyRunRecord) =>
          void this.handleStrategyCompleted(repositoryId, record),
      },
      selected === "DAG" ? "DAG" : undefined,
    );
  }

  /**
   * Completion callback fired by the strategy engine when a SWARM/DAG run
   * finishes. Makes integrated `main` durable on the remote, writes the canonical
   * result manifest, and hands the normalized result back to the loop.
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
    const activeStrategy = this.strategyRunStore.getActiveForRun(run.id);
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

  async pause(repositoryId: string): Promise<void> {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) {
      this.routeStrategyControl(repositoryId, strategy, "PAUSE");
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
    if (!active || active.status !== "PAUSED") return;
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) {
      this.routeStrategyControl(repositoryId, strategy, "RESUME");
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
      this.routeStrategyControl(repositoryId, strategy, "STOP");
      if (active.status !== "DRAINING") {
        this.runStore.updateStatus(active.id, "DRAINING", {
          lastError: "Stopped by user (draining)",
          drainReason: "USER_STOP",
        });
        this.publishStateChange(repositoryId, active.id, "DRAINING");
      }
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
      this.routeStrategyControl(repositoryId, strategy, "KILL");
    } else {
      await this.executorService.killRun(repositoryId).catch(() => {});
    }
    await this.browserManager.closeRepositoryPage(repositoryId).catch(() => {});
    if (active) {
      this.runStore.updateStatus(active.id, "RECOVERY_REQUIRED", {
        lastError:
          "Run interrupted by emergency kill. Manual recovery required.",
        finishedAt: new Date().toISOString(),
      });
      this.publishStateChange(repositoryId, active.id, "RECOVERY_REQUIRED");
    }
  }

  /** Propagate a campaign drain (ceiling/stop) to the active strategy. */
  drainActiveStrategy(repositoryId: string): void {
    const active = this.runStore.getActiveRun(repositoryId);
    if (!active) return;
    const strategy = this.strategyRunStore.getActiveForRun(active.id);
    if (strategy) this.routeStrategyControl(repositoryId, strategy, "STOP");
  }

  /**
   * Graceful controller shutdown (item #12). Stop admitting new workers,
   * terminate live strategy child processes so they do not survive controller
   * ownership, and mark active strategy runs for recovery. Durable state and
   * worktrees are preserved for deterministic restart reconstruction.
   */
  shutdown(): void {
    for (const repo of this.repositoryStore.list()) {
      const active = this.runStore.getActiveRun(repo.id);
      if (!active) continue;
      const strategy = this.strategyRunStore.getActiveForRun(active.id);
      if (!strategy) continue;
      try {
        this.routeStrategyControl(repo.id, strategy, "KILL");
      } catch {
        /* best-effort during teardown */
      }
      try {
        this.runStore.updateStatus(active.id, "RECOVERY_REQUIRED", {
          lastError:
            "Controller shutdown: active strategy marked for recovery.",
          finishedAt: new Date().toISOString(),
        });
      } catch {
        /* best-effort */
      }
    }
  }

  private routeStrategyControl(
    repositoryId: string,
    strategy: StrategyRunRecord,
    decision: StrategyControlDecision,
  ): void {
    const svc =
      strategy.strategy === "SWARM"
        ? this.swarmExecutionService
        : this.dagExecutionService;
    try {
      const result = svc.control(
        repositoryId,
        strategy.strategyRunId,
        decision,
        "orchestrated control",
      );
      // Orchestration control is fire-and-forget; a DB-closed rejection during
      // teardown must never surface as an unhandled rejection.
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {
      /* best-effort during teardown */
    }
  }

  private publishStateChange(
    repositoryId: string,
    runId: string,
    loopState: LoopState,
  ): void {
    this.eventPublisher?.({
      type: "loop.state_changed",
      at: new Date().toISOString(),
      repositoryId,
      data: { runId, loopState, reason: "iteration execution coordinator" },
    } as RepositoryMutationEvent);
  }
}

export function mapStrategyToLoopStatus(
  status: StrategyRunStatus,
): StrategyRunStatus {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "PARTIAL":
    case "BLOCKED":
      return "BLOCKED";
    case "FAILED":
    case "CANCELLED":
    case "RECOVERY_REQUIRED":
      return "RECOVERY_REQUIRED";
    default:
      return "RECOVERY_REQUIRED";
  }
}
