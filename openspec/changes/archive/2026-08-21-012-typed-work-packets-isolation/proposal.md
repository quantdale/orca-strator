# Change 012: Typed Work Packets & Parallel-Writer Isolation

## Status

Implementing after Change 011 was verified, folded, committed, and pushed.

## Why

Orca's hardened V1 safely serializes one executor per repository. Before any
same-repository swarm or DAG strategy can exist, work must be represented as
versioned structured packets and every potential writer must receive an
isolated checkout. This change establishes and qualifies those prerequisites;
it does not enable swarm execution.

## Scope

1. Add versioned typed work-packet and result-envelope contracts, stores, and
   APIs with structured verification/artifact references.
2. Add persisted deterministic Git worktrees/internal branches with explicit
   lifecycle, crash/stale recovery, Windows/WSL routing, and user-work
   preservation.
3. Add deterministic integration/reconciliation for non-overlapping worker
   commits, dependency ordering, conflict blockers, and partial success.
4. Represent worker and integration outcomes without flattening independent
   failures into one generic error.
5. Qualify the primitives with deterministic local Git/child-process tests;
   keep production single-agent mode and main-only V1 orchestration unchanged.

## Non-goals

- no production swarm or DAG strategy in this change;
- no same-checkout concurrent writers;
- no force-push, reset, clean, or destructive worktree cleanup;
- no automatic model routing or opaque scheduler use;
- no visual workflow composer.

## Gate

Change 013 may start only after worktree allocation/recovery and integration
qualification pass on the current Windows machine, with WSL explicitly marked
qualified or unqualified based on actual execution.
