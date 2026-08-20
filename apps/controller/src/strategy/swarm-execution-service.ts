import crypto from "node:crypto";
import path from "node:path";
import {
  ValidationError,
  type RepositoryMutationEvent,
  type RepositoryRecord,
  type RunRecord,
  type StrategyControlDecision,
  type StrategyControlRecord,
  type StrategyRunRecord,
  type StrategyRunStatus,
  type SwarmExecutionReport,
  type WorkPacket,
  type WorkPacketResult,
  type WorktreeProvenance
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "../loop/run-store.js";
import type { GitClient, GitContext } from "../watcher/git-client.js";
import { GitClient as DefaultGitClient } from "../watcher/git-client.js";
import type { ExecutorAdapter } from "../executor/adapters/executor-adapter.js";
import { WindowsPowerShellAdapter } from "../executor/adapters/windows-adapter.js";
import { WslAdapter } from "../executor/adapters/wsl-adapter.js";
import { ExecutorRunner, type ExecutorExitReason } from "../executor/executor-runner.js";
import { buildExecutorInvocation, resolveProfile } from "../executor/profiles.js";
import type { PermissionPolicyService } from "../permissions/permission-policy-service.js";
import type { SchedulerService } from "../scheduler/scheduler-service.js";
import type { UsageTelemetryService } from "../usage/usage-telemetry-service.js";
import type { WorkPacketService } from "../packets/work-packet-service.js";
import type { WorkPacketStore } from "../packets/work-packet-store.js";
import type { WorktreeIsolationService } from "../packets/worktree-isolation-service.js";
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
  private readonly eventPublisher?: (event: RepositoryMutationEvent) => void;
  private readonly active = new Map<string, ActiveStrategy>();

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
    this.windowsAdapter = options.windowsAdapter ?? new WindowsPowerShellAdapter();
    this.wslAdapter = options.wslAdapter ?? new WslAdapter();
    this.eventPublisher = options.eventPublisher;
  }

  /** Start an explicitly selected swarm in the background for REST callers. */
  start(repositoryId: string, runId: string, iteration: number, options: SwarmStartOptions): StrategyRunRecord {
    const context = this.validateStart(repositoryId, runId, iteration, options);
    const record = this.createRecord(context.repository, context.run, context.packets, options.maxConcurrency);
    void this.executeRecord(record, context.repository, context.run, context.packets).catch((error) => {
      this.failStrategy(record.strategyRunId, error);
    });
    return record;
  }

  /** Deterministic/test-friendly synchronous entry point that resolves on final report. */
  async execute(repositoryId: string, runId: string, iteration: number, options: SwarmStartOptions): Promise<StrategyRunRecord> {
    const context = this.validateStart(repositoryId, runId, iteration, options);
    const record = this.createRecord(context.repository, context.run, context.packets, options.maxConcurrency);
    return this.executeRecord(record, context.repository, context.run, context.packets);
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

  getDetail(repositoryId: string, runId: string, strategyRunId: string): {
    strategy: StrategyRunRecord;
    controls: StrategyControlRecord[];
    packets: WorkPacket[];
    results: WorkPacketResult[];
  } | null {
    const strategy = this.strategyStore.get(strategyRunId);
    if (!strategy || strategy.repositoryId !== repositoryId || strategy.runId !== runId) return null;
    const packets = strategy.packetIds
      .map((packetId) => this.packetService.get(packetId))
      .filter((packet): packet is WorkPacket => Boolean(packet));
    return {
      strategy,
      controls: this.strategyStore.listControls(strategyRunId),
      packets,
      results: packets
        .map((packet) => this.packetService.getResult(packet.packetId))
        .filter((result): result is WorkPacketResult => Boolean(result))
    };
  }

  async control(
    repositoryId: string,
    strategyRunId: string,
    decision: StrategyControlDecision,
    reason: string | null = null
  ): Promise<StrategyRunRecord> {
    const record = this.strategyStore.get(strategyRunId);
    if (!record || record.repositoryId !== repositoryId) {
      throw new ValidationError("Swarm strategy run does not belong to this repository.");
    }
    if (record.strategy !== "SWARM") throw new ValidationError("Only SWARM strategy runs accept swarm controls.");
    const repository = this.repositoryStore.get(repositoryId);
    if (!repository) throw new ValidationError(`Repository ${repositoryId} not found`);
    const control = this.strategyStore.createControl({
      strategyRunId,
      repositoryId,
      runId: record.runId,
      iteration: record.iteration,
      decision,
      reason,
      createdAt: new Date().toISOString()
    });
    const nextState = decision === "PAUSE"
      ? "PAUSE_REQUESTED"
      : decision === "STOP"
        ? "STOP_REQUESTED"
        : decision === "KILL"
          ? "KILL_REQUESTED"
          : "NONE";
    const updated = this.strategyStore.update(strategyRunId, {
      controlState: nextState,
      status: decision === "STOP" ? "STOPPING" : record.status
    }) ?? record;
    this.publish({
      type: "strategy.control",
      at: control.createdAt,
      repositoryId,
      data: {
        runId: record.runId,
        iteration: record.iteration,
        strategyRunId,
        controlId: control.controlId,
        decision,
        reason: reason ?? undefined
      }
    });

    const active = this.active.get(strategyRunId);
    if (decision === "PAUSE" && active) {
      await Promise.all([...active.workers.values()].map(async (worker) => {
        await worker.runner?.pause().catch(() => {});
      }));
    } else if (decision === "KILL" && active) {
      await Promise.all([...active.workers.values()].map(async (worker) => {
        await worker.runner?.kill().catch(() => {});
      }));
    } else if (decision === "RESUME") {
      if (record.status !== "PAUSED") throw new ValidationError(`Cannot resume swarm strategy in status ${record.status}.`);
      const run = this.runStore.get(record.runId);
      if (!run) throw new ValidationError(`Campaign ${record.runId} not found.`);
      const packets = record.packetIds.map((packetId) => this.packetService.get(packetId)).filter((packet): packet is WorkPacket => Boolean(packet));
      for (const packet of packets) {
        const existingResult = this.packetService.getResult(packet.packetId);
        if (existingResult?.status !== "COMPLETED") this.packetService.updateStatus(packet.packetId, "QUEUED");
      }
      const resumed = this.strategyStore.update(strategyRunId, { controlState: "NONE", status: "QUEUED", finishedAt: null });
      if (resumed) void this.executeRecord(resumed, repository, run, packets).catch((error) => this.failStrategy(strategyRunId, error));
      return resumed ?? updated;
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
        if (!["STARTING", "RUNNING", "RETRYING"].includes(packet.status)) continue;
        const worktree = this.packetStore.getWorktreeByPacket(packet.packetId);
        this.packetService.recordResult(repository, packet, this.syntheticResult(
          packet,
          "BLOCKED",
          "RECOVERY_REQUIRED: controller restarted without a live swarm worker.",
          worktree ? this.provenance(worktree.path, worktree.branch, worktree.baseSha, null, worktree.worktreeId) : null
        ));
      }
      await this.worktreeService.recover(repository).catch(() => {});
      const next = this.strategyStore.update(record.strategyRunId, {
        status: "RECOVERY_REQUIRED",
        controlState: "NONE",
        lastError: "RECOVERY_REQUIRED: controller restarted without live swarm runners.",
        finishedAt: new Date().toISOString()
      });
      if (next) {
        recovered.push(next);
        this.publish({
          type: "strategy.recovery",
          at: next.finishedAt ?? new Date().toISOString(),
          repositoryId: next.repositoryId,
          data: { runId: next.runId, iteration: next.iteration, strategyRunId: next.strategyRunId, reason: next.lastError ?? undefined }
        });
      }
    }
    return recovered;
  }

  private validateStart(repositoryId: string, runId: string, iteration: number, options: SwarmStartOptions): {
    repository: RepositoryRecord;
    run: RunRecord;
    packets: WorkPacket[];
  } {
    const repository = this.repositoryStore.get(repositoryId);
    if (!repository) throw new ValidationError(`Repository ${repositoryId} not found`);
    const run = this.runStore.get(runId);
    if (!run || run.repositoryId !== repositoryId) throw new ValidationError("Campaign/run correlation is invalid.");
    if (run.currentIteration !== iteration) throw new ValidationError("Swarm iteration does not match the campaign's current iteration.");
    const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > MAX_MAX_CONCURRENCY) {
      throw new ValidationError(`Swarm maxConcurrency must be an integer from 1 to ${MAX_MAX_CONCURRENCY}.`);
    }
    const packetIds = [...new Set(options.packetIds)];
    if (packetIds.length !== options.packetIds.length) throw new ValidationError("Swarm packet IDs must be unique.");
    const packets = packetIds.map((packetId) => this.packetService.get(packetId));
    if (packets.some((packet): packet is null => packet === null)) throw new ValidationError("Every swarm packet must be durable before execution.");
    const selected = packets as WorkPacket[];
    for (const packet of selected) {
      if (packet.runId !== runId || packet.campaignId !== runId || packet.iteration !== iteration || this.packetStore.getRepositoryId(packet.packetId) !== repositoryId) {
        throw new ValidationError(`Packet ${packet.packetId} does not belong to the requested campaign iteration.`);
      }
      if (packet.parentDispatchId && packet.parentDispatchId !== run.activeDispatchId) {
        throw new ValidationError(`Packet ${packet.packetId} parent dispatch is not the campaign's active dispatch.`);
      }
    }
    const selectedIds = new Set(selected.map((packet) => packet.packetId));
    for (const packet of selected) {
      if (packet.dependencies.some((dependency) => !selectedIds.has(dependency))) {
        throw new ValidationError(`Packet ${packet.packetId} has a dependency outside the selected swarm.`);
      }
    }
    if (this.hasCycle(selected)) throw new ValidationError("Swarm packet dependency graph contains a cycle.");
    if (this.strategyStore.getActiveForRun(runId)) throw new ValidationError(`A strategy is already active for campaign ${runId}.`);
    return { repository, run, packets: selected };
  }

  private createRecord(repository: RepositoryRecord, run: RunRecord, packets: WorkPacket[], maxConcurrency = DEFAULT_MAX_CONCURRENCY): StrategyRunRecord {
    const now = new Date().toISOString();
    return this.strategyStore.create({
      schemaVersion: 1,
      strategyRunId: crypto.randomUUID(),
      repositoryId: repository.id,
      campaignId: run.id,
      runId: run.id,
      iteration: run.currentIteration,
      strategy: "SWARM",
      status: "QUEUED",
      maxConcurrency,
      packetIds: packets.map((packet) => packet.packetId),
      controlState: "NONE",
      startedAt: null,
      finishedAt: null,
      lastError: null,
      report: null,
      createdAt: now,
      updatedAt: now
    });
  }

  private async executeRecord(record: StrategyRunRecord, repository: RepositoryRecord, run: RunRecord, packets: WorkPacket[]): Promise<StrategyRunRecord> {
    const startedAt = new Date().toISOString();
    this.strategyStore.update(record.strategyRunId, { status: "RUNNING", startedAt, controlState: "NONE", lastError: null });
    const active: ActiveStrategy = { workers: new Map(), queuedRequests: new Set() };
    this.active.set(record.strategyRunId, active);
    this.publish({
      type: "strategy.started",
      at: startedAt,
      repositoryId: repository.id,
      data: { runId: run.id, iteration: run.currentIteration, strategyRunId: record.strategyRunId, strategy: "SWARM", maxConcurrency: record.maxConcurrency }
    });

    const pending = new Set(packets.map((packet) => packet.packetId));
    const results = new Map<string, WorkPacketResult>();
    for (const packet of packets) {
      const existing = this.packetService.getResult(packet.packetId);
      if (existing?.status === "COMPLETED") {
        results.set(packet.packetId, existing);
        pending.delete(packet.packetId);
      }
    }

    try {
      let idlePolls = 0;
      while (pending.size > 0 || active.workers.size > 0) {
        const current = this.strategyStore.get(record.strategyRunId);
        const controlState = current?.controlState ?? "NONE";
        if (controlState === "PAUSE_REQUESTED") {
          await Promise.all([...active.workers.values()].map((worker) => worker.runner?.pause().catch(() => undefined)));
          break;
        }
        if (controlState === "KILL_REQUESTED") {
          for (const packetId of pending) {
            const packet = packets.find((candidate) => candidate.packetId === packetId)!;
            const result = this.syntheticResult(packet, "CANCELLED", "EMERGENCY_KILLED: swarm worker was not started.", null);
            results.set(packetId, this.packetService.recordResult(repository, packet, result));
            pending.delete(packetId);
          }
          await Promise.all([...active.workers.values()].map((worker) => worker.runner?.kill().catch(() => undefined)));
        }
        if (controlState === "STOP_REQUESTED") {
          for (const packetId of pending) {
            const packet = packets.find((candidate) => candidate.packetId === packetId)!;
            const result = this.syntheticResult(packet, "CANCELLED", "USER_STOP: swarm worker was not started.", null);
            results.set(packetId, this.packetService.recordResult(repository, packet, result));
            pending.delete(packetId);
          }
        }

        let launched = false;
        if (controlState === "NONE") {
          const sorted = packets.filter((packet) => pending.has(packet.packetId)).sort((a, b) => a.packetId.localeCompare(b.packetId));
          for (const packet of sorted) {
            if (active.workers.size >= record.maxConcurrency) break;
            const dependencyResults = packet.dependencies.map((dependency) => results.get(dependency) ?? this.packetService.getResult(dependency));
            if (dependencyResults.some((dependency) => dependency && dependency.status !== "COMPLETED")) {
              const result = this.syntheticResult(packet, "SKIPPED_DEPENDENCY", "A dependency did not complete successfully.", null);
              results.set(packet.packetId, this.packetService.recordResult(repository, packet, result));
              pending.delete(packet.packetId);
              continue;
            }
            if (dependencyResults.some((dependency) => !dependency)) continue;

            const permission = this.evaluateWritePermission(repository, run, packet);
            if (permission === "ASK" || permission === "DENY") {
              this.packetService.updateStatus(packet.packetId, "WAITING_PERMISSION");
              const result = this.syntheticResult(packet, "BLOCKED", `PERMISSION_${permission}: repository file write policy requires attention.`, null);
              results.set(packet.packetId, this.packetService.recordResult(repository, packet, result));
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
              requestedSpend: packet.budget.maxSpend
            });
            if (decision.status !== "ADMITTED") {
              if (decision.status === "QUEUED" && !active.queuedRequests.has(requestId)) {
                active.queuedRequests.add(requestId);
                this.publish({
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
                    reason: decision.reason
                  }
                });
              }
              if (decision.status === "REJECTED") {
                const result = this.syntheticResult(packet, "BLOCKED", `SCHEDULER_REJECTED: ${decision.reason}`, null);
                results.set(packet.packetId, this.packetService.recordResult(repository, packet, result));
                pending.delete(packet.packetId);
              }
              continue;
            }

            let worktree;
            try {
              this.packetService.updateStatus(packet.packetId, "STARTING");
              worktree = await this.worktreeService.allocate(repository, packet);
              this.packetService.updateStatus(packet.packetId, "RUNNING");
            } catch (error: any) {
              this.schedulerService.release(requestId);
              const result = this.syntheticResult(packet, "BLOCKED", `WORKTREE_ALLOCATION_FAILED: ${error?.message ?? String(error)}`, null);
              results.set(packet.packetId, this.packetService.recordResult(repository, packet, result));
              pending.delete(packet.packetId);
              continue;
            }

            pending.delete(packet.packetId);
            launched = true;
            const worker: ActiveWorker = {
              packet,
              requestId,
              runner: null,
              done: Promise.resolve(this.syntheticResult(packet, "BLOCKED", "Worker did not start.", null))
            };
            worker.done = this.runWorker(record, repository, packet, worktree, worker).then((result) => {
              const persisted = this.packetService.recordResult(repository, packet, result);
              results.set(packet.packetId, persisted);
              this.schedulerService.release(requestId);
              active.workers.delete(packet.packetId);
              this.publish({
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
                  commitSha: persisted.worktree?.commitSha ?? undefined
                }
              });
              return persisted;
            }).catch((error) => {
              const result = this.syntheticResult(packet, "FAILED", `WORKER_RESULT_FAILED: ${error?.message ?? String(error)}`, worktree ? this.provenance(worktree.path, worktree.branch, worktree.baseSha, null, worktree.worktreeId) : null);
              const persisted = this.packetService.recordResult(repository, packet, result);
              results.set(packet.packetId, persisted);
              this.schedulerService.release(requestId);
              active.workers.delete(packet.packetId);
              return persisted;
            });
            active.workers.set(packet.packetId, worker);
            this.publish({
              type: "strategy.worker_started",
              at: new Date().toISOString(),
              repositoryId: repository.id,
              data: { runId: run.id, iteration: run.currentIteration, strategyRunId: record.strategyRunId, packetId: packet.packetId, worktreeId: worktree.worktreeId, branch: worktree.branch, executor: packet.executor.executorCli, model: packet.executor.model }
            });
          }
        }

        if (active.workers.size > 0) {
          idlePolls = 0;
          await Promise.race([...active.workers.values()].map((worker) => worker.done.catch(() => undefined)));
          continue;
        }
        if (pending.size > 0) {
          if (!launched) {
            idlePolls += 1;
            if (idlePolls > 600) {
              for (const packetId of pending) {
                const packet = packets.find((candidate) => candidate.packetId === packetId)!;
                const result = this.syntheticResult(packet, "BLOCKED", "SCHEDULER_WAIT_TIMEOUT: packet did not become runnable.", null);
                results.set(packetId, this.packetService.recordResult(repository, packet, result));
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
      const finalResults = packets.map((packet) => results.get(packet.packetId) ?? this.packetService.getResult(packet.packetId)).filter((result): result is WorkPacketResult => Boolean(result));
      const controlState = latest?.controlState ?? "NONE";
      let integration = null;
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
      } else {
        integration = await this.integrationService.integrate(repository, run.id, run.currentIteration, packets, finalResults);
        this.publish({
          type: "strategy.integration_completed",
          at: integration.createdAt,
          repositoryId: repository.id,
          data: { runId: run.id, iteration: run.currentIteration, strategyRunId: record.strategyRunId, integrationStatus: integration.status, finalCommitSha: integration.finalCommitSha ?? undefined }
        });
        status = integration.status === "COMPLETED"
          ? "COMPLETED"
          : integration.status === "PARTIAL" || integration.status === "INTEGRATION_CONFLICT"
            ? "PARTIAL"
            : "BLOCKED";
        blocker = integration.blocker;
      }
      const finishedAt = new Date().toISOString();
      const report: SwarmExecutionReport = {
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
        schedulerDecisionIds: this.schedulerService.listDecisions(1000).filter((decision) => decision.requestId.startsWith(`${record.strategyRunId}:`)).map((decision) => decision.id),
        controlIds: controls.map((control) => control.controlId),
        blocker,
        startedAt,
        finishedAt
      };
      if (status !== "PAUSED" && status !== "RECOVERY_REQUIRED") {
        await Promise.all(packets.map(async (packet) => {
          const worktree = this.packetStore.getWorktreeByPacket(packet.packetId);
          if (worktree && ["ACTIVE", "STALE", "ALLOCATED"].includes(worktree.status)) await this.worktreeService.release(repository, worktree.worktreeId);
        }));
      }
      const final = this.strategyStore.update(record.strategyRunId, { status, finishedAt, report, lastError: blocker });
      this.publish({
        type: "strategy.completed",
        at: finishedAt,
        repositoryId: repository.id,
        data: { runId: run.id, iteration: run.currentIteration, strategyRunId: record.strategyRunId, strategyStatus: status, blocker: blocker ?? undefined }
      });
      return final ?? { ...record, status, finishedAt, report, lastError: blocker, updatedAt: finishedAt };
    } catch (error) {
      await this.failStrategy(record.strategyRunId, error);
      return this.strategyStore.get(record.strategyRunId) ?? record;
    } finally {
      this.active.delete(record.strategyRunId);
    }
  }

  private async runWorker(
    strategy: StrategyRunRecord,
    repository: RepositoryRecord,
    packet: WorkPacket,
    worktree: { path: string; branch: string; baseSha: string; worktreeId: string },
    holder: ActiveWorker
  ): Promise<WorkPacketResult> {
    const adapter = repository.environment === "wsl" ? this.wslAdapter : this.windowsAdapter;
    const profile = resolveProfile(packet.executor.executorCli);
    const invocation = buildExecutorInvocation(profile, {
      cli: packet.executor.executorCli,
      model: packet.executor.model,
      prompt: this.buildWorkerPrompt(packet),
      environment: repository.environment
    });
    const logPath = path.join(this.dataDir, "logs", "swarm", strategy.strategyRunId, `${packet.packetId}.log`);
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
            ...(process.env.ORCA_SWARM_FAIL_PACKET ? { ORCA_SWARM_FAIL_PACKET: process.env.ORCA_SWARM_FAIL_PACKET } : {}),
            ...(process.env.ORCA_SWARM_HARNESS_SLOW_MS ? { ORCA_SWARM_HARNESS_SLOW_MS: process.env.ORCA_SWARM_HARNESS_SLOW_MS } : {}),
            ...(process.env.ORCA_SWARM_WAIT_FILE ? { ORCA_SWARM_WAIT_FILE: process.env.ORCA_SWARM_WAIT_FILE } : {})
          },
          wslDistribution: repository.wslDistribution
        },
        logPath,
        watchdogMs: packet.budget.maxRuntimeMs,
        onLog: () => {},
        onExit: (exitCode, details) => {
          void this.buildWorkerResult(repository, packet, worktree, context, exitCode, details, adapter).then(finish).catch((error) => finish(this.syntheticResult(packet, "FAILED", `WORKER_RESULT_FAILED: ${error?.message ?? String(error)}`, this.provenance(worktree.path, worktree.branch, worktree.baseSha, null, worktree.worktreeId))));
        }
      });
      holder.runner = runner;
      void runner.start().catch((error) => {
        finish(this.syntheticResult(packet, "FAILED", `EXECUTOR_START_FAILED: ${error?.message ?? String(error)}`, this.provenance(worktree.path, worktree.branch, worktree.baseSha, null, worktree.worktreeId)));
      });
    });
  }

  private async buildWorkerResult(
    repository: RepositoryRecord,
    packet: WorkPacket,
    worktree: { path: string; branch: string; baseSha: string; worktreeId: string },
    context: GitContext,
    exitCode: number | null,
    details: { reason: ExecutorExitReason; timedOut: boolean; wasKilled: boolean; wasPaused: boolean },
    adapter: ExecutorAdapter
  ): Promise<WorkPacketResult> {
    let head: string | null = null;
    let filesChanged: string[] = [];
    try {
      head = await this.gitClient.getCurrentSha(context);
      if (head && head !== worktree.baseSha) {
        const commits = await this.gitClient.getRevList(context, worktree.baseSha, head);
        const changes = (await Promise.all(commits.map((commit) => this.gitClient.getCommitChanges(context, commit)))).flat();
        filesChanged = [...new Set(changes.map((change) => change.path.replace(/\\/g, "/")))];
      }
    } catch {}
    let usageMetricIds: string[] = [];
    const metric = await this.usageTelemetryService?.captureAdapterUsage(adapter, {
      repositoryId: repository.id,
      runId: packet.runId,
      iteration: packet.iteration,
      dispatchId: null,
      executorRunId: null,
      executor: packet.executor.executorCli,
      model: packet.executor.model,
      provider: packet.executor.provider
    });
    if (metric) usageMetricIds = [metric.id];
    const provenance = this.provenance(worktree.path, worktree.branch, worktree.baseSha, head && head !== worktree.baseSha ? head : null, worktree.worktreeId);
    const reason = details.wasPaused
      ? "PAUSED"
      : details.wasKilled
        ? "EMERGENCY_KILLED"
        : details.timedOut
          ? "EXECUTOR_WATCHDOG_TIMEOUT"
          : exitCode !== 0
            ? `EXECUTOR_EXIT_${exitCode ?? "UNKNOWN"}`
            : !provenance.commitSha
              ? "WORKER_NO_COMMIT"
              : null;
    const status: WorkPacketResult["status"] = details.wasPaused || details.wasKilled ? "CANCELLED" : exitCode === 0 && provenance.commitSha ? "COMPLETED" : "FAILED";
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
        ...(provenance.commitSha ? [`worker_commit=${provenance.commitSha}`] : [])
      ],
      findings: [],
      risks: status === "COMPLETED" ? [] : [reason ?? "WORKER_FAILED"],
      artifacts: [],
      dependenciesAffected: packet.dependencies,
      usageMetricIds,
      summary: status === "COMPLETED" ? `Worker ${packet.workstream} completed.` : `Worker ${packet.workstream} did not complete.`,
      blocker: reason,
      createdAt: new Date().toISOString()
    };
  }

  private evaluateWritePermission(repository: RepositoryRecord, run: RunRecord, packet: WorkPacket): "ALLOW" | "ASK" | "DENY" {
    if (packet.permissionPolicy.deniedActions.includes("REPOSITORY_FILE_WRITE") || packet.permissionPolicy.deniedActions.includes("GIT_COMMIT")) return "DENY";
    if (packet.permissionPolicy.preset === "CONSERVATIVE" && !packet.permissionPolicy.allowedActions.includes("REPOSITORY_FILE_WRITE")) return "ASK";
    if (packet.permissionPolicy.preset === "CUSTOM" && !packet.permissionPolicy.allowedActions.includes("REPOSITORY_FILE_WRITE")) return "ASK";
    const evaluation = this.permissionPolicyService?.evaluate({
      repositoryId: repository.id,
      action: "REPOSITORY_FILE_WRITE",
      runId: run.id,
      iteration: run.currentIteration
    });
    return evaluation?.outcome === "DENY" ? "DENY" : evaluation?.outcome === "ASK" ? "ASK" : "ALLOW";
  }

  private syntheticResult(packet: WorkPacket, status: WorkPacketResult["status"], blocker: string, worktree: WorktreeProvenance | null): WorkPacketResult {
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
      createdAt: new Date().toISOString()
    };
  }

  private provenance(pathValue: string, branch: string, baseSha: string, commitSha: string | null, worktreeId: string): WorktreeProvenance {
    return { worktreeId, path: pathValue, branch, baseSha, commitSha };
  }

  private gitContext(repository: RepositoryRecord, worktreePath: string): GitContext {
    return repository.environment === "wsl"
      ? { environment: "wsl", workingPath: worktreePath, linuxPath: toWslPath(worktreePath), wslDistribution: repository.wslDistribution }
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
      "Work only in the supplied isolated checkout. Commit completed changes locally; do not push or rewrite main. Return structured evidence through the worker result path."
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
      for (const dependency of byId.get(packetId)?.dependencies ?? []) if (visit(dependency)) return true;
      visiting.delete(packetId);
      visited.add(packetId);
      return false;
    };
    return packets.some((packet) => visit(packet.packetId));
  }

  private async failStrategy(strategyRunId: string, error: unknown): Promise<StrategyRunRecord | null> {
    try {
      const record = this.strategyStore.get(strategyRunId);
      if (!record) return null;
      const message = `SWARM_FAILED: ${error instanceof Error ? error.message : String(error)}`;
      const next = this.strategyStore.update(strategyRunId, {
        status: "FAILED",
        lastError: message,
        finishedAt: new Date().toISOString()
      });
      if (next) this.publish({ type: "strategy.completed", at: next.finishedAt!, repositoryId: next.repositoryId, data: { runId: next.runId, iteration: next.iteration, strategyRunId, strategyStatus: "FAILED", reason: message } });
      return next;
    } catch {
      // A controller teardown can close SQLite while a child exit callback is
      // unwinding. The durable state already records the last safe checkpoint;
      // never surface a second unhandled rejection from cleanup.
      return null;
    }
  }

  private publish(event: RepositoryMutationEvent): void {
    try { this.eventPublisher?.(event); } catch {}
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
