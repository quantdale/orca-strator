import {
  ValidationError,
  type DagNodeDefinition,
  type DagNodeRecord,
  type DagNodeStatus,
  type DagStartRequest,
  type RepositoryMutationEvent,
  type RepositoryRecord,
  type RunRecord,
  type StrategyRunRecord,
  type WorkPacket,
  type WorkPacketResult
} from "@orca/shared";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { RunStore } from "../loop/run-store.js";
import type { WorkPacketService } from "../packets/work-packet-service.js";
import type { WorkPacketStore } from "../packets/work-packet-store.js";
import type { StrategyRunStore } from "./strategy-run-store.js";
import type { DagNodeStore } from "./dag-node-store.js";
import {
  SwarmExecutionService,
  type StrategyExecutionHooks,
  type SwarmStartOptions
} from "./swarm-execution-service.js";

export interface DagExecutionServiceOptions {
  repositoryStore: RepositoryStore;
  runStore: RunStore;
  strategyStore: StrategyRunStore;
  nodeStore: DagNodeStore;
  packetStore: WorkPacketStore;
  packetService: WorkPacketService;
  executionService: SwarmExecutionService;
}

interface DagContext {
  repository: RepositoryRecord;
  run: RunRecord;
  packets: WorkPacket[];
  nodes: DagNodeDefinition[];
}

export class DagExecutionService {
  private readonly repositoryStore: RepositoryStore;
  private readonly runStore: RunStore;
  private readonly strategyStore: StrategyRunStore;
  private readonly nodeStore: DagNodeStore;
  private readonly packetStore: WorkPacketStore;
  private readonly packetService: WorkPacketService;
  private readonly executionService: SwarmExecutionService;

  constructor(options: DagExecutionServiceOptions) {
    this.repositoryStore = options.repositoryStore;
    this.runStore = options.runStore;
    this.strategyStore = options.strategyStore;
    this.nodeStore = options.nodeStore;
    this.packetStore = options.packetStore;
    this.packetService = options.packetService;
    this.executionService = options.executionService;
  }

  start(repositoryId: string, runId: string, iteration: number, request: DagStartRequest): StrategyRunRecord {
    const context = this.validate(repositoryId, runId, iteration, request);
    const strategyRunId = { value: "" };
    return this.executionService.startStrategy(
      "DAG",
      repositoryId,
      runId,
      iteration,
      this.asWorkerOptions(request),
      this.hooks(context, strategyRunId)
    );
  }

  async execute(repositoryId: string, runId: string, iteration: number, request: DagStartRequest): Promise<StrategyRunRecord> {
    const context = this.validate(repositoryId, runId, iteration, request);
    const strategyRunId = { value: "" };
    const result = await this.executionService.executeStrategy(
      "DAG",
      repositoryId,
      runId,
      iteration,
      this.asWorkerOptions(request),
      this.hooks(context, strategyRunId)
    );
    return this.finalize(result);
  }

  get(strategyRunId: string): StrategyRunRecord | null {
    const record = this.strategyStore.get(strategyRunId);
    return record?.strategy === "DAG" ? record : null;
  }

  listByRun(runId: string): StrategyRunRecord[] {
    return this.strategyStore.listByRun(runId).filter((record) => record.strategy === "DAG");
  }

