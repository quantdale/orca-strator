# Design: Durable execution ownership and crash consistency

## Context

Orca already has strong in-process ownership checks. The missing layer is **crash durability**: JavaScript maps, ChildProcess handles, Promise chains, and callback sequencing disappear when the controller process dies, while SQLite rows, Git commits, workers, Chrome, and worktrees can survive.

The design therefore treats process loss as an uncertainty boundary, not as evidence of actor death.

## Invariants

The implementation MUST preserve these invariants throughout the change:

1. At most one repository-level execution actor lease may authorize repository mutation for a repository.
2. SWARM/DAG workers may be concurrent only underneath their one strategy actor and only in isolated worktrees until qualified integration.
3. No new actor may start while prior actor ownership is live or uncertain.
4. No process may be killed without a strong identity match to an Orca-launched process record.
5. A protocol source is logically consumed iff its required run transition is committed.
6. No external I/O occurs inside a SQLite transaction.
7. External effects are at-least-once replayable and logically idempotent.
8. Restart may produce `RECOVERY_REQUIRED`/quarantine, but never invented success.
9. A stale async callback may not overwrite a newer terminal state.
10. User Git work is preserved; no hard reset/clean/force push is introduced.

## D1 — Controller instance identity

Create a fresh cryptographic `controllerInstanceId` (startup epoch) for every controller process.

Recommended ownership:

- generated once in `index.ts` before app construction;
- included in runtime lock metadata for diagnostics;
- passed into `buildApp` / execution ownership service;
- written to every actor/process ownership record.

The instance ID is not a secret and is not an authentication token. Do not reuse the lifecycle `controlToken` for this purpose.

## D2 — Additive execution ownership schema

Add a migration after the current schema version (currently 23 at planning time). Keep it additive; do not rebuild legacy protocol tables merely to add constraints.

Recommended tables (names may change if repository naming conventions demand it):

### `repository_actor_leases`

One row per repository, enforced by `repository_id PRIMARY KEY`.

Suggested fields:

- `repository_id` FK repositories;
- `lease_id` unique UUID;
- `controller_instance_id`;
- `run_id` FK runs;
- `iteration`;
- `actor_kind` = `SINGLE_AGENT | SWARM | DAG`;
- `actor_id` = executor attempt ID or strategy run ID when known;
- `state` = `STARTING | ACTIVE | RELEASING | QUARANTINED`;
- `created_at`, `updated_at`, optional `released_at`/`last_error`.

A new actor acquisition is a transaction using the primary-key uniqueness boundary. Application-level check-then-set is not sufficient.

### `process_ownership_records`

One row per launched mutating child.

Suggested fields:

- ownership ID / controller instance / repository / run / iteration;
- actor/strategy ID and optional packet ID;
- process kind (`DIRECT_EXECUTOR`, `SWARM_WORKER`, `DAG_WORKER`);
- host PID;
- captured process creation/start marker;
- executable/command identity evidence that can be safely recorded (never secrets/argv values containing credentials);
- working path / environment classification;
- state (`STARTING`, `RUNNING`, `EXITED`, `KILL_CONFIRMED`, `UNKNOWN`);
- timestamps and last error.

Do not store sensitive environment values or full command lines if they can contain credentials.

## D3 — Process identity/probe abstraction

Add a small interface such as:

```ts
type ProcessIdentityVerdict =
  | "LIVE_MATCH"
  | "DEAD"
  | "PID_REUSED"
  | "UNKNOWN";

interface ProcessProbe {
  capture(pid: number): Promise<ProcessIdentityEvidence>;
  classify(record: ProcessOwnershipRecord): Promise<ProcessIdentityVerdict>;
  killVerifiedTree(record: ProcessOwnershipRecord): Promise<void>;
}
```

Exact shape is implementation-owned.

Rules:

- PID equality alone is never enough to kill.
- `PID_REUSED` and `UNKNOWN` are fail-closed: quarantine, do not kill.
- `DEAD` allows lease reconciliation.
- `LIVE_MATCH` may be killed only through an explicit recovery/kill/shutdown policy that owns that exact actor.
- capture evidence immediately after the child emits `spawn`.
- if capture fails after spawn, persist `UNKNOWN` ownership before returning control; do not erase the lease.

On Windows, use stable process creation evidence available without admin rights (for example CIM/PowerShell process creation time plus executable/process ID, carefully bounded). On non-Windows test hosts, provide a portable probe adequate for deterministic tests. WSL execution should conservatively identify the host `wsl.exe` process Orca spawned; do not assume knowledge of arbitrary Linux descendants when it is unavailable.

## D4 — ExecutorRunner spawn ownership hook

`ExecutorRunner` is the shared child-process primitive for direct executors and strategy workers. Add an awaited or failure-aware `onSpawn` hook that exposes the PID after the real spawn handshake and before the actor is considered safely active.

