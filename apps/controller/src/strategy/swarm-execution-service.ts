import crypto from "node:crypto";
import path from "node:path";
import {
  ValidationError,
  type RepositoryMutationEvent,
  type RepositoryRecord,
  type RunRecord,
  type StrategyControlDecision,
  type StrategyControlRecord,
  type ExecutionStrategy,
  type StrategyExecutionReport,
  type IntegrationReport,
  type StrategyRunRecord,
  type StrategyRunStatus,
  type WorkPacket,
  type WorkPacketResult,
  type WorktreeProvenance,
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "../loop/run-store.js";
import type { GitClient, GitContext } from "../watcher/git-client.js";
import { GitClient as DefaultGitClient } from "../watcher/git-client.js";
import type { ExecutorAdapter } from "../executor/adapters/executor-adapter.js";
import type { OpenCodeAdapter } from "../executor/adapters/opencode-adapter.js";
import { WindowsPowerShellAdapter } from "../executor/adapters/windows-adapter.js";
import { WslAdapter } from "../executor/adapters/wsl-adapter.js";
import {
  ExecutorRunner,
  type ExecutorExitReason,
} from "../executor/executor-runner.js";
import {
  buildExecutorInvocation,
  resolveProfile,
} from "../executor/profiles.js";
import type { PermissionPolicyService } from "../permissions/permission-policy-service.js";
import type { SchedulerService } from "../scheduler/scheduler-service.js";
import type { UsageTelemetryService } from "../usage/usage-telemetry-service.js";
import type { WorkPacketService } from "../packets/work-packet-service.js";
import type { WorkPacketStore } from "../packets/work-packet-store.js";
import type { WorktreeIsolationService } from "../packets/worktree-isolation-service.js";
import type { StrategyStagingHandle } from "../packets/worktree-isolation-service.js";
import type { IntegrationService } from "../packets/integration-service.js";
import { toWslPath } from "../wsl-path.js";
import type { StrategyRunStore } from "./strategy-run-store.js";

const DEFAULT_MAX_CONCURRENCY = 2;
const MAX_MAX_CONCURRENCY = 32;
const SCHEDULER_POLL_MS = 100;

interface ActiveWorker {
  packet: WorkPacket;
  requestId: string;
  runner: ExecutorRunner | null;
  done: Promise<WorkPacketResult>;
}

interface ActiveStrategy {
  workers: Map<string, ActiveWorker>;
  queuedRequests: Set<string>;
}

export interface StrategyExecutionHooks {
  nodeIds?: string[];
  onCreated?: (record: StrategyRunRecord, packets: WorkPacket[]) => void;
  onEvent?: (event: RepositoryMutationEvent) => void;
  /** Called when a strategy finishes (both SWARM and DAG). */
  onCompleted?: (record: StrategyRunRecord) => void;
  /** DAG only: a node's worktree was allocated against a deterministic base. */
  onNodeAllocated?: (
    packetId: string,
    baseSha: string,
    dependencyInputShas: string[],
  ) => void;
  /** DAG only: a node's commit was integrated into persistent main. */
  onNodeIntegrated?: (
    packetId: string,
    result: WorkPacketResult,
    integration: IntegrationReport,
  ) => void;
}

export interface SwarmStartOptions {
  packetIds: string[];
  maxConcurrency?: number;
}

export interface SwarmExecutionServiceOptions {
  repositoryStore: RepositoryStore;
  runStore: RunStore;
  strategyStore: StrategyRunStore;
  packetStore: WorkPacketStore;
  packetService: WorkPacketService;
  worktreeService: WorktreeIsolationService;
  integrationService: IntegrationService;
  schedulerService: SchedulerService;
  permissionPolicyService?: PermissionPolicyService;
  usageTelemetryService?: UsageTelemetryService;
  gitClient?: GitClient;
  dataDir?: string;
  windowsAdapter?: ExecutorAdapter;
  wslAdapter?: ExecutorAdapter;
  openCodeAdapter?: OpenCodeAdapter;
  eventPublisher?: (event: RepositoryMutationEvent) => void;
}

export class SwarmExecutionService {
  private readonly repositoryStore: RepositoryStore;
  private readonly runStore: RunStore;
  private readonly strategyStore: StrategyRunStore;
  private readonly packetStore: WorkPacketStore;
  private readonly packetService: WorkPacketService;
  private readonly worktreeService: WorktreeIsolationService;
  private readonly integrationService: IntegrationService;
  private readonly schedulerService: SchedulerService;
  private readonly permissionPolicyService?: PermissionPolicyService;
  private readonly usageTelemetryService?: UsageTelemetryService;
  private readonly gitClient: GitClient;
  private readonly dataDir: string;
  private readonly windowsAdapter: ExecutorAdapter;
  private readonly wslAdapter: ExecutorAdapter;
  private readonly openCodeAdapter?: OpenCodeAdapter;
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private readonly active = new Map<string, ActiveStrategy>();
  private readonly hooks = new Map<string, StrategyExecutionHooks>();
  /**
   * Change 018 R2: per-strategyRunId integration mutex (promise chain). Every
   * operation that touches the strategy staging checkout — staging creation,
   * node cherry-pick, final integration — runs exclusively under it, so no two
   * Git index operations can race by construction. Worker EXECUTION stays
   * parallel; only staging ownership is serialized.
   */
  private readonly integrationLocks = new Map<string, Promise<void>>();
  /** Change 018 R1: the single staging checkout per strategy run. */
  private readonly stagings = new Map<string, StrategyStagingHandle>();
  /**
   * Fast path for lineage reconciliation: ORIGINAL worker commit SHAs that
   * stageNodeCommit successfully staged into this run's staging checkout,
   * per strategyRunId. Memory-only — losing it (controller restart) stays
   * safe because cherryPickIntoStaging treats git's empty-pick stop as
   * already-applied content.
   */
  private readonly stagedOriginalShas = new Map<string, Set<string>>();

  constructor(options: SwarmExecutionServiceOptions) {
    this.repositoryStore = options.repositoryStore;
    this.runStore = options.runStore;
    this.strategyStore = options.strategyStore;
    this.packetStore = options.packetStore;
    this.packetService = options.packetService;
    this.worktreeService = options.worktreeService;
    this.integrationService = options.integrationService;
    this.schedulerService = options.schedulerService;
    this.permissionPolicyService = options.permissionPolicyService;
    this.usageTelemetryService = options.usageTelemetryService;
    this.gitClient = options.gitClient ?? new DefaultGitClient();
    this.dataDir = path.resolve(options.dataDir ?? ".orca-data");
    this.windowsAdapter =
      options.windowsAdapter ?? new WindowsPowerShellAdapter();
    this.wslAdapter = options.wslAdapter ?? new WslAdapter();
    this.openCodeAdapter = options.openCodeAdapter;
    this.eventPublisher = options.eventPublisher;
  }

  /** Start an explicitly selected swarm in the background for REST callers. */
  start(
    repositoryId: string,
    runId: string,
    iteration: number,
    options: SwarmStartOptions,
  ): StrategyRunRecord {
    return this.startStrategy("SWARM", repositoryId, runId, iteration, options);
  }

  /** Autonomous-loop entry point: start a strategy authorized by an explicit dispatch. */
  startStrategyForDispatch(
    repositoryId: string,
    runId: string,
    iteration: number,
    dispatch: import("@orca/shared").DispatchMarker,
    plan: import("@orca/shared").DispatchExecutionPlan,
    hooks: StrategyExecutionHooks = {},
    strategy: Exclude<ExecutionStrategy, "SINGLE_AGENT"> = "SWARM",
  ): StrategyRunRecord {
    const options: SwarmStartOptions = {
      packetIds: plan.packetIds ?? [],
      maxConcurrency: plan.maxConcurrency,
    };
    const strategyBaseSha =
      dispatch.baseSha && /^[0-9a-f]{40}$/i.test(dispatch.baseSha)
        ? dispatch.baseSha
        : null;
    return this.startStrategy(
      strategy,
      repositoryId,
      runId,
      iteration,
      options,
      hooks,
      dispatch.dispatchId ?? null,
      strategyBaseSha,
    );
  }

  startStrategy(
    strategy: Exclude<ExecutionStrategy, "SINGLE_AGENT">,
    repositoryId: string,
    runId: string,
    iteration: number,
    options: SwarmStartOptions,
    hooks: StrategyExecutionHooks = {},
    dispatchId: string | null = null,
    strategyBaseSha: string | null = null,
  ): StrategyRunRecord {
    const context = this.validateStart(repositoryId, runId, iteration, options);
    const record = this.createRecord(
      strategy,
      context.repository,
      context.run,
      context.packets,
      options.maxConcurrency,
      dispatchId,
      strategyBaseSha,
    );
    this.hooks.set(record.strategyRunId, hooks);
    hooks.onCreated?.(record, context.packets);
    void this.executeRecord(
      record,
      context.repository,
      context.run,
      context.packets,
      hooks,
    ).catch((error) => {
      this.failStrategy(record.strategyRunId, error);
    });
    return record;
  }

  /** Deterministic/test-friendly synchronous entry point that resolves on final report. */
  async execute(
    repositoryId: string,
    runId: string,
    iteration: number,
    options: SwarmStartOptions,
  ): Promise<StrategyRunRecord> {
    return this.executeStrategy(
      "SWARM",
      repositoryId,
      runId,
      iteration,
      options,
    );
  }

  async executeStrategy(
    strategy: Exclude<ExecutionStrategy, "SINGLE_AGENT">,
    repositoryId: string,
    runId: string,
    iteration: number,
    options: SwarmStartOptions,
    hooks: StrategyExecutionHooks = {},
    dispatchId: string | null = null,
    strategyBaseSha: string | null = null,
  ): Promise<StrategyRunRecord> {
    const context = this.validateStart(repositoryId, runId, iteration, options);
    const record = this.createRecord(
      strategy,
      context.repository,
      context.run,
      context.packets,
      options.maxConcurrency,
      dispatchId,
      strategyBaseSha,
    );
    this.hooks.set(record.strategyRunId, hooks);
    hooks.onCreated?.(record, context.packets);
    return this.executeRecord(
      record,
      context.repository,
      context.run,
      context.packets,
      hooks,
    );
  }

  get(strategyRunId: string): StrategyRunRecord | null {
    return this.strategyStore.get(strategyRunId);
  }

  listByRun(runId: string): StrategyRunRecord[] {
    return this.strategyStore.listByRun(runId);
  }

  listControls(strategyRunId: string): StrategyControlRecord[] {
    return this.strategyStore.listControls(strategyRunId);
  }

  getDetail(
    repositoryId: string,
    runId: string,
    strategyRunId: string,
  ): {
    strategy: StrategyRunRecord;
    controls: StrategyControlRecord[];
    packets: WorkPacket[];
    results: WorkPacketResult[];
  } | null {
    const strategy = this.strategyStore.get(strategyRunId);
    if (
      !strategy ||
      strategy.strategy !== "SWARM" ||
      strategy.repositoryId !== repositoryId ||
      strategy.runId !== runId
    )
      return null;
    const packets = strategy.packetIds
      .map((packetId) => this.packetService.get(packetId))
      .filter((packet): packet is WorkPacket => Boolean(packet));
    return {
      strategy,
      controls: this.strategyStore.listControls(strategyRunId),
      packets,
      results: packets
        .map((packet) => this.packetService.getResult(packet.packetId))
        .filter((result): result is WorkPacketResult => Boolean(result)),
    };
  }

  async control(
    repositoryId: string,
    strategyRunId: string,
    decision: StrategyControlDecision,
    reason: string | null = null,
  ): Promise<StrategyRunRecord> {
    const record = this.strategyStore.get(strategyRunId);
    if (!record || record.repositoryId !== repositoryId) {
      throw new ValidationError(
        "Execution strategy run does not belong to this repository.",
      );
    }
    if (record.strategy === "SINGLE_AGENT")
      throw new ValidationError(
        "Single-agent runs do not accept strategy controls.",
      );
    const repository = this.repositoryStore.get(repositoryId);
    if (!repository)
      throw new ValidationError(`Repository ${repositoryId} not found`);
    const control = this.strategyStore.createControl({
      strategyRunId,
      repositoryId,
      runId: record.runId,
      iteration: record.iteration,
      decision,
      reason,
      createdAt: new Date().toISOString(),
    });
    const nextState =
      decision === "PAUSE"
        ? "PAUSE_REQUESTED"
        : decision === "STOP"
          ? "STOP_REQUESTED"
          : decision === "KILL"
            ? "KILL_REQUESTED"
            : "NONE";
    const updated =
      this.strategyStore.update(strategyRunId, {
        controlState: nextState,
        status: decision === "STOP" ? "STOPPING" : record.status,
      }) ?? record;
    this.publish(
      {
        type: "strategy.control",
        at: control.createdAt,
        repositoryId,
        data: {
          runId: record.runId,
          iteration: record.iteration,
          strategyRunId,
          controlId: control.controlId,
          decision,
          reason: reason ?? undefined,
          strategy: record.strategy,
        },
      },
      this.hooks.get(strategyRunId),
    );

    const active = this.active.get(strategyRunId);
    if (decision === "PAUSE" && active) {
      await Promise.all(
        [...active.workers.values()].map(async (worker) => {
          await worker.runner?.pause().catch(() => {});
        }),
      );
    } else if (decision === "KILL" && active) {
      await Promise.all(
        [...active.workers.values()].map(async (worker) => {
          await worker.runner?.kill().catch(() => {});
        }),
      );
    } else if (decision === "RESUME") {
      if (record.status !== "PAUSED")
        throw new ValidationError(
          `Cannot resume strategy in status ${record.status}.`,
        );
      const run = this.runStore.get(record.runId);
      if (!run)
        throw new ValidationError(`Campaign ${record.runId} not found.`);
      // Change 018 review F6: a direct strategy RESUME must not contradict
      // campaign state — the campaign must itself be PAUSED.
      if (run.status !== "PAUSED")
        throw new ValidationError(
          `Cannot resume strategy while campaign is ${run.status}.`,
        );
      const packets = record.packetIds
        .map((packetId) => this.packetService.get(packetId))
        .filter((packet): packet is WorkPacket => Boolean(packet));
      for (const packet of packets) {
        const existingResult = this.packetService.getResult(packet.packetId);
        if (existingResult?.status !== "COMPLETED")
          this.packetService.updateStatus(packet.packetId, "QUEUED");
      }
      const resumed = this.strategyStore.update(strategyRunId, {
        controlState: "NONE",
        status: "QUEUED",
        finishedAt: null,
      });
      if (resumed)
        void this.executeRecord(
          resumed,
          repository,
          run,
          packets,
          this.hooks.get(strategyRunId),
        ).catch((error) => this.failStrategy(strategyRunId, error));
      return resumed ?? updated;
    } else if (
      (decision === "STOP" || decision === "KILL") &&
      !active &&
      record.status === "PAUSED"
    ) {
      // A paused actor has no live executeRecord loop to observe the requested
      // control state; settle it synchronously so campaign controls cannot hang
      // and campaign/strategy states can never contradict.
      const terminalStatus: StrategyRunStatus =
        decision === "STOP" ? "CANCELLED" : "RECOVERY_REQUIRED";
      const blocker =
        decision === "STOP"
          ? "USER_STOP: paused strategy stopped."
          : "EMERGENCY_KILLED: paused strategy killed.";
      const packets = record.packetIds
        .map((packetId) => this.packetService.get(packetId))
        .filter((packet): packet is WorkPacket => Boolean(packet));
      for (const packet of packets) {
        const existing = this.packetService.getResult(packet.packetId);
        if (existing?.status === "COMPLETED") continue;
        this.packetService.recordResult(
          repository,
          packet,
          this.syntheticResult(packet, "CANCELLED", blocker, null),
        );
      }
      // Terminal worktree semantics: STOP releases (policy violations keep
      // their worktree); KILL preserves everything for recovery.
      await Promise.all(
        packets.map(async (packet) => {
          if (decision === "KILL") return;
          const worktree = this.packetStore.getWorktreeByPacket(packet.packetId);
          if (
            worktree &&
            ["ACTIVE", "STALE", "ALLOCATED"].includes(worktree.status)
          ) {
            const result = this.packetService.getResult(packet.packetId);
            if (result?.blocker === "POLICY_VIOLATION") return;
            await this.worktreeService
              .release(repository, worktree.worktreeId)
              .catch(() => {});
          }
        }),
      );
      const staging = this.stagings.get(strategyRunId);
      if (staging) {
        try {
          await this.worktreeService.removeStagingWorktree(repository, staging);
        } catch {}
      }
      const finishedAt = new Date().toISOString();
      const settled =
        this.strategyStore.update(strategyRunId, {
          status: terminalStatus,
          controlState: nextState,
          finishedAt,
          lastError: blocker,
        }) ??
        this.strategyStore.get(strategyRunId) ?? {
          ...record,
          status: terminalStatus,
          controlState: nextState,
          finishedAt,
          lastError: blocker,
          updatedAt: finishedAt,
        };
      this.publish(
        {
          type: "strategy.completed",
          at: finishedAt,
          repositoryId,
          data: {
            runId: record.runId,
            iteration: record.iteration,
            strategyRunId,
            strategy: record.strategy,
            strategyStatus: terminalStatus,
            reason: blocker,
          },
        },
        this.hooks.get(strategyRunId),
      );
      try {
        this.hooks.get(strategyRunId)?.onCompleted?.(settled);
      } catch {}
      this.active.delete(strategyRunId);
      this.hooks.delete(strategyRunId);
      this.stagings.delete(strategyRunId);
      this.stagedOriginalShas.delete(strategyRunId);
      this.integrationLocks.delete(strategyRunId);
      return settled;
    }
    return this.strategyStore.get(strategyRunId) ?? updated;
  }

  /** Mark orphaned in-memory strategy work as recoverable after controller restart. */
  async recoverAll(): Promise<StrategyRunRecord[]> {
    const recovered: StrategyRunRecord[] = [];
    for (const record of this.strategyStore.listRecoverable()) {
      const repository = this.repositoryStore.get(record.repositoryId);
      if (!repository) continue;
      const packets = record.packetIds
        .map((packetId) => this.packetService.get(packetId))
        .filter((packet): packet is WorkPacket => Boolean(packet));
      for (const packet of packets) {
        if (!["STARTING", "RUNNING", "RETRYING"].includes(packet.status))
          continue;
        const worktree = this.packetStore.getWorktreeByPacket(packet.packetId);
        this.packetService.recordResult(
          repository,
          packet,
          this.syntheticResult(
            packet,
            "BLOCKED",
            "RECOVERY_REQUIRED: controller restarted without a live swarm worker.",
            worktree
              ? this.provenance(
                  worktree.path,
                  worktree.branch,
                  worktree.baseSha,
                  null,
                  worktree.worktreeId,
                )
              : null,
          ),
        );
      }
      await this.worktreeService.recover(repository).catch(() => {});
      const next = this.strategyStore.update(record.strategyRunId, {
        status: "RECOVERY_REQUIRED",
        controlState: "NONE",
        lastError:
          "RECOVERY_REQUIRED: controller restarted without live swarm runners.",
        finishedAt: new Date().toISOString(),
      });
      if (next) {
        recovered.push(next);
        this.publish({
          type: "strategy.recovery",
          at: next.finishedAt ?? new Date().toISOString(),
          repositoryId: next.repositoryId,
          data: {
            runId: next.runId,
            iteration: next.iteration,
            strategyRunId: next.strategyRunId,
            strategy: next.strategy,
            reason: next.lastError ?? undefined,
          },
        });
      }
    }
    return recovered;
  }

  private validateStart(
    repositoryId: string,
    runId: string,
    iteration: number,
    options: SwarmStartOptions,
  ): {
    repository: RepositoryRecord;
    run: RunRecord;
    packets: WorkPacket[];
  } {
    const repository = this.repositoryStore.get(repositoryId);
    if (!repository)
      throw new ValidationError(`Repository ${repositoryId} not found`);
    const run = this.runStore.get(runId);
    if (!run || run.repositoryId !== repositoryId)
      throw new ValidationError("Campaign/run correlation is invalid.");
    if (run.currentIteration !== iteration)
      throw new ValidationError(
        "Execution strategy iteration does not match the campaign's current iteration.",
      );
    const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    if (
      !Number.isInteger(maxConcurrency) ||
      maxConcurrency < 1 ||
      maxConcurrency > MAX_MAX_CONCURRENCY
    ) {
      throw new ValidationError(
        `Swarm maxConcurrency must be an integer from 1 to ${MAX_MAX_CONCURRENCY}.`,
      );
    }
    const packetIds = [...new Set(options.packetIds)];
    if (packetIds.length === 0)
      throw new ValidationError(
        "A strategy start requires at least one durable work packet.",
      );
    if (packetIds.length !== options.packetIds.length)
      throw new ValidationError("Swarm packet IDs must be unique.");
    const packets = packetIds.map((packetId) =>
      this.packetService.get(packetId),
    );
    if (packets.some((packet): packet is null => packet === null))
      throw new ValidationError(
        "Every strategy packet must be durable before execution.",
      );
    const selected = packets as WorkPacket[];
    for (const packet of selected) {
      if (
        packet.runId !== runId ||
        packet.campaignId !== runId ||
        packet.iteration !== iteration ||
        this.packetStore.getRepositoryId(packet.packetId) !== repositoryId
      ) {
        throw new ValidationError(
          `Packet ${packet.packetId} does not belong to the requested campaign iteration.`,
        );
      }
      if (
        packet.parentDispatchId &&
        packet.parentDispatchId !== run.activeDispatchId
      ) {
        throw new ValidationError(
          `Packet ${packet.packetId} parent dispatch is not the campaign's active dispatch.`,
        );
      }
    }
    const selectedIds = new Set(selected.map((packet) => packet.packetId));
    for (const packet of selected) {
      if (
        packet.dependencies.some((dependency) => !selectedIds.has(dependency))
      ) {
        throw new ValidationError(
          `Packet ${packet.packetId} has a dependency outside the selected strategy.`,
        );
      }
    }
    if (this.hasCycle(selected))
      throw new ValidationError(
        "Swarm packet dependency graph contains a cycle.",
      );
    // A RECOVERY_REQUIRED record is ownership-terminal (documents the
    // interrupted iteration) and must not permanently block a new authorized
    // strategy start (Change 018 review F3 recovery dead-end).
    const blocking = this.strategyStore.getActiveForRun(runId);
    if (blocking && blocking.status !== "RECOVERY_REQUIRED")
      throw new ValidationError(
        `A strategy is already active for campaign ${runId}.`,
      );
    return { repository, run, packets: selected };
  }

  private createRecord(
    strategy: Exclude<ExecutionStrategy, "SINGLE_AGENT">,
    repository: RepositoryRecord,
    run: RunRecord,
    packets: WorkPacket[],
    maxConcurrency = DEFAULT_MAX_CONCURRENCY,
    dispatchId: string | null = null,
    strategyBaseSha: string | null = null,
  ): StrategyRunRecord {
    const now = new Date().toISOString();
    return this.strategyStore.create({
      schemaVersion: 1,
      strategyRunId: crypto.randomUUID(),
      repositoryId: repository.id,
      campaignId: run.id,
      runId: run.id,
      iteration: run.currentIteration,
      strategy,
      status: "QUEUED",
      maxConcurrency,
      packetIds: packets.map((packet) => packet.packetId),
      controlState: "NONE",
      dispatchId,
      strategyBaseSha,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Resolve the current local `main` HEAD SHA (used as the DAG strategy base fallback). */
  private async currentMainSha(
    repository: RepositoryRecord,
  ): Promise<string | null> {
    try {
      return await this.gitClient.getCurrentSha(
        this.gitContext(repository, repository.localPath),
      );
    } catch {
      return null;
    }
  }

  /**
   * Change 018 R2: serialize every staging-checkout operation for a strategy
   * run through a per-run promise chain. Each caller chains onto the stored
   * tail; rejections are swallowed in the stored tail so the chain never
   * breaks, while the caller still receives its own outcome.
   */
  private withIntegrationLock<T>(
    strategyRunId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.integrationLocks.get(strategyRunId) ?? Promise.resolve();
    const run = previous.then(operation);
    this.integrationLocks.set(
      strategyRunId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /**
   * Change 018 R1/R3: resolve the immutable base every DAG node, the staging
   * lineage, and every SWARM worker derives from. Dispatch-authorized runs
   * carry an explicit strategyBaseSha; REST-started strategies capture main
   * once, before the first worker launches, and backfill the record so resume
   * reuses the same snapshot.
   */
  private async resolveStrategyBase(
    repository: RepositoryRecord,
    record: StrategyRunRecord,
  ): Promise<string | null> {
    if (record.strategyBaseSha && /^[0-9a-f]{40}$/i.test(record.strategyBaseSha))
      return record.strategyBaseSha;
    const captured = await this.currentMainSha(repository);
    if (captured && !record.strategyBaseSha)
      this.strategyStore.update(record.strategyRunId, { strategyBaseSha: captured });
    return captured;
  }

  /**
   * Change 018 R3: original staged commit SHAs of the packet's TRANSITIVE
   * dependencies, in completion order. The scheduler only launches a node once
   * its direct dependencies completed, so completion order is a topological
   * order and replaying in it is parent-before-child by construction.
   */
  private transitiveDependencyCommits(
    packet: WorkPacket,
    packets: WorkPacket[],
    results: Map<string, WorkPacketResult>,
  ): string[] {
    const byId = new Map(packets.map((candidate) => [candidate.packetId, candidate]));
    const seen = new Set<string>();
    const queue = [...packet.dependencies];
    const commits: { createdAt: string; sha: string }[] = [];
    while (queue.length > 0) {
      const dependencyId = queue.shift()!;
      if (seen.has(dependencyId)) continue;
      seen.add(dependencyId);
      const dependency = byId.get(dependencyId);
      if (dependency) queue.push(...dependency.dependencies);
      const result =
        results.get(dependencyId) ?? this.packetService.getResult(dependencyId);
      const sha = result?.worktree?.commitSha;
      if (result?.status === "COMPLETED" && sha)
        commits.push({ createdAt: result.createdAt, sha });
    }
    return commits
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((entry) => entry.sha);
  }

  /**
   * Change 018 R1: cherry-pick one accepted node commit into the strategy's
   * staging checkout (never onto persistent user main). Failure returns a
   * structured INTEGRATION_CONFLICT/BLOCKED report so the existing conflict
   * semantics apply unchanged — staged instead of integrated.
   */
  private async stageNodeCommit(
    repository: RepositoryRecord,
    record: StrategyRunRecord,
    result: WorkPacketResult,
  ): Promise<IntegrationReport> {
    const commitSha = result.worktree?.commitSha;
    const reportBase = {
      schemaVersion: 1 as const,
      repositoryId: repository.id,
      runId: result.runId,
      iteration: result.iteration,
      integratedPacketIds: [] as string[],
      results: [result],
      createdAt: new Date().toISOString(),
    };
    if (!commitSha)
      return {
        ...reportBase,
        status: "BLOCKED",
        finalCommitSha: null,
        blocker: "Completed result has no worktree branch/commit provenance.",
      };
    try {
      return await this.withIntegrationLock(record.strategyRunId, async () => {
        const staging = await this.ensureStagingCheckout(repository, record);
        const picked = await this.worktreeService.cherryPickIntoStaging(
          repository,
          staging,
          commitSha,
        );
        if (!picked.ok)
          return {
            ...reportBase,
            status: "INTEGRATION_CONFLICT" as const,
            finalCommitSha: null,
            blocker: `Git integration failed and was aborted: ${picked.error}`,
          };
        // Fast-path provenance: remember the ORIGINAL SHA so this run's final
        // landing reconciles it without probing/picking again — the staging
        // lineage contains its REWRITTEN twin, so the original SHA is not an
        // ancestor of HEAD even though the content is present.
        const stagedShas = this.stagedOriginalShas.get(record.strategyRunId);
        if (stagedShas) stagedShas.add(commitSha);
        else
          this.stagedOriginalShas.set(
            record.strategyRunId,
            new Set([commitSha]),
          );
        return {
          ...reportBase,
          status: "COMPLETED" as const,
          integratedPacketIds: [result.packetId],
          finalCommitSha: picked.head,
          blocker: null,
        };
      });
    } catch (error: any) {
      return {
        ...reportBase,
        status: "BLOCKED",
        finalCommitSha: null,
        blocker: `STAGING_UNAVAILABLE: ${error?.message ?? String(error)}`,
      };
    }
  }

  /** Lazily create/reuse the run's single staging checkout. Call under the mutex. */
  private async ensureStagingCheckout(
    repository: RepositoryRecord,
    record: StrategyRunRecord,
  ): Promise<StrategyStagingHandle> {
    const existing = this.stagings.get(record.strategyRunId);
    if (existing) return existing;
    const baseSha =
      record.strategyBaseSha && /^[0-9a-f]{40}$/i.test(record.strategyBaseSha)
        ? record.strategyBaseSha
        : await this.currentMainSha(repository);
    if (!baseSha)
      throw new Error("Cannot resolve an immutable base for the staging checkout.");
    const staging = await this.worktreeService.ensureStaging(repository, {
      strategyRunId: record.strategyRunId,
      runId: record.runId,
      baseSha,
    });
    this.stagings.set(record.strategyRunId, staging);
    return staging;
  }

  /**
   * Change 018 restart continuation: original worker commit SHAs of EVERY
   * accepted COMPLETED result belonging to this campaign iteration — across
   * ALL strategy runs of the campaign, including runs interrupted by a
   * controller restart whose commits were never landed. Completion order is
   * deterministic and topological (a node only completes after its declared
   * dependencies), so replaying in this order is parent-before-child.
   */
  private acceptedIterationResultCommits(
    record: StrategyRunRecord,
  ): { createdAt: string; sha: string }[] {
    const seen = new Set<string>();
    const commits: { createdAt: string; sha: string }[] = [];
    for (const result of this.packetService.listResults(record.runId)) {
      const sha = result.worktree?.commitSha;
      if (
        result.iteration !== record.iteration ||
        result.status !== "COMPLETED" ||
        !sha ||
        seen.has(sha)
      )
        continue;
      seen.add(sha);
      commits.push({ createdAt: result.createdAt, sha });
    }
    return commits.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.sha.localeCompare(b.sha),
    );
  }

  /**
   * Change 018 restart continuation: bring the staging lineage up to the full
   * accepted state of the campaign iteration before it is merged. A fresh
   * strategy run reuses pre-existing COMPLETED results without re-staging
   * their commits, so its own lineage would otherwise silently DROP the
   * previously accepted commits of interrupted prior runs at final
   * integration. Presence is detected in three layers: the per-run in-memory
   * fast path (SHAs this process staged via stageNodeCommit), the cheap
   * merge-base --is-ancestor probe (direct matches), and — covering commits
   * staged under rewritten SHAs or across a controller restart — git's
   * empty-pick stop inside cherryPickIntoStaging, which reports
   * already-applied instead of failing. Missing commits are cherry-picked
   * exactly like stageNodeCommit picks; only a GENUINE conflict aborts with a
   * structured outcome — the landing never proceeds half-reconciled.
   * Call under the integration mutex.
   */
  private async reconcileStagingLineage(
    repository: RepositoryRecord,
    staging: StrategyStagingHandle,
    acceptedCommits: { createdAt: string; sha: string }[],
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        status: IntegrationReport["status"];
        blocker: string;
      }
  > {
    const stagedShas = this.stagedOriginalShas.get(staging.strategyRunId);
    for (const { sha } of acceptedCommits) {
      // Same-process short-circuit: stageNodeCommit staged this exact original
      // SHA into this checkout, so probing/picking it again is pure overhead.
      if (stagedShas?.has(sha)) continue;
      const present = await this.worktreeService.isCommitAncestorOfHead(
        repository,
        staging.path,
        sha,
      );
      if (present) continue;
      const picked = await this.worktreeService.cherryPickIntoStaging(
        repository,
        staging,
        sha,
      );
      if (!picked.ok)
        return {
          ok: false,
          status: "INTEGRATION_CONFLICT",
          blocker: `LINEAGE_RECONCILIATION_CONFLICT: cherry-pick of previously accepted commit ${sha} failed and was aborted: ${picked.error}`,
        };
    }
    return { ok: true };
  }

  /**
   * Change 018 R1: final qualified integration at strategy terminal. From a
   * CLEAN persistent main, bring the staging lineage forward: first reconcile
   * it against EVERY accepted COMPLETED result of the campaign iteration
   * (restart continuation — a fresh run inherits prior runs' accepted results
   * without their commits), then ff-only merge; if main advanced, rebase the
   * staging branch onto main (abort-on-failure) then ff again. Any unsafe
   * condition yields a structured non-COMPLETED outcome — success is never
   * faked. Returns null when nothing was ever staged (no accepted node),
   * leaving the aggregate untouched.
   */
  private async landStagingLineage(
    repository: RepositoryRecord,
    record: StrategyRunRecord,
  ): Promise<{
    status: IntegrationReport["status"];
    finalCommitSha: string | null;
    blocker: string | null;
  } | null> {
    // Restart continuation: reconcile BEFORE touching main so accepted commits
    // of interrupted prior strategy runs cannot be silently dropped by this
    // run's lineage. An empty accepted set => nothing was ever staged.
    const acceptedCommits = this.acceptedIterationResultCommits(record);
    if (acceptedCommits.length === 0) return null;
    let mainStatus = "";
    try {
      mainStatus = await this.gitClient.getWorkingTreeStatus(
        this.gitContext(repository, repository.localPath),
      );
    } catch (error: any) {
      return {
        status: "BLOCKED",
        finalCommitSha: null,
        blocker: `MAIN_STATUS_UNAVAILABLE: ${error?.message ?? String(error)}`,
      };
    }
    if (mainStatus.trim())
      return {
        status: "BLOCKED",
        finalCommitSha: null,
        blocker:
          "FINAL_INTEGRATION_DIRTY_MAIN: persistent main checkout is dirty; the staging lineage was not merged.",
      };
    let staging = this.stagings.get(record.strategyRunId);
    if (!staging) {
      try {
        staging = await this.ensureStagingCheckout(repository, record);
      } catch (error: any) {
        return {
          status: "BLOCKED",
          finalCommitSha: null,
          blocker: `STAGING_UNAVAILABLE: ${error?.message ?? String(error)}`,
        };
      }
    }
    const reconciled = await this.reconcileStagingLineage(
      repository,
      staging,
      acceptedCommits,
    );
    if (!reconciled.ok)
      return {
        status: reconciled.status,
        finalCommitSha: null,
        blocker: reconciled.blocker,
      };
    const fastForward = await this.worktreeService.mergeFastForwardIntoMain(
      repository,
      staging.branch,
    );
    if (fastForward.ok) {
      await this.worktreeService.removeStagingWorktree(repository, staging);
      return { status: "COMPLETED", finalCommitSha: fastForward.head, blocker: null };
    }
    const rebased = await this.worktreeService.rebaseStagingOntoMain(
      repository,
      staging,
    );
    if (!rebased.ok)
      return {
        status: "INTEGRATION_CONFLICT",
        finalCommitSha: null,
        blocker: `FINAL_INTEGRATION_CONFLICT: cannot fast-forward or rebase the staging lineage onto main. ${rebased.error}`,
      };
    const secondFastForward = await this.worktreeService.mergeFastForwardIntoMain(
      repository,
      staging.branch,
    );
    if (!secondFastForward.ok)
      return {
        status: "BLOCKED",
        finalCommitSha: null,
        blocker: `FINAL_INTEGRATION_FAILED: staging rebased onto main but the fast-forward failed. ${secondFastForward.error}`,
      };
    await this.worktreeService.removeStagingWorktree(repository, staging);
    return {
      status: "COMPLETED",
      finalCommitSha: secondFastForward.head,
      blocker: null,
    };
  }

  private async executeRecord(
    record: StrategyRunRecord,
    repository: RepositoryRecord,
    run: RunRecord,
    packets: WorkPacket[],
    hooks: StrategyExecutionHooks = this.hooks.get(record.strategyRunId) ?? {},
  ): Promise<StrategyRunRecord> {
    this.hooks.set(record.strategyRunId, hooks);
    const startedAt = new Date().toISOString();
    this.strategyStore.update(record.strategyRunId, {
      status: "RUNNING",
      startedAt,
      controlState: "NONE",
      lastError: null,
    });
    const active: ActiveStrategy = {
      workers: new Map(),
      queuedRequests: new Set(),
    };
    this.active.set(record.strategyRunId, active);
    this.publish(
      {
        type: "strategy.started",
        at: startedAt,
        repositoryId: repository.id,
        data: {
          runId: run.id,
          iteration: run.currentIteration,
          strategyRunId: record.strategyRunId,
          strategy: record.strategy,
          maxConcurrency: record.maxConcurrency,
        },
      },
      hooks,
    );

    const pending = new Set(packets.map((packet) => packet.packetId));
    const results = new Map<string, WorkPacketResult>();
    for (const packet of packets) {
      const existing = this.packetService.getResult(packet.packetId);
      if (existing?.status === "COMPLETED") {
        results.set(packet.packetId, existing);
        pending.delete(packet.packetId);
      }
    }
    // Change 018 R3: DAG nodes, the staging lineage, and SWARM workers derive
    // from ONE immutable base. Dispatch-authorized runs carry it explicitly;
    // REST-started strategies capture main once here and backfill the record
    // so resume reuses the same snapshot instead of drifting refs/heads/main.
    const strategyBase = await this.resolveStrategyBase(repository, record);
    if (strategyBase && !record.strategyBaseSha)
      record.strategyBaseSha = strategyBase;

    try {
      let idlePolls = 0;
      while (pending.size > 0 || active.workers.size > 0) {
        const current = this.strategyStore.get(record.strategyRunId);
        const controlState = current?.controlState ?? "NONE";
        if (controlState === "PAUSE_REQUESTED") {
          await Promise.all(
            [...active.workers.values()].map((worker) =>
              worker.runner?.pause().catch(() => undefined),
            ),
          );
          break;
        }
        if (controlState === "KILL_REQUESTED") {
          for (const packetId of pending) {
            const packet = packets.find(
              (candidate) => candidate.packetId === packetId,
            )!;
            const result = this.syntheticResult(
              packet,
              "CANCELLED",
              "EMERGENCY_KILLED: swarm worker was not started.",
              null,
            );
            results.set(
              packetId,
              this.packetService.recordResult(repository, packet, result),
            );
            pending.delete(packetId);
          }
          await Promise.all(
            [...active.workers.values()].map((worker) =>
              worker.runner?.kill().catch(() => undefined),
            ),
          );
        }
        if (controlState === "STOP_REQUESTED") {
          for (const packetId of pending) {
            const packet = packets.find(
              (candidate) => candidate.packetId === packetId,
            )!;
            const result = this.syntheticResult(
              packet,
              "CANCELLED",
              "USER_STOP: swarm worker was not started.",
              null,
            );
            results.set(
              packetId,
              this.packetService.recordResult(repository, packet, result),
            );
            pending.delete(packetId);
          }
        }

        let launched = false;
        if (controlState === "NONE") {
          const sorted = packets
            .filter((packet) => pending.has(packet.packetId))
            .sort((a, b) => a.packetId.localeCompare(b.packetId));
          for (const packet of sorted) {
            if (active.workers.size >= record.maxConcurrency) break;
            // A dependency still pending (re-)execution in this run must be
            // waited for — never judged by its stale pre-pause result record
            // (DAG resume correctness: dependents sort by random UUIDs).
            if (
              packet.dependencies.some((dependency) =>
                pending.has(dependency),
              )
            ) {
              continue;
            }
            const dependencyResults = packet.dependencies.map(
              (dependency) =>
                results.get(dependency) ??
                this.packetService.getResult(dependency),
            );
            if (
              dependencyResults.some(
                (dependency) => dependency && dependency.status !== "COMPLETED",
              )
            ) {
              const result = this.syntheticResult(
                packet,
                "SKIPPED_DEPENDENCY",
                "A dependency did not complete successfully.",
                null,
              );
              results.set(
                packet.packetId,
                this.packetService.recordResult(repository, packet, result),
              );
              pending.delete(packet.packetId);
              continue;
            }
            if (dependencyResults.some((dependency) => !dependency)) continue;

            const permission = this.evaluateWritePermission(
              repository,
              run,
              packet,
            );
            if (permission === "ASK" || permission === "DENY") {
              this.packetService.updateStatus(
                packet.packetId,
                "WAITING_PERMISSION",
              );
              this.publish(
                {
                  type: "strategy.permission_required",
                  at: new Date().toISOString(),
                  repositoryId: repository.id,
                  data: {
                    runId: run.id,
                    iteration: run.currentIteration,
                    strategyRunId: record.strategyRunId,
                    strategy: record.strategy,
                    packetId: packet.packetId,
                    outcome: permission,
                    reason:
                      "Repository file write policy requires an actionable permission decision.",
                  },
                },
                hooks,
              );
              const result = this.syntheticResult(
                packet,
                "BLOCKED",
                `PERMISSION_${permission}: repository file write policy requires attention.`,
                null,
              );
              results.set(
                packet.packetId,
                this.packetService.recordResult(repository, packet, result),
              );
              pending.delete(packet.packetId);
              continue;
            }

            const requestId = `${record.strategyRunId}:${packet.packetId}`;
            const decision = this.schedulerService.admit({
              requestId,
              repositoryId: repository.id,
              runId: run.id,
              iteration: run.currentIteration,
              executor: packet.executor.executorCli,
              provider: packet.executor.provider,
              model: packet.executor.model,
              kind: "SUBAGENT",
              requestedTokens: packet.budget.maxTokens,
              requestedSpend: packet.budget.maxSpend,
            });
            if (decision.status !== "ADMITTED") {
              if (
                decision.status === "QUEUED" &&
                !active.queuedRequests.has(requestId)
              ) {
                active.queuedRequests.add(requestId);
                this.publish(
                  {
                    type: "strategy.worker_queued",
                    at: new Date().toISOString(),
                    repositoryId: repository.id,
                    data: {
                      runId: run.id,
                      iteration: run.currentIteration,
                      strategyRunId: record.strategyRunId,
                      packetId: packet.packetId,
                      schedulerDecisionId: decision.id,
                      blockedBy: decision.blockedBy ?? undefined,
                      reason: decision.reason,
                    },
                  },
                  hooks,
                );
              }
              if (decision.status === "REJECTED") {
                const result = this.syntheticResult(
                  packet,
                  "BLOCKED",
                  `SCHEDULER_REJECTED: ${decision.reason}`,
                  null,
                );
                results.set(
                  packet.packetId,
                  this.packetService.recordResult(repository, packet, result),
                );
                pending.delete(packet.packetId);
              }
              continue;
            }

            // Change 018 R3: workers derive from the immutable strategy base.
            // SWARM uses it directly; a DAG node additionally replays its
            // AUTHORIZED transitive dependency commits (original staged SHAs,
            // completion order) into its own worktree before the worker starts
            // — never sibling output, never user-main noise.
            const isDag = record.strategy === "DAG";
            const baseSha = strategyBase ?? undefined;
            const dependencyInputShas = isDag
              ? this.transitiveDependencyCommits(packet, packets, results)
              : [];
            let worktree;
            try {
              this.packetService.updateStatus(packet.packetId, "STARTING");
              worktree = await this.worktreeService.allocate(
                repository,
                packet,
                baseSha,
                isDag && dependencyInputShas.length > 0
                  ? (target) =>
                      this.worktreeService.replayCommits(
                        repository,
                        target.path,
                        dependencyInputShas,
                      )
                  : undefined,
              );
              if (isDag && dependencyInputShas.length > 0) {
                // Provenance: the worktree row keeps the ORIGINAL staged
                // dependency SHAs; its baseSha (persisted by allocate) is the
                // post-replay HEAD the worker actually derives from.
                this.packetStore.updateWorktree(worktree.worktreeId, {
                  dependencyInputShas,
                });
              }
              hooks.onNodeAllocated?.(
                packet.packetId,
                worktree.baseSha,
                dependencyInputShas,
              );
              this.packetService.updateStatus(packet.packetId, "RUNNING");
            } catch (error: any) {
              this.schedulerService.release(requestId);
              const message = error?.message ?? String(error);
              const result = this.syntheticResult(
                packet,
                "BLOCKED",
                message.startsWith("DEPENDENCY_REPLAY_FAILED")
                  ? message
                  : `WORKTREE_ALLOCATION_FAILED: ${message}`,
                null,
              );
              results.set(
                packet.packetId,
                this.packetService.recordResult(repository, packet, result),
              );
              pending.delete(packet.packetId);
              continue;
            }

            pending.delete(packet.packetId);
            launched = true;
            const worker: ActiveWorker = {
              packet,
              requestId,
              runner: null,
              done: Promise.resolve(
                this.syntheticResult(
                  packet,
                  "BLOCKED",
                  "Worker did not start.",
                  null,
                ),
              ),
            };
            worker.done = (async () => {
              const result = await this.runWorker(
                record,
                repository,
                packet,
                worktree,
                worker,
              );
              let persisted = this.packetService.recordResult(
                repository,
                packet,
                result,
              );
              let integration: IntegrationReport | null = null;
              // Change 018 R1/R2: a DAG node's accepted commit is cherry-picked
              // into the run's staging checkout under the integration mutex.
              // Persistent user main is NOT touched during node staging; the
              // final qualified integration happens once at strategy terminal.
              if (
                record.strategy === "DAG" &&
                persisted.status === "COMPLETED" &&
                persisted.worktree?.commitSha
              ) {
                integration = await this.stageNodeCommit(
                  repository,
                  record,
                  persisted,
                );
                hooks.onNodeIntegrated?.(
                  packet.packetId,
                  persisted,
                  integration,
                );
                if (integration.status !== "COMPLETED") {
                  // A node whose accepted output did not stage (e.g. a
                  // cherry-pick conflict against staged sibling output) must
                  // not count as COMPLETED in the DAG aggregate; surface the
                  // typed staging outcome.
                  persisted = {
                    ...persisted,
                    status: "BLOCKED",
                    blocker:
                      integration.status === "INTEGRATION_CONFLICT"
                        ? "INTEGRATION_CONFLICT"
                        : `NODE_INTEGRATION_${integration.status}`,
                    risks: [
                      ...persisted.risks,
                      `node_integration=${integration.status}`,
                    ],
                    summary: `Worker ${packet.workstream} completed but its staging did not (${integration.status}).`,
                  };
                  // Persist the downgraded result itself, not merely the packet
                  // status: landing-time lineage reconciliation derives its
                  // accepted-commit set from persisted result rows. A row still
                  // saying COMPLETED would make the final landing re-pick this
                  // rejected commit, hit the same conflict again, and abort the
                  // WHOLE lineage merge — dropping already-staged independent
                  // siblings from persistent main (Change 014/018 preservation
                  // contract). recordResult also derives the packet BLOCKED
                  // status from the result, replacing updateStatus.
                  persisted = this.packetService.recordResult(
                    repository,
                    packet,
                    persisted,
                  );
                }
              }
              results.set(packet.packetId, persisted);
              this.schedulerService.release(requestId);
              active.workers.delete(packet.packetId);
              this.publish(
                {
                  type: "strategy.worker_completed",
                  at: persisted.createdAt,
                  repositoryId: repository.id,
                  data: {
                    runId: run.id,
                    iteration: run.currentIteration,
                    strategyRunId: record.strategyRunId,
                    packetId: packet.packetId,
                    resultStatus: persisted.status,
                    blocker: persisted.blocker ?? undefined,
                    commitSha: persisted.worktree?.commitSha ?? undefined,
                    integrated:
                      record.strategy === "DAG"
                        ? integration?.status === "COMPLETED"
                        : undefined,
                  },
                },
                hooks,
              );
              return persisted;
            })().catch((error) => {
              const result = this.syntheticResult(
                packet,
                "FAILED",
                `WORKER_RESULT_FAILED: ${error?.message ?? String(error)}`,
                worktree
                  ? this.provenance(
                      worktree.path,
                      worktree.branch,
                      worktree.baseSha,
                      null,
                      worktree.worktreeId,
                    )
                  : null,
              );
              const persisted = this.packetService.recordResult(
                repository,
                packet,
                result,
              );
              results.set(packet.packetId, persisted);
              this.schedulerService.release(requestId);
              active.workers.delete(packet.packetId);
              return persisted;
            });
            active.workers.set(packet.packetId, worker);
            this.publish(
              {
                type: "strategy.worker_started",
                at: new Date().toISOString(),
                repositoryId: repository.id,
                data: {
                  runId: run.id,
                  iteration: run.currentIteration,
                  strategyRunId: record.strategyRunId,
                  packetId: packet.packetId,
                  worktreeId: worktree.worktreeId,
                  branch: worktree.branch,
                  executor: packet.executor.executorCli,
                  model: packet.executor.model,
                },
              },
              hooks,
            );
          }
        }

        if (active.workers.size > 0) {
          idlePolls = 0;
          await Promise.race(
            [...active.workers.values()].map((worker) =>
              worker.done.catch(() => undefined),
            ),
          );
          continue;
        }
        if (pending.size > 0) {
          if (!launched) {
            idlePolls += 1;
            if (idlePolls > 600) {
              for (const packetId of pending) {
                const packet = packets.find(
                  (candidate) => candidate.packetId === packetId,
                )!;
                const result = this.syntheticResult(
                  packet,
                  "BLOCKED",
                  "SCHEDULER_WAIT_TIMEOUT: packet did not become runnable.",
                  null,
                );
                results.set(
                  packetId,
                  this.packetService.recordResult(repository, packet, result),
                );
                pending.delete(packetId);
              }
            } else {
              await this.delay(SCHEDULER_POLL_MS);
            }
          }
        }
      }

      const latest = this.strategyStore.get(record.strategyRunId);
      const controls = this.strategyStore.listControls(record.strategyRunId);
      const finalResults = packets
        .map(
          (packet) =>
            results.get(packet.packetId) ??
            this.packetService.getResult(packet.packetId),
        )
        .filter((result): result is WorkPacketResult => Boolean(result));
      const controlState = latest?.controlState ?? "NONE";
      let integration: IntegrationReport | null = null;
      let status: StrategyRunStatus;
      let blocker: string | null = null;
      if (controlState === "PAUSE_REQUESTED") {
        status = "PAUSED";
        blocker = "PAUSED: explicit swarm pause requested.";
      } else if (controlState === "KILL_REQUESTED") {
        status = "RECOVERY_REQUIRED";
        blocker = "EMERGENCY_KILLED: explicit swarm kill requested.";
      } else if (controlState === "STOP_REQUESTED") {
        status = "CANCELLED";
        blocker = "USER_STOP: explicit swarm stop requested.";
      } else if (record.strategy === "DAG") {
        // Change 018 R1: node commits were staged (never integrated) during
        // execution; perform the FINAL qualified integration of the staging
        // lineage onto a clean persistent main, then aggregate truthfully.
        const completedIds = finalResults
          .filter((result) => result?.status === "COMPLETED")
          .map((result) => result!.packetId);
        const allCompleted =
          finalResults.length > 0 &&
          finalResults.every((result) => result?.status === "COMPLETED");
        const hadIntegrationConflict = finalResults.some(
          (result) =>
            result && result.status === "BLOCKED" && result.blocker === "INTEGRATION_CONFLICT",
        );
        const anyFailed = finalResults.some(
          (result) =>
            result &&
            (result.status === "FAILED" ||
              (result.status === "BLOCKED" &&
                result.blocker !== "INTEGRATION_CONFLICT")),
        );
        const dagStatus = allCompleted
          ? "COMPLETED"
          : hadIntegrationConflict
            ? "INTEGRATION_CONFLICT"
            : anyFailed
              ? "BLOCKED"
              : "PARTIAL";
        const landing = await this.withIntegrationLock(
          record.strategyRunId,
          () => this.landStagingLineage(repository, record),
        );
        let finalCommitSha: string | null = landing?.finalCommitSha ?? null;
        if (!finalCommitSha) {
          try {
            finalCommitSha = await this.currentMainSha(repository);
          } catch {}
        }
        const landingFailure =
          landing && landing.status !== "COMPLETED" ? landing : null;
        const integrationStatus =
          dagStatus === "COMPLETED" && landingFailure
            ? landingFailure.status
            : dagStatus;
        integration = {
          schemaVersion: 1,
          repositoryId: repository.id,
          runId: run.id,
          iteration: run.currentIteration,
          status: integrationStatus,
          integratedPacketIds: completedIds,
          results: finalResults.filter((result): result is WorkPacketResult =>
            Boolean(result),
          ),
          finalCommitSha,
          blocker: allCompleted
            ? (landingFailure?.blocker ?? null)
            : "Some DAG nodes did not complete successfully.",
          createdAt: new Date().toISOString(),
        };
        this.publish(
          {
            type: "strategy.integration_completed",
            at: integration.createdAt,
            repositoryId: repository.id,
            data: {
              runId: run.id,
              iteration: run.currentIteration,
              strategyRunId: record.strategyRunId,
              strategy: record.strategy,
              integrationStatus: integration.status,
              finalCommitSha: finalCommitSha ?? undefined,
            },
          },
          hooks,
        );
        status =
          integration.status === "COMPLETED"
            ? "COMPLETED"
            : integration.status === "PARTIAL" ||
                integration.status === "INTEGRATION_CONFLICT"
              ? "PARTIAL"
              : "BLOCKED";
        blocker = integration.blocker;
      } else {
        integration = await this.integrationService.integrate(
          repository,
          run.id,
          run.currentIteration,
          packets,
          finalResults,
        );
        this.publish(
          {
            type: "strategy.integration_completed",
            at: integration.createdAt,
            repositoryId: repository.id,
            data: {
              runId: run.id,
              iteration: run.currentIteration,
              strategyRunId: record.strategyRunId,
              strategy: record.strategy,
              integrationStatus: integration.status,
              finalCommitSha: integration.finalCommitSha ?? undefined,
            },
          },
          hooks,
        );
        status =
          integration.status === "COMPLETED"
            ? "COMPLETED"
            : integration.status === "PARTIAL" ||
                integration.status === "INTEGRATION_CONFLICT"
              ? "PARTIAL"
              : "BLOCKED";
        blocker = integration.blocker;
      }
      const finishedAt = new Date().toISOString();
      const report: StrategyExecutionReport =
        record.strategy === "DAG"
          ? {
              schemaVersion: 1,
              strategyRunId: record.strategyRunId,
              repositoryId: repository.id,
              runId: run.id,
              iteration: run.currentIteration,
              strategy: "DAG",
              status,
              maxConcurrency: record.maxConcurrency,
              packetIds: packets.map((packet) => packet.packetId),
              nodeIds: hooks.nodeIds ?? [],
              nodes: [],
              results: integration?.results ?? finalResults,
              integration,
              schedulerDecisionIds: this.schedulerService
                .listDecisions(1000)
                .filter((decision) =>
                  decision.requestId.startsWith(`${record.strategyRunId}:`),
                )
                .map((decision) => decision.id),
              controlIds: controls.map((control) => control.controlId),
              blocker,
              startedAt,
              finishedAt,
            }
          : {
              schemaVersion: 1,
              strategyRunId: record.strategyRunId,
              repositoryId: repository.id,
              runId: run.id,
              iteration: run.currentIteration,
              strategy: "SWARM",
              status,
              maxConcurrency: record.maxConcurrency,
              packetIds: packets.map((packet) => packet.packetId),
              results: integration?.results ?? finalResults,
              integration,
              schedulerDecisionIds: this.schedulerService
                .listDecisions(1000)
                .filter((decision) =>
                  decision.requestId.startsWith(`${record.strategyRunId}:`),
                )
                .map((decision) => decision.id),
              controlIds: controls.map((control) => control.controlId),
              blocker,
              startedAt,
              finishedAt,
            };
      if (status !== "PAUSED" && status !== "RECOVERY_REQUIRED") {
        // Change 018 R1: remove the staging checkout at strategy terminal
        // (branch retained as provenance). A failed final integration leaves
        // the checkout in place for inspection instead.
        if (record.strategy === "DAG") {
          const staging = this.stagings.get(record.strategyRunId);
          if (staging)
            await this.worktreeService.removeStagingWorktree(
              repository,
              staging,
            );
        }
        await Promise.all(
          packets.map(async (packet) => {
            const worktree = this.packetStore.getWorktreeByPacket(
              packet.packetId,
            );
            if (
              worktree &&
              ["ACTIVE", "STALE", "ALLOCATED"].includes(worktree.status)
            ) {
              // Item #9: a policy-violating worker keeps its worktree/branch
              // for inspection instead of being released.
              const result = results.get(packet.packetId);
              if (result?.blocker === "POLICY_VIOLATION") return;
              await this.worktreeService.release(
                repository,
                worktree.worktreeId,
              );
            }
          }),
        );
      }
      // Change 018 R3/F2: a KILL (or STOP) that lands while final integration
      // is still running must win over the just-computed integration outcome —
      // otherwise a strategy could report COMPLETED under a campaign already
      // marked RECOVERY_REQUIRED/STOPPED. Re-read the latched control state
      // after all async work and let the control decision override.
      const latestControlState =
        this.strategyStore.get(record.strategyRunId)?.controlState ?? "NONE";
      if (latestControlState === "KILL_REQUESTED") {
        status = "RECOVERY_REQUIRED";
        blocker = "EMERGENCY_KILLED: kill requested during strategy finalization.";
      } else if (latestControlState === "STOP_REQUESTED") {
        status = "CANCELLED";
        blocker = "USER_STOP: stop requested during strategy finalization.";
      }
      const final = this.strategyStore.update(record.strategyRunId, {
        status,
        finishedAt,
        report,
        lastError: blocker,
      });
      const finalRecord =
        final ?? {
          ...record,
          status,
          finishedAt,
          report,
          lastError: blocker,
          updatedAt: finishedAt,
        };
      // Item #5: hand the normalized terminal outcome to the coordinator so it
      // can publish integrated main durably and close the loop iteration.
      if (
        ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"].includes(
          status,
        )
      ) {
        try {
          hooks.onCompleted?.(finalRecord);
        } catch {}
      }
      this.publish(
        {
          type: "strategy.completed",
          at: finishedAt,
          repositoryId: repository.id,
          data: {
            runId: run.id,
            iteration: run.currentIteration,
            strategyRunId: record.strategyRunId,
            strategy: record.strategy,
            strategyStatus: status,
            blocker: blocker ?? undefined,
          },
        },
        hooks,
      );
      return finalRecord;
    } catch (error) {
      await this.failStrategy(record.strategyRunId, error);
      return this.strategyStore.get(record.strategyRunId) ?? record;
    } finally {
      this.active.delete(record.strategyRunId);
      this.integrationLocks.delete(record.strategyRunId);
      if (this.strategyStore.get(record.strategyRunId)?.status !== "PAUSED") {
        // A PAUSED run keeps its staging handle: RESUME continues the same
        // lineage in the same checkout. Every terminal state drops it.
        this.stagings.delete(record.strategyRunId);
        this.stagedOriginalShas.delete(record.strategyRunId);
        this.hooks.delete(record.strategyRunId);
      }
    }
  }

  private async runWorker(
    strategy: StrategyRunRecord,
    repository: RepositoryRecord,
    packet: WorkPacket,
    worktree: {
      path: string;
      branch: string;
      baseSha: string;
      worktreeId: string;
    },
    holder: ActiveWorker,
  ): Promise<WorkPacketResult> {
    const profile = resolveProfile(packet.executor.executorCli);
    const adapter =
      profile === "opencode" && this.openCodeAdapter
        ? this.openCodeAdapter
        : repository.environment === "wsl"
          ? this.wslAdapter
          : this.windowsAdapter;
    const invocation = buildExecutorInvocation(profile, {
      cli: packet.executor.executorCli,
      model: packet.executor.model,
      prompt: this.buildWorkerPrompt(packet),
      environment: repository.environment,
    });
    const logPath = path.join(
      this.dataDir,
      "logs",
      "swarm",
      strategy.strategyRunId,
      `${packet.packetId}.log`,
    );
    const context = this.gitContext(repository, worktree.path);
    return new Promise<WorkPacketResult>((resolve) => {
      let settled = false;
      const finish = (result: WorkPacketResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const runner = new ExecutorRunner({
        adapter,
        context: {
          command: invocation.command,
          args: invocation.args,
          cwd: worktree.path,
          env: {
            ORCA_RUN_ID: packet.runId,
            ORCA_SWARM_RUN_ID: strategy.strategyRunId,
            ORCA_PACKET_ID: packet.packetId,
            ORCA_WORKSTREAM: packet.workstream,
            ORCA_ALLOWED_PATHS: JSON.stringify(packet.allowedPaths),
            ORCA_WORKTREE_PATH: worktree.path,
            ORCA_EXECUTOR_MODEL: packet.executor.model,
            ORCA_ENVIRONMENT: repository.environment,
            ...(process.env.ORCA_SWARM_FAIL_PACKET
              ? { ORCA_SWARM_FAIL_PACKET: process.env.ORCA_SWARM_FAIL_PACKET }
              : {}),
            ...(process.env.ORCA_SWARM_HARNESS_SLOW_MS
              ? {
                  ORCA_SWARM_HARNESS_SLOW_MS:
                    process.env.ORCA_SWARM_HARNESS_SLOW_MS,
                }
              : {}),
            ...(process.env.ORCA_SWARM_WAIT_FILE
              ? { ORCA_SWARM_WAIT_FILE: process.env.ORCA_SWARM_WAIT_FILE }
              : {}),
            ...(process.env.ORCA_REQUIRE_FILE
              ? { ORCA_REQUIRE_FILE: process.env.ORCA_REQUIRE_FILE }
              : {}),
            ...(process.env.ORCA_REQUIRE_CONTENT
              ? {
                  ORCA_REQUIRE_CONTENT: process.env.ORCA_REQUIRE_CONTENT,
                }
              : {}),
            ...(process.env.ORCA_REQUIRE_PACKETS
              ? {
                  ORCA_REQUIRE_PACKETS: process.env.ORCA_REQUIRE_PACKETS,
                }
              : {}),
            ...(process.env.ORCA_SWARM_VIOLATE_PATHS
              ? {
                  ORCA_SWARM_VIOLATE_PATHS:
                    process.env.ORCA_SWARM_VIOLATE_PATHS,
                }
              : {}),
          },
          wslDistribution: repository.wslDistribution,
        },
        logPath,
        watchdogMs: packet.budget.maxRuntimeMs,
        onLog: () => {},
        onExit: (exitCode, details) => {
          void this.buildWorkerResult(
            repository,
            packet,
            worktree,
            context,
            exitCode,
            details,
            adapter,
          )
            .then(finish)
            .catch((error) =>
              finish(
                this.syntheticResult(
                  packet,
                  "FAILED",
                  `WORKER_RESULT_FAILED: ${error?.message ?? String(error)}`,
                  this.provenance(
                    worktree.path,
                    worktree.branch,
                    worktree.baseSha,
                    null,
                    worktree.worktreeId,
                  ),
                ),
              ),
            );
        },
      });
      holder.runner = runner;
      void runner.start().catch((error) => {
        finish(
          this.syntheticResult(
            packet,
            "FAILED",
            `EXECUTOR_START_FAILED: ${error?.message ?? String(error)}`,
            this.provenance(
              worktree.path,
              worktree.branch,
              worktree.baseSha,
              null,
              worktree.worktreeId,
            ),
          ),
        );
      });
    });
  }

  private async buildWorkerResult(
    repository: RepositoryRecord,
    packet: WorkPacket,
    worktree: {
      path: string;
      branch: string;
      baseSha: string;
      worktreeId: string;
    },
    context: GitContext,
    exitCode: number | null,
    details: {
      reason: ExecutorExitReason;
      timedOut: boolean;
      wasKilled: boolean;
      wasPaused: boolean;
    },
    adapter: ExecutorAdapter,
  ): Promise<WorkPacketResult> {
    let head: string | null = null;
    let filesChanged: string[] = [];
    try {
      head = await this.gitClient.getCurrentSha(context);
      if (head && head !== worktree.baseSha) {
        const commits = await this.gitClient.getRevList(
          context,
          worktree.baseSha,
          head,
        );
        const changes = (
          await Promise.all(
            commits.map((commit) =>
              this.gitClient.getCommitChanges(context, commit),
            ),
          )
        ).flat();
        filesChanged = [
          ...new Set(changes.map((change) => change.path.replace(/\\/g, "/"))),
        ];
      }
    } catch {}
    // Item #9: real write-ownership enforcement. A packet that declares no
    // allowed paths is unrestricted by declaration; declared scopes are hard
    // enforcement validated against actual Git-derived changes.
    const violatingPaths =
      packet.allowedPaths.length > 0
        ? filesChanged.filter((file) => !isPathAllowed(file, packet.allowedPaths))
        : [];
    let usageMetricIds: string[] = [];
    const metric = await this.usageTelemetryService?.captureAdapterUsage(
      adapter,
      {
        repositoryId: repository.id,
        runId: packet.runId,
        iteration: packet.iteration,
        dispatchId: null,
        executorRunId: null,
        executor: packet.executor.executorCli,
        model: packet.executor.model,
        provider: packet.executor.provider,
      },
    );
    if (metric) usageMetricIds = [metric.id];
    const provenance = this.provenance(
      worktree.path,
      worktree.branch,
      worktree.baseSha,
      head && head !== worktree.baseSha ? head : null,
      worktree.worktreeId,
    );
    const reason = details.wasPaused
      ? "PAUSED"
      : details.wasKilled
        ? "EMERGENCY_KILLED"
        : details.timedOut
          ? "EXECUTOR_WATCHDOG_TIMEOUT"
          : violatingPaths.length > 0
            ? "POLICY_VIOLATION"
            : exitCode !== 0
              ? `EXECUTOR_EXIT_${exitCode ?? "UNKNOWN"}`
              : !provenance.commitSha
                ? "WORKER_NO_COMMIT"
                : null;
    const status: WorkPacketResult["status"] =
      details.wasPaused || details.wasKilled
        ? "CANCELLED"
        : violatingPaths.length > 0
          ? "BLOCKED"
          : exitCode === 0 && provenance.commitSha
            ? "COMPLETED"
            : "FAILED";
    return {
      schemaVersion: 1,
      packetId: packet.packetId,
      campaignId: packet.campaignId,
      runId: packet.runId,
      iteration: packet.iteration,
      status,
      worktree: provenance,
      filesChanged,
      verification: [
        `executor_exit_code=${exitCode ?? "unknown"}`,
        `executor_exit_reason=${details.reason}`,
        ...(provenance.commitSha
          ? [`worker_commit=${provenance.commitSha}`]
          : []),
        ...(violatingPaths.length > 0
          ? [`allowed_paths_violation=${violatingPaths.join(",")}`]
          : []),
      ],
      findings: [],
      risks:
        status === "COMPLETED"
          ? []
          : violatingPaths.length > 0
            ? [`POLICY_VIOLATION: ${violatingPaths.join(", ")}`]
            : [reason ?? "WORKER_FAILED"],
      artifacts: [],
      dependenciesAffected: packet.dependencies,
      usageMetricIds,
      summary:
        status === "COMPLETED"
          ? `Worker ${packet.workstream} completed.`
          : violatingPaths.length > 0
            ? `Worker ${packet.workstream} modified paths outside allowedPaths: ${violatingPaths.join(", ")}.`
            : `Worker ${packet.workstream} did not complete.`,
      blocker: reason,
      createdAt: new Date().toISOString(),
    };
  }

  private evaluateWritePermission(
    repository: RepositoryRecord,
    run: RunRecord,
    packet: WorkPacket,
  ): "ALLOW" | "ASK" | "DENY" {
    if (
      packet.permissionPolicy.deniedActions.includes("REPOSITORY_FILE_WRITE") ||
      packet.permissionPolicy.deniedActions.includes("GIT_COMMIT")
    )
      return "DENY";
    if (
      packet.permissionPolicy.preset === "CONSERVATIVE" &&
      !packet.permissionPolicy.allowedActions.includes("REPOSITORY_FILE_WRITE")
    )
      return "ASK";
    if (
      packet.permissionPolicy.preset === "CUSTOM" &&
      !packet.permissionPolicy.allowedActions.includes("REPOSITORY_FILE_WRITE")
    )
      return "ASK";
    const evaluation = this.permissionPolicyService?.evaluate({
      repositoryId: repository.id,
      action: "REPOSITORY_FILE_WRITE",
      runId: run.id,
      iteration: run.currentIteration,
    });
    return evaluation?.outcome === "DENY"
      ? "DENY"
      : evaluation?.outcome === "ASK"
        ? "ASK"
        : "ALLOW";
  }

  private syntheticResult(
    packet: WorkPacket,
    status: WorkPacketResult["status"],
    blocker: string,
    worktree: WorktreeProvenance | null,
  ): WorkPacketResult {
    return {
      schemaVersion: 1,
      packetId: packet.packetId,
      campaignId: packet.campaignId,
      runId: packet.runId,
      iteration: packet.iteration,
      status,
      worktree,
      filesChanged: [],
      verification: [],
      findings: [],
      risks: [blocker],
      artifacts: [],
      dependenciesAffected: packet.dependencies,
      usageMetricIds: [],
      summary: blocker,
      blocker,
      createdAt: new Date().toISOString(),
    };
  }

  private provenance(
    pathValue: string,
    branch: string,
    baseSha: string,
    commitSha: string | null,
    worktreeId: string,
  ): WorktreeProvenance {
    return { worktreeId, path: pathValue, branch, baseSha, commitSha };
  }

  private gitContext(
    repository: RepositoryRecord,
    worktreePath: string,
  ): GitContext {
    return repository.environment === "wsl"
      ? {
          environment: "wsl",
          workingPath: worktreePath,
          linuxPath: toWslPath(worktreePath),
          wslDistribution: repository.wslDistribution,
        }
      : { environment: "windows", workingPath: worktreePath };
  }

  private buildWorkerPrompt(packet: WorkPacket): string {
    return [
      "You are an isolated Orca swarm worker.",
      `Workstream: ${packet.workstream}`,
      `Goal: ${packet.goal}`,
      `Requirements: ${packet.requirements.join(" | ") || "none"}`,
      `Allowed paths: ${packet.allowedPaths.join(", ") || "none"}`,
      `Read paths: ${packet.readPaths.join(", ") || "none"}`,
      `Dependencies: ${packet.dependencies.join(", ") || "none"}`,
      "Work only in the supplied isolated checkout. Commit completed changes locally; do not push or rewrite main. Return structured evidence through the worker result path.",
    ].join("\n");
  }

  private hasCycle(packets: WorkPacket[]): boolean {
    const byId = new Map(packets.map((packet) => [packet.packetId, packet]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (packetId: string): boolean => {
      if (visiting.has(packetId)) return true;
      if (visited.has(packetId)) return false;
      visiting.add(packetId);
      for (const dependency of byId.get(packetId)?.dependencies ?? [])
        if (visit(dependency)) return true;
      visiting.delete(packetId);
      visited.add(packetId);
      return false;
    };
    return packets.some((packet) => visit(packet.packetId));
  }

  private async failStrategy(
    strategyRunId: string,
    error: unknown,
  ): Promise<StrategyRunRecord | null> {
    try {
      const record = this.strategyStore.get(strategyRunId);
      if (!record) return null;
      const message = `STRATEGY_FAILED: ${error instanceof Error ? error.message : String(error)}`;
      const next = this.strategyStore.update(strategyRunId, {
        status: "FAILED",
        lastError: message,
        finishedAt: new Date().toISOString(),
      });
      if (next)
        this.publish(
          {
            type: "strategy.completed",
            at: next.finishedAt!,
            repositoryId: next.repositoryId,
            data: {
              runId: next.runId,
              iteration: next.iteration,
              strategyRunId,
              strategy: next.strategy,
              strategyStatus: "FAILED",
              reason: message,
            },
          },
          this.hooks.get(strategyRunId),
        );
      // Terminal failure must also reach the coordinator/loop truthfully.
      if (next) {
        try {
          this.hooks.get(strategyRunId)?.onCompleted?.(next);
        } catch {}
      }
      this.hooks.delete(strategyRunId);
      return next;
    } catch {
      // A controller teardown can close SQLite while a child exit callback is
      // unwinding. The durable state already records the last safe checkpoint;
      // never surface a second unhandled rejection from cleanup.
      return null;
    }
  }

  private publish(
    event: RepositoryMutationEvent,
    hooks?: StrategyExecutionHooks,
  ): void {
    try {
      this.eventPublisher?.(event);
    } catch {}
    try {
      hooks?.onEvent?.(event);
    } catch {}
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
/**
 * Item #9: check whether a changed file is within the packet's allowed paths.
 * Supports exact paths, directory prefixes (trailing "/"), basename match when
 * the allowed path has no "/", and simple glob segments ("*" / "**").
 */
function isPathAllowed(file: string, allowedPaths: string[]): boolean {
  const normalized = file.replace(/\\/g, "/");
  for (const raw of allowedPaths) {
    const a = raw.replace(/\\/g, "/").trim();
    if (!a) continue;
    if (a === "*" || a === "**" || a === "*/*") return true;
    if (a.includes("*")) {
      const regex = new RegExp(
        "^" +
          a
            .split("/")
            .map((seg) =>
              seg === "**"
                ? "(?:.*)"
                : seg === "*"
                  ? "[^/]*"
                  : seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("/") +
          "$",
      );
      if (regex.test(normalized)) return true;
      continue;
    }
    if (normalized === a) return true;
    if (a.endsWith("/") && normalized.startsWith(a)) return true;
    if (!a.includes("/") && normalized.split("/").pop() === a) return true;
    if (normalized.startsWith(a + "/")) return true;
  }
  return false;
}
