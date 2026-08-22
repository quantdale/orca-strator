# Change 019: Executor start serialization and lease reconciliation

## Why

Post-Change-018 review left two known runtime-correctness gaps:

1. **`ExecutorService.startRun` concurrent-start TOCTOU.** The
   already-running guard inspects `activeRunners`/`pendingRunners` before any
   `await`; the first runner registration happens only after the async
   preflight and record setup. Two overlapping starts for one repository (a
   manual "Run executor" press racing an autonomous dispatch hand-off) can both
   pass the guard before either registers its runner, double-launching an
   executor for one repository and violating D-002's at-most-one-active-executor
   invariant.
2. **No `STALE_RECOVERABLE` lease reconciliation consumer.** Startup recovery
   flips persisted-but-unconfirmed `ADMITTED` scheduler leases to
   `STALE_RECOVERABLE`, but nothing ever consumes that state. Because a
   `RECOVERY_REQUIRED` strategy record is ownership-terminal (Change 018 F3),
   the owning request IDs can never be re-admitted, so these rows dangle
   forever as unresolved bookkeeping that misrepresents runtime truth.

This change closes both gaps with the smallest possible surface.

## Scope

- serialize `ExecutorService.startRun` per repository with a synchronous
  check-and-set intent guard held across all async setup, released on every
  exit path;
- add an idempotent startup reconciliation step that closes every
  `STALE_RECOVERABLE` scheduler admission as `RELEASED` with truthful evidence
  naming the owning strategy run, and publishes an observable event per closed
  lease;
- add focused unit tests covering concurrent-start rejection, start-guard
  release after failed/aborted launches, shutdown-during-launch behavior, and
  stale-lease reconciliation (including idempotence and non-interference with
  live decisions).

## Explicit non-goals

- no change to scheduler admission policy, limits, or queue semantics;
- no multi-executor-per-repository support;
- no UI changes;
- no new permission or ASK behavior (separate follow-up change);
- no re-admission path for old strategy-run request IDs (recovery stays
  ownership-terminal by design).

## Exit evidence

Focused unit tests for both behaviors pass alongside the existing fast tier;
typecheck/build/lint pass as available; strict OpenSpec validation passes.
