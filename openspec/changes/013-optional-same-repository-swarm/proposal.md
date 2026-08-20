## Why

Change 012 qualified the durable packet, worktree, and integration primitives
needed to isolate writers safely. Orca can now offer bounded same-repository
parallel execution as an explicit opt-in without weakening the V1 single-agent
default or making a worker's completion equivalent to campaign completion.

## What Changes

- Add an explicit `SWARM` execution strategy alongside the existing
  `SINGLE_AGENT` strategy.
- Schedule independent typed work packets with bounded, transparent
  concurrency and the existing optional scheduler policy.
- Run every worker in a persisted temporary Git worktree/internal branch and
  reconcile worker results through the qualified integration service.
- Persist strategy, worker, control, recovery, budget, permission, and usage
  outcomes with deterministic campaign/run/iteration correlation.
- Preserve partial success and typed worker failures, and return one structured
  iteration result to Sol for the next campaign decision.
- Add deterministic child-process qualification before any real provider smoke;
  do not make swarm mandatory, automatic, or model-routing aware.

## Capabilities

### New Capabilities

- `same-repository-swarm`: Explicit, bounded, isolated swarm execution for one
  Orca iteration with durable worker and integration results.

### Modified Capabilities

<!-- No existing requirement changes; Change 012's isolation and integration
     requirements remain the governing safety contract. -->

## Impact

- Shared execution-strategy and swarm result contracts.
- Controller persistence, scheduler admission, worker runner, recovery, and
  REST endpoints.
- Existing executor profiles gain a deterministic test-worker profile while
  generic CLI/Kimi/Codex behavior remains unchanged.
- Real local Git/child-process qualification and focused failure/control tests.
- Runtime and API documentation; no visual graph authoring UI.
