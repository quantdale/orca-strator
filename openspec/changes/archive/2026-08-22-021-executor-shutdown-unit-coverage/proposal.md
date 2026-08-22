# Change 021: Executor shutdown-path unit coverage

## Why

The Change 018 hardening wave added several `ExecutorService` and
`StartupReconciler` lifecycle paths that are correct but only exercised by
integration/real-tier suites (or not at all at unit level):

- the startup orphaned-executor-run truth repair (persisted
  `running`/`pending` rows with no live process marked `failed`);
- the shutdown kill sweep covering runners still registered in the
  per-repository intent map (`pendingRunners`) with an already-spawned child;
- sweep isolation: one failed kill must not abort the remaining kills;
- emergency `killRun` aborting a runner inside its launch-retry window so no
  later retry spawns.

The recorded follow-up from the Change 018 campaign asked for dedicated unit
coverage for these paths so regressions surface in the fast tier instead of
only in slow real-tier runs.

## Scope

- new focused test suite `executor-shutdown-paths.test.ts` covering the four
  paths above against the production `ExecutorService` / `StartupReconciler`
  wiring with fake adapters;
- extend `startup-reconciler.test.ts` wiring to pass the executor store where
  needed for the orphan-sweep case;
- no production behavior change is intended. If authoring the tests disproves
  a documented behavior assumption, the artifact is updated instead of
  silently deviating.

## Out of scope

- changing shutdown/orphan semantics;
- real-tier scenario additions;
- UI or API changes.

## Risks

Low. Test-only change plus documentation reconciliation; the fast-tier gate
runtime grows by a few seconds at most.
