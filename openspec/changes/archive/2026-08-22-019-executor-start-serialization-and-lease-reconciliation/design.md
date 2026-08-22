# Change 019 design

## Start-intent guard (ExecutorService)

JavaScript's single-threaded event loop makes a synchronous check-and-set
atomic across any subsequent `await`. `startRun` therefore adds a private
`startingRepositories: Set<string>` that is checked-and-filled synchronously
immediately after the `shuttingDown` refusal and before the first async step
(dispatch/preflight). The remainder of the method is wrapped so a `finally`
block deletes the repository from the set on every path: thrown validation
errors, preflight failures, launch-retry exhaustion, shutdown aborts, and the
success graduation into `activeRunners`.

The existing `activeRunners`/`pendingRunners` guards stay: they catch starts
that overlap an already-running or already-registered runner. The new guard
closes only the window between the check and the first registration — exactly
the TOCTOU identified in review. Rejection reuses `ValidationError` with an
explicit "start already in progress" message so HTTP semantics remain 400-class
and truthful.

## Stale-lease reconciliation (SchedulerService)

Facts established by Change 018 that make startup closure safe:

- `SchedulerService.recover()` runs at startup with an empty in-memory active
  map and flips every persisted `ADMITTED` lease to `STALE_RECOVERABLE`;
- worker request IDs are `${strategyRunId}:${packet.packetId}` and a new
  authorized strategy run always mints a new `strategyRunId`;
- a strategy record left `RECOVERY_REQUIRED` by restart recovery is
  ownership-terminal (coordinator F3) and can never resume its old request IDs.

Therefore every `STALE_RECOVERABLE` row at startup is dead bookkeeping.
`reconcileStaleLeases()` lists decisions, closes each `STALE_RECOVERABLE` row
as `RELEASED` via the store's update path with a reason naming the owning
strategy run parsed from the request ID (or "unknown" when unparseable), and
returns the closed decisions. It touches nothing else; running it twice is a
no-op because no row remains stale.

`app.ts` invokes it once after all other startup sweeps (startup reconciler,
DAG `recoverAll()`, scheduler `recover()`, coordinator construction, and the
pending-postflight retry) and publishes one `scheduler.lease_reconciled` event
per closed lease through the existing event bus. The event type is added to
the shared `EventType` union rather than cast through `any`.

### Adjacent observation, deliberately deferred

Persisted `QUEUED` decisions also cannot be promoted after restart (the
in-memory queue is empty), but they are inert: admission limits count only the
in-memory active map, so a stale QUEUED row neither blocks nor misroutes
anything and simply reads as history. Closing them would expand this change's
test surface without runtime benefit; it stays out of scope.

## Tests

Focused unit tests extend `executor-launch-retry.test.ts` conventions for the
executor paths and `usage-scheduler.test.ts` for reconciliation:

1. two overlapping `startRun` calls on one repository → one launch, one
   structured rejection, exactly one running executor record;
2. failed start releases the intent so a later start is not falsely refused;
3. shutdown during the launch window aborts cleanly and refuses later starts;
4. reconciliation closes stale rows with truthful reasons/events, is
   idempotent, and leaves ADMITTED/QUEUED/REJECTED/RELEASED rows untouched.
