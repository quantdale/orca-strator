# Spec: Operational Intelligence & Executor Capabilities

## Requirement: Campaign trace

The controller MUST expose a durable, queryable campaign history using
normalized run, dispatch, executor, Sol, control, and structured event data.

- Scenario: A campaign runs through Sol, dispatch, executor, result, Git, and
  Sol phases.
  - Then campaign detail and timeline APIs SHALL expose repository, campaign,
    iteration, correlation IDs, timestamps, phase durations where available,
    executor/model/environment, verification/result references, retries,
    recovery, controls, ceilings, and classified failure boundaries without
    requiring raw-log parsing.
- Scenario: Two repositories run concurrently.
  - Then each history/read model SHALL contain only its repository's events and
    references.
- Scenario: The controller restarts.
  - Then previously persisted history SHALL remain queryable from SQLite.
- Scenario: A trace event contains credentials or secret-named fields.
  - Then it SHALL pass through the existing redacting EventBus before ledger
    persistence and UI exposure; raw logs remain a separate diagnostic path.

## Requirement: Capability probe

Executor readiness MUST be represented independently from executor brands and
MUST distinguish STATIC, NON_INFERENCE, and explicitly authorized INFERENCE
probe levels.

- Scenario: Settings opens or a GET readiness request is made.
  - Then Orca SHALL perform at most STATIC checks and SHALL NOT silently issue
    a model request.
- Scenario: A NON_INFERENCE probe is requested.
  - Then CLI/version, environment, working directory, Git, and invocation
    readiness SHALL be classified with typed errors where possible and
    persisted.
- Scenario: Kimi, Codex, generic CLI, or deterministic test CLI is configured.
  - Then each SHALL use the same capability contract; unknown optional
    features SHALL be reported as UNKNOWN/NOT_APPLICABLE rather than guessed.
- Scenario: A capability probe cannot check auth or model recognition without
  a real provider request.
  - Then the result SHALL be UNKNOWN, never fabricated READY; INFERENCE SHALL
    require explicit user authorization and remains non-implemented until a
    provider-specific adapter can report trustworthy results.

## Requirement: Capability-aware adapter

The executor adapter contract MUST retain the working generic CLI path while
making optional behavior feature-detected.

- Scenario: An adapter does not support pause, native permissions, usage, or
  session APIs.
  - Then orchestration SHALL use the existing safe fallback or report the
    capability as unsupported; it SHALL not branch on brand names throughout
    the loop engine.
- Scenario: Current Kimi/Codex invocation is used.
  - Then the configured CLI/model SHALL be passed unchanged and current V1
    launch/cancel behavior SHALL remain intact.

## Requirement: Effective phase budgets

Each run MUST persist the effective budget policy captured at run creation.

- Scenario: Repository settings change after a run starts.
  - Then the historical run SHALL retain its original effective policy.
- Scenario: A phase expires.
  - Then the trace/API SHALL distinguish the phase-specific reason, including
    `EXECUTOR_START_TIMEOUT`, `GIT_POSTFLIGHT_TIMEOUT`,
    `SOL_COMPLETION_TIMEOUT`, and `WALL_CLOCK_CEILING` where applicable.
- Scenario: The campaign wall-clock ceiling crosses while an actor is active.
  - Then the existing `DRAINING`/natural completion behavior SHALL remain; the
    actor SHALL NOT be killed by the policy layer.

## Requirement: Autonomy permission policy

The controller MUST provide executor-neutral policy presets and durable
decisions with honest enforcement labels.

- Scenario: A policy evaluates a force-push or dirty-tree discard action.
  - Then the result SHALL be DENY/ORCA_ENFORCED or an absolute invariant
    rejection regardless of preset.
- Scenario: A generic CLI cannot enforce an optional permission.
  - Then the result SHALL be ADVISORY_ONLY or UNSUPPORTED, never falsely claim
    that Orca blocked the executor.
- Scenario: A rule returns ASK.
  - Then Orca SHALL persist an actionable attention decision/event rather than
    hanging indefinitely.
- Scenario: A permission decision is reviewed later.
  - Then it SHALL be linked to repository/run/iteration/action and visible in
    campaign history.
