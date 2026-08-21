# Change 017: Execution-strategy loop integration

## Why

Changes 010-016 built the `SINGLE_AGENT`, `SWARM`, and `DAG` execution
strategies as separate subsystems. `SWARM` and `DAG` are currently reachable
only through manual REST endpoints (`/swarm/start`, `/dag/start`) that operate
beside the ordinary campaign actor, and `LoopService` has no knowledge of them.
There is no single authoritative execution actor per iteration, no durable
strategy selection, no shared ownership boundary, no deterministic integration
onto remote `main`, no real `allowedPaths` enforcement, and no dependency-state
materialization for DAG. The post-V1 roadmap is therefore not genuinely
machine-qualified for autonomous campaign integration of these strategies.

This change finishes composing the already-built strategies into Orca's
canonical autonomous campaign loop so that exactly one execution strategy
(`SINGLE_AGENT` / `SWARM` / `DAG`) owns each iteration, durably, with the same
actor-ownership, control, budget, recovery, and Git-truth guarantees as V1.

## Scope

- introduce exactly one `IterationExecutionCoordinator` that normalizes
  start/pause/resume/stop/kill/status/completion/recovery across strategies;
- make execution-strategy selection durable and explicit via the dispatch
  marker (default `SINGLE_AGENT`; old V1 dispatches resolve to `SINGLE_AGENT`);
- route `LoopService.onDispatchDetected` through the coordinator so exactly one
  strategy path owns the iteration;
- close the manual `/swarm/start` and `/dag/start` concurrency hole by routing
  them through the same campaign/iteration ownership boundary;
- normalize strategy completion into a canonical Orca iteration result
  (never `GOAL_COMPLETE`);
- make integrated `main` durable on the remote (reconcile, never force-push);
- persist one immutable `strategyBaseSha` per strategy run and use it as the
  deterministic worker base;
- materialize DAG dependency state so a dependent node runs against its
  dependencies' accepted output;
- enforce `allowedPaths` after execution (write ownership is real enforcement);
- compose campaign controls (pause/resume/stop/kill/ceilings) and Sol control
  with active strategy actors;
- coordinate active strategy workers on graceful controller shutdown;
- harden integration against remote/local `main` movement;
- qualify the actual autonomous SWARM and DAG loops end-to-end with production
  `buildApp` wiring and a real remote;
- preserve the standalone strategy APIs as inspection/advanced paths that never
  bypass ownership, campaign state, authorization, budgets, permissions, or
  run/iteration correlation.

## Explicit non-goals

- no new product features beyond composing existing subsystems;
- no visual composer;
- no hidden routing or opaque strategy heuristics;
- no change to `SINGLE_AGENT` as the default;
- no making OpenCode mandatory;
- no mapping strategy completion to `GOAL_COMPLETE` (Sol remains authority).

## Exit evidence

Change 017 is complete only when the new production-loop SWARM and DAG
qualification tests pass along with focused/full fast tests, `npm run test:real`,
`npm run typecheck`, `npm run build`, `npm run lint`, strict OpenSpec validation,
and `git diff --check`. Real ChatGPT-authenticated wake, Tailscale phone route,
real Kimi/Codex inference, and an authorized OpenCode server remain honestly
UNQUALIFIED where absent.
