# Change 014: Optional DAG execution strategy

## Why

Change 013 qualifies explicit bounded swarm execution, but some iterations need
more precise dependency semantics than a flat packet list. Orca needs a small,
durable DAG strategy that can schedule typed packets in topological order while
reusing the already-qualified scheduler, worktree isolation, integration, and
control boundaries.

## Scope

- add versioned DAG node/request/report contracts;
- persist DAG node state and explicit dependencies;
- validate node identity, packet correlation, dependencies, and cycles before
  any worker starts;
- execute DAG nodes through the capability-aware, isolated worker runtime with
  bounded concurrency and packet-level budgets;
- preserve durable pause/stop/kill/restart recovery and partial failure
  semantics;
- expose structured DAG start/detail/control/recovery APIs;
- add deterministic unit, integration, Windows/Git, negative, and restart
  qualification coverage;
- reconcile canonical runtime, API, data, security, and test documentation.

## Explicit non-goals

- no visual workflow/DAG composer;
- no OpenFlow import or compatibility format;
- no change to SINGLE_AGENT as the default;
- no same-checkout concurrent writers;
- no hidden model routing or automatic quota spending;
- no interpretation of DAG completion as GOAL_COMPLETE.

## Exit evidence

Change 014 is complete only when focused and full fast tests, deterministic
qualification, typecheck, build, lint, and diff checks pass, and the DAG
qualification demonstrates cycle rejection, dependency blocking, bounded
isolated execution, integration, partial failure, controls, and restart
recovery. External model/browser credentials remain separately qualified.
