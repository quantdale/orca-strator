# Execution-strategy postflight and concurrency hardening

## ADDED Requirements

### Requirement: Authoritative remote publication

Orca MUST treat a strategy iteration as durably successful only when the
strategy engine reached `COMPLETED` AND required remote publication succeeded
and was verified. A failed/unverified publication SHALL NOT consume the
authorizing dispatch as successful, SHALL NOT send a COMPLETED Sol wake, and
SHALL transition the iteration to a structured retryable postflight/recovery
state that retains strategy/integration/result provenance.

#### Scenario: Engine completed and publication verified

- **WHEN** a strategy run reaches `COMPLETED` and its remote publication is
  `PUBLISHED` with `remoteVerified=true`
- **THEN** Orca SHALL consume the dispatch as successful and wake Sol with a
  COMPLETED result

#### Scenario: Engine completed but publication blocked

- **WHEN** a strategy run reaches `COMPLETED` but remote publication returns
  `BLOCKED` or `remoteVerified=false`
- **THEN** Orca SHALL NOT consume the dispatch as successful, SHALL NOT send a
  COMPLETED Sol wake, and SHALL record durable retryable postflight/recovery
  evidence including the publication blocker

### Requirement: Remote advancement classification

`IntegrationService.publishToRemote` MUST explicitly classify local/remote
main relation as `UP_TO_DATE`, `LOCAL_AHEAD`, `REMOTE_AHEAD`, or `DIVERGED`,
and MUST reconcile `REMOTE_AHEAD` by safely bringing integrated work forward
before writing the result manifest. `DIVERGED` is reconciled only when safe;
otherwise a structured blocker is returned. Force-push and history
discarding are forbidden.

#### Scenario: Remote ahead of integrated local main

- **WHEN** remote main advanced non-conflictingly while the strategy ran and
  local integrated main is behind it
- **THEN** Orca SHALL bring integrated work forward onto the advanced remote
  state before committing/pushing the result manifest

#### Scenario: Diverged unsafe movement

- **WHEN** local and remote main diverged in a way that cannot be reconciled
  safely
- **THEN** Orca SHALL return a structured publication blocker without
  force-push or loss of user work

### Requirement: Post-reconciliation SHA truth

After any reconciliation/rebase, Orca MUST determine and persist the actual
post-reconciliation integrated HEAD, write the result manifest using that
actual final durable SHA, verify that SHA on remote main, and preserve the
original worker commit provenance separately.

#### Scenario: Rebase rewrites integrated SHAs

- **WHEN** reconciliation rebases integrated commits onto advanced remote
  main so their SHAs change
- **THEN** Orca SHALL publish the result manifest with the actual
  post-rebase HEAD and SHALL NOT fail because pre-rebase SHAs are absent from
  remote ancestry

### Requirement: Strategy-owned DAG staging lineage

DAG dependency staging MUST use one strategy-owned integration lineage
derived from the immutable `strategyBaseSha`. Completed nodes integrate into
that lineage; dependent nodes derive their input snapshot from it. Persistent
user main MUST NOT be mutated merely to prepare downstream nodes; only the
final qualified integration/postflight may reconcile persistent main.

#### Scenario: Dependent node derives from staging lineage

- **WHEN** node B depends on node A in a DAG strategy
- **THEN** B's worktree base SHALL equal `strategyBaseSha` plus accepted
  staged dependency commits, without mutating persistent user main

### Requirement: Serialized integration ownership

Worker execution MAY be parallel, but exactly ONE integration operation SHALL
own a strategy's integration lineage at a time. Concurrent worker completions
MUST NOT race cherry-pick/index operations on the same checkout.

#### Scenario: Simultaneous worker completion

- **WHEN** multiple workers complete at the same time
- **THEN** their integrations serialize deterministically without Git
  index-lock failures

### Requirement: Authorized dependency snapshots only

Every DAG node's input snapshot MUST be exactly `strategyBaseSha` plus its
accepted transitive dependency commits, and MUST NOT include unrelated user
main changes, unrelated sibling worker output, later remote changes, or
non-dependency commits. Node base SHA and dependency input SHAs SHALL be
persisted as provenance.

#### Scenario: Non-dependency sibling output invisible

- **WHEN** nodes A -> C exist and independent node B also completes
- **THEN** C's input snapshot SHALL contain A's output and SHALL NOT contain
  B's output unless B is also a declared dependency of C

### Requirement: Movement qualification matrix

Orca MUST qualify, with real deterministic Git tests, remote-main advancement
(non-conflicting and conflicting) during SWARM and DAG strategies, local
persistent main advancement (safe and conflicting), dirty persistent main,
and stale strategy bases. Safe movement reconciles; unsafe movement blocks
truthfully; no case may produce a false COMPLETED Sol wake or force-push.

#### Scenario: Conflicting remote movement during strategy

- **WHEN** remote main advances conflictingly while a strategy runs
- **THEN** Orca SHALL block publication truthfully without losing user work
  and without a COMPLETED Sol wake

### Requirement: Awaited campaign-control synchronization

Campaign pause/resume/stop/kill SHALL be awaited, acknowledged operations:
pause does not mark the campaign `PAUSED` before the strategy reaches its
paused boundary; resume failure does not mark the campaign `EXECUTING`;
stop/kill propagate engine outcomes truthfully. No strategy-control rejection
may be swallowed, and campaign state must never contradict strategy actor
state.

#### Scenario: Pause then immediate resume race

- **WHEN** campaign pause is followed immediately by campaign resume
- **THEN** the resulting campaign and strategy states SHALL remain mutually
  consistent through the whole sequence

### Requirement: Graceful asynchronous shutdown

Normal controller shutdown SHALL stop new strategy admissions, request
worker termination/recovery, await child-process termination within a bounded
grace, persist recovery state, settle completion callbacks, preserve
worktrees, and only then return — so `fastify.close()` followed by database
close requires no extra caller-side settling.

#### Scenario: Shutdown settles active strategy

- **WHEN** a strategy actor is running and the controller shuts down normally
- **THEN** `fastify.close()` alone SHALL leave no orphan children, no
  DB-closed callback errors, and durable recovery evidence for restart

### Requirement: Postflight retry without worker rerun

When workers and integration succeeded and only remote publication failed,
retrying the iteration SHALL retry publication/postflight only — never rerun
model workers — and pending publication state SHALL survive controller
restart.

#### Scenario: Publication retry after restart

- **WHEN** a controller restarts after a publication failure with successful
  workers/integration
- **THEN** Orca SHALL complete the publication retry using persisted
  provenance without spawning new model workers

### Requirement: Clean production artifacts

Production code SHALL NOT contain temporary debug logging, and qualification
test documentation SHALL describe historical bugs explicitly as found-and-
fixed rather than as current blockers.

#### Scenario: Audit for debug artifacts

- **WHEN** production sources and real-tier test headers are audited
- **THEN** no temporary debug prints or contradictory skip instructions
  remain
