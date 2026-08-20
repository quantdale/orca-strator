import crypto from "node:crypto";
import { isSafeRelativePath, ValidationError, workPacketResultSchema, workPacketSchema, type RepositoryRecord, type RunRecord, type WorkPacket, type WorkPacketResult, type WorkPacketStatus } from "@orca/shared";
import type { WorkPacketStore } from "./work-packet-store.js";

export interface WorkPacketCreateInput {
  workstream: string;
  goal: string;
  requirements?: string[];
  allowedPaths?: string[];
  readPaths?: string[];
  dependencies?: string[];
  parentDispatchId?: string | null;
  executor: WorkPacket["executor"];
  verificationExpectations?: string[];
  budget?: Partial<WorkPacket["budget"]>;
  permissionPolicy?: Partial<WorkPacket["permissionPolicy"]>;
}

export class WorkPacketService {
  constructor(private readonly store: WorkPacketStore) {}

  create(repository: RepositoryRecord, run: RunRecord, input: WorkPacketCreateInput): WorkPacket {
    this.validatePaths([...(input.allowedPaths ?? []), ...(input.readPaths ?? [])]);
    const now = new Date().toISOString();
    const packet = workPacketSchema.parse({
      schemaVersion: 1,
      packetId: crypto.randomUUID(),
      campaignId: run.id,
      runId: run.id,
      iteration: run.currentIteration,
      parentDispatchId: input.parentDispatchId ?? null,
      workstream: input.workstream,
      goal: input.goal,
      requirements: input.requirements ?? [],
      allowedPaths: input.allowedPaths ?? [],
      readPaths: input.readPaths ?? [],
      dependencies: input.dependencies ?? [],
      executor: input.executor,
      verificationExpectations: input.verificationExpectations ?? [],
      budget: {
        maxRuntimeMs: input.budget?.maxRuntimeMs ?? 30 * 60 * 1000,
        maxRetries: input.budget?.maxRetries ?? 0,
        maxTokens: input.budget?.maxTokens ?? null,
        maxSpend: input.budget?.maxSpend ?? null
      },
      permissionPolicy: {
        preset: input.permissionPolicy?.preset ?? "BALANCED",
        allowedActions: input.permissionPolicy?.allowedActions ?? [],
        deniedActions: input.permissionPolicy?.deniedActions ?? []
      },
      status: "QUEUED",
      createdAt: now,
      updatedAt: now
    });
    if (packet.runId !== run.id || repository.id.length === 0) throw new ValidationError("Work packet repository/run correlation is invalid.");
    return this.store.save(packet, repository.id);
  }

  recordResult(repository: RepositoryRecord, packet: WorkPacket, input: unknown): WorkPacketResult {
    const result = workPacketResultSchema.parse(input);
    if (result.packetId !== packet.packetId || result.runId !== packet.runId || result.campaignId !== packet.campaignId || result.iteration !== packet.iteration) {
      throw new ValidationError("Work packet result correlation does not match its packet.");
    }
    if (result.worktree) {
      const worktree = this.store.getWorktree(result.worktree.worktreeId);
      if (!worktree || worktree.packetId !== packet.packetId || worktree.branch !== result.worktree.branch || worktree.baseSha !== result.worktree.baseSha) {
        throw new ValidationError("Work packet result worktree provenance does not match the persisted isolated worktree.");
      }
    }
    this.store.saveResult(result, repository.id);
    const status: WorkPacketStatus = result.status === "COMPLETED" ? "COMPLETED" : result.status === "SKIPPED_DEPENDENCY" ? "SKIPPED_DEPENDENCY" : result.status === "CANCELLED" ? "CANCELLED" : result.status === "BLOCKED" || result.status === "INTEGRATION_CONFLICT" ? "BLOCKED" : "FAILED";
    this.store.updateStatus(packet.packetId, status);
    return result;
  }

  get(packetId: string): WorkPacket | null { return this.store.get(packetId); }
  list(runId: string): WorkPacket[] { return this.store.listByRun(runId); }
  getResult(packetId: string): WorkPacketResult | null { return this.store.getResult(packetId); }
  listResults(runId: string): WorkPacketResult[] { return this.store.listResults(runId); }
  updateStatus(packetId: string, status: WorkPacketStatus): WorkPacket | null { return this.store.updateStatus(packetId, status); }

  private validatePaths(paths: string[]): void {
    for (const value of paths) {
      if (!isSafeRelativePath(value)) throw new ValidationError(`Work packet path is not safe: ${value}`);
    }
  }
}
