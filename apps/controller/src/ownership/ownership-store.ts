import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { ProcessKind } from "./process-probe.js";

export type ActorKind = "SINGLE_AGENT" | "SWARM" | "DAG";
export type ActorLeaseState = "STARTING" | "ACTIVE" | "RELEASING" | "QUARANTINED";
export type ProcessOwnershipState =
  | "STARTING"
  | "RUNNING"
  | "EXITED"
  | "KILL_CONFIRMED"
  | "UNKNOWN";
export type TransitionSourceKind =
  | "DISPATCH"
  | "SOL_CONTROL"
  | "EXECUTOR_COMPLETION"
  | "STRATEGY_COMPLETION";
export type TransitionIntentState =
  | "PENDING"
  | "APPLYING"
  | "APPLIED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL";
export type OutboxEffectState =
  | "PENDING"
  | "DELIVERING"
  | "DELIVERED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL";

function nowIso(): string {
  return new Date().toISOString();
}

export interface RepositoryActorLease {
  repositoryId: string;
  leaseId: string;
  controllerInstanceId: string;
  runId: string | null;
  iteration: number | null;
  actorKind: ActorKind;
  actorId: string | null;
  state: ActorLeaseState;
  createdAt: string;
  updatedAt: string;
  releasedAt: string | null;
  lastError: string | null;
}

