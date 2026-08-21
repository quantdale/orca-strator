# Change 017 tasks

## 1. Coordinator + durable strategy selection

- [x] 1.1 Add `strategy` + `executionPlan` to the dispatch marker (JSON + TS), default `SINGLE_AGENT`, preserving legacy V1 dispatches.
- [x] 1.2 Add `dispatchId` + `strategyBaseSha` to `StrategyRunRecord` and migration 22.
- [x] 1.3 Add `IterationExecutionCoordinator` normalizing start/pause/resume/stop/kill/status/completion/recovery.
- [x] 1.4 Add structured `StrategyConflictError` + campaign/iteration ownership boundary shared by the loop and manual strategy APIs.

## 2. Loop routing + ownership

- [x] 2.1 Route `LoopService.onDispatchDetected` through the coordinator; resolve explicit strategy; exactly one path owns the iteration.
- [x] 2.2 Reject starting another strategy/executor while an iteration actor is active.
- [x] 2.3 Close the `/swarm/start` and `/dag/start` concurrency hole via the shared ownership boundary.
- [x] 2.4 Normalize strategy completion into the canonical Orca iteration result; never `GOAL_COMPLETE`.

## 3. Integration hardening

- [x] 3.1 Persist one immutable `strategyBaseSha`; `SWARM` workers branch from it.
- [x] 3.2 `DAG` dependency materialization: dependent node runs against dependencies' accepted output; record dependency input SHAs.
- [x] 3.3 Make integrated `main` durable on remote: reconcile, verify, push, result manifest; no force-push.
- [x] 3.4 Enforce `allowedPaths` after execution (write ownership real); preserve + report violations.

## 4. Controls + shutdown

- [x] 4.1 Compose campaign pause/resume/stop/kill/ceilings with active strategy actors.
- [x] 4.2 Compose Sol control with active strategies; no rogue workers; no `GOAL_COMPLETE` while unauthorized actor active.
- [x] 4.3 Graceful controller shutdown coordinates active strategy workers; no `process.exit` reliance.

## 5. Qualification

- [x] 5.1 Real production `buildApp` autonomous SWARM loop test (dispatch -> swarm -> integration -> remote -> wake).
- [x] 5.2 Real production `buildApp` autonomous DAG loop test with true state dependency A->B.
- [x] 5.3 Real campaign-level controls qualification for SWARM and DAG (via LoopService seam).
- [x] 5.4 Reclassify Change 013/014 qualification truthfully; update state/README/ROADMAP/architecture/runtime/data/api/test docs.

Qualification evidence: `test/real-strategy-loop-swarm.test.ts` (4, incl.
allowedPaths out-of-scope enforcement),
`test/real-strategy-loop-dag.test.ts` (2, incl. falsifiability case),
`test/real-strategy-controls.test.ts` (9) — all under production `buildApp`
with real Git remotes and deterministic real child workers. Authoring these
tests surfaced and fixed six real integration bugs: non-durable dispatch
strategy selection, SWARM-labeled DAG starts, a dead completion bridge, a
missing result-manifest directory, a stale-dependency skip on DAG resume, and
a Windows rev-list range quirk that silently emptied worker `filesChanged`
(also degrading integration overlap/conflict detection).