  getDetail(repositoryId: string, runId: string, strategyRunId: string): {
    strategy: StrategyRunRecord;
    nodes: DagNodeRecord[];
    controls: ReturnType<StrategyRunStore["listControls"]>;
    packets: WorkPacket[];
    results: WorkPacketResult[];
  } | null {
    const strategy = this.get(strategyRunId);
    if (!strategy || strategy.repositoryId !== repositoryId || strategy.runId !== runId) return null;
    const packets = strategy.packetIds
      .map((packetId) => this.packetService.get(packetId))
      .filter((packet): packet is WorkPacket => Boolean(packet));
    return {
      strategy,
      nodes: this.nodeStore.list(strategyRunId),
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
    decision: "PAUSE" | "STOP" | "KILL" | "RESUME",
    reason: string | null = null
  ): Promise<StrategyRunRecord> {
    const result = await this.executionService.control(repositoryId, strategyRunId, decision, reason);
    if (result.strategy !== "DAG") throw new ValidationError("The requested strategy run is not a DAG.");
    const nodes = this.nodeStore.list(strategyRunId);
    if (decision === "STOP") {
      for (const node of nodes) {
        if (["QUEUED", "WAITING_DEPENDENCY", "WAITING_PERMISSION", "RETRYING"].includes(node.status)) {
          this.nodeStore.update(strategyRunId, node.nodeId, { status: "CANCELLED", waitingReason: reason ?? "USER_STOP" });
        }
      }
    } else if (decision === "KILL") {
      for (const node of nodes) {
        if (["QUEUED", "STARTING", "RUNNING", "WAITING_DEPENDENCY", "WAITING_PERMISSION", "RETRYING"].includes(node.status)) {
          this.nodeStore.update(strategyRunId, node.nodeId, { status: "BLOCKED", waitingReason: reason ?? "RECOVERY_REQUIRED: emergency kill" });
        }
      }
    } else if (decision === "RESUME") {
      for (const node of nodes) {
        if (node.status !== "COMPLETED") this.nodeStore.update(strategyRunId, node.nodeId, { status: node.dependsOn.length ? "WAITING_DEPENDENCY" : "QUEUED", waitingReason: null, finishedAt: null });
      }
    }
    return this.finalize(result);
  }

  async recoverAll(): Promise<StrategyRunRecord[]> {
    const recovered = await this.executionService.recoverAll();
    for (const strategy of recovered.filter((record) => record.strategy === "DAG")) {
      for (const node of this.nodeStore.list(strategy.strategyRunId)) {
        if (node.status !== "COMPLETED") this.nodeStore.update(strategy.strategyRunId, node.nodeId, {
          status: "BLOCKED",
          waitingReason: "RECOVERY_REQUIRED: controller restarted without a live DAG runner.",
          finishedAt: new Date().toISOString()
        });
      }
    }
    return recovered.filter((record) => record.strategy === "DAG");
  }

  private validate(repositoryId: string, runId: string, iteration: number, request: DagStartRequest): DagContext {
    const repository = this.repositoryStore.get(repositoryId);
    if (!repository) throw new ValidationError(`Repository ${repositoryId} not found`);
    const run = this.runStore.get(runId);
    if (!run || run.repositoryId !== repositoryId) throw new ValidationError("Campaign/run correlation is invalid.");
    if (run.currentIteration !== iteration) throw new ValidationError("DAG iteration does not match the campaign's current iteration.");
    const maxConcurrency = request.maxConcurrency ?? 2;
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) throw new ValidationError("DAG maxConcurrency must be an integer from 1 to 32.");
    if (request.nodes.length === 0 || request.nodes.length > 100) throw new ValidationError("A DAG must contain between 1 and 100 nodes.");

    const nodeIds = new Set<string>();
    const packetIds = new Set<string>();
    const byNode = new Map<string, DagNodeDefinition>();
    for (const node of request.nodes) {
      if (nodeIds.has(node.nodeId)) throw new ValidationError(`DAG node ID is duplicated: ${node.nodeId}`);
      if (packetIds.has(node.packetId)) throw new ValidationError(`DAG packet ID is duplicated: ${node.packetId}`);
      if (node.dependsOn.includes(node.nodeId)) throw new ValidationError(`DAG node cannot depend on itself: ${node.nodeId}`);
      if (new Set(node.dependsOn).size !== node.dependsOn.length) throw new ValidationError(`DAG dependencies are duplicated for node ${node.nodeId}.`);
      nodeIds.add(node.nodeId);
      packetIds.add(node.packetId);
      byNode.set(node.nodeId, node);
    }
    for (const node of request.nodes) for (const dependency of node.dependsOn) if (!nodeIds.has(dependency)) throw new ValidationError(`DAG dependency does not name a known node: ${dependency}`);
    if (this.hasCycle(request.nodes, byNode)) throw new ValidationError("DAG dependency graph contains a cycle.");

    const packets = request.nodes.map((node) => this.packetService.get(node.packetId));
    if (packets.some((packet): packet is null => packet === null)) throw new ValidationError("Every DAG packet must be durable before execution.");
    const selected = packets as WorkPacket[];
    for (const node of request.nodes) {
      const packet = selected.find((candidate) => candidate.packetId === node.packetId)!;
      if (packet.runId !== runId || packet.campaignId !== runId || packet.iteration !== iteration || this.packetStore.getRepositoryId(packet.packetId) !== repositoryId) {
        throw new ValidationError(`Packet ${packet.packetId} does not belong to the requested campaign iteration.`);
      }
      const expectedPacketDependencies = node.dependsOn.map((dependency) => byNode.get(dependency)!.packetId).sort();
      const actualPacketDependencies = [...packet.dependencies].sort();
      if (expectedPacketDependencies.length !== actualPacketDependencies.length || expectedPacketDependencies.some((value, index) => value !== actualPacketDependencies[index])) {
        throw new ValidationError(`DAG dependencies for node ${node.nodeId} do not match its typed packet dependencies.`);
      }
    }
    return { repository, run, packets: selected, nodes: request.nodes };
  }

  private hooks(context: DagContext, strategyRunId: { value: string }): StrategyExecutionHooks {
    return {
      nodeIds: context.nodes.map((node) => node.nodeId),
      onCreated: (record) => {
        strategyRunId.value = record.strategyRunId;
        const packetById = new Map(context.packets.map((packet) => [packet.packetId, packet]));
        for (const definition of context.nodes) {
          const packet = packetById.get(definition.packetId)!;
          const now = new Date().toISOString();
          this.nodeStore.create({
            schemaVersion: 1,
            strategyRunId: record.strategyRunId,
            nodeId: definition.nodeId,
            packetId: definition.packetId,
            dependsOn: definition.dependsOn,
            status: definition.dependsOn.length ? "WAITING_DEPENDENCY" : "QUEUED",
            budget: packet.budget,
            attempt: 0,
            maxRetries: packet.budget.maxRetries,
            waitingReason: definition.dependsOn.length ? "Waiting for explicit DAG dependencies." : null,
            startedAt: null,
            finishedAt: null,
            resultId: null,
            createdAt: now,
            updatedAt: now
          });
        }
      },
      onEvent: (event) => {
        const eventStrategyId = String(event.data?.strategyRunId ?? "");
        if (!strategyRunId.value || eventStrategyId !== strategyRunId.value) return;
        this.applyEvent(strategyRunId.value, event);
      }
    };
  }