export interface ProcessOwnershipRecord {
  id: string;
  controllerInstanceId: string;
  repositoryId: string;
  runId: string | null;
  iteration: number | null;
  actorId: string | null;
  packetId: string | null;
  processKind: ProcessKind;
  hostPid: number;
  executableName: string | null;
  startMarker: string | null;
  state: ProcessOwnershipState;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface TransitionIntent {
  intentId: string;
  repositoryId: string;
  runId: string | null;
  sourceKind: TransitionSourceKind;
  sourceId: string;
  operation: string;
  payloadJson: string;
  state: TransitionIntentState;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutboxItem {
  id: string;
  effectKey: string;
  repositoryId: string;
  runId: string | null;
  effectKind: string;
  payloadJson: string;
  state: OutboxEffectState;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repository actor lease store (Change 028 D2/D5). The repository_id PRIMARY
 * KEY is the durability boundary: only one lease row may exist per repository,
 * enforced by the database, not by in-memory maps.
 */
export class RepositoryActorLeaseStore {
  constructor(private readonly db: DatabaseSync) {}

  get(repositoryId: string): RepositoryActorLease | null {
    const row = this.db
      .prepare(
        `SELECT repository_id, lease_id, controller_instance_id, run_id, iteration,
                actor_kind, actor_id, state, created_at, updated_at, released_at, last_error
         FROM repository_actor_leases WHERE repository_id = ?`
      )
      .get(repositoryId) as
      | {
          repository_id: string;
          lease_id: string;
          controller_instance_id: string;
          run_id: string | null;
          iteration: number | null;
          actor_kind: ActorKind;
          actor_id: string | null;
          state: ActorLeaseState;
          created_at: string;
          updated_at: string;
          released_at: string | null;
          last_error: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      repositoryId: row.repository_id,
      leaseId: row.lease_id,
      controllerInstanceId: row.controller_instance_id,
      runId: row.run_id,
      iteration: row.iteration,
      actorKind: row.actor_kind,
      actorId: row.actor_id,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      releasedAt: row.released_at,
      lastError: row.last_error
    };
  }

  /** Insert a new lease, returning false if a row already exists (PK boundary). */
  insert(
    lease: Omit<RepositoryActorLease, "createdAt" | "updatedAt" | "releasedAt" | "lastError">
  ): boolean {
    const ts = nowIso();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO repository_actor_leases
         (repository_id, lease_id, controller_instance_id, run_id, iteration,
          actor_kind, actor_id, state, created_at, updated_at, released_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        lease.repositoryId,
        lease.leaseId,
        lease.controllerInstanceId,
        lease.runId ?? null,
        lease.iteration ?? null,
        lease.actorKind,
        lease.actorId ?? null,
        lease.state,
        ts,
        ts
      );
    return result.changes === 1;
  }

  updateState(
    repositoryId: string,
    state: ActorLeaseState,
    extra?: { actorId?: string | null; runId?: string | null; lastError?: string | null }
  ): void {
    const sets: string[] = ["state = ?", "updated_at = ?"];
    const params: unknown[] = [state, nowIso()];
    if (extra?.actorId !== undefined) {
      sets.push("actor_id = ?");
      params.push(extra.actorId);
    }
    if (extra?.runId !== undefined) {
      sets.push("run_id = ?");
      params.push(extra.runId);
    }
    if (extra?.lastError !== undefined) {
      sets.push("last_error = ?");
      params.push(extra.lastError);
    }
    params.push(repositoryId);
    const sqlParams = params as SQLInputValue[];
    this.db
      .prepare(
        `UPDATE repository_actor_leases SET ${sets.join(", ")} WHERE repository_id = ?`
      )
      .run(...sqlParams);
  }

  release(repositoryId: string): void {
    this.db
      .prepare(
        `UPDATE repository_actor_leases
         SET state = 'RELEASING', released_at = ?, updated_at = ?
         WHERE repository_id = ?`
      )
      .run(nowIso(), nowIso(), repositoryId);
    // Remove the row so a future acquire can re-insert (PK boundary resets).
    this.db
      .prepare(`DELETE FROM repository_actor_leases WHERE repository_id = ?`)
      .run(repositoryId);
  }

  delete(repositoryId: string): void {
    this.db
      .prepare(`DELETE FROM repository_actor_leases WHERE repository_id = ?`)
      .run(repositoryId);
  }
}

/**
 * Process ownership store (Change 028 D2/D4). One row per real mutating child
 * spawn, correlated to controller instance / repository / run / actor.
 */
export class ProcessOwnershipStore {
  constructor(private readonly db: DatabaseSync) {}

  insert(
    rec: Omit<ProcessOwnershipRecord, "createdAt" | "updatedAt" | "lastError">
  ): void {
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO process_ownership_records
         (id, controller_instance_id, repository_id, run_id, iteration, actor_id,
          packet_id, process_kind, host_pid, executable_name, start_marker,
          state, created_at, updated_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        rec.id,
        rec.controllerInstanceId,
        rec.repositoryId,
        rec.runId ?? null,
        rec.iteration ?? null,
        rec.actorId ?? null,
        rec.packetId ?? null,
        rec.processKind,
        rec.hostPid,
        rec.executableName ?? null,
        rec.startMarker ?? null,
        rec.state,
        ts,
        ts
      );
  }

  setState(id: string, state: ProcessOwnershipState, lastError?: string): void {
    this.db
      .prepare(
        `UPDATE process_ownership_records
         SET state = ?, updated_at = ?, last_error = ?
         WHERE id = ?`
      )
      .run(state, nowIso(), lastError ?? null, id);
  }

  listByRepository(repositoryId: string): ProcessOwnershipRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, controller_instance_id, repository_id, run_id, iteration,
                actor_id, packet_id, process_kind, host_pid, executable_name,
                start_marker, state, created_at, updated_at, last_error
         FROM process_ownership_records WHERE repository_id = ?`
      )
      .all(repositoryId) as Array<Record<string, unknown>>;
    return rows.map(mapProcessRow);
  }

  listByActor(actorId: string): ProcessOwnershipRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, controller_instance_id, repository_id, run_id, iteration,
                actor_id, packet_id, process_kind, host_pid, executable_name,
                start_marker, state, created_at, updated_at, last_error
         FROM process_ownership_records WHERE actor_id = ?`
      )
      .all(actorId) as Array<Record<string, unknown>>;
    return rows.map(mapProcessRow);
  }
}

function mapProcessRow(row: Record<string, unknown>): ProcessOwnershipRecord {
  return {
    id: row.id as string,
    controllerInstanceId: row.controller_instance_id as string,
    repositoryId: row.repository_id as string,
    runId: (row.run_id as string | null) ?? null,
    iteration: (row.iteration as number | null) ?? null,
    actorId: (row.actor_id as string | null) ?? null,
    packetId: (row.packet_id as string | null) ?? null,
    processKind: row.process_kind as ProcessKind,
    hostPid: row.host_pid as number,
    executableName: (row.executable_name as string | null) ?? null,
    startMarker: (row.start_marker as string | null) ?? null,
    state: row.state as ProcessOwnershipState,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastError: (row.last_error as string | null) ?? null
  };
}

/**
 * Durable transition intent store (Change 028 D7). A protocol source may be
 * durably consumed only after its required run transition is committed; the
 * intent is the replayable record. UNIQUE(source_kind, source_id, operation)
 * is the logical idempotency boundary.
 */
export class TransitionIntentStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Enqueue an intent. Returns false if an equivalent intent already exists. */
  enqueue(
    intent: Omit<TransitionIntent, "intentId" | "state" | "attemptCount" | "lastError" | "createdAt" | "updatedAt" | "payloadJson"> & {
      intentId?: string;
      payloadJson?: string;
    }
  ): { inserted: boolean; intentId: string } {
    const id = intent.intentId ?? randomId();
    const ts = nowIso();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO orchestration_transition_intents
         (intent_id, repository_id, run_id, source_kind, source_id, operation,
          payload_json, state, attempt_count, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?)`
      )
      .run(
        id,
        intent.repositoryId,
        intent.runId ?? null,
        intent.sourceKind,
        intent.sourceId,
        intent.operation,
        intent.payloadJson ?? "{}",
        ts,
        ts
      );
    return { inserted: result.changes === 1, intentId: id };
  }

  getBySource(
    sourceKind: TransitionSourceKind,
    sourceId: string,
    operation: string
  ): TransitionIntent | null {
    const row = this.db
      .prepare(
        `SELECT intent_id, repository_id, run_id, source_kind, source_id, operation,
                payload_json, state, attempt_count, last_error, created_at, updated_at
         FROM orchestration_transition_intents
         WHERE source_kind = ? AND source_id = ? AND operation = ?`
      )
      .get(sourceKind, sourceId, operation) as
      | {
          intent_id: string;
          repository_id: string;
          run_id: string | null;
          source_kind: TransitionSourceKind;
          source_id: string;
          operation: string;
          payload_json: string;
          state: TransitionIntentState;
          attempt_count: number;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      intentId: row.intent_id,
      repositoryId: row.repository_id,
      runId: row.run_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      operation: row.operation,
      payloadJson: row.payload_json,
      state: row.state,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /** Atomically move PENDING -> APPLYING. Returns false if not PENDING. */
  markApplying(intentId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE orchestration_transition_intents
         SET state = 'APPLYING', updated_at = ?, attempt_count = attempt_count + 1
         WHERE intent_id = ? AND state = 'PENDING'`
      )
      .run(nowIso(), intentId);
    return result.changes === 1;
  }

  setState(intentId: string, state: TransitionIntentState, lastError?: string): void {
    this.db
      .prepare(
        `UPDATE orchestration_transition_intents
         SET state = ?, updated_at = ?, last_error = ?
         WHERE intent_id = ?`
      )
      .run(state, nowIso(), lastError ?? null, intentId);
  }

  listByState(state: TransitionIntentState, limit = 100): TransitionIntent[] {
    const rows = this.db
      .prepare(
        `SELECT intent_id, repository_id, run_id, source_kind, source_id, operation,
                payload_json, state, attempt_count, last_error, created_at, updated_at
         FROM orchestration_transition_intents
         WHERE state = ? ORDER BY created_at ASC LIMIT ?`
      )
      .all(state, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      intentId: r.intent_id as string,
      repositoryId: r.repository_id as string,
      runId: (r.run_id as string | null) ?? null,
      sourceKind: r.source_kind as TransitionSourceKind,
      sourceId: r.source_id as string,
      operation: r.operation as string,
      payloadJson: r.payload_json as string,
      state: r.state as TransitionIntentState,
      attemptCount: r.attempt_count as number,
      lastError: (r.last_error as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));
  }
}

