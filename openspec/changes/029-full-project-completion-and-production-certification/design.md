# Design: Full project completion and production certification

## Core rule

This campaign is dependency-driven. Do not treat Change 029 as permission to bypass unfinished earlier changes. The only safe order is:

1. finish Change 028 crash consistency and durable execution ownership;
2. re-run the whole fast/real-process battery and close Change 027 source-truth/resilience work;
3. obtain every locally available Change 026 package/lifecycle/endurance/release qualification result;
4. perform a final repository-wide audit and production certification;
5. archive only changes whose evidence is actually complete.

## Work model

Use small independently verifiable implementation slices. For each slice:

- establish the failing/reproducing test first when feasible;
- modify the smallest responsible subsystem;
- run focused tests plus typecheck for affected workspaces;
- update the active task ledger only after evidence exists;
- periodically run the repository fast tier to catch cross-system regressions;
- commit coherent slices with exact evidence in commit messages.

Do not batch dozens of unrelated changes into one unreviewable commit.

## System invariants to preserve

### Repository ownership

One repository may have at most one mutating logical actor at a time. A strategy owns the lease; its workers are child ownership records, not competing leases. Uncertain prior ownership is blocking/quarantined, never assumed dead.

### Process identity

A PID alone is never authority. Kill/reclaim requires LIVE_MATCH with sufficient creation/executable identity evidence. DEAD, PID_REUSED and UNKNOWN remain distinct outcomes.

### Transition atomicity

For dispatch, Sol control, executor/strategy completion and any future durable source, source consumption and the required run transition belong to one SQLite transaction. External I/O occurs after commit through an idempotent/replayable outbox or equivalent durable boundary.

### Lifecycle ownership

Every async callback capable of mutating durable orchestration state or launching resources must be awaited, tracked, or durably enqueued. Naked `void` promises are forbidden on critical mutation paths.

### Shutdown

Shutdown is a latch, not a late cleanup function. Once latched, no new resource admission is allowed. Partial construction, signal interruption and listen failure must converge on the same bounded teardown graph.

### Worktree safety

Never sweep/release a checkout while a live or uncertain worker may own it. Dirty user/worker files are evidence to preserve, not trash to normalize away.

### Browser profile safety

The dedicated profile may be reclaimed only when controller and exact `--user-data-dir` ownership are provably stale. A dead controller PID alone is insufficient.

### Evidence truthfulness

Package, installer, release, endurance and external-host qualification tiers must remain distinct. Never turn an unavailable environment into a PASS by renaming the gate.

## Final audit method

Before final certification, inventory every tracked file and classify it into source, tests, scripts, workflow, docs/specs, packaging assets, agent metadata or generated/local-data rules. Inspect all executable/configuration files for:

- TODO/FIXME/temporary bypasses;
- detached async work;
- unsafe child-process launch/kill behavior;
- non-atomic state transitions;
- stale migration/schema/version assumptions;
- ignored-but-required source/package inputs;
- secrets or unsafe logging;
- unbounded retries/timers/logs;
- missing timeout/abort propagation;
- path traversal/symlink/Windows quoting hazards;
- race-prone singleton/profile/worktree ownership;
- stale docs/spec/task claims;
- test-only assumptions leaking into production.

Then map every Critical/High finding to a regression test and close it before certification.

## Certification tiers

Report each separately:

- FAST_TESTS
- REAL_PROCESS_TESTS
- TYPECHECK
- BUILD
- LINT
- OPENSPEC_STRICT
- SOURCE_INTEGRITY
- VERSION_COHERENCE
- PACKAGE_BUILT
- PACKAGE_RUNTIME_QUALIFIED
- BACKUP_RESTORE_QUALIFIED
- CRASH_RECOVERY_QUALIFIED
- MULTI_REPO_STRESS_QUALIFIED
- ENDURANCE_SHORT_QUALIFIED
- ENDURANCE_LONG_QUALIFIED
- UNPACKED_UPGRADE_PRESERVATION_QUALIFIED
- INSTALLER_LIFECYCLE_QUALIFIED
- RELEASE_DRY_RUN_QUALIFIED

A final report must show PASS / FAIL / EXTERNAL-BLOCKED / NOT-APPLICABLE with exact command, host assumptions, artifact paths and relevant commit SHA.

## Stop condition

The project is locally complete only when all locally executable tiers pass, every known Critical/High defect is fixed, active OpenSpec truth is reconciled, docs reflect reality, `.agent/state.json` points at the final verified SHA, and the working tree is clean/pushed. Any remaining external-only qualification must be narrow enough that a human can execute the exact workflow without further engineering.