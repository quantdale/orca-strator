import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  RepositoryActorLeaseStore,
  ProcessOwnershipStore,
  type RepositoryActorLease,
  type ActorKind,
  type ProcessOwnershipRecord
} from "./ownership-store.js";
import {
  type ProcessProbe,
  type ProcessIdentityVerdict,
  isProcessReleasable
} from "./process-probe.js";
import type { EventBus } from "../events/event-bus.js";
import type { RepositoryMutationEvent } from "@orca/shared";
import { redactSecrets, boundDataStrings } from "../events/event-bus.js";

export interface AcquireOptions {
  runId?: string | null;
  iteration?: number | null;
  actorId?: string | null;
}

export type AcquireOutcome = "acquired" | "conflict" | "quarantined";

export interface AcquireResult {
  outcome: AcquireOutcome;
  lease: RepositoryActorLease | null;
  reason?: string;
}

export interface ReconcileProcessResult {
  recordId: string;
  hostPid: number;
  verdict: ProcessIdentityVerdict;
}

export interface ReconcileResult {
  repositoryId: string;
  priorLease: RepositoryActorLease;
  processes: ReconcileProcessResult[];
  outcome: "released" | "quarantined";
  reason: string;
}

/**
 * Change 028 (D5): focused service owning repository actor lease
 * acquire/bind/quarantine/release and startup reconciliation.
 *
 * The database PRIMARY KEY on repository_id is the durable uniqueness boundary
 * (application check-then-set is not sufficient). No new mutating actor may
 * start while prior ownership is live or uncertain; uncertain ownership is
 * fail-closed into QUARANTINED.
 */
export class RepositoryActorLeaseService {
  private readonly leaseStore: RepositoryActorLeaseStore;
  private readonly processStore: ProcessOwnershipStore;

  constructor(
    private readonly db: DatabaseSync,
    private readonly probe: ProcessProbe,
    private readonly eventBus?: EventBus
  ) {
    this.leaseStore = new RepositoryActorLeaseStore(db);
    this.processStore = new ProcessOwnershipStore(db);
  }
  private emitAudit(type: string, repositoryId: string, runId: string | null, data: Record<string, unknown>): void {
    if (!this.eventBus) return;
    try {
      const payload: Record<string, unknown> = runId ? { ...data, runId } : { ...data };
      const redacted = redactSecrets(payload);
      const bounded = boundDataStrings(redacted as Record<string, unknown>);
      const event: RepositoryMutationEvent = {
        type: type as RepositoryMutationEvent["type"],
        at: new Date().toISOString(),
        repositoryId,
        data: bounded
      };
      this.eventBus.publish(event);
    } catch {
      /* audit emission must never break lease operation */
    }
  }

  getLease(repositoryId: string): RepositoryActorLease | null {
    return this.leaseStore.get(repositoryId);
  }

  /**
   * Acquire a single durable actor lease for a repository. Returns a conflict
   * when an existing blocking lease (live/quarantined/prior instance) owns the
   * repository. The PRIMARY KEY insert is the authoritative acquire.
   */
  acquire(
    repositoryId: string,
    controllerInstanceId: string,
    actorKind: ActorKind,
    opts: AcquireOptions = {}
  ): AcquireResult {
    const existing = this.leaseStore.get(repositoryId);
    if (existing) {
      if (existing.state === "QUARANTINED") {
        const result: AcquireResult = {
          outcome: "quarantined",
          lease: existing,
          reason: "repository actor is quarantined; manual reconciliation required"
        };
        this.emitAudit("lease.quarantined", repositoryId, existing.runId ?? opts.runId ?? null, {
          outcome: result.outcome,
          actorKind,
          controllerInstanceId,
          existingState: existing.state,
          reason: result.reason ?? "",
          leaseId: existing.leaseId
        });
        return result;
      }
      if (
        existing.controllerInstanceId !== controllerInstanceId ||
        existing.state === "ACTIVE" ||
        existing.state === "STARTING"
      ) {
        const result: AcquireResult = {
          outcome: "conflict",
          lease: existing,
          reason: `repository already has a ${existing.state} actor lease owned by controller instance ${existing.controllerInstanceId}`
        };
        this.emitAudit("lease.conflict", repositoryId, existing.runId ?? opts.runId ?? null, {
          outcome: result.outcome,
          actorKind,
          controllerInstanceId,
          existingState: existing.state,
          existingControllerInstanceId: existing.controllerInstanceId,
          reason: result.reason ?? "",
          leaseId: existing.leaseId
        });
        return result;
      }
    }

    const leaseId = randomUUID();
    const inserted = this.leaseStore.insert({
      repositoryId,
      leaseId,
      controllerInstanceId,
      runId: opts.runId ?? null,
      iteration: opts.iteration ?? null,
      actorKind,
      actorId: opts.actorId ?? null,
      state: "STARTING"
    });
    if (!inserted) {
      const after = this.leaseStore.get(repositoryId);
      if (after && after.state === "QUARANTINED") {
        const result: AcquireResult = { outcome: "quarantined", lease: after, reason: "lease became quarantined" };
        this.emitAudit("lease.quarantined", repositoryId, after.runId ?? opts.runId ?? null, {
          outcome: result.outcome,
          actorKind,
          controllerInstanceId,
          reason: result.reason ?? "",
          leaseId: after.leaseId
        });
        return result;
      }
      const result: AcquireResult = {
        outcome: "conflict",
        lease: after,
        reason: "another actor lease already owns this repository (PK boundary)"
      };
      this.emitAudit("lease.conflict", repositoryId, after?.runId ?? opts.runId ?? null, {
        outcome: result.outcome,
        actorKind,
        controllerInstanceId,
        reason: result.reason ?? "",
        leaseId: after?.leaseId ?? leaseId
      });
      return result;
    }
    const lease = this.leaseStore.get(repositoryId)!;
    this.emitAudit("lease.acquired", repositoryId, lease.runId ?? opts.runId ?? null, {
      outcome: "acquired",
      actorKind,
      controllerInstanceId,
      leaseId: lease.leaseId,
      actorId: opts.actorId ?? null
    });
    return { outcome: "acquired", lease };
  }

