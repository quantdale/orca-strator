# Same-repository swarm

## Purpose

Provide an optional, explicitly enabled same-repository swarm strategy backed
by typed packets, isolated worktrees, bounded scheduling, deterministic
integration, and structured partial results.

## Requirements

### Requirement: Explicit swarm strategy

Orca MUST expose `SWARM` as an explicit opt-in execution strategy for one
campaign iteration, while preserving `SINGLE_AGENT` as the default and leaving
the existing single-agent loop behavior unchanged.

#### Scenario: A user starts a swarm iteration

- **WHEN** an authorized request selects `SWARM`, identifies one campaign/run
  and iteration, supplies typed packet IDs, and supplies a positive worker
  bound
- **THEN** Orca SHALL persist a strategy-run record with deterministic
  campaign/run/iteration correlation and start only those packets

#### Scenario: No strategy is selected

- **WHEN** a repository campaign follows the ordinary V1 dispatch path
- **THEN** Orca SHALL use `SINGLE_AGENT` and SHALL not create same-checkout
  parallel writers

#### Scenario: A request selects an invalid packet set

- **WHEN** a swarm request contains a packet from another campaign/iteration,
  duplicate packet IDs, or a non-positive/overly large concurrency bound
- **THEN** Orca SHALL reject the request without starting a worker

### Requirement: Bounded isolated worker scheduling

Every swarm worker MUST execute in a distinct persisted Change 012 worktree and
internal branch. The strategy MUST enforce its effective concurrency bound and
MUST honor explicit SchedulerService admission decisions.

#### Scenario: Independent packets are runnable

- **WHEN** two or more packets have no unresolved dependencies and the effective
  bound has capacity
- **THEN** Orca SHALL allocate distinct worktrees, admit at most the bound of
  workers, and launch each packet with its authored executor/model policy

#### Scenario: The scheduler limit is reached

- **WHEN** a packet cannot obtain an explicit scheduler admission lease
- **THEN** Orca SHALL persist the queued/rejected decision and limiting
  dimension, SHALL not launch that packet, and SHALL retry only when it becomes
  runnable or the strategy is controlled

#### Scenario: A packet has an unresolved dependency

- **WHEN** a packet depends on a sibling that is not durably `COMPLETED`
- **THEN** Orca SHALL keep it waiting or mark it `SKIPPED_DEPENDENCY` after the
  dependency fails, and SHALL not launch it prematurely

#### Scenario: Two workers are active

- **WHEN** the persistent repository checkout is the integration target
- **THEN** no worker process SHALL use that checkout as its current working
  directory and no two workers SHALL share a worktree

### Requirement: Typed worker lifecycle and policy evidence

Swarm worker lifecycle, effective budget, permission outcome, executor/model
identity, control reason, and trustworthy usage references MUST be represented
by durable packet results/events. Unsupported optional adapter features MUST
degrade to an explicit typed outcome.

#### Scenario: A worker exits successfully with a commit

- **WHEN** the worker exits zero and its isolated branch contains a valid commit
  and changed paths
- **THEN** Orca SHALL persist a `COMPLETED` packet result with worktree/branch/
  base/commit provenance and verification evidence before integration

#### Scenario: A worker exits nonzero or times out

- **WHEN** the child process fails, exceeds its packet budget, or cannot be
  started
- **THEN** Orca SHALL persist `FAILED` or `BLOCKED` with a distinct reason,
  preserve its worktree for recovery, and SHALL not treat the worker as an
  integrated success

#### Scenario: A permission decision asks for attention

- **WHEN** a packet action is `ASK` and the executor cannot continue without a
  user decision
- **THEN** the strategy SHALL persist `WAITING_PERMISSION`/`BLOCKED` evidence
  and an actionable attention state rather than hanging indefinitely

#### Scenario: Usage is unavailable

- **WHEN** the selected adapter exposes no reliable usage metric
- **THEN** the result and campaign views SHALL preserve UNKNOWN usage and SHALL
  not fabricate token counts or cost

### Requirement: Durable controls and restart recovery

Swarm controls MUST be durable, deterministic, and distinct from campaign
completion. Restart reconciliation MUST never discard worker files or infer
success from an orphaned process.

#### Scenario: Pause is requested

- **WHEN** a running strategy receives `PAUSE`
- **THEN** it SHALL stop starting new workers, request adapter pause/cancel for
  active workers, persist the control, and expose a paused strategy state

#### Scenario: Stop is requested

- **WHEN** a running strategy receives `STOP`
- **THEN** queued packets SHALL become `CANCELLED`, active workers SHALL drain
  to a boundary where possible, and the strategy SHALL finish as a stopped or
  partial result without waking Sol as goal-complete

#### Scenario: Emergency kill is requested

- **WHEN** a running strategy receives `KILL`
- **THEN** active workers SHALL be terminated through adapter cancellation,
  results/worktrees SHALL remain recoverable, and the strategy SHALL be marked
  `RECOVERY_REQUIRED` or `CANCELLED` with the kill reason

#### Scenario: The controller restarts

- **WHEN** a strategy has persisted `STARTING`/`RUNNING` packets but no live
  in-memory runner exists
- **THEN** startup recovery SHALL mark those packets and strategy state as
  recovery-required/blocked, call worktree stale/dirty recovery, and preserve
  all provenance for explicit retry or integration

### Requirement: Deterministic integration and partial results

Swarm completion MUST run the qualified integration/reconciliation protocol and
return a structured iteration result to Sol. A worker or swarm result MUST NOT
be interpreted as `GOAL_COMPLETE`.

#### Scenario: Independent workers complete cleanly

- **WHEN** completed packet commits have valid dependencies and non-overlapping
  paths
- **THEN** Orca SHALL integrate them deterministically, persist the integration
  report, and expose the final main commit/result references

#### Scenario: A worker conflict occurs

- **WHEN** completed worker changes overlap or cherry-pick cannot be applied
- **THEN** Orca SHALL preserve already integrated independent siblings, return
  `INTEGRATION_CONFLICT`, safely abort the in-progress Git operation, and retain
  the conflicting worktree/branch provenance

#### Scenario: Siblings partially fail

- **WHEN** one worker is `FAILED`, `BLOCKED`, or `CANCELLED` while independent
  siblings complete
- **THEN** the final report SHALL preserve each typed status, keep usable
  siblings integrated when safe, and return `PARTIAL`/`BLOCKED` to Sol for the
  next campaign action

#### Scenario: Strategy execution finishes

- **WHEN** worker and integration records are finalized
- **THEN** the campaign ledger SHALL expose strategy/worker/integration events,
  durations, controls, scheduler reasons, and result references while the
  enclosing campaign remains under Sol's completion/replanning authority

### Requirement: Structured swarm API and observability

Orca MUST provide REST support to start, inspect, control, and recover an
explicit swarm execution, using structured packets/results rather than raw log
transcripts.

#### Scenario: The UI/API inspects a strategy run

- **WHEN** a client requests the strategy for a campaign/run
- **THEN** the response SHALL include strategy status, effective concurrency,
  packet lifecycle/results, scheduler decisions, controls, integration report,
  and recovery blockers where present

#### Scenario: A client controls a strategy

- **WHEN** a client submits pause, stop, or kill for an existing strategy run
- **THEN** Orca SHALL validate campaign correlation, persist the control, apply
  the corresponding lifecycle semantics, and return the updated structured
  strategy state