Requirements:

- process ownership persistence must happen before start APIs report successful admission;
- an ownership-persistence failure after child spawn must trigger verified termination if identity was captured; otherwise quarantine;
- `onExit` marks the process record terminal before actor lease release;
- launch retry must not create multiple ownership records that are later mistaken for one process; each real spawn attempt is uniquely traceable.

## D5 — Repository actor lease service

Create one focused service/store responsible for acquire, bind actor ID, quarantine, release, and startup reconcile.

Acquisition is required before:

- direct executor start;
- dispatch-authorized SWARM/DAG strategy start;
- manual advanced strategy start that can mutate a repository.

Do not acquire one repository lease per SWARM worker. The strategy owns the repository lease; workers have process records beneath it.

Release only when:

- all owned child process records are terminal/proven dead;
- strategy/executor state has reached a durable actor boundary; and
- no transition outbox item still requires that actor to be treated as active.

On abnormal restart:

1. find leases owned by a prior controller instance;
2. classify all associated processes;
3. if all are `DEAD`, convert interrupted run/strategy to truthful recovery state and release the lease;
4. if any are `LIVE_MATCH`, preserve the lease as `QUARANTINED` and expose actionable recovery; optionally support an explicit verified kill;
5. if any are `PID_REUSED` or `UNKNOWN`, quarantine and never auto-kill;
6. only after lease release may a new campaign actor start.

## D6 — Worktree recovery ordering

Startup process/actor reconciliation MUST run before strategy/worktree cleanup.

A worktree associated with `LIVE_MATCH` or `UNKNOWN` ownership is protected from automatic release/sweep. Dirty-file preservation semantics remain unchanged.

DAG staging cleanup may run only after the owning strategy actor has been proven dead/reconciled. Provenance branches remain retained as today.

## D7 — Crash-consistent transition inbox

Add a durable transition queue/table, e.g. `orchestration_transition_intents`.

Suggested fields:

- `intent_id` UUID;
- `repository_id`, `run_id`;
- `source_kind` (`DISPATCH`, `SOL_CONTROL`, `EXECUTOR_COMPLETION`, `STRATEGY_COMPLETION`, plus only other sources needed by this change);
- `source_id`;
- `operation`;
- validated payload JSON containing identifiers/status only;
- `state` (`PENDING`, `APPLYING`, `APPLIED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`);
- attempt count, last error, timestamps;
- UNIQUE key covering the logical source/operation.

Watcher ingestion should create protocol rows and transition intents durably. It is acceptable for watcher HEAD to advance after the intent is durable; it is not acceptable to depend on a one-time in-memory callback for eventual application.

Executor/strategy completion should similarly enqueue or synchronously invoke the durable transition processor rather than marking source consumption in a separate service first.

## D8 — Transaction application service

Create a small `OrchestrationTransitionService` (name flexible) that owns SQLite transactions for state-machine application.

For each intent:

1. `BEGIN IMMEDIATE` (or repository-consistent transaction primitive);
2. re-read source + run + expected correlation;
3. if already logically applied, mark intent APPLIED idempotently;
4. otherwise use expected-state/CAS updates;
5. mutate run and source consumption in the same transaction;
6. enqueue required side-effect outbox rows in the same transaction;
7. commit;
8. execute/replay side effects outside the transaction.

Do not hold a transaction while spawning a process, touching Git remote, driving Chrome, or publishing network I/O.

A rejected/stale protocol source is also a durable terminal application result; it must not be retried forever.

## D9 — Side-effect outbox

Add a durable `orchestration_outbox` (or equivalent).

Initial effect kinds should stay minimal and tied to the identified crash holes, such as:

- `START_EXECUTION_ACTOR` (if the final design needs durable start delivery);
- `SUBMIT_SOL_WAKE`;
- `COMPLETE_SOL_OPERATION` / close repository page;
- event/audit publication where loss would otherwise make transition evidence misleading.

Each item has a deterministic idempotency key and states `PENDING | DELIVERING | DELIVERED | FAILED_RETRYABLE | FAILED_TERMINAL`.

If `START_EXECUTION_ACTOR` is outboxed, actor lease acquisition is the idempotency boundary: replay must observe the existing lease/process before spawning again.

For Sol wake replay, reuse the existing durable Sol-operation intent/idempotency contract rather than create parallel wake semantics.

## D10 — Marker consumption semantics

Remove premature consumption from `ExecutorService.handleTurnCompletion()`.

The component that atomically applies the campaign completion owns dispatch consumption.

For Sol controls, do not mark the control consumed before the run transition. Apply run state + control consumed atomically, then close the browser operation from outbox/replay.

For dispatch start, the durable transition intent remains replayable until actor start is durably owned. If process start succeeds but controller dies before delivery acknowledgement, actor lease/process reconciliation must make replay a no-op/quarantine rather than a second spawn.

