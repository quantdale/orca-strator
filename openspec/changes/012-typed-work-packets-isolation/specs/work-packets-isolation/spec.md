# Spec: Typed Work Packets & Writer Isolation

## ADDED Requirements

### Requirement: Typed work packets

Orca MUST persist versioned structured work packets and result envelopes rather
than piping giant prior-agent transcripts.

#### Scenario: A strategy creates work for a bounded stream

- **WHEN** a strategy creates work for a bounded stream
- **THEN** the packet SHALL include campaign/run/iteration identity, parent
  dispatch, workstream, goal, requirements, allowed/read paths, dependencies,
  executor/model policy, verification expectations, budget, and permission
  policy.
#### Scenario: A worker completes, fails, blocks, is cancelled, or depends on a failed sibling

- **WHEN** a worker completes, fails, blocks, is cancelled, or depends on a
  failed sibling
- **THEN** its result SHALL preserve a typed status, packet identity,
  worktree/branch/commit provenance, files changed, verification, findings,
  risks, artifacts, dependencies affected, usage references, and summary.
#### Scenario: A controller restarts

- **WHEN** a controller restarts
- **THEN** packet/result records remain queryable and correlation IDs are stable.

### Requirement: Isolated writers

Any parallel-capable writer MUST receive a distinct isolated checkout and
persisted lifecycle before it can write.

#### Scenario: Two packets are allocated for one repository

- **WHEN** two packets are allocated for one repository
- **THEN** their worktree paths and internal branch names SHALL be distinct and
  neither writer SHALL use the persistent main checkout.
#### Scenario: A worker or controller crashes

- **WHEN** a worker or controller crashes
- **THEN** persisted ownership/provenance SHALL support stale/orphan recovery;
  dirty worker files SHALL not be discarded automatically.
#### Scenario: A worktree is released

- **WHEN** a worktree is released
- **THEN** clean cleanup MAY occur without force; dirty/unmerged work SHALL stay
  recoverable and the lifecycle SHALL expose that condition.
#### Scenario: Repository environment is WSL

- **WHEN** the repository environment is WSL
- **THEN** Git/worktree commands SHALL use the WSL distribution and Linux path;
  Windows Git behavior SHALL not be inferred as WSL qualification.

### Requirement: Integration and partial failure

Integration MUST be explicit, deterministic, and separate from worker success.

#### Scenario: Completed packets have non-overlapping changes and valid dependencies

- **WHEN** completed packets have non-overlapping changes and valid dependencies
- **THEN** integration SHALL order and apply them to main deterministically,
  followed by an integration result/verification record.
#### Scenario: Completed packets overlap or Git cannot safely apply a commit

- **WHEN** completed packets overlap or Git cannot safely apply a commit
- **THEN** integration SHALL return a structured `INTEGRATION_CONFLICT` blocker,
  abort the in-progress operation safely, and preserve already integrated
  independent siblings.
#### Scenario: One sibling fails or is blocked

- **WHEN** one sibling fails or is blocked
- **THEN** independent successful siblings SHALL remain usable while dependent
  packets become `SKIPPED_DEPENDENCY`; the result SHALL not flatten all work
  into one generic failure.
#### Scenario: Integration finishes

- **WHEN** integration finishes
- **THEN** the structured report SHALL return to the future execution strategy
  and ultimately Sol; it SHALL not mark the high-level campaign goal complete.
