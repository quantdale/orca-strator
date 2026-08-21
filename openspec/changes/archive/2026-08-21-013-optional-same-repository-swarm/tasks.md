## 1. Strategy contracts and durable state

- [x] 1.1 Add shared `SINGLE_AGENT`/`SWARM` strategy, worker lifecycle,
  control, and structured swarm report schemas with correlation validation.
- [x] 1.2 Add SQLite migration and store for strategy runs and durable
  pause/stop/kill/recovery controls without changing existing V1 run rows.
- [x] 1.3 Add swarm event types and campaign-ledger/read-model exposure for
  strategy, worker, scheduler, control, and integration phases.

## 2. Worker execution service

- [x] 2.1 Add explicit `SwarmExecutionService` start/inspect lifecycle with
  packet-set validation, bounded dependency-aware scheduling, and no default
  activation from the single-agent loop.
- [x] 2.2 Reuse capability-aware adapters and `ExecutorRunner` through profile
  construction; preserve authored executor/model policy and add only a
  deterministic local worker harness profile.
- [x] 2.3 Allocate isolated worktrees, persist packet status/result/provenance,
  collect changed paths/commits/verification, capture trustworthy usage, and
  release only clean worktrees.
- [x] 2.4 Integrate explicit SchedulerService admission/release, packet budgets,
  permission outcomes, and transparent queued/rejected reasons.
- [x] 2.5 Implement pause, graceful stop, emergency kill, cancellation,
  recovery, and stale/dirty worktree reconciliation semantics.

## 3. API and application wiring

- [x] 3.1 Wire strategy store/service into `buildApp` without changing ordinary
  V1 campaign startup or cross-repository concurrency behavior.
- [x] 3.2 Add structured REST endpoints to start, inspect, control, and recover
  a swarm execution with strict repository/run/iteration correlation.
- [x] 3.3 Expose strategy reports through campaign detail/iteration APIs where
  useful, retaining raw logs separately and never using transcripts as truth.

## 4. Qualification and negative paths

- [x] 4.1 Add fast unit/integration tests for schemas, lifecycle persistence,
  dependency scheduling, explicit bounds, scheduler queueing, and restart
  recovery.
- [x] 4.2 Add deterministic real Windows child-process/Git qualification for
  two isolated workers, integration, partial failure, conflict, and controls.
- [x] 4.3 Add conditional WSL worker routing coverage and honestly report it
  unqualified when Ubuntu/node/git is unavailable; add multi-repository
  isolation evidence and no-shared-checkout assertions.

## 5. Documentation and checkpoint

- [x] 5.1 Fold the accepted swarm capability into canonical OpenSpec and update
  architecture, runtime, data model, API, observability, security, UI, and test
  strategy documentation.
- [x] 5.2 Reconcile README, ROADMAP, DECISIONS, and `.agent/state.json` with
  the actual qualification result and preserve the single-agent default.
- [x] 5.3 Run focused and final verification, mark all tasks complete, commit
  and push Change 013, then activate Change 014 only if swarm qualification
  passes.