  private applyEvent(strategyRunId: string, event: RepositoryMutationEvent): void {
    const packetId = typeof event.data?.packetId === "string" ? event.data.packetId : null;
    const node = packetId ? this.nodeStore.getByPacket(strategyRunId, packetId) : null;
    if (event.type === "strategy.worker_queued" && node) {
      this.nodeStore.update(strategyRunId, node.nodeId, { status: "QUEUED", waitingReason: String(event.data?.reason ?? "Scheduler admission queued the node.") });
    } else if (event.type === "strategy.permission_required" && node) {
      this.nodeStore.update(strategyRunId, node.nodeId, { status: "WAITING_PERMISSION", waitingReason: String(event.data?.reason ?? "Permission decision required.") });
    } else if (event.type === "strategy.worker_started" && node) {
      this.nodeStore.update(strategyRunId, node.nodeId, { status: "RUNNING", attempt: node.attempt + 1, startedAt: event.at, waitingReason: null });
    } else if (event.type === "strategy.worker_completed" && node) {
      const resultStatus = String(event.data?.resultStatus ?? "FAILED");
      const status: DagNodeStatus = resultStatus === "COMPLETED" ? "COMPLETED" : resultStatus === "CANCELLED" ? "CANCELLED" : resultStatus === "SKIPPED_DEPENDENCY" ? "SKIPPED" : resultStatus === "BLOCKED" ? "BLOCKED" : "FAILED";
      this.nodeStore.update(strategyRunId, node.nodeId, { status, finishedAt: event.at, resultId: packetId, waitingReason: String(event.data?.blocker ?? "") || null });
    } else if (event.type === "strategy.integration_completed") {
      for (const candidate of this.nodeStore.list(strategyRunId)) if (candidate.status === "COMPLETED") this.nodeStore.update(strategyRunId, candidate.nodeId, { status: "INTEGRATING", waitingReason: null });
    } else if (event.type === "strategy.control" && (event.data?.decision === "STOP" || event.data?.decision === "KILL")) {
      for (const candidate of this.nodeStore.list(strategyRunId)) if (["QUEUED", "WAITING_DEPENDENCY", "WAITING_PERMISSION", "RETRYING"].includes(candidate.status)) this.nodeStore.update(strategyRunId, candidate.nodeId, { status: event.data?.decision === "KILL" ? "BLOCKED" : "CANCELLED", waitingReason: String(event.data?.reason ?? event.data?.decision) });
    } else if (event.type === "strategy.completed") {
      const strategy = this.strategyStore.get(strategyRunId);
      if (strategy) this.finalize(strategy);
    }
  }

  private finalize(strategy: StrategyRunRecord): StrategyRunRecord {
    if (strategy.strategy !== "DAG") return strategy;
    const report = strategy.report;
    if (report?.strategy !== "DAG") return strategy;
    const results = new Map(report.results.map((result) => [result.packetId, result]));
    for (const node of this.nodeStore.list(strategy.strategyRunId)) {
      const result = results.get(node.packetId);
      if (!result) continue;
      const status: DagNodeStatus = result.status === "COMPLETED" ? "COMPLETED" : result.status === "CANCELLED" ? "CANCELLED" : result.status === "SKIPPED_DEPENDENCY" ? "SKIPPED" : result.status === "BLOCKED" || result.status === "INTEGRATION_CONFLICT" ? "BLOCKED" : "FAILED";
      if (node.status !== status || node.finishedAt === null) this.nodeStore.update(strategy.strategyRunId, node.nodeId, { status, finishedAt: report.finishedAt, resultId: node.packetId, waitingReason: result.blocker });
    }
    const nodes = this.nodeStore.list(strategy.strategyRunId);
    const nextReport = { ...report, nodes };
    return this.strategyStore.update(strategy.strategyRunId, { report: nextReport }) ?? { ...strategy, report: nextReport };
  }

  private asWorkerOptions(request: DagStartRequest): SwarmStartOptions {
    return { packetIds: request.nodes.map((node) => node.packetId), maxConcurrency: request.maxConcurrency };
  }

  private hasCycle(nodes: DagNodeDefinition[], byNode: Map<string, DagNodeDefinition>): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const dependency of byNode.get(nodeId)?.dependsOn ?? []) if (visit(dependency)) return true;
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    return nodes.some((node) => visit(node.nodeId));
  }
}
