# Change 024: Sol control closure for stalled campaigns

## Why

Phase 10 of the real dogfood campaign (run `a19f488f`, 2026-08-23) exposed a
real production lifecycle defect: after a transient network outage moved the
run to `SOL_STALLED`, real Sol independently verified the completed iteration
from Git and published a correctly correlated GOAL_COMPLETE sol-control commit
(`6a7649c`). The watcher detected it, but `LoopService.onControlDetected`
resolves its control target exclusively through `RunStore.getActiveRun()`,
which intentionally excludes `SOL_STALLED`. Validation therefore rejected the
control with `no active run for repository`. The control stays durably
auditable (status `rejected`), but there is no Git-truthful closure path for
an already-stalled campaign: Sol's authoritative terminal decision cannot land
after the stall.

`SOL_STALLED` is terminal-by-visibility but not final-by-decision: the run
stopped making progress, while the campaign's authoritative verdict (Sol's)
may still arrive later through Git. The boundary must let that verdict close
the stalled run without resurrecting any actor.

## Scope

- Keep `RunStore.getActiveRun()` semantics exactly unchanged; `SOL_STALLED`
  remains excluded from normal active ownership everywhere else.
- In `LoopService.onControlDetected`, resolve the normal active run first.
  Only when no active run exists may the LATEST `SOL_STALLED` run of the
  repository become the control target, and only when the control references
  that exact run (`control.runId === stalledRun.id`). A newer active campaign
  always wins and protects an older stalled campaign from late mutation.
- Preserve every existing strict validation: repositoryId match, runId match,
  iteration must equal the target run's `currentIteration`, non-null
  `relatedDispatchId` must equal the target run's `activeDispatchId`,
  detected/consumed/rejected idempotency, strategy/executor ownership guards.
- Allowed decisions for a stalled target: `GOAL_COMPLETE`, `BLOCKED`,
  `NEEDS_HUMAN`. `PAUSED` is explicitly rejected for a stalled target and no
  executor pause/resume behavior may be invoked for a stalled campaign.
- No actor resurrection: applying a terminal control to a stalled run must not
  submit a Sol wake, start/resume an executor or SWARM/DAG strategy, acquire
  scheduler ownership, re-arm wall-clock execution, or temporarily reclassify
  the run through an active state.
- Focused fast-tier regression suite for the stalled closure boundary plus all
  existing normal active-run control tests unchanged.
- Adjacent lifecycle hygiene found by audit within this same boundary:
  loop-owned timers (wall-clock ceiling + busy backpressure) are released when
  a run enters `SOL_STALLED`, stale drain state is cleared when a stalled run
  is closed, and the closure publishes an explicit durable audit event.
- Documentation reconciliation: record the Phase-10 defect as fixed with real
  evidence in `docs/REAL-DOGFOOD-QUALIFICATION.md`; correct stale README/
  ROADMAP qualification claims contradicted by later dogfood evidence without
  overclaiming Tailscale/OpenCode external paths.
- OpenSpec bookkeeping: correct Change 022's stale task 4.2 against Git
  evidence and fold/archive it; evaluate Change 009 for honest archival.

## Impact

- Real Sol can close a stalled campaign through Git — the exact flow the
  cross-agent protocol promises — restoring truthful terminal states instead
  of permanently stranded `SOL_STALLED` rows.
- No behavior change for active runs: the active path is byte-for-byte
  identical, guarded by the existing strict correlation tests.

## Verification intent

- New focused suite `sol-stalled-control-closure.test.ts`: matching
  GOAL_COMPLETE closes the latest stalled run and consumes the control;
  BLOCKED / NEEDS_HUMAN also work; PAUSED is rejected and the run stays
  SOL_STALLED; a newer active run prevents old-stalled closure; wrong
  iteration / relatedDispatchId rejected on the stalled path; duplicate
  delivery idempotent; no wake submission and no executor launch during
  closure; `getActiveRun()` still never returns `SOL_STALLED`.
- All existing control tests (`loop-drain-correlation.test.ts` et al.) remain
  green unchanged.
- Full gates at checkpoint: npm test, typecheck, build, lint,
  `openspec validate --all --strict`, `git diff --check`.