/**
 * Durable side-effect outbox (Change 028 D9). Each effect has a deterministic
 * idempotency key so replay after crash cannot double-deliver a logical effect.
 */
export class OutboxStore {
  constructor(private readonly db: DatabaseSync) {}

  /** Enqueue an outbox item. Returns false if effect_key already exists. */
  enqueue(item: {
    id?: string;
    effectKey: string;
    repositoryId: string;
    runId?: string | null;
    effectKind: string;
    payloadJson?: string;
  }): { inserted: boolean; id: string } {
    const id = item.id ?? randomId();
    const ts = nowIso();
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO orchestration_outbox
         (id, effect_key, repository_id, run_id, effect_kind, payload_json,
          state, attempt_count, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?)`
      )
      .run(
        id,
        item.effectKey,
        item.repositoryId,
        item.runId ?? null,
        item.effectKind,
        item.payloadJson ?? "{}",
        ts,
        ts
      );
    return { inserted: result.changes === 1, id };
  }

  markDelivering(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE orchestration_outbox
         SET state = 'DELIVERING', updated_at = ?, attempt_count = attempt_count + 1
         WHERE id = ? AND state = 'PENDING'`
      )
      .run(nowIso(), id);
    return result.changes === 1;
  }

  setState(id: string, state: OutboxEffectState, lastError?: string): void {
    this.db
      .prepare(
        `UPDATE orchestration_outbox
         SET state = ?, updated_at = ?, last_error = ?
         WHERE id = ?`
      )
      .run(state, nowIso(), lastError ?? null, id);
  }

  get(id: string): OutboxItem | null {
    const row = this.db
      .prepare(
        `SELECT id, effect_key, repository_id, run_id, effect_kind, payload_json,
                state, attempt_count, last_error, created_at, updated_at
         FROM orchestration_outbox WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          effect_key: string;
          repository_id: string;
          run_id: string | null;
          effect_kind: string;
          payload_json: string;
          state: OutboxEffectState;
          attempt_count: number;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      effectKey: row.effect_key,
      repositoryId: row.repository_id,
      runId: row.run_id,
      effectKind: row.effect_kind,
      payloadJson: row.payload_json,
      state: row.state,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listByState(state: OutboxEffectState, limit = 100): OutboxItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, effect_key, repository_id, run_id, effect_kind, payload_json,
                state, attempt_count, last_error, created_at, updated_at
         FROM orchestration_outbox
         WHERE state = ? ORDER BY created_at ASC LIMIT ?`
      )
      .all(state, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      effectKey: r.effect_key as string,
      repositoryId: r.repository_id as string,
      runId: (r.run_id as string | null) ?? null,
      effectKind: r.effect_kind as string,
      payloadJson: r.payload_json as string,
      state: r.state as OutboxEffectState,
      attemptCount: r.attempt_count as number,
      lastError: (r.last_error as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string
    }));
  }
}

function randomId(): string {
  return randomUUID();
}
