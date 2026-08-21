# Change 017 design

## Coordinator seam

`IterationExecutionCoordinator` is the single authoritative execution actor per
repository/campaign iteration. `LoopService` delegates strategy start, strategy
completion, and all campaign controls to it; the manual `/swarm/start` and
`/dag/start` routes also delegate through it. The coordinator resolves the
selected strategy from the durable dispatch and calls exactly one underlying
engine (`ExecutorService` for `SINGLE_AGENT`, `SwarmExecutionService` for
`SWARM`, `DagExecutionService` for `DAG`). `LoopService` therefore contains no
brand-specific strategy implementation.

## Durable strategy selection

The dispatch marker gains optional `strategy` (`SINGLE_AGENT` default) and
`executionPlan` (`packetIds` / `dagNodes`). Legacy V1 dispatches (no `strategy`)
resolve to `SINGLE_AGENT`. A `SWARM`/`DAG` dispatch durably references the typed
packet/DAG definition it must run. The browser transcript is never authoritative.

## Ownership boundary

`coordinator.assertCampaignIterationOwnership(repositoryId, run, opts)` throws a
structured `StrategyConflictError` when: Sol is active without a dispatched
strategy; a `SINGLE_AGENT` executor is active; another strategy is active; the
run/iteration does not match; the run is draining/paused/terminal; or the
dispatch does not authorize the requested strategy. Both the autonomous loop and
the manual strategy APIs acquire this boundary before starting any worker.

## Immutable base + dependency materialization

Each strategy run persists a `strategyBaseSha` correlated to the authorized
dispatch/base/remote state. `SWARM` workers branch from that immutable base.
`DAG` integrates each completed node's commit into local `main` immediately, so a
dependent node is allocated from a deterministic base that already contains its
dependencies' accepted output; the resolved dependency input SHAs are recorded
in node and worktree provenance.

## Normalized iteration result

The coordinator maps `StrategyRunStatus` truthfully into loop state:
`COMPLETED` -> `COMPLETED` (next Sol handoff), `PARTIAL` -> `BLOCKED` (Sol
review), `BLOCKED` -> `BLOCKED`, `RECOVERY_REQUIRED` -> `RECOVERY_REQUIRED`.
Strategy completion never sets `GOAL_COMPLETE`.

## Durable remote integration

After local integration, `IntegrationService.publishToRemote` inspects local
`main`, fetches remote `main`, reconciles ordinary non-overlapping advancement,
writes the canonical `.orca/results/<dispatchId>.json` strategy-result manifest,
commits and pushes `main`, and verifies the remote contains both integration and
result. Unsafe movement yields a structured integration blocker. No force-push,
no reset/discard.

## allowedPaths enforcement

After a worker derives `filesChanged` from Git, every changed path is validated
against `packet.allowedPaths` (write ownership is real enforcement). A violation
marks the packet `BLOCKED`/`POLICY_VIOLATION`, is not integrated, preserves its
worktree/branch, and reports the offending paths. `readPaths` remain advisory
and are labeled honestly. A packet declaring no allowed paths stays unrestricted
by declaration, preserving Change 012 packet compatibility.

## Controls + Sol

Campaign pause/resume/stop/emergency-kill and wall-clock/iteration ceilings
route through the coordinator to the active strategy engine, preserving
partial work and worktrees. A valid terminal Sol control never leaves rogue
strategy workers alive. `GOAL_COMPLETE` is rejected while an unauthorized actor
is active.
