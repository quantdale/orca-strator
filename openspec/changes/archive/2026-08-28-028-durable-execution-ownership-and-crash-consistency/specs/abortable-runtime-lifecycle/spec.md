# Delta Spec: Abortable runtime lifecycle

## ADDED Requirements

### Requirement: initialization can be cancelled safely

Controller initialization SHALL have a cancellation/cleanup owner from the moment resources capable of background work are created until the fully initialized app is published.

SIGINT/SIGTERM during initialization MUST latch shutdown and prevent new browser/process/watcher work from being admitted.

#### Scenario: signal during startup reconciliation

- Given `buildApp()` is reconciling a persisted Sol operation
- And a shutdown signal arrives before `buildApp()` returns
- Then initialization is cancelled or allowed only to reach a bounded cleanup point
- And no new automated browser/process start occurs after the shutdown latch
- And all already-owned resources are closed/reconciled before singleton ownership is released.

### Requirement: partial construction has deterministic cleanup

Every resource that can own timers, sockets, child processes, browser state, watcher work, or database callbacks SHALL register cleanup as soon as it can become active.

If later initialization fails, cleanup SHALL run in a deterministic bounded order.

#### Scenario: service construction fails late

- Given watcher/browser/controller services have been created
- And a later initialization/reconciliation step throws
- Then already-created resources are closed/reconciled
- And the database/runtime lock are not released first while callbacks can still target them.

### Requirement: listen failure uses full teardown

A Fastify listen failure after app construction SHALL execute the assembled runtime shutdown path before closing the database and releasing the runtime singleton lock.

#### Scenario: port conflict after build

- Given `buildApp()` completed and watcher/startup reconciliation has run
- When `listen()` fails with EADDRINUSE
- Then watcher, loop timers, execution actors, browser resources, and Fastify hooks are settled first
- Then persistence is closed
- Then the singleton lock is released
- And no Orca child/resource is intentionally left alive by the failed startup.

### Requirement: singleton release follows owned-resource settlement

The controller SHALL NOT release its runtime singleton ownership while it is still intentionally managing cleanup of resources that could mutate repository/browser state, except after a documented bounded-shutdown failure that leaves durable recovery evidence.

#### Scenario: shutdown while executor kill is settling

- Given an owned executor is being terminated during shutdown
- When shutdown is requested
- Then singleton release waits for verified/bounded actor settlement and durable recovery marking
- And a second controller cannot legitimately take ownership during the normal cleanup window.

### Requirement: automated browser stale lock is conservative

A dead controller PID SHALL NOT by itself prove an AUTOMATED browser profile lock is stale.

Before reclaiming such a lock, Orca MUST authoritatively determine that no Chrome process is using the exact dedicated profile. If it cannot determine this, it SHALL refuse/quarantine acquisition.

#### Scenario: Chrome survives controller crash

- Given automated Chrome is using Orca's dedicated profile
- And the controller process dies
- When a new controller attempts to acquire the automated profile lock
- Then it detects or conservatively treats the surviving profile owner as blocking
- And it does not launch a second Chrome on the same profile.

#### Scenario: authoritative no-owner proof

- Given an automated lock references a dead controller
- And the host process probe authoritatively finds no Chrome using the dedicated profile
- When the new controller acquires the profile
- Then stale lock recovery may proceed
- And the recovery is recorded observably.

### Requirement: shutdown remains repository-independent

A lifecycle failure/quarantine for one repository SHALL NOT require unrelated repositories to be marked failed, except for global resources whose ownership genuinely prevents safe operation (for example one shared browser profile).

#### Scenario: repository process quarantine

- Given repository A has uncertain executor ownership
- And repository B is idle and otherwise ready
- When the controller restarts
- Then A is blocked
- And B may continue normal non-conflicting operation.
