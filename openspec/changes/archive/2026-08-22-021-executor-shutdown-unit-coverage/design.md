# Change 021 design

## Context

The lifecycle paths under test were introduced by the Change 018 hardening
wave and refined by Change 019's start-intent guard. They are implemented in:

- `apps/controller/src/loop/startup-reconciler.ts` — orphaned executor-run
  truth repair (`running`/`pending` → `failed` with cause + `finishedAt`),
  counted as `orphanedExecutorRuns`;
- `apps/controller/src/executor/executor-service.ts` — `shutdown()` sweep over
  both `pendingRunners` (launch-intent map) and `activeRunners`, per-target
  catch-and-continue, `killRun()` lookup across both maps.

## Goals

1. Pin the four paths with deterministic fast-tier tests using fake
   `ExecutorAdapter` implementations (no real processes).
2. Keep the tests behavioral: assert store rows, spawn counts, kill targets,
   and promise settlement rather than private map internals where possible.

## Non-goals

- No production code changes unless a test proves a documented behavior wrong.
- No new real-tier scenarios.

## Test mechanics

- **Hung handshake adapter**: a fake child that emits neither `spawn` nor
  `error` keeps the runner inside the launch window indefinitely with an
  already-spawned child object. `shutdown()` must route
  `killProcessTree`/`cancel` to exactly that child. This is the only
  deterministic way to observe the registration→graduation window from the
  public API.
- **Retry-sleep kill**: attempt 1 fails async (`ENOENT`-shaped error), the
  runner then sleeps `LAUNCH_RETRY_BASE_MS * attempt` (1500 ms). An emergency
  `killRun` inside that window must leave `spawnCount === 1`; the start
  attempt settles via the between-attempts abort check.
- **Sweep isolation**: two repositories started concurrently; the first
  repository's `killProcessTree` rejects, the second resolves. `shutdown()`
  must still resolve and must have attempted both kills.
- **Orphan repair**: seed `executor_runs` rows directly through
  `ExecutorStore.create` + `updateStatus`, run `StartupReconciler.reconcile()`
  with the executor store wired in, assert statuses/causes/count.

## Risks / trade-offs

- Timing-based assertions are avoided; the retry-sleep case uses the real
  1500 ms base delay with generous outer timeouts instead of sleeps on both
  sides of the race.
- If the hung-handshake case exposes that a killed pre-handshake runner never
  settles its persisted row, that is recorded truthfully as a finding; fixing
  it would be a follow-up behavior change outside this coverage-focused
  change.
