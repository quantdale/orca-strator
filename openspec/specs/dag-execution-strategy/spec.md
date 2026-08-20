# DAG execution strategy

## Purpose

Provide an optional, explicitly authored DAG execution strategy for one
campaign iteration while preserving isolated writers, bounded scheduling,
durable integration, partial failure semantics, and Sol-owned completion.

## Requirements

### Requirement: Explicit validated DAG strategy

Orca MUST expose `DAG` as an optional intra-iteration execution strategy while
keeping `SINGLE_AGENT` the default and preserving the explicit `SWARM` strategy.

#### Scenario: A valid DAG is selected

- **WHEN** an authorized request supplies unique node IDs, typed packet IDs,
  explicit dependencies, one campaign/run/iteration, and a positive bounded
  concurrency value
- **THEN** Orca SHALL persist a correlated `DAG` strategy run and node records
  before starting any worker

#### Scenario: A DAG definition is invalid

- **WHEN** a request contains duplicate node/packet IDs, an unknown
  dependency, a packet from another run/iteration/repository, a dependency
  mismatch, or a cycle
- **THEN** Orca SHALL reject it without allocating a worktree or launching an
  executor

#### Scenario: Ordinary campaign execution is unchanged

- **WHEN** no intra-iteration strategy is explicitly selected
- **THEN** Orca SHALL continue through `SINGLE_AGENT` and SHALL NOT create a
  DAG or swarm run

### Requirement: Topological bounded isolated execution

Every runnable DAG node MUST execute through a distinct persisted Change 012
worktree/branch, explicit SchedulerService admission, the authored packet
executor/model, and the effective packet budget. At most the strategy bound
may be active, and dependency-ready nodes SHALL be scheduled without requiring
unrelated repositories to wait.

#### Scenario: Independent nodes are ready

- **WHEN** two independent nodes are ready and the bound has capacity
- **THEN** Orca SHALL admit and launch them in distinct worktrees while keeping
  the persistent main checkout out of worker working directories

#### Scenario: A node waits on a dependency

- **WHEN** a dependency has not completed successfully
- **THEN** the node SHALL remain `WAITING_DEPENDENCY` and SHALL NOT launch

#### Scenario: A dependency fails

- **WHEN** a node dependency is `FAILED`, `BLOCKED`, `CANCELLED`, or `SKIPPED`
- **THEN** Orca SHALL mark the dependent node `SKIPPED` with a durable reason
  and SHALL leave independent siblings usable

#### Scenario: A scheduler or permission boundary blocks a node

- **WHEN** scheduler admission queues/rejects a node or permission evaluation
  returns `ASK`/`DENY`
- **THEN** Orca SHALL persist the limiting reason and expose
  `WAITING_PERMISSION`/`BLOCKED` or a transparent queued state without hanging

### Requirement: Durable DAG node lifecycle and budgets

Orca MUST persist node lifecycle, dependency identity, packet budget snapshot,
timestamps, result references, and distinct failure/control reasons. Node and
strategy completion MUST remain distinct from campaign `GOAL_COMPLETE`.

#### Scenario: A node completes

- **WHEN** its isolated worker exits successfully with a valid commit/result
- **THEN** Orca SHALL persist `COMPLETED` with packet result/provenance before
  integration and expose the node's executor/model and verification evidence

#### Scenario: A node fails or exceeds budget

- **WHEN** its executor fails, cannot start, or exceeds its packet watchdog
- **THEN** Orca SHALL persist `FAILED` or `BLOCKED` with a distinct reason and
  retain its worktree provenance for recovery

#### Scenario: Integration runs

- **WHEN** worker results are ready for reconciliation
- **THEN** affected nodes SHALL be observable as `INTEGRATING`, the existing
  deterministic integration protocol SHALL run, and the final report SHALL
  preserve integration conflict/partial outcomes

### Requirement: Durable controls and restart recovery

DAG pause, stop, kill, cancellation, and restart recovery MUST use the durable
strategy controls and worktree recovery semantics already qualified for swarm.

#### Scenario: A DAG is paused or stopped

- **WHEN** a user submits `PAUSE` or `STOP`
- **THEN** Orca SHALL persist the decision, stop new admission, apply the
  adapter control where possible, and expose paused/cancelled/partial node
  states without treating the iteration as goal-complete

#### Scenario: A DAG is emergency-killed

- **WHEN** a user submits `KILL`
- **THEN** active workers SHALL be terminated through the adapter path, active
  worktrees SHALL remain recoverable, and the strategy SHALL be
  `RECOVERY_REQUIRED` with typed node evidence

#### Scenario: The controller restarts during a DAG

- **WHEN** a persisted DAG has active nodes but no in-memory runner
- **THEN** startup recovery SHALL mark nodes blocked/recovery-required, mark
  worktrees stale where applicable, and preserve paths/branches for explicit
  retry or inspection

### Requirement: Structured DAG API and Sol result boundary

Orca MUST expose structured DAG list/start/detail/control/recovery APIs and
return a typed final strategy result to Sol. No DAG result SHALL directly set
the enclosing campaign to `GOAL_COMPLETE`.

#### Scenario: A client inspects a DAG

- **WHEN** it requests a campaign DAG detail
- **THEN** the response SHALL include strategy status, node/dependency states,
  packet results, controls, integration, scheduler references, and blockers

#### Scenario: DAG execution finalizes

- **WHEN** all runnable nodes and integration are finalized or the strategy is
  blocked/partial/cancelled
- **THEN** the campaign ledger SHALL expose the DAG trace and the structured
  result SHALL return to Sol for the next campaign action

#### Scenario: No visual composer is added

- **WHEN** the DAG capability is delivered
- **THEN** users SHALL still be able to use repository + goal with
  `SINGLE_AGENT`, and no UI graph-authoring workflow SHALL be required
