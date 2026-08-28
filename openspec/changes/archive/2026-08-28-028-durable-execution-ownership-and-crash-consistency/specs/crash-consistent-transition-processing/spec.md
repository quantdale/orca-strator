# Delta Spec: Crash-consistent transition processing

## ADDED Requirements

### Requirement: durable transition intent

Every protocol event whose application changes campaign state SHALL have a durable, idempotently addressable transition intent before the system depends on asynchronous in-memory delivery for eventual application.

At minimum, Change 028 SHALL cover dispatch application, Sol-control application, direct executor completion, and strategy completion paths affected by the audit.

#### Scenario: controller dies after watcher stores dispatch

- Given a valid dispatch commit is inspected and durably recorded
- And the controller dies before in-memory loop application completes
- When the controller restarts
- Then a durable transition intent remains discoverable
- And the dispatch is reapplied/reconciled idempotently without requiring Git HEAD to move again.

### Requirement: source consumption and run mutation are atomic

For a transition that consumes a dispatch/control source, the source consumption and its required run-state mutation MUST commit in the same SQLite transaction.

The system SHALL NOT expose a durable state in which the source is consumed but the required campaign transition is absent.

#### Scenario: crash during executor completion

- Given a valid executor result authorizes completion of dispatch D
- When the process crashes at any write boundary while applying the completion
- Then after restart either both D consumption and the required run transition are present
- Or neither logical effect is committed and the intent remains replayable.

#### Scenario: crash during Sol control

- Given a valid Sol control C authorizes a terminal run transition
- When the process crashes during application
- Then C cannot remain consumed while the run remains in the pre-control state.

### Requirement: expected-state compare-and-set

Critical run transitions SHALL include durable expected-state/correlation predicates so a stale callback cannot overwrite a newer transition.

A failed expected-state update SHALL be treated as an explicit stale/idempotent/recovery outcome, not silently ignored as success.

#### Scenario: late executor completion after terminal control

- Given a run has already moved to a terminal state through a newer valid transition
- When an older executor completion callback arrives
- Then the callback cannot overwrite the terminal state
- And its transition intent settles as stale/already-applied according to correlation rules.

### Requirement: no external I/O inside transition transaction

Browser automation, process spawning, Git remote/network operations, and other awaited external effects MUST NOT occur while the SQLite transition transaction is open.

#### Scenario: Sol wake required after completion

- Given a completed iteration requires a new Sol wake
- When the completion transaction is committed
- Then the run/source state and an idempotent wake side-effect intent are committed first
- And browser submission occurs only after that transaction has ended.

### Requirement: durable side-effect outbox

External effects required by a committed transition SHALL be represented by a durable idempotent outbox record (or an existing durable mechanism explicitly reused with equivalent guarantees).

Outbox delivery SHALL be replayable after controller restart.

#### Scenario: crash after commit before browser delivery

- Given a run transition and Sol-wake outbox item were committed
- And the controller dies before submitting the wake
- When it restarts
- Then the pending effect is delivered/reconciled
- And duplicate delivery cannot create a second logical wake for the same intent.

### Requirement: actor-start replay does not double-spawn

If actor start is delivered asynchronously/outboxed, replay SHALL use durable actor lease/process ownership as the logical exactly-once boundary.

#### Scenario: process starts before delivery acknowledgement

- Given an actor-start effect launched a child and durable actor/process ownership exists
- And the controller dies before marking the effect delivered
- When the effect is replayed
- Then Orca observes/reconciles the existing ownership
- And does not spawn a second child for the same repository actor.

### Requirement: protocol duplicates are idempotent

Repeated delivery of the same dispatch/control/completion source SHALL result in at most one logical campaign transition and at most one logical external effect per idempotency key.

#### Scenario: duplicate Sol control delivery

- Given control C has already been atomically applied
- When C is delivered again
- Then the processor recognizes it as already applied
- And does not alter run state, close an unrelated page, or emit a second logical transition.

### Requirement: invalid/stale sources terminate durably

A transition intent whose source is conclusively invalid or stale SHALL settle to a durable terminal/rejected state with an auditable reason rather than retry forever.

#### Scenario: old-run dispatch

- Given a detected dispatch references an older run than the current active campaign
- When transition processing validates correlation
- Then the source/intent is rejected with durable reason
- And no actor starts.

### Requirement: asynchronous failure has an owner

Any Promise that can apply or enqueue an orchestration transition SHALL be awaited, tracked through shutdown, or have an explicit failure handler that records retryable/terminal durable evidence.

#### Scenario: transition callback rejects

- Given a watcher or executor completion callback rejects asynchronously
- Then the rejection does not become an unowned promise
- And the corresponding transition remains durably retryable/rejected with observable error evidence.