  bindActor(repositoryId: string, actorId: string, extra?: { runId?: string | null }): void {
    this.leaseStore.updateState(repositoryId, "STARTING", { actorId, runId: extra?.runId });
  }

  markActive(repositoryId: string): void {
    this.leaseStore.updateState(repositoryId, "ACTIVE");
  }

  /**
   * Quarantine a repository actor, blocking new mutation. Used when liveness
   * cannot be proven or for explicit recovery evidence. Never silently clears.
   */
  quarantine(repositoryId: string, reason: string): void {
    this.leaseStore.updateState(repositoryId, "QUARANTINED", { lastError: reason });
    const lease = this.leaseStore.get(repositoryId);
    this.emitAudit("lease.quarantined", repositoryId, lease?.runId ?? null, {
      reason,
      leaseId: lease?.leaseId ?? null,
      state: "QUARANTINED"
    });
  }

  /**
   * Release a lease only after all associated mutating child processes are
   * terminal or proven dead. A concurrent start cannot re-acquire in the
   * intermediate window because the row is deleted atomically with this check
   * inside the caller's transaction where required; here we verify first.
   */
  release(repositoryId: string, controllerInstanceId: string): void {
    const lease = this.leaseStore.get(repositoryId);
    if (!lease) return;
    if (lease.controllerInstanceId !== controllerInstanceId) {
      // Only the owning controller may release; otherwise leave quarantined.
      this.leaseStore.updateState(repositoryId, "QUARANTINED", {
        lastError: "release attempted by non-owning controller instance"
      });
      const updated = this.leaseStore.get(repositoryId);
      this.emitAudit("lease.quarantined", repositoryId, lease.runId ?? null, {
        reason: "release attempted by non-owning controller instance",
        leaseId: lease.leaseId,
        controllerInstanceId,
        ownerControllerInstanceId: lease.controllerInstanceId,
        state: updated?.state ?? "QUARANTINED"
      });
      return;
    }
    const processes = this.processStore.listByRepository(repositoryId);
    for (const rec of processes) {
      if (!terminalProcessState(rec)) {
        // Refuse release while a child may still be alive/uncertain.
        this.leaseStore.updateState(repositoryId, "QUARANTINED", {
          lastError: `cannot release: process ${rec.id} still in state ${rec.state}`
        });
        this.emitAudit("lease.quarantined", repositoryId, lease.runId ?? null, {
          reason: `cannot release: process ${rec.id} still in state ${rec.state}`,
          leaseId: lease.leaseId,
          processId: rec.id,
          processState: rec.state
        });
        return;
      }
    }
    this.leaseStore.release(repositoryId);
    this.emitAudit("lease.released", repositoryId, lease.runId ?? null, {
      leaseId: lease.leaseId,
      controllerInstanceId,
      actorKind: lease.actorKind
    });
  }

