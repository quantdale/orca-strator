# Spec: Operational Intelligence & Executor Capabilities

## ADDED Requirements

### Requirement: Campaign trace

The controller MUST expose a durable, queryable campaign history using existing
run/dispatch/result/control data and structured event references.

#### Scenario: A campaign runs through Sol, dispatch, executor, result, Git, and Sol phases

- **WHEN** a campaign runs through Sol, dispatch, executor, result, Git, and Sol phases
- **THEN** its API detail and timeline SHALL expose repository, campaign/run,
  iteration, correlation IDs, timestamps, phase, durations where available,
  executor/model/environment, verification/result references, retries,
  recovery, controls, ceilings, and classified failure boundaries without
  requiring raw-log parsing.
#### Scenario: Two repositories run concurrently

- **WHEN** two repositories run concurrently
- **THEN** each history/read model SHALL contain only its repository's events
  and references.
#### Scenario: The controller restarts

- **WHEN** the controller restarts
- **THEN** previously persisted history SHALL remain queryable.

### Requirement: Capability probe

Executor readiness MUST be represented independently from executor brands and
MUST distinguish STATIC, NON_INFERENCE, and explicitly authorized INFERENCE
probe levels.

#### Scenario: Settings opens or a GET readiness request is made

- **WHEN** Settings opens or a GET readiness request is made
- **THEN** Orca SHALL perform at most STATIC checks and SHALL NOT silently issue
  a model request.
#### Scenario: A NON_INFERENCE probe is requested

- **WHEN** a NON_INFERENCE probe is requested
- **THEN** CLI/version, environment, working directory, Git, and invocation
  readiness SHALL be classified with typed errors where possible and persisted.
#### Scenario: A supported executor is configured

- **WHEN** Kimi, Codex, generic CLI, or deterministic test CLI is configured
- **THEN** each SHALL use the same capability contract; unknown optional
  features SHALL be reported as UNKNOWN/NOT_APPLICABLE rather than guessed.
#### Scenario: A capability probe cannot check auth or model recognition

- **WHEN** a capability probe cannot check auth or model recognition without a
  real provider request
- **THEN** the result SHALL be UNKNOWN/NOT_RUN, never fabricated READY.

### Requirement: Capability-aware adapter

The executor adapter contract MUST retain the working generic CLI path while
making optional behavior feature-detected.

#### Scenario: An adapter does not support optional features

- **WHEN** an adapter does not support pause, native permissions, usage, or
  session APIs
- **THEN** orchestration SHALL use the existing safe fallback or report the
  capability as unsupported; it SHALL not branch on brand names throughout the
  loop engine.
#### Scenario: Current Kimi/Codex invocation is used

- **WHEN** current Kimi/Codex invocation is used
- **THEN** the configured CLI/model SHALL be passed unchanged and current V1
  launch/cancel behavior SHALL remain intact.

### Requirement: Effective phase budgets

Each run MUST persist the effective budget policy captured at run creation.

#### Scenario: Repository settings change after a run starts

- **WHEN** repository settings change after a run starts
- **THEN** the historical run SHALL retain its original effective policy.
#### Scenario: A phase expires

- **WHEN** a phase expires
- **THEN** the trace/API SHALL distinguish the phase-specific reason, including
  `EXECUTOR_START_TIMEOUT`, `GIT_POSTFLIGHT_TIMEOUT`,
  `SOL_COMPLETION_TIMEOUT`, and `WALL_CLOCK_CEILING` where applicable.
#### Scenario: The campaign wall-clock ceiling crosses while an actor is active

- **WHEN** the campaign wall-clock ceiling crosses while an actor is active
- **THEN** Change 009's `DRAINING`/natural completion behavior SHALL remain;
  the actor SHALL NOT be killed by the policy layer.

### Requirement: Autonomy permission policy

The controller MUST provide executor-neutral policy presets and durable
decisions with honest enforcement labels.

#### Scenario: A policy evaluates a force-push or dirty-tree discard action

- **WHEN** a policy evaluates a force-push or dirty-tree discard action
- **THEN** the result SHALL be DENY/ORCA_ENFORCED or an absolute invariant
  rejection regardless of preset.
#### Scenario: A generic CLI cannot enforce an optional permission

- **WHEN** a generic CLI cannot enforce an optional permission
- **THEN** the result SHALL be ADVISORY_ONLY or UNSUPPORTED, never falsely claim
  that Orca blocked the executor.
#### Scenario: A rule returns ASK

- **WHEN** a rule returns ASK
- **THEN** Orca SHALL persist an actionable attention decision/event rather than
  hanging indefinitely.
#### Scenario: A permission decision is reviewed later

- **WHEN** a permission decision is reviewed later
- **THEN** it SHALL be linked to repository/run/iteration/action and visible in
  campaign history.
