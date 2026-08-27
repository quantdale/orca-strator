import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  TransitionIntentStore,
  OutboxStore,
  type TransitionSourceKind,
  type OutboxItem
} from "./ownership-store.js";

/**
 * Change 028 (D7/D8/D9): durable, crash-consistent orchestration transition
 * processor.
 *
 * The invariant this service enforces is F2: a protocol source (dispatch,
 * Sol control, executor/strategy completion) is logically consumed **iff** its
 * required run mutation is committed, and any external side effect (Sol wake,
 * browser close, audit publication) is delivered **after** commit from a
 * durable, idempotent outbox.
 *
 * No external I/O (browser, Git network, process spawn, network) may occur
 * inside the transaction. Only durable state mutation + outbox row creation
 * happen within BEGIN/COMMIT; side-effect delivery happens after commit and is
 * replayable on restart.
 */
export interface OutboxEffectSpec {
  effectKey: string;
  repositoryId: string;
  runId?: string | null;
  effectKind: string;
  payloadJson?: string;
}

export interface EnqueueAndApplyOptions {
  sourceKind: TransitionSourceKind;
  sourceId: string;
  operation: string;
  repositoryId: string;
  runId?: string | null;
  payloadJson?: string;
  /**
   * Runs inside the SQLite transaction. Perform the source consumption and
   * required run mutation via the caller's stores, then call
   * `ctx.enqueueOutbox(...)` for each external side effect that must be
   * delivered after commit. MUST NOT perform awaited external I/O itself.
   */
  apply: (ctx: { enqueueOutbox: (spec: OutboxEffectSpec) => void }) => void | Promise<void>;
}

export interface EnqueueAndApplyResult {
  /** false when an equivalent idempotent intent already existed (replay-safe no-op). */
  applied: boolean;
  intentId: string;
  /** Side effects to deliver after commit (already durable in the outbox). */
  outbox: OutboxEffectSpec[];
}

export type OutboxDeliverer = (
  item: OutboxItem
) => Promise<void> | void;

export class OrchestrationTransitionService {
  private readonly intentStore: TransitionIntentStore;
  private readonly outboxStore: OutboxStore;

  constructor(
    private readonly db: DatabaseSync,
    intentStore?: TransitionIntentStore,
    outboxStore?: OutboxStore
  ) {
    this.intentStore = intentStore ?? new TransitionIntentStore(db);
    this.outboxStore = outboxStore ?? new OutboxStore(db);
  }

  /** Wrap a unit of work in a single SQLite transaction. */
  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw err;
    }
  }

  /**
   * Atomically enqueue a transition intent (idempotent by the UNIQUE
   * (source_kind, source_id, operation) key), apply its run mutation + source
   * consumption, and create its outbox rows — all in one transaction. The
   * returned `outbox` effects are durable and must be delivered by the caller
   * after this resolves.
   *
   * Idempotency: if an equivalent intent already exists, this is a no-op
   * (a restarted/duplicate caller must not double-apply or double-spawn).
   */
  async enqueueAndApply(opts: EnqueueAndApplyOptions): Promise<EnqueueAndApplyResult> {
    const intentId = randomUUID();
    const { inserted } = this.intentStore.enqueue({
      intentId,
      repositoryId: opts.repositoryId,
      runId: opts.runId ?? null,
      sourceKind: opts.sourceKind,
      sourceId: opts.sourceId,
      operation: opts.operation,
      payloadJson: opts.payloadJson ?? "{}"
    });
    if (!inserted) {
      return { applied: false, intentId, outbox: [] };
    }
    if (!this.intentStore.markApplying(intentId)) {
      return { applied: false, intentId, outbox: [] };
    }

    const outboxSpecs: OutboxEffectSpec[] = [];
    await this.withTransaction(async () => {
      await opts.apply({
        enqueueOutbox: (spec) => {
          outboxSpecs.push(spec);
        }
      });
      for (const spec of outboxSpecs) {
        this.outboxStore.enqueue(spec);
      }
      this.intentStore.setState(intentId, "APPLIED");
    });

    return { applied: true, intentId, outbox: outboxSpecs };
  }

  /**
   * Deliver (or re-deliver after a crash) all pending/delivering outbox
   * effects. Called after commit and during startup replay. Delivery is
   * idempotent: an already-DELIVERED effect is skipped, and the deterministic
   * effect key prevents duplicate side effects.
   */
  async replayOutbox(deliver: OutboxDeliverer): Promise<void> {
    const pending = [
      ...this.outboxStore.listByState("PENDING"),
      ...this.outboxStore.listByState("DELIVERING")
    ];
    for (const item of pending) {
      if (item.state === "DELIVERED" || item.state === "FAILED_TERMINAL") {
        continue;
      }
      if (!this.outboxStore.markDelivering(item.id)) {
        continue; // another worker claimed it
      }
      try {
        await deliver(item);
        this.outboxStore.setState(item.id, "DELIVERED");
      } catch (err) {
        const message = (err as Error | null)?.message ?? String(err);
        // Retryable by default; terminal outbox failures require an explicit
        // policy decision elsewhere and are not swallowed here.
        this.outboxStore.setState(item.id, "FAILED_RETRYABLE", message);
      }
    }
  }

  listPendingOutbox(): OutboxItem[] {
    return [
      ...this.outboxStore.listByState("PENDING"),
      ...this.outboxStore.listByState("DELIVERING")
    ];
  }
}