  /**
   * Startup reconciliation (D5/D6): for every lease owned by a PRIOR controller
   * instance, classify its process records. If all are provably DEAD, release
   * the lease and let run/strategy state move to truthful recovery. If any
   * process is LIVE_MATCH / PID_REUSED / UNKNOWN, quarantine the repository and
   * block new mutation. UNKNOWN never becomes DEAD by convenience.
   */
  reconcileOnStartup(
    currentInstanceId: string,
    repositories?: string[]
  ): ReconcileResult[] {
    const results: ReconcileResult[] = [];
    const leases = this.priorInstanceLeases(currentInstanceId, repositories);

     for (const lease of leases) {
       const processes = this.processStore.listByRepository(lease.repositoryId);

       // Change 028 P0 (5.8/5.9): a prior STARTING/ACTIVE lease with zero
       // process ownership records means admission happened but we cannot prove
       // whether a child was actually spawned or persisted. The spawn-to-
       if (
         processes.length === 0 &&
         (lease.state === "STARTING" || lease.state === "ACTIVE")
       ) {
         const reason =
           "prior lease has no process ownership record; spawn/persistence window is ambiguous after restart";
         this.leaseStore.updateState(lease.repositoryId, "QUARANTINED", { lastError: reason });
         this.emitAudit("lease.quarantined", lease.repositoryId, lease.runId ?? null, {
           reason,
           leaseId: lease.leaseId,
           state: lease.state,
           processesCount: 0,
           outcome: "quarantined"
         });
         this.emitAudit("recovery.decision", lease.repositoryId, lease.runId ?? null, {
           reason,
           decision: "quarantine",
           processesCount: 0
         });
         results.push({
           repositoryId: lease.repositoryId,
           priorLease: lease,
           processes: [],
           outcome: "quarantined",
           reason
         });
         continue;
       }

       const classified: ReconcileProcessResult[] = processes.map((rec) => ({
         recordId: rec.id,
         hostPid: rec.hostPid,
         verdict: this.classifyRecord(rec)
       }));
       for (const c of classified) {
         this.emitAudit("process.verdict", lease.repositoryId, lease.runId ?? null, {
           recordId: c.recordId,
           hostPid: c.hostPid,
           verdict: c.verdict,
           leaseId: lease.leaseId
         });
       }

      const blocking = classified.find((c) => !isProcessReleasable(c.verdict));
      if (blocking) {
        const reason =
          blocking.verdict === "UNKNOWN"
            ? `process ${blocking.recordId} liveness unverifiable after restart; refusing to assume death`
            : `process ${blocking.recordId} verdict=${blocking.verdict}; prior writer may still be alive`;
        this.leaseStore.updateState(lease.repositoryId, "QUARANTINED", { lastError: reason });
        this.emitAudit("lease.quarantined", lease.repositoryId, lease.runId ?? null, {
          reason,
          leaseId: lease.leaseId,
          blockingRecordId: blocking.recordId,
          blockingVerdict: blocking.verdict,
          outcome: "quarantined"
        });
        this.emitAudit("recovery.decision", lease.repositoryId, lease.runId ?? null, {
          reason,
          decision: "quarantine",
          blockingVerdict: blocking.verdict
        });
        results.push({
          repositoryId: lease.repositoryId,
          priorLease: lease,
          processes: classified,
          outcome: "quarantined",
          reason
        });
      } else {
        // All dead/terminal: release the durable lease so recovery can proceed.
        this.leaseStore.release(lease.repositoryId);
        this.emitAudit("lease.released", lease.repositoryId, lease.runId ?? null, {
          reason: "all owned processes confirmed dead; lease released for recovery",
          leaseId: lease.leaseId,
          outcome: "released"
        });
        this.emitAudit("recovery.decision", lease.repositoryId, lease.runId ?? null, {
          reason: "all owned processes confirmed dead; lease released for recovery",
          decision: "release",
          processesCount: classified.length
        });
        results.push({
          repositoryId: lease.repositoryId,
          priorLease: lease,
          processes: classified,
          outcome: "released",
          reason: "all owned processes confirmed dead; lease released for recovery"
        });
      }
    }
    return results;
  }

  private classifyRecord(rec: ProcessOwnershipRecord): ProcessIdentityVerdict {
    if (terminalProcessState(rec)) return "DEAD";
    return this.probe.classify({
      hostPid: rec.hostPid,
      executableName: rec.executableName ?? undefined,
      startMarker: rec.startMarker ?? undefined
    });
  }

  private priorInstanceLeases(
    currentInstanceId: string,
    repositories?: string[]
  ): RepositoryActorLease[] {
    // Read all leases not owned by the current instance.
    const rows = this.db
      .prepare(
        `SELECT repository_id FROM repository_actor_leases
         WHERE controller_instance_id <> ?`
      )
      .all(currentInstanceId) as Array<{ repository_id: string }>;
    const ids = repositories
      ? rows.map((r) => r.repository_id).filter((id) => repositories.includes(id))
      : rows.map((r) => r.repository_id);
    return ids
      .map((id) => this.leaseStore.get(id))
      .filter((l): l is RepositoryActorLease => l !== null);
  }
}

function terminalProcessState(rec: ProcessOwnershipRecord): boolean {
  return rec.state === "EXITED" || rec.state === "KILL_CONFIRMED";
}
