import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  TransitionIntentStore,
  OutboxStore,
  type TransitionSourceKind,
  type OutboxItem
} from "./ownership-store.js";
import type { EventBus } from "../events/event-bus.js";
import type { RepositoryMutationEvent } from "@orca/shared";
import { redactSecrets, boundDataStrings } from "../events/event-bus.js";

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
  private readonly eventBus?: EventBus;

  constructor(
    private readonly db: DatabaseSync,
    intentStore?: TransitionIntentStore,
    outboxStore?: OutboxStore,
    eventBus?: EventBus
  ) {
    // Support positional overload where EventBus is passed as second arg for ergonomic injection
    const isEventBus = (v: unknown): boolean =>
      Boolean(v && typeof v === "object" && "publish" in (v as Record<string, unknown>) && typeof (v as Record<string, unknown>).publish === "function" && !("enqueue" in (v as Record<string, unknown>)));
    if (intentStore && isEventBus(intentStore)) {
      this.eventBus = intentStore as unknown as EventBus;
      this.intentStore = new TransitionIntentStore(db);
      this.outboxStore = outboxStore ?? new OutboxStore(db);
      return;
    }
    if (outboxStore && isEventBus(outboxStore)) {
      this.eventBus = outboxStore as unknown as EventBus;
      this.intentStore = intentStore ?? new TransitionIntentStore(db);
      this.outboxStore = new OutboxStore(db);
      return;
    }
    this.intentStore = intentStore ?? new TransitionIntentStore(db);
    this.outboxStore = outboxStore ?? new OutboxStore(db);
    this.eventBus = eventBus;
  }

  private emitAudit(type: string, repositoryId: string, runId: string | null, data: Record<string, unknown>): void {
    if (!this.eventBus) return;
    try {
      const payload: Record<string, unknown> = runId ? { ...data, runId } : { ...data };
      const redacted = redactSecrets(payload);
      const bounded = boundDataStrings(redacted as Record<string, unknown>);
      const event = {
        type,
        at: new Date().toISOString(),
        repositoryId,
        data: bounded
      } satisfies { type: string; at: string; repositoryId: string; data: Record<string, unknown> };
      this.eventBus.publish(event as unknown as RepositoryMutationEvent);
    } catch {
      /* audit emission must not break transition */
    }
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
      const existing = this.intentStore.getBySource(opts.sourceKind, opts.sourceId, opts.operation);
      this.emitAudit("transition.retry", opts.repositoryId, opts.runId ?? null, {
        sourceKind: opts.sourceKind,
        sourceId: opts.sourceId,
        operation: opts.operation,
        intentId,
        attempt_count: existing?.attemptCount ?? 0,
        applied: false,
        reason: "duplicate intent"
      });
      return { applied: false, intentId, outbox: [] };
    }
    const applying = this.intentStore.markApplying(intentId);
    const afterMark = this.intentStore.getBySource(opts.sourceKind, opts.sourceId, opts.operation);
    const attemptCount = afterMark?.attemptCount ?? 1;
    this.emitAudit("transition.retry", opts.repositoryId, opts.runId ?? null, {
      sourceKind: opts.sourceKind,
      sourceId: opts.sourceId,
      operation: opts.operation,
      intentId,
      attempt_count: attemptCount,
      phase: "markApplying"
    });
    if (!applying) {
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

    this.emitAudit("transition.retry", opts.repositoryId, opts.runId ?? null, {
      sourceKind: opts.sourceKind,
      sourceId: opts.sourceId,
      operation: opts.operation,
      intentId,
      attempt_count: attemptCount,
      applied: true,
      outboxCount: outboxSpecs.length
    });
    return { applied: true, intentId, outbox: outboxSpecs };
  }

  async replayOutbox(deliver: OutboxDeliverer): Promise<void> {
    const pending = [
      ...this.outboxStore.listByState("PENDING"),
      ...this.outboxStore.listByState("DELIVERING")
    ];
    for (const item of pending) {
      if (item.state === "DELIVERED" || item.state === "FAILED_TERMINAL") {
        continue;
      }
      const claimed = this.outboxStore.markDelivering(item.id);
      // For DELIVERING items, markDelivering returns false (already claimed), but we still treat as claimed for retry audit
      const current = this.outboxStore.get(item.id);
      const attemptCount = current?.attemptCount ?? item.attemptCount;
      if (!claimed && item.state !== "DELIVERING") {
        continue; // another worker claimed it
      }
      try {
        await deliver(item);
        this.outboxStore.setState(item.id, "DELIVERED");
        this.emitAudit("outbox.retry", item.repositoryId, item.runId ?? null, {
          effectKey: item.effectKey,
          effectKind: item.effectKind,
          outboxId: item.id,
          attempt_count: attemptCount + (claimed ? 0 : 1),
          result: "delivered"
        });
      } catch (err) {
        const message = (err as Error | null)?.message ?? String(err);
        // Retryable by default; terminal outbox failures require an explicit
        // policy decision elsewhere and are not swallowed here.
        this.outboxStore.setState(item.id, "FAILED_RETRYABLE", message);
        const after = this.outboxStore.get(item.id);
        this.emitAudit("outbox.retry", item.repositoryId, item.runId ?? null, {
          effectKey: item.effectKey,
          effectKind: item.effectKind,
          outboxId: item.id,
          attempt_count: after?.attemptCount ?? attemptCount,
          result: "retryable",
          reason: message
        });
      }
    }
  }

  /**
   * True when a non-start transition already exists for this dispatch, i.e. the
   * iteration it authorized has already been completed/failed durably.
   *
   * This is the post-Change-028 replacement for `dispatch.status === "consumed"`
   * as an "already applied" test: DISPATCH_START consumes the dispatch at the
   * START of the turn, so consumption no longer distinguishes a finished
   * iteration from one that has only just begun.
   */
  hasCompletedIterationFor(dispatchId: string): boolean {
    return this.intentStore.hasIntentForSourceExcluding("DISPATCH", dispatchId, [
      "DISPATCH_START",
      "DISPATCH_DRAIN"
    ]);
  }

  /**
   * True when this dispatch's iteration was applied as a SUCCESSFUL completion
   * (the ordinary COMPLETE transition, or a POSTFLIGHT_COMPLETE republish).
   *
   * Narrower than `hasCompletedIterationFor`, which also counts the FAIL_*
   * terminal transitions: a BLOCKED/PARTIAL iteration is durably applied but was
   * never consumed as a success.
   */
  hasSuccessfulCompletionFor(dispatchId: string): boolean {
    return (
      this.intentStore.getBySource("DISPATCH", dispatchId, "COMPLETE") !== null ||
      this.intentStore.getBySource("DISPATCH", dispatchId, "POSTFLIGHT_COMPLETE") !== null
    );
  }

  listPendingOutbox(): OutboxItem[] {
    return [
      ...this.outboxStore.listByState("PENDING"),
      ...this.outboxStore.listByState("DELIVERING")
    ];
  }
}
