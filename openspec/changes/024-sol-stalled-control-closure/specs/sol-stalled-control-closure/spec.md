# Delta spec: sol-stalled-control-closure

## ADDED Requirements

### Requirement: Git-truthful terminal closure after SOL_STALLED

Orca SHALL allow a durable Sol-control marker to terminally reconcile the latest `SOL_STALLED` campaign when browser transport failed before the decision could be applied, without reclassifying that campaign as active or reviving any execution actor.

A stalled campaign SHALL be eligible as a Sol-control target only when there is no currently active campaign for the repository, the stalled campaign is the repository's latest run, and the durable control identifies that exact run.

#### Scenario: GOAL_COMPLETE arrives after terminal wake transport failure

- **GIVEN** the latest campaign for a repository is `SOL_STALLED`
- **AND** no newer active campaign exists
- **WHEN** the watcher detects a `GOAL_COMPLETE` Sol-control marker whose repository, run, iteration, and optional related dispatch strictly match the stalled campaign
- **THEN** Orca consumes the control and transitions that campaign directly to `GOAL_COMPLETE`
- **AND** no executor, strategy worker, scheduler lease, or new Sol wake is started

#### Scenario: BLOCKED or NEEDS_HUMAN arrives after stall

- **GIVEN** the latest campaign is `SOL_STALLED` and no newer active campaign exists
- **WHEN** a strictly correlated `BLOCKED` or `NEEDS_HUMAN` control is detected
- **THEN** Orca consumes the control and applies that terminal decision directly

### Requirement: SOL_STALLED remains outside active ownership

`SOL_STALLED` SHALL remain excluded from the normal active-run query and SHALL NOT participate in dispatch reception, executor ownership, strategy ownership, scheduler admission, wall-clock rehydration, or pause/resume semantics merely because terminal control reconciliation is supported.

#### Scenario: Stalled run is not active

- **WHEN** a campaign enters `SOL_STALLED`
- **THEN** `RunStore.getActiveRun(repositoryId)` does not return that campaign
- **AND** the exception used for terminal Sol-control reconciliation is scoped to control handling only

### Requirement: Newer campaigns protect historical stalled state

If a newer campaign is active for the repository, that campaign SHALL remain the sole Sol-control validation target. A late control that references an older `SOL_STALLED` campaign SHALL be rejected and SHALL NOT mutate either campaign.

#### Scenario: Late control after a new run starts

- **GIVEN** campaign A is `SOL_STALLED`
- **AND** campaign B was started later and is active
- **WHEN** a Sol-control marker referencing campaign A is detected
- **THEN** the control is rejected as stale/wrong-run
- **AND** campaign A remains `SOL_STALLED`
- **AND** campaign B remains unchanged

### Requirement: Stalled closure preserves strict correlation and decision safety

Terminal reconciliation from `SOL_STALLED` SHALL retain the existing Sol-control idempotency and correlation contract. The control MUST exist in `detected` status, match repository, run, current iteration, and optional active dispatch. `PAUSED` SHALL NOT be accepted as a closure decision for a stalled campaign.

#### Scenario: PAUSED cannot be applied to a stalled campaign

- **GIVEN** the latest campaign is `SOL_STALLED`
- **WHEN** a strictly correlated `PAUSED` control is detected
- **THEN** Orca rejects the control and leaves the campaign `SOL_STALLED`

#### Scenario: Wrong iteration stays rejected

- **GIVEN** the latest campaign is `SOL_STALLED`
- **WHEN** a terminal control references a different iteration
- **THEN** Orca rejects the control and leaves campaign state unchanged

#### Scenario: Wrong related dispatch stays rejected

- **GIVEN** the latest campaign is `SOL_STALLED` with an active dispatch recorded
- **WHEN** a terminal control carries a different non-null `relatedDispatchId`
- **THEN** Orca rejects the control and leaves campaign state unchanged

#### Scenario: Duplicate control is idempotent

- **WHEN** an already consumed or rejected stalled-run control is delivered again
- **THEN** Orca performs no second state transition and preserves the recorded audit status
