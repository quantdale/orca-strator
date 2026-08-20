# Spec: Usage Telemetry & Explicit Scheduler Policy

## ADDED Requirements

### Requirement: Trustworthy usage telemetry

Orca MUST persist usage only when an executor/provider exposes reliable
structured values and MUST preserve partial or unavailable values explicitly.

#### Scenario: A generic CLI completes without usage telemetry

- **WHEN** a generic CLI completes without usage telemetry
- **THEN** the campaign and iteration views SHALL report usage as UNKNOWN and
  SHALL NOT fabricate zero tokens or zero cost.
#### Scenario: A native source reports token counts, latency, retries, or rate limits

- **WHEN** a native source reports token counts, latency, retries, or rate limits
- **THEN** those fields SHALL be persisted with executor/provider/model identity
  and correlation to run, iteration, dispatch, and executor run where known.
#### Scenario: A source reports a cost estimate rather than an exact cost

- **WHEN** a source reports a cost estimate rather than an exact cost
- **THEN** the value SHALL be labeled ESTIMATED and SHALL never be presented as
  exact.
#### Scenario: The provider exposes no reliable value

- **WHEN** the provider exposes no reliable value
- **THEN** the field SHALL remain null/UNKNOWN; Orca SHALL not scrape fragile UI
  output or infer a price.
#### Scenario: The controller restarts

- **WHEN** the controller restarts
- **THEN** persisted usage metrics and their campaign links remain queryable.

### Requirement: Transparent scheduler policy

Orca MUST support explicit scheduler limits without imposing an Orca-wide cap
on ordinary independent repositories by default.

#### Scenario: No user scheduler limits are configured

- **WHEN** no user scheduler limits are configured
- **THEN** independent repository executions SHALL not be queued by an Orca-wide
  scheduler limit.
#### Scenario: A user configures a total/provider/model/repository/resource or spend limit

- **WHEN** a user configures a total/provider/model/repository/resource or spend limit
- **THEN** an admission decision SHALL record whether work was admitted, queued,
  or rejected, the exact limiting dimension, and when it becomes runnable.
#### Scenario: A scheduler decision is reviewed after restart

- **WHEN** a scheduler decision is reviewed after restart
- **THEN** its policy snapshot, reason, request identity, and resolution state
  SHALL remain durable and distinguish stale/recoverable state from success.
#### Scenario: Current V1 single-agent execution is used

- **WHEN** current V1 single-agent execution is used
- **THEN** scheduler foundations SHALL not introduce same-checkout parallel
  writers or silently alter the configured executor flow.

### Requirement: Explicit role/model policy

Orca MUST provide user-authored role/model policy foundations without opaque
automatic model routing.

#### Scenario: A matching explicit role rule exists

- **WHEN** a matching explicit role rule exists
- **THEN** resolution SHALL return exactly that configured executor/model/provider
  and identify the rule as explicit.
#### Scenario: No matching explicit rule exists

- **WHEN** no matching explicit rule exists
- **THEN** resolution SHALL return the repository's configured executor/model
  exactly and identify the repository default.
#### Scenario: Sol or a heuristic requests an unconfigured alternate model

- **WHEN** Sol or a heuristic requests an unconfigured alternate model
- **THEN** Orca SHALL not authorize or silently perform that switch.
