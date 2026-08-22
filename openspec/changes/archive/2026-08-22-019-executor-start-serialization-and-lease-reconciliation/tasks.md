# Change 019 tasks

## 1. Serialized executor start

- [x] 1.1 Add synchronous per-repository start-intent guard in `ExecutorService.startRun`, held across all async setup and released in a `finally` on every exit path.
- [x] 1.2 Concurrent-start unit test: overlapping starts → exactly one launch, one structured rejection, one running executor record. (`executor-start-serialization.test.ts` green.)
- [x] 1.3 Guard-release unit tests: failed preflight / exhausted launch retry / shutdown abort do not leak the intent; later authorized start succeeds or refuses only for truthful reasons. (Same file, green.)

## 2. Stale lease reconciliation

- [x] 2.1 Add idempotent `reconcileStaleLeases()` to `SchedulerService` closing `STALE_RECOVERABLE` rows as `RELEASED` with owning-run evidence; no other statuses touched.
- [x] 2.2 Add `scheduler.lease_reconciled` to the shared event union and publish one event per closed lease from `app.ts` after all startup sweeps.
- [x] 2.3 Unit tests: closure with truthful reasons, idempotence, non-interference with ADMITTED/QUEUED/REJECTED/RELEASED rows. (`usage-scheduler.test.ts` green: fixed missing repository FK seed.)

## 3. Gates + durable state

- [x] 3.1 Run focused tests plus typecheck (and build/lint/fast tier where available); record results truthfully. (Focused 15/15, fast tier 248/248 across 51 files, typecheck/build/lint all pass via `node scripts/verify-changes-019-020.mjs` after shell recovery.)
- [x] 3.2 Strict OpenSpec validation passes for the new change. (`openspec validate --all --strict`: 20 passed, 0 failed.)
- [ ] 3.3 Update `.agent/state.json` waypoint and commit/push coherent checkpoint.
