# Execution topology UI

## Purpose

Provide a responsive, read-only projection of the durable single-agent,
SWARM, and DAG execution topology without creating a second truth store or a
graph-authoring workflow.

## Requirements

### Requirement: The UI visualizes actual single-agent topology

The repository campaign detail view MUST show the current or latest ordinary
single-agent sequence as `Sol -> dispatch -> executor -> result -> Sol`, using
durable campaign/run/dispatch/executor/timeline evidence. It MUST not label an
executor completion as campaign completion.

#### Scenario: Ordinary campaign has no strategy run

- **WHEN** a campaign detail has ordinary dispatch/executor/result evidence and
  no explicit SWARM or DAG strategy run
- **THEN** the topology panel shows the five logical handoff stages with their
  actual status, timestamps/duration, executor/model/environment, and Git/result
  references where present

#### Scenario: Ordinary campaign has incomplete evidence

- **WHEN** a stage has not yet produced a durable record
- **THEN** the panel shows QUEUED, RUNNING, or UNKNOWN as appropriate and does
  not infer success from a previous stage

### Requirement: The UI visualizes real swarm and DAG topology

When an explicit strategy run exists, the panel MUST show the actual strategy,
packet/node identities, typed statuses, dependencies, controls/retries,
integration state, and structured partial failures from `CampaignDetail`. It
MUST not fabricate workers or collapse independent success into generic failure.

#### Scenario: Swarm has independent workers

- **WHEN** a SWARM report contains packet results and an integration report
- **THEN** the panel shows each actual packet/result, worktree/commit and
  verification references, executor/model identity when available, usage
  references/summary, and the integration outcome

#### Scenario: DAG has dependency waits or conflicts

- **WHEN** a DAG detail contains nodes in `WAITING_DEPENDENCY`,
  `WAITING_PERMISSION`, `RETRYING`, `BLOCKED`, `CANCELLED`, or
  `INTEGRATING`
- **THEN** the panel shows those exact statuses and textual `dependsOn` links,
  including the conflict/blocker, without presenting the DAG as complete

### Requirement: Topology is responsive observability, not authoring

The topology view MUST remain usable at narrow phone-like widths and wider
desktop widths. It MUST use cards/flow/textual dependency evidence and MUST NOT
include drag/drop node editing, graph import, manual packet creation, or graph
authoring controls.

#### Scenario: Phone viewport renders topology

- **WHEN** the campaign detail is viewed in a narrow responsive viewport
- **THEN** stages and worker cards wrap into a readable vertical flow without
  horizontal-only graph interaction

### Requirement: Presets remain explicit policy references

The UI MAY expose reusable Feature Development, Deep Audit, Bug Hunt,
Migration, and Release Hardening presets, but a preset MUST be versioned
configuration/reference data. Preset display MUST preserve `SINGLE_AGENT` as
the default and MUST not automatically decompose goals, select models,
allocate packets, start strategies, or spend inference.

#### Scenario: User views a preset

- **WHEN** a user opens the preset catalog
- **THEN** the UI shows its recommended strategy, boundedness, and packet/node
  requirement with an explicit non-authoring/no-auto-start explanation

### Requirement: Unknown and failure data stay truthful

The topology view MUST show `UNKNOWN` for unavailable usage/cost or missing
optional evidence, distinguish exact from estimated cost, and retain
COMPLETED, PARTIAL, FAILED, BLOCKED, SKIPPED, CANCELLED, and
INTEGRATION_CONFLICT distinctions. It MUST not introduce a GOAL_COMPLETE state
for a worker, strategy, or DAG.

#### Scenario: Usage is unavailable

- **WHEN** a strategy has no trustworthy telemetry
- **THEN** the topology card displays UNKNOWN rather than zero or fabricated
  estimated spend
