# Proposal: SOL_STALLED Git-truthful control closure

## Why

Real Phase-10 Codex qualification exposed a production lifecycle gap rather than a simulated edge case. The executor completed and published its durable result, the terminal ChatGPT wake temporarily failed and moved the campaign to `SOL_STALLED`, then a later successful manual wake caused real Sol to publish a correctly correlated `GOAL_COMPLETE` marker. Orca detected that Git control but rejected it because `RunStore.getActiveRun()` intentionally excludes `SOL_STALLED`.

The exclusion itself is correct: a stalled campaign must not regain executor/scheduler ownership merely because durable evidence arrives later. The missing behavior is a narrow **terminal closure seam** that lets Git remain authoritative after transport failure.

## What changes

- Keep `SOL_STALLED` excluded from the normal active-run query and all ordinary actor ownership paths.
- When a Sol-control marker is detected and there is no currently active run, allow `LoopService` to resolve the repository's latest run as the control target **only when**:
  - the latest run is `SOL_STALLED`;
  - the control `runId` matches that exact run;
  - repository, iteration, and optional `relatedDispatchId` pass the existing strict correlation checks; and
  - the decision is terminal (`GOAL_COMPLETE`, `BLOCKED`, or `NEEDS_HUMAN`).
- Never apply `PAUSED` to a stalled run.
- If a newer active campaign exists, it remains authoritative; a late control for an older stalled run is rejected and cannot alter either campaign.
- Preserve control idempotency and durable `detected` -> `consumed` / `rejected` audit semantics.
- Add focused regression coverage for successful stalled closure, new-run protection, stale correlation, and pause rejection.

## Scope boundaries

This change does **not**:

- make `SOL_STALLED` an active state;
- auto-retry browser transport;
- revive or restart an executor;
- infer completion from browser text;
- mutate an older stalled run after a newer run has become active;
- weaken the one-writer / one-active-actor invariant.

## Exit gate

1. A strictly correlated terminal Sol control can close the latest `SOL_STALLED` run from Git truth.
2. `RunStore.getActiveRun()` still excludes `SOL_STALLED`.
3. A newer active run prevents late control application to the older stalled run.
4. `PAUSED`, wrong-run, wrong-iteration, and wrong-dispatch controls remain rejected and auditable.
5. Focused tests pass, followed by the normal meaningful checkpoint gates (`npm test`, typecheck, build, lint, strict OpenSpec validation, `git diff --check`) when execution is available.
