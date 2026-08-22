# Runtime concurrency closure

## ADDED Requirements

### Requirement: Serialized executor start per repository

`ExecutorService.startRun` MUST acquire a per-repository start intent
synchronously before its first `await`, MUST refuse a second concurrent start
for the same repository with a structured validation error, and MUST release
the intent on every exit path (failed preflight, exhausted launch retry,
shutdown abort, successful graduation to the active runner map).

#### Scenario: Concurrent manual and autonomous start

- **WHEN** two `startRun` calls for the same repository overlap in the async
  setup window before runner registration
- **THEN** exactly one SHALL proceed to launch an executor process and the
  other SHALL be rejected without creating a second live runner or a duplicate
  running executor record

#### Scenario: Start guard does not leak after failure

- **WHEN** a start fails (preflight error, launch-retry exhaustion, or
  shutdown abort) and a later authorized start arrives
- **THEN** the later start SHALL NOT be refused by a stale per-repository
  start-intent guard

### Requirement: Stale admission leases are reconciled at startup

After all startup recovery sweeps complete, Orca MUST close every persisted
scheduler admission in `STALE_RECOVERABLE` state as `RELEASED` with truthful
evidence naming its owning request, because recovery is ownership-terminal and
no old request ID can be re-admitted. The reconciliation MUST be idempotent,
MUST NOT touch `ADMITTED`, `QUEUED`, or `REJECTED` decisions, and MUST emit an
observable event per closed lease.

#### Scenario: Restart leaves stale leases closed, not dangling

- **WHEN** a controller restarts with persisted unconfirmed admissions and
  startup recovery completes
- **THEN** no decision row SHALL remain in `STALE_RECOVERABLE` state, each
  closed row SHALL carry a truthful reason and resolution timestamp, and a
  structured reconciliation event SHALL be published per lease

#### Scenario: Reconciliation is idempotent and scoped

- **WHEN** reconciliation runs again with no stale leases present
- **THEN** it SHALL close nothing, publish nothing, and SHALL NOT alter live
  or historical non-stale decisions
