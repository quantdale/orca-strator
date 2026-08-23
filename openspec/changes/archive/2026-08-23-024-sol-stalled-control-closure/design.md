# Design: SOL_STALLED Git-truthful control closure

## Context

`SOL_STALLED` is intentionally excluded from `RunStore.getActiveRun()`. That prevents transport failures from being mistaken for live actor ownership and lets a user start a later campaign. Real dogfood nevertheless proved that Git can contain a valid terminal Sol decision after the browser transport has stalled. The control watcher remains able to detect that commit, but `LoopService.onControlDetected()` currently validates only against `getActiveRun()`, so the durable decision is rejected as `no active run for repository`.

The design must repair terminal closure without redefining `SOL_STALLED` as active.

## Decision 1: resolve a control target, not an active actor

Introduce a narrow resolver inside `LoopService` (name may vary) with these semantics:

1. Query `runStore.getActiveRun(repositoryId)`.
2. If an active run exists, return it unchanged. Existing correlation rules remain authoritative.
3. If no active run exists and no control record exists, return `null`.
4. Query `runStore.getLatestRun(repositoryId)`.
5. Return that latest run only when all are true:
   - `latest.status === "SOL_STALLED"`;
   - `latest.id === control.runId`;
   - the incoming callback `runId` / durable control record identify the same run.
6. Otherwise return `null`.

This resolver is used only by Sol-control application. Dispatch, executor, scheduler, startup-rehydration, controls, and strategy ownership continue to use `getActiveRun()`.

### Rationale

Changing `getActiveRun()` would be structurally wrong: it would leak `SOL_STALLED` into unrelated ownership paths. A control-target resolver keeps the exception local to the Git decision boundary that needs it.

## Decision 2: only terminal decisions may close a stalled run

For a target whose current status is `SOL_STALLED`, allowed decisions are:

- `GOAL_COMPLETE`
- `BLOCKED`
- `NEEDS_HUMAN`

`PAUSED` is rejected. A stalled run has no live actor to pause, and accepting pause would blur terminal/problem-state semantics.

The normal target-state mapping is reused for allowed terminal decisions. The control becomes `consumed` only after strict validation passes.

## Decision 3: preserve all existing correlation checks

The stalled-run exception does not waive validation. The control still must satisfy:

- control exists and is `detected`;
- `control.repositoryId === repositoryId`;
- `control.runId === targetRun.id`;
- `control.iteration === targetRun.currentIteration`;
- when `relatedDispatchId` is non-null, it equals `targetRun.activeDispatchId`;
- no active strategy/executor actor conflicts with the decision.

A malformed, stale, duplicate, or mismatched control stays rejected/auditable.

## Decision 4: newer campaigns win

If `getActiveRun(repositoryId)` returns a newer campaign, that active campaign is the sole validation target. A control for an older stalled campaign therefore fails run correlation and is rejected.

This prevents a late Git commit from rewriting historical terminal state while a newer campaign is operating.

## Decision 5: no actor resurrection

Applying a terminal control to `SOL_STALLED` performs only terminal state reconciliation and normal event/audit updates. It MUST NOT:

- submit another Sol wake;
- start/resume an executor;
- acquire a scheduler lease;
- arm a new wall-clock timer;
- reclassify the stalled run as active first.

The resulting run becomes `GOAL_COMPLETE`, `BLOCKED`, or `NEEDS_HUMAN` directly.

## Test design

Focused tests belong with the existing LoopService control-correlation suite or in a dedicated `sol-stalled-control-closure.test.ts` using the same real SQLite stores and mock browser boundary.

Required cases:

1. **Matching GOAL_COMPLETE closes stalled run**: transition a run to `SOL_STALLED`, seed a matching durable control, call `onControlDetected`, assert control `consumed` and run `GOAL_COMPLETE`.
2. **BLOCKED / NEEDS_HUMAN allowed**: at least one additional terminal decision proves the resolver is not GOAL_COMPLETE-specific.
3. **PAUSED rejected**: stalled run remains stalled, control becomes rejected.
4. **Newer active run protection**: stall run A, start run B, deliver control for A; A remains stalled, B remains active, control rejected.
5. **Strict stale correlation**: wrong iteration and/or `relatedDispatchId` is rejected even when the stalled run is the latest run.
6. **Normal active-run controls unchanged**: existing valid/stale/duplicate cases remain green.

## Verification and rollout

No database migration is required. The change is controller-only and backward compatible with persisted run/control records.

Because the original bug was discovered by a real external campaign, after focused and fast gates pass, record the fix in `docs/REAL-DOGFOOD-QUALIFICATION.md` as closure hardening. A new external inference burn is not required merely to qualify the deterministic control-state fix, but a future naturally occurring stall should exercise it without manual DB/state repair.
