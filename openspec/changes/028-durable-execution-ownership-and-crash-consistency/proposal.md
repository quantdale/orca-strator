# Proposal: Durable execution ownership and crash consistency

## Why

A repository-wide audit of pushed `main` at `4d1246aa2b9d5fbdd455d17d72b3259896f80432` found a concentrated set of crash-safety defects in the exact subsystem Orca-Strator exists to make trustworthy: unattended repository mutation.

The current runtime is well defended against many ordinary in-process races, but controller death crosses a different boundary. In that case:

1. persisted `running`/`pending` executor rows are declared failed without durable evidence that their child processes are dead;
2. no repository-level durable actor lease prevents a new campaign from starting after the old campaign is moved to `RECOVERY_REQUIRED`;
3. SWARM/DAG recovery similarly loses worker handles and assumes workers are gone;
4. dispatch/control rows can be marked `consumed` in a different durable write from the run-state transition they authorize;
5. watcher callbacks and executor completion callbacks can be fire-and-forget, so asynchronous application failure is not a durable protocol state;
6. startup signal handling can exit before `buildApp()` returns even though startup reconciliation may already have launched browser activity;
7. automated browser profile lock ownership is tied to the controller PID, so a surviving Chrome process can outlive the process whose death makes the lock look stale.

These defects violate existing product promises—single actor ownership, crash/reboot reconstruction, duplicate protection, and no silent data loss—rather than introducing a new feature requirement.

## Goals

1. Make repository execution ownership durable across controller restarts.
2. Never admit a second mutating actor while a prior actor is live or its liveness is uncertain.
3. Persist enough child-process identity to distinguish live match, dead process, PID reuse, and unknown/unprovable ownership.
4. Never kill a process unless Orca can prove it is the process Orca launched.
5. Make dispatch/control/completion-to-run transitions crash-consistent and idempotently replayable.
6. Separate SQLite state transactions from external side effects using a durable outbox.
7. Ensure every critical asynchronous callback has an explicit owner and failure path.
8. Make initialization and shutdown safe when signals/listen failures occur before the app is fully published.
9. Make automated browser-profile stale ownership conservative: reclaim only after proving the dedicated profile is not still in use.
10. Prove the behavior with subprocess/process-tree and crash-boundary fault injection, not only mocks.

## Non-goals

- No new product feature or UI redesign.
- No distributed database, broker, Redis, or external queue.
- No generic process manager/daemon framework.
- No automatic reattachment to a previous executor's stdout/stderr session; safe containment/recovery is sufficient.
- No automatic killing of a PID based only on PID equality.
- No hard reset, `git clean`, force push, or destructive recovery of user files.
- No fake closure of residual external acceptance tasks in Changes 026/027.
- No broad rewrite of LoopService/SwarmExecutionService merely for aesthetics.
- No holding SQLite transactions open across browser, Git-network, process-spawn, or other awaited external I/O.

## What changes

### 1. Durable actor and process ownership

Add additive persistence for:

- one repository-level execution actor lease (SINGLE_AGENT / SWARM / DAG) per repository;
- process ownership records for direct executors and strategy workers;
- a controller-instance/startup epoch so old ownership can be distinguished from the current process;
- process identity evidence sufficient for safe liveness decisions where the OS exposes it.

Abnormal restart reconciliation MUST classify prior ownership as `LIVE_MATCH`, `DEAD`, `PID_REUSED`, or `UNKNOWN` (names may differ in implementation). Only proven-dead ownership may be released automatically. Live or unknown ownership moves the repository into a durable quarantine/recovery condition and blocks new mutation.

### 2. Crash-consistent transition processor

Introduce a durable transition inbox and side-effect outbox (or an equivalent design with the same guarantees).

For a protocol source such as dispatch, Sol control, executor completion, or strategy completion:

- the source marker/result remains auditable;
- source consumption + required run-state mutation happen in one SQLite transaction;
- an external action required after that state mutation is represented by an idempotent durable outbox item in the same transaction;
- restart replays pending transition/outbox work;
- duplicate delivery produces the same logical outcome without double-start/double-wake/double-consume.

### 3. Owned async boundaries

Watcher/controller/executor callbacks that can mutate durable state become awaitable or enqueue durable work. Every detached promise has an explicit `.catch`/tracking owner. A process-level unhandled-rejection hook may exist only as last-resort crash reporting/controlled shutdown, not as the normal transition mechanism.

### 4. Abortable initialization and unified teardown

Initialization gains a cancellation/cleanup owner so SIGINT/SIGTERM or listen failure during construction cannot bypass teardown after browser/watcher/process resources have become active. The singleton lock is released only after owned resources are settled as far as bounded shutdown allows.

### 5. Conservative browser profile recovery

An automated profile lock from a dead controller is not automatically considered safe. Before reclaim, Orca must prove no Chrome process is using the exact dedicated profile. Unknown evidence surfaces a recoverable/actionable quarantine rather than racing a second Chrome against the profile.

## Capabilities

### New: `durable-execution-ownership`

Defines repository actor leases, child-process identity, crash-time liveness classification, quarantine, safe kill rules, and worktree protection.

### New: `crash-consistent-transition-processing`

Defines atomic protocol-marker/run transitions, idempotent transition replay, outbox side effects, callback ownership, and duplicate semantics.

### New: `abortable-runtime-lifecycle`

Defines startup cancellation, partial construction teardown, listen-failure cleanup, and safe browser-profile ownership recovery.

## Product assumptions

- SQLite remains the local durable coordination store.
- One controller owns one Orca data directory at a time through the existing runtime singleton lock.
- SWARM/DAG may run multiple workers concurrently, but those workers belong to one repository-level strategy actor and mutate isolated Orca-owned worktrees until integration.
- Persistent user `main` remains protected from concurrent actor ownership.
- Windows is the primary host; WSL execution still originates from a host child process that Orca can identify conservatively.

## User-visible outcome

After an abrupt controller crash, Orca must no longer pretend it knows a worker died. It will either prove prior ownership is gone and recover safely, or present a clear recovery/quarantine state that blocks a second writer. Git dispatch/control transitions will resume from durable intent rather than silently disappearing between “consumed” and “applied.”

## Risks

- Process identity is OS-specific. The design must fail closed when evidence is incomplete.
- Outbox replay can create duplicate side effects if idempotency keys are not enforced end-to-end.
- Retrofitting transaction ownership into large services can accidentally broaden scope. Keep transaction orchestration in a small dedicated service/store layer.
- Startup cancellation touches lifecycle ordering and must not regress packaged controller supervision from Changes 025–027.
- Conservative quarantine may require explicit user recovery in ambiguous cases. That is preferable to concurrent mutation or killing a foreign process.

## Success criteria

- Fault-injection proves no duplicate repository writer after controller death for direct executor, SWARM, and DAG paths.
- PID reuse/unknown-process tests prove Orca never kills a foreign process.
- Crash-at-every-transition-boundary tests prove marker consumption cannot outrun the corresponding run transition.
- Pending outbox items replay idempotently after restart.
- Startup signal/listen-failure tests prove bounded cleanup of browser/process/profile ownership.
- Existing unit/integration/real-process suites remain green.
- Changes 026/027 external blockers remain truthfully open and are not conflated with Change 028 completion.

## Roadmap relationship

This is a focused post-M24 hardening change. It does not create a new product feature milestone. `docs/ROADMAP.md` remains product-history truth; this change closes newly discovered defects against the existing Milestone 6/17/23/24 safety contracts.
