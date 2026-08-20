## 1. Contracts and durable state

- [x] 1.1 Add versioned DAG node/request/report contracts and strategy schema
  support while preserving `SINGLE_AGENT` and `SWARM`.
- [x] 1.2 Add migrations/stores for the `DAG` strategy discriminator and
  durable node lifecycle/dependency/budget state.
- [x] 1.3 Add DAG event/read-model fields to campaign detail without replacing
  existing packet/result truth.

## 2. DAG runtime

- [x] 2.1 Add strict DAG validation: correlation, uniqueness, dependency
  references, packet dependency agreement, and cycle rejection before launch.
- [x] 2.2 Reuse the Change 013 isolated worker engine through a strategy hook;
  implement topological scheduling, bounded concurrency, packet/node budgets,
  and authored executor/model policy.
- [x] 2.3 Persist node lifecycle transitions, scheduler/permission waits,
  typed partial failures, integration state, and final DAG reports.
- [x] 2.4 Implement durable pause/stop/kill, cancellation, and restart/orphan
  recovery with stale worktree preservation.

## 3. API and application wiring

- [x] 3.1 Wire DAG service into buildApp without changing ordinary V1 startup
  or cross-repository concurrency.
- [x] 3.2 Add structured DAG list/start/detail/control/recover REST routes with
  strict repository/run/iteration correlation.
- [x] 3.3 Expose nodes and DAG reports through campaign detail/iteration reads;
  keep topology visualization deferred to Change 016.

## 4. Qualification

- [x] 4.1 Add fast contract/store/validation/topological/negative tests.
- [x] 4.2 Add deterministic real Windows child-process/Git qualification for
  independent/dependent nodes, bounded isolation, integration, conflict and
  partial failure.
- [x] 4.3 Add controls, restart recovery, multi-repository isolation, and
  conditional WSL coverage; never label skipped external tiers green.

## 5. Documentation and checkpoint

- [x] 5.1 Fold the DAG spec and reconcile architecture, runtime, data, API,
  security, observability, UI, and test strategy docs.
- [x] 5.2 Update README, ROADMAP, DECISIONS, and `.agent/state.json` with the
  actual qualification result and preserve explicit opt-in/default behavior.
- [x] 5.3 Run focused and final verification, commit/push Change 014, then
  activate Change 015 and continue only after the DAG foundations are stable.
