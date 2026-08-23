# Change 024 design — Sol control closure for stalled campaigns

## Context

`LoopService.onControlDetected` (apps/controller/src/loop/loop-service.ts) is
the single application point for durable Sol control markers. Its current
shape:

1. fetch the durable `SolControlRecord`;
2. resolve the target through `RunStore.getActiveRun(repositoryId)` — which
   excludes every terminal/problem state including `SOL_STALLED`;
3. idempotency: consumed/rejected controls return untouched;
4. strict validation (`validateSolControl`) against the active run;
5. GOAL_COMPLETE execution-actor guard;
6. close the Sol browser operation, consume the control;
7. drain-boundary handling; apply the decision (PAUSED additionally invokes
   the executor pause path).

The Phase-10 dogfood defect: step 2 returns null for a stalled run, so step 4
rejects with `no active run for repository` and a perfectly correlated
GOAL_COMPLETE can never close the campaign.

## Decisions

### Two-step target resolution, active-first (requirement)

- Step 2 stays first and unchanged: `getActiveRun()` semantics are frozen.
  Every other caller of `getActiveRun()` keeps its exact behavior; SOL_STALLED
  is NOT made active globally.
- Only when the active resolution is null do we consult a new
  `RunStore.getLatestStalledRun(repositoryId)` (latest run with
  `status = 'SOL_STALLED'`, ordered by `started_at DESC`). The stalled
  fallback requires `control.runId === stalledRun.id` — the control must
  reference that exact run, not merely "any stalled run".
- Newer-campaign protection falls out structurally: any active run short-
  circuits the fallback, so a late control for an older stalled campaign is
  validated against the newer active run's correlation and rejected as a
  mismatch without consuming anything or mutating either run.

### Validation refactor, not duplication

`validateSolControl` gains two parameters: the resolved `targetRun` (active OR
stalled) and a `targetIsStalled` flag. All existing checks stay identical for
the active path:

- strategy actor still running → reject;
- missing record / non-detected status → reject;
- repositoryId mismatch → reject;
- no target run → reject (same reason string as today);
- runId mismatch against target → reject;
- iteration !== target.currentIteration → reject;
- non-null relatedDispatchId !== target.activeDispatchId → reject.

Stalled-only additions inside the same function:

- `decision === 'PAUSED'` → explicit rejection
  (`SOL_STALLED_PAUSE_UNSUPPORTED`); this also guarantees the executor pause
  path can never be reached for a stalled campaign, because PAUSED never
  survives validation on that path.
- exact-match requirement `control.runId === target.id`.

The GOAL_COMPLETE execution-actor guard stays unconditional: if an execution
actor were somehow alive, the control is rejected before any mutation.

### No-resurrection application path

After consumption, when the resolved target was stalled:

- skip all drain/boundary machinery (a stalled run owns no drain boundary);
- re-read the run immediately before mutation and require it is still
  `SOL_STALLED` (cheap race guard against concurrent recovery/start);
- write the terminal state directly (`GOAL_COMPLETE` | `BLOCKED` |
  `NEEDS_HUMAN`) via `updateStatus` only — never through an intermediate
  active state, never by calling `submitSolWakeForRun`, executor start/resume,
  strategy start, or scheduler admission;
- `finishedAt`: preserve the established convention of the surrounding code —
  `GOAL_COMPLETE` records the decision time (matching how active-run closure
  already stamps GOAL_COMPLETE); BLOCKED/NEEDS_HUMAN keep the stall-time
  `finishedAt` that the stall transition already wrote, because the run's
  progress actually ended there;
- release loop-owned timers for the repository (wall-clock ceiling + busy
  backpressure) — safe because the stalled path only runs when no active run
  exists, so the repository-keyed timers cannot belong to anyone else;
- clear stale `drainReason` on the closed run;
- publish `loop.state_changed` (existing channel) plus one new durable audit
  event `loop.control_applied` carrying `{ controlId, runId, decision,
  targetWasStalled }`, following the existing custom-event cast pattern. The
  campaign ledger maps unknown types to INFO, so this is additive-safe.

## Adjacent audit findings fixed in this boundary

1. **Lingering wall-clock timer after stall**: `submitSolWakeForRun` moves
   runs to SOL_STALLED (four sites) and app.ts' stalled handler does too,
   without canceling the repository wall-clock timer armed at `startRun`.
   Today `handleWallClockCeiling` no-ops later because `getActiveRun` returns
   null — benign but untidy. Fix: new public `LoopService.releaseTerminalTimers(repositoryId)`
   (clears busy-retry + wall-clock timers) invoked at every SOL_STALLED entry
   point and reused by the stalled-closure path.
2. **Stale drain state**: a run could theoretically carry a persisted
   `drainReason` into SOL_STALLED; closing it now clears the field so the row
   reads truthfully terminal.
3. **Restart staleness**: controls are durable rows; after a controller
   restart the watcher re-inspects unseen commits and re-runs the same strict
   path, so a pre-restart control closes a post-restart stalled run correctly
   with no extra state. Covered by the idempotency + correlation suites.

Explicitly out of scope: changing `getActiveRun()`, recoverRun semantics for
stalled runs, wake retry policy, and any multi-session-per-repository work.

## Test plan

New focused suite `apps/controller/test/sol-stalled-control-closure.test.ts`
mirroring the `loop-drain-correlation.test.ts` harness (real SQLite temp dir,
MockBrowserDriver, FakeExecutorAdapter):

1. matching GOAL_COMPLETE closes latest stalled run + consumes control;
2. BLOCKED works; NEEDS_HUMAN works;
3. PAUSED rejected; run stays SOL_STALLED; executor pause not invoked;
4. newer active run prevents old-stalled closure (control rejected, both runs
   unchanged);
5. wrong iteration rejected on stalled path;
6. wrong relatedDispatchId rejected on stalled path;
7. duplicate delivery idempotent;
8. closure submits nothing: mock driver receives no new page activity beyond
   closing the stale operation, fake executor spawned nothing;
9. `getActiveRun()` still never returns `SOL_STALLED`.
