# Autonomous Loop Engine and Multi-Repository Concurrency Specification

## Purpose

Compose watcher, executor, Git results, and Playwright Sol wakes into a per-repository autonomous state machine loop supporting multi-repository concurrency and operational run controls.
## Requirements
### Requirement: Autonomous state machine progression

The engine SHALL manage the state transitions for each active repository according to the canonical state machine.

#### Scenario: Forward progression loop
- GIVEN an active run in `SOL_REVIEWING`
- WHEN a new valid isolated dispatch is detected on remote `main`
- THEN state transitions to `EXECUTOR_PENDING` and launches the headless executor -> `EXECUTING`
- WHEN the executor completes and publishes a result manifest
- THEN state transitions to `SOL_PENDING`, submits a trusted Sol wake, and transitions to `SOL_REVIEWING`

#### Scenario: Single actor exclusivity per repository
- GIVEN an active run
- WHEN executor is running
- THEN Sol browser bridge is never invoked for that repository until executor completes

---

### Requirement: Multi-repository concurrency

The engine SHALL allow multiple configured repositories to execute their autonomous loops independently and simultaneously without a global concurrency cap.

#### Scenario: Independent concurrent repositories
- GIVEN Repository A is in `EXECUTING` and Repository B is in `SOL_REVIEWING`
- WHEN Repository A finishes and transitions to `SOL_PENDING`
- THEN Repository B's state and execution are unaffected

---

### Requirement: Run controls and terminal state handling

The engine SHALL enforce iteration limits, pause, resume, and stop controls.

#### Scenario: Max iterations ceiling
- GIVEN a run configured with `maxIterations = 5`
- WHEN iteration 5 completes
- THEN state transitions to `DRAINING` or `GOAL_COMPLETE` instead of launching another turn

#### Scenario: Pause and Resume
- GIVEN an active run
- WHEN user requests Pause
- THEN current execution is cleanly stopped and state transitions to `PAUSED`
- WHEN user requests Resume
- THEN state resumes from where it was paused

### Requirement: Sol control closure of a stalled campaign

When a detected Sol control references a run whose status is `SOL_STALLED`,
the engine SHALL resolve the control target in two strict steps: the normal
active run first (via the unchanged active-run query, which excludes
`SOL_STALLED`), and only when no active run exists, the LATEST `SOL_STALLED`
run of the repository — and only when the control's `runId` references that
exact stalled run. A newer active campaign SHALL always win: while any active
run exists, a control referencing an older stalled run SHALL be rejected as a
correlation mismatch without consuming the control or mutating either run.
`SOL_STALLED` SHALL remain excluded from the normal active-run query and
SHALL NOT participate in dispatch reception, executor ownership, strategy
ownership, scheduler admission, wall-clock rehydration, or pause/resume
semantics merely because terminal control reconciliation is supported; the
stalled-closure exception is scoped to Sol-control handling only.

#### Scenario: Matching GOAL_COMPLETE closes the latest stalled run

- **GIVEN** a repository whose latest run is `SOL_STALLED` at iteration N with
  an active dispatch id D
- **WHEN** a detected GOAL_COMPLETE control arrives with `runId` equal to that
  stalled run's id, `iteration = N`, and non-null `relatedDispatchId = D`
- **THEN** the control is consumed, the run transitions to `GOAL_COMPLETE`,
  and it remains excluded from the active-run query

#### Scenario: Newer active campaign protects an older stalled campaign

- **GIVEN** an older stalled run and a newer active run on the same repository
- **WHEN** a detected terminal control referencing the older stalled run
  arrives
- **THEN** the control is rejected as a correlation mismatch, is not consumed,
  the older run remains `SOL_STALLED`, and the newer active run is untouched

### Requirement: Stalled-target decision allowlist

For a control whose resolved target is a `SOL_STALLED` run, only
`GOAL_COMPLETE`, `BLOCKED`, and `NEEDS_HUMAN` MAY be applied. `PAUSED` SHALL
be explicitly rejected for a stalled target, and no executor pause/resume
behavior may be invoked for a stalled campaign. All existing strict controls
SHOULD continue to apply identically: repositoryId match, exact runId match,
iteration equal to the stalled run's `currentIteration`, non-null
`relatedDispatchId` equal to the stalled run's `activeDispatchId`, and
detected/consumed/rejected idempotency.

#### Scenario: PAUSED rejected for a stalled run

- **GIVEN** a repository whose latest run is `SOL_STALLED`
- **WHEN** a detected PAUSED control referencing that exact run arrives
- **THEN** the control is rejected with a stalled-pause reason, the run stays
  `SOL_STALLED`, and no executor pause path runs

#### Scenario: BLOCKED or NEEDS_HUMAN closes the stalled run

- **GIVEN** a repository whose latest run is `SOL_STALLED`
- **WHEN** a detected BLOCKED or NEEDS_HUMAN control with exact correlation
  arrives
- **THEN** the control is consumed and the run transitions to the decision's
  terminal state

#### Scenario: Wrong iteration or relatedDispatchId rejected on the stalled path

- **GIVEN** a repository whose latest run is `SOL_STALLED`
- **WHEN** a detected terminal control referencing the stalled run arrives
  with an iteration other than its `currentIteration`, or a non-null
  `relatedDispatchId` different from its `activeDispatchId`
- **THEN** the control is rejected, is not consumed, and the run stays
  `SOL_STALLED`

### Requirement: No actor resurrection from stalled closure

Applying a terminal control to a `SOL_STALLED` run SHALL NOT submit another
Sol wake, start or resume an executor, start SWARM/DAG execution, acquire
scheduler ownership, re-arm wall-clock execution, or temporarily reclassify
the run through an active state. The transition goes directly from
`SOL_STALLED` to the decision's terminal state.

#### Scenario: Closure submits nothing new

- **GIVEN** a repository whose latest run is `SOL_STALLED`
- **WHEN** a matching terminal control closes the run
- **THEN** no Sol wake submission occurs, no executor/strategy launch occurs,
  and the run's recorded history contains no intermediate active state between
  `SOL_STALLED` and the final terminal state

#### Scenario: Duplicate delivery stays idempotent

- **GIVEN** a terminal control that already closed a stalled run
- **WHEN** the same control is delivered again
- **THEN** the second delivery is a no-op: the control stays consumed once,
  and the run state does not change again

### Requirement: Stalled-boundary lifecycle hygiene

When a run enters `SOL_STALLED`, loop-owned timers for the repository
(wall-clock ceiling timer and busy-backpressure retry timer) SHALL be released.
Closing a stalled run through a terminal control SHALL clear stale drain state
on that run and publish a durable audit event identifying the applied control,
the closed run, the decision, and that the target was a stalled campaign.

#### Scenario: Timers do not outlive the stall

- **GIVEN** a run with an armed wall-clock ceiling timer enters `SOL_STALLED`
- **WHEN** the stall transition completes
- **THEN** no loop-owned wall-clock or busy-retry timer remains armed for the
  repository

#### Scenario: Stalled closure is durably auditable

- **WHEN** a terminal control closes a stalled run
- **THEN** a durable event records the control id, run id, decision, and
  stalled-target flag alongside the state change
