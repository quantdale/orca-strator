# permission-ask-resolution Specification

## Purpose
TBD - created by archiving change 020-permission-ask-resolution-flow. Update Purpose after archive.
## Requirements
### Requirement: Resolution is durably observable

Resolving a permission decision MUST publish a structured
`permission.resolved` event carrying the decision id, repository, run id,
iteration, action, final outcome, enforcement, and resolution timestamp.
Failed resolutions (404 unknown, 409 already-resolved, 422 invalid outcome)
MUST NOT emit the event.

#### Scenario: Successful resolve publishes exactly one event

- **WHEN** a pending actionable decision is resolved through the resolve
  endpoint with a valid outcome
- **THEN** Orca SHALL publish one `permission.resolved` event whose payload
  matches the persisted decision row

### Requirement: Resolution un-sticks an attention-parked campaign

When a resolved decision belonged to a run that is currently parked in
`ATTENTION_REQUIRED`, and no other unresolved actionable decision remains for
that run, Orca MUST transition that run out of `ATTENTION_REQUIRED` and
re-drive it toward Sol review using the existing recovery path. Resolution
MUST NOT contradict an active actor: while the run is executing, reviewing,
draining, or already terminal, resolution records evidence only.

#### Scenario: Last pending ask resolved

- **WHEN** the user resolves the only unresolved actionable decision of a run
  parked in `ATTENTION_REQUIRED`
- **THEN** the run SHALL leave `ATTENTION_REQUIRED`, advance toward Sol
  review, and a failed wake submission SHALL surface through the existing
  Sol-stall machinery instead of silently succeeding

#### Scenario: Other asks still pending

- **WHEN** a resolved decision is one of several unresolved actionable
  decisions for the same run
- **THEN** the run SHALL remain parked until its last unresolved actionable
  decision is resolved

#### Scenario: Actor active during resolution

- **WHEN** a decision is resolved while its run is mid-flight on an active
  executor/strategy or Sol actor
- **THEN** Orca SHALL record the resolution evidence and SHALL NOT force any
  loop transition that contradicts the active actor state

### Requirement: UI resolve controls

The responsive UI SHALL surface each unresolved actionable permission
decision for a repository with explicit ALLOW / ALLOW_ONCE / DENY controls,
invoke the resolve endpoint, display truthful errors for 404 and 409
responses without replacing durable history, and reflect the resulting run
state after refresh.

#### Scenario: User resolves from the panel

- **WHEN** the user picks an outcome for an unresolved actionable decision in
  the operational-intelligence panel
- **THEN** the UI SHALL call the resolve endpoint and, on success, stop
  offering controls for that decision; on 409 it SHALL show the
  already-resolved error while keeping the decision history visible