## D11 — Expected-state/CAS transitions

Introduce compare-and-set helpers for critical run transitions. Examples:

- only `SOL_PENDING|SOL_REVIEWING` may atomically accept a correlated dispatch;
- only the exact current execution state/dispatch may accept its completion;
- only an expected Sol boundary may apply a Sol control;
- terminal state may not be overwritten by a stale callback.

Do not attempt to encode the entire state machine in SQL triggers. Keep policy in TypeScript but require SQL predicates to make stale writes observable (`changes === 0`).

## D12 — Async callback ownership

Change critical callback signatures to `Promise<void>` or durable enqueue functions.

Production wiring requirements:

- watcher awaits durable enqueue/application or explicitly catches it and records retryable transition failure;
- executor completion owns/tracks the Promise;
- strategy completion retains the coordinator's existing pending-completion tracking but must route into the same durable transition semantics;
- no `void someStateMutationPromise()` without `.catch`/tracking.

Add a final `unhandledRejection`/`uncaughtException` diagnostic path only if it can perform bounded controlled shutdown safely. Do not use it to make ordinary errors disappear.

## D13 — Abortable initialization and cleanup stack

The current assumption that pre-return `buildApp()` cannot launch resources is invalid because startup reconciliation may retry a Sol wake and the watcher is started before return.

Preferred structure:

- `index.ts` owns an `AbortController` for construction;
- `buildApp` accepts the signal or an initialization lifecycle object;
- resource constructors/register steps push cleanup functions to a LIFO cleanup scope as soon as the resource can own work;
- if initialization aborts/throws, `buildApp` settles that cleanup scope before rejecting;
- SIGINT/SIGTERM during initialization requests abort and awaits construction settlement/cleanup before releasing runtime singleton ownership;
- listen failure calls the same app shutdown path (`fastify.close()` / runtime close), then DB close, then lock release;
- no new browser/process start is admitted after the abort/shutdown flag is latched.

Do not call `process.exit()` while owned asynchronous cleanup is still intentionally in flight unless bounded shutdown has expired and durable recovery evidence has been written.

## D14 — Automated browser profile quarantine

Keep the existing file lock, but change stale automated recovery semantics.

When an automated lock references a dead controller PID:

1. inspect host Chrome processes for the exact dedicated profile path / `--user-data-dir` ownership;
2. if a matching Chrome is proven alive, refuse acquisition and expose `BROWSER_PROFILE_QUARANTINED` (or equivalent);
3. if no matching Chrome exists and the probe is authoritative, reclaim;
4. if the probe cannot decide, refuse/quarantine rather than unlink blindly.

Interactive external Chrome ownership remains PID-based and already uses the actual spawned PID; preserve that behavior.

## D15 — Recovery/API semantics

Start/retry/resume endpoints that would create a mutating actor must reject with a structured 409 while actor lease/profile ownership is quarantined.

Expose enough status/evidence for the UI/diagnostics to explain:

- prior run/actor ID;
- live vs unknown ownership verdict;
- safe next actions (`retry reconciliation`, `verified kill`, `manual inspection/stop` as implemented).

Do not expose full command lines, secrets, or sensitive environment data.

## D16 — Failure-injection strategy

Build deterministic tests before broad refactoring.

Required crash points include:

1. child spawned before process ownership persistence finishes;
2. controller death with long-running direct executor;
3. controller death with SWARM worker;
4. controller death with DAG worker/staging checkout;
5. validated executor result before dispatch consumption;
6. dispatch/run transition committed before Sol wake delivery;
7. Sol control persisted before application;
8. control/run transition committed before browser operation close;
9. transition intent marked/delivered around each commit boundary;
10. SIGTERM during expired-Sol-operation startup rehydrate;
11. listen failure after app construction/watcher start;
12. PID reused by a foreign process;
13. process probe returns UNKNOWN;
14. automated Chrome survives controller death.

Use subprocess fixtures and real OS process trees where practical. Mocks are acceptable for exhaustive state combinations, but the no-second-writer and verified-kill claims need real child-process evidence on the supported host tier.

## D17 — Performance / retention

The new durable queues are control-plane volume, not log volume. Index by state + created time and repository/run. Bound history retention only after preserving existing audit/ledger requirements.

Avoid polling process probes continuously. Probe on startup reconciliation, explicit recovery, and bounded shutdown/kill paths.

## D18 — Implementation order

1. failure tests for current defects;
2. migration + stores + controller instance ID;
3. process probe + actor lease service;
4. ExecutorRunner/direct executor integration;
5. SWARM/DAG worker/worktree integration;
6. transition inbox/outbox + transaction service;
7. dispatch/control/completion migration;
8. callback ownership;
9. abortable initialization/listen-failure teardown;
10. browser quarantine;
11. status/API diagnostics;
12. full crash matrix, regression gates, bounded stress;
13. docs/spec folding and state handoff.
