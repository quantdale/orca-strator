# Execution-strategy loop integration

## ADDED Requirements

### Requirement: One iteration execution coordinator

Orca MUST expose exactly one authoritative execution actor
(`IterationExecutionCoordinator`) per repository/campaign iteration that
normalizes start, pause, resume, stop/drain, kill, status, completion, and
recovery for the selected execution strategy.

#### Scenario: A dispatch selects a strategy

- **WHEN** the watcher detects a durable dispatch carrying `strategy`
- **THEN** Orca SHALL resolve the explicit strategy and start exactly one
  underlying engine (`SINGLE_AGENT`, `SWARM`, or `DAG`)

#### Scenario: LoopService stays strategy-agnostic

- **WHEN** the loop drives an iteration
- **THEN** Orca SHALL NOT contain brand-specific strategy implementation inside
  `LoopService`; it SHALL delegate to the coordinator

### Requirement: Durable explicit strategy selection

Orca MUST support a durable, explicit execution-strategy selection of
`SINGLE_AGENT`, `SWARM`, or `DAG`, defaulting to `SINGLE_AGENT`, resolved from
the dispatch or explicit run/dispatch policy, never from an opaque heuristic.

#### Scenario: Legacy V1 dispatch

- **WHEN** a dispatch carries no `strategy` field
- **THEN** Orca SHALL resolve it to `SINGLE_AGENT`

#### Scenario: Strategy dispatch references its definition

- **WHEN** a `SWARM` or `DAG` dispatch is detected
- **THEN** Orca SHALL durably reference the typed packet/DAG definition it must
  run and SHALL NOT treat the browser transcript as authoritative

### Requirement: Campaign iteration ownership boundary

Orca MUST reject starting a strategy/executor while an iteration actor is active,
and MUST return a structured conflict when Sol is active without dispatch, a
`SINGLE_AGENT` executor is active, another strategy is active, the run/iteration
does not match, the run is draining/paused/terminal, or the dispatch does not
authorize the strategy.

#### Scenario: Concurrent strategy start rejected

- **WHEN** a strategy start is requested while another executor or strategy owns
  the iteration
- **THEN** Orca SHALL reject it with a structured `StrategyConflictError`

### Requirement: Normalized iteration result

Orca MUST normalize strategy outcomes truthfully into the canonical iteration
result: `COMPLETED` -> next Sol handoff, `PARTIAL` -> `BLOCKED` for review,
`BLOCKED` -> `BLOCKED`, `RECOVERY_REQUIRED` -> recovery state, and SHALL NOT map
strategy completion to `GOAL_COMPLETE`.

#### Scenario: A strategy finishes COMPLETED

- **WHEN** a strategy run reaches `COMPLETED`
- **THEN** Orca SHALL advance the iteration to the next Sol handoff and SHALL
  NOT set `GOAL_COMPLETE`

#### Scenario: A strategy finishes PARTIAL

- **WHEN** a strategy run reaches `PARTIAL`
- **THEN** Orca SHALL surface a structured blocked/strategy-partial result for
  Sol review instead of a successful iteration

### Requirement: Durable remote integration

Orca MUST, after strategy integration, inspect local `main`, fetch remote
`main`, reconcile ordinary non-overlapping advancement, verify integrated
commits, push intended `main`, produce the canonical `.orca` result manifest,
commit/push it per the cross-agent protocol, verify remote `main` contains both
integration and result, and only then mark the iteration durable-complete.

#### Scenario: Unsafe remote movement

- **WHEN** remote or local `main` advanced in a conflicting way during the
  strategy run
- **THEN** Orca SHALL return a structured integration/postflight blocker and
  SHALL NOT force-push or silently accept local-only success

### Requirement: Immutable strategy base SHA

Orca MUST persist one immutable `strategyBaseSha` per strategy run, correlated to
the authorized dispatch/base/remote state, and MUST derive independent workers
from that deterministic snapshot rather than reading mutable `refs/heads/main`
independently per packet.

#### Scenario: Workers of one strategy run

- **WHEN** independent workers of one strategy run are allocated
- **THEN** each SHALL derive from the persisted immutable `strategyBaseSha`
  recorded on the strategy run and worktree provenance

### Requirement: DAG dependency state materialization

Orca MUST ensure a dependent DAG node runs against a deterministic base that
contains its dependencies' accepted output, and MUST record dependency input
SHAs in node and worktree provenance.

