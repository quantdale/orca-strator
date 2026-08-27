# Change 029: Full project completion and production certification

## Intent

Drive Orca-Strator from the current partially hardened state to a truthfully complete, production-ready project. This change is an umbrella completion campaign, not a feature-expansion campaign.

The implementation agent MUST first finish active correctness work in Change 028, then reconcile and close Changes 027 and 026 using real acceptance evidence, then perform whole-repository certification. No new product feature work is permitted unless required to close a verified blocker.

## Current baseline

Planning baseline: `main@0811c8d8e06739c193d7e509140dc4e55dd0ed9f`.

Repository truth at this baseline:

- Change 028 remains materially incomplete. Hard blockers include durable process-attempt ownership across retries, SWARM/DAG actor leasing and worker ownership, worktree reconciliation ordering, atomic SWARM/DAG and Sol-control transitions, promise-aware callback ownership, abortable initialization/teardown, stale browser-profile recovery, failure-injection qualification, stress gates, and documentation/final handoff.
- Change 027 has implementation largely landed but still requires the final full battery, documentation reconciliation, canonical spec folding/archive, and durable state closeout.
- Change 026 still has external/qualified acceptance work: release dry-run, installer lifecycle/upgrade workflow-dispatch evidence, final package/endurance/stress evidence, artifact records, and closeout.
- The root project exposes fast, real-process, packaging, installer, crash-recovery, endurance, multi-repository stress, backup/restore, release-integrity, typecheck/build/lint and strict OpenSpec gates. Completion means using those gates rather than inventing weaker substitutes.

## Objective

Make the repository genuinely finished for its documented scope:

1. No known Critical/High correctness, durability, safety, security, lifecycle, packaging or data-integrity defect remains.
2. Crash/restart paths cannot create a second mutating repository actor while prior ownership is live or uncertain.
3. Process kill paths never target unverified, PID-reused or foreign processes.
4. Dispatch, control and completion sources cannot be consumed without their required durable state transition.
5. Every external post-transaction side effect is replayable/idempotent or is guarded by an equivalent durable once-only boundary.
6. Direct, SWARM and DAG execution obey the same durable repository-ownership invariant.
7. Startup, shutdown, listen failure and signal interruption cannot strand child processes, browser profiles, worktrees, timers, sockets, database ownership or singleton locks.
8. Fresh clone, packaged runtime, upgrade, backup/restore and rollback claims are supported by reproducible evidence.
9. Documentation, canonical OpenSpec, `.agent/state.json`, release/version metadata and code behavior agree.
10. The final tree passes all supported automated gates and produces an explicit qualification matrix for any evidence that truly requires an external sanctioned Windows/installer environment.

## Non-goals

- No aesthetic rewrite or speculative feature expansion.
- No migration to another framework/runtime unless a blocker proves the current architecture incapable of safe completion.
- No weakening of fail-closed behavior to make tests pass.
- No fake qualification of external installer/release evidence.
- No archiving of 026/027/028 until their acceptance truth is satisfied.

## Completion policy

The agent may work for the full long-session budget (target approximately 12 hours of autonomous execution) while useful implementation, testing, fault injection, documentation reconciliation or certification work remains. It MUST NOT idle merely to consume time.

If all locally executable completion gates become green before the budget is exhausted, use the remaining budget for repeated crash/restart, contention, lifecycle, endurance and multi-repository stress runs. Stop only when:

- all locally solvable blockers are closed;
- no additional Critical/High defect is found by the final audit;
- all supported local gates are green;
- external-only evidence is narrowly and truthfully enumerated with exact commands/workflows required to obtain it;
- repo state and docs are reconciled and pushed.

## Acceptance

Change 029 is accepted only when the task file is fully reconciled with implementation truth and the final completion report contains exact SHAs, test/gate results, qualification tiers, remaining external-only evidence (if any), and a statement that no known locally reproducible Critical/High blocker remains.