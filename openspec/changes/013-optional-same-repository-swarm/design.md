## Context

Orca's hardened V1 loop still runs one executor in the persistent repository
checkout. Change 012 added and qualified typed work packets, persisted
worktree/internal-branch ownership, deterministic integration, and typed
partial-failure results. Those primitives are the only safe base for
same-repository parallelism.

The swarm strategy is an optional intra-iteration execution strategy. It is
not a replacement for the campaign loop: Sol still owns decomposition/choice
of strategy and reviews the final structured iteration result before deciding
whether to dispatch again or finish the goal.

## Goals / Non-Goals

**Goals:**

- Make `SWARM` an explicit, persisted strategy for one campaign iteration.
- Schedule only user/Sol-authored typed packets, with bounded concurrency and
  transparent scheduler admission decisions.
- Run each worker in its own Change 012 worktree and collect durable packet
  results, usage references, permissions, and failure/control evidence.
- Integrate through the existing deterministic reconciliation service and
  preserve usable independent successes.
- Support restart reconciliation and pause/stop/emergency-kill semantics
  without corrupting main or losing dirty worker work.
- Qualify the strategy with deterministic local child processes before any
  expensive real-provider smoke.

**Non-Goals:**

- No automatic swarm selection; `SINGLE_AGENT` remains the default.
- No unrestricted same-checkout writers, force-push, destructive worktree
  cleanup, or hidden model/provider routing.
- No visual graph composer, DAG semantics, remote collaboration, or OpenCode
  dependency in this change.
- No claim that an integrated worker result is `GOAL_COMPLETE`.

## Decisions

### Explicit strategy boundary

Introduce a shared `ExecutionStrategy` contract with `SINGLE_AGENT` and
`SWARM`. The existing LoopService continues to use its current single-agent
path. A new SwarmExecutionService is invoked only by an explicit strategy API
request carrying a packet set and a positive concurrency bound.

### Durable strategy run and control records

Add a small normalized strategy-run table and append-only strategy-control
records. Packet/result/worktree/integration records remain the detailed source
of truth; the strategy row is a lifecycle/read-model anchor rather than a
duplicate event table. Strategy events enter the existing campaign ledger and
are redacted by the existing EventBus path.

### Bounded worker scheduler

Use a per-strategy in-process scheduler with `maxConcurrency` as the effective
worker bound. Each runnable packet must also obtain an explicit SchedulerService
admission lease. The default scheduler policy remains unlimited, and a queued
admission is recorded rather than bypassed. Dependency readiness is evaluated
from typed packet results; dependent packets do not start early.

### Adapter/profile reuse

Workers use the existing capability-aware `ExecutorAdapter` and
`ExecutorRunner`. Invocation construction stays in executor profiles. Generic
CLI, Kimi, and Codex profiles remain unchanged; a deterministic test profile
is added only for local qualification. The orchestration service never branches
on provider brands or silently changes a packet's executor/model.

### Result collection and integration

Worker exit is converted into a typed `WorkPacketResult` using the persisted
worktree provenance, branch HEAD, changed paths, exit/control reason, and
verification evidence. Results are persisted before integration. The existing
IntegrationService performs dependency ordering, overlap detection, cherry-pick
and safe abort. The strategy report contains worker outcomes and the final
integration report, and is never mapped to a campaign terminal success state.

### Control and recovery

`pause` stops starting new workers and pauses active runners; `stop` drains
active workers and cancels queued work; `kill` cancels active workers
immediately and leaves worktrees/results recoverable. The durable control record
is authoritative after restart. Active packet leases without a live runner are
marked `BLOCKED`/recovery-required and worktrees are passed to Change 012's
stale/dirty recovery rather than deleted.

## Risks / Trade-offs

- [A provider may not commit worker changes] → record a typed FAILED/BLOCKED
  result and retain the worktree; integration requires commit provenance.
- [A worker process can outlive controller memory] → persist active strategy
  state, reconcile active packets on restart, and never claim completion from a
  missing process.
- [A low concurrency bound can make a strategy slow] → expose the effective
  bound and scheduler reason in API/events; do not adapt it opaquely.
- [Parallel branches can conflict] → deterministic packet ordering and
  IntegrationService overlap/cherry-pick blockers preserve partial success.
- [Real provider credentials may be absent] → deterministic harness tests are
  the machine qualification; external inference remains explicitly
  UNQUALIFIED.

## Migration Plan

1. Add shared strategy/report contracts and a durable migration that is
   backward-compatible with existing runs.
2. Add the worker service, profile seam, API, ledger events, and deterministic
   tests while leaving the V1 loop untouched.
3. Qualify Windows child-process/worktree execution, partial failure,
   cancellation, restart recovery, and scheduler admission. Exercise WSL
   routing through existing qualified worktree/adapter paths where available.
4. Mark the change machine-qualified only when the real local tier passes.
   Rollback is a code/database migration rollback before any swarm strategy run
   is enabled; existing single-agent campaigns remain usable throughout.

## Open Questions

- Native provider session resume and rich usage remain adapter capabilities for
  later changes; this strategy does not invent them.
- DAG dependency authoring is intentionally deferred to Change 014 and must
  reuse this service's isolation/control seams.