#### Scenario: Node B depends on node A

- **WHEN** node B depends on node A and A created/changed code
- **THEN** B SHALL receive A's accepted output and SHALL NOT see unrelated
  sibling changes

### Requirement: allowedPaths enforcement

Orca MUST, after deriving `filesChanged` from Git, validate every changed path
against `packet.allowedPaths`, and on violation SHALL NOT integrate the worker,
SHALL mark it `BLOCKED`/`POLICY_VIOLATION`, SHALL preserve its worktree/branch,
and SHALL report the offending paths. A packet that declares no allowed paths is
unrestricted by declaration; enforcement applies to declared scopes.

#### Scenario: A worker writes outside its declared scope

- **WHEN** a completed worker's Git-derived `filesChanged` contains a path
  outside `packet.allowedPaths`
- **THEN** Orca SHALL NOT integrate that worker, SHALL mark it
  `BLOCKED`/`POLICY_VIOLATION` with the offending paths, and SHALL preserve its
  worktree/branch for inspection

### Requirement: Campaign control composition

Orca MUST operate pause, resume, stop, emergency kill, and wall-clock/iteration
ceilings correctly regardless of whether the active strategy is `SINGLE_AGENT`,
`SWARM`, or `DAG`, and SHALL NOT maintain contradictory campaign and strategy
control planes.

#### Scenario: Campaign pause during a strategy iteration

- **WHEN** the campaign pause control is invoked while a `SWARM` or `DAG`
  strategy actor owns the iteration
- **THEN** Orca SHALL route the decision through the coordinator to the active
  strategy engine and SHALL record the campaign as `PAUSED` with worktrees
  preserved

### Requirement: Sol control with active strategies

Orca MUST reject a stale/invalid Sol control per Change 009, MUST NOT leave rogue
strategy workers alive after a valid terminal Sol control, and SHALL NOT allow
`GOAL_COMPLETE` while an unauthorized execution actor remains active.

#### Scenario: Terminal Sol control with a live strategy actor

- **WHEN** a valid terminal Sol control (for example `GOAL_COMPLETE`) is applied
  while a strategy actor is still active
- **THEN** Orca SHALL terminate/stop that repository's strategy workers through
  the coordinator and SHALL NOT complete the goal while an unauthorized
  execution actor remains active

### Requirement: Graceful controller shutdown

Orca MUST, on normal controller shutdown, stop admitting new workers, mark
active strategy execution for recovery or drain, terminate child processes so
they do not survive controller ownership, preserve worktrees and durable state,
settle callbacks before SQLite closes, and reconstruct deterministically on
restart.

#### Scenario: Controller shuts down mid-strategy

- **WHEN** the controller shuts down normally while a strategy actor is running
- **THEN** Orca SHALL stop admitting new workers, terminate child processes,
  preserve worktrees/durable state, and reconstruct the interrupted strategy as
  `RECOVERY_REQUIRED` deterministically on restart

### Requirement: Standalone strategy API discipline

Orca MAY retain standalone strategy APIs for inspection/advanced execution, but
they MUST NEVER bypass actor ownership, campaign state, strategy authorization,
budgets, permissions, or run/iteration correlation.

#### Scenario: Manual strategy start beside an active actor

- **WHEN** a standalone `/swarm/start` or `/dag/start` request arrives while an
  iteration actor is active
- **THEN** Orca SHALL reject it with the same structured ownership conflict as
  the autonomous loop and SHALL NOT create a second strategy record

### Requirement: Honest qualification classification

Orca MUST distinguish, until the new production-loop tests pass, between
ENGINE MACHINE-QUALIFIED and AUTONOMOUS CAMPAIGN INTEGRATION UNQUALIFIED for
Change 013/014, and SHALL NOT describe the entire post-V1 roadmap as internally
complete before composition passes.

#### Scenario: Status reporting before production-loop qualification

- **WHEN** durable status artifacts (waypoint, README, roadmap, docs) describe
  Changes 013/014 before the new production-loop qualifications pass
- **THEN** Orca SHALL label the strategy engines ENGINE MACHINE-QUALIFIED and
  the autonomous campaign integration AUTONOMOUS CAMPAIGN INTEGRATION
  UNQUALIFIED, and SHALL flip that classification only on real gate evidence
