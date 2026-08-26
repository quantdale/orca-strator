# Repository-wide next-campaign audit — crash consistency and execution ownership

Date: 2026-08-26

Audit base: `4d1246aa2b9d5fbdd455d17d72b3259896f80432` (`main`)

## Executive verdict

Orca-Strator is feature-rich and heavily hardened, but its most important unattended-execution invariant is still not crash-safe: **controller process death is treated as proof that child executors/workers are dead, even though that proof is not available, and several marker-to-state handoffs can be durably consumed before the corresponding campaign transition is durably applied.**

The next campaign should therefore be a focused post-M24 hardening change, not another product feature and not a replay of the externally gated portions of Changes 026/027.

Selected campaign: `028-durable-execution-ownership-and-crash-consistency`.

## Audit method and coverage

The audit used the pushed GitHub tree as source of truth.

Coverage included:

- recursive inventory of the complete tracked tree on `main`;
- repository instructions, durable agent state, planner handoff, roadmap, OpenSpec conventions, active Changes 026/027, package scripts, Windows CI, and recent commits;
- open issue / open PR check (none open at audit time);
- deep semantic review of controller startup/shutdown, SQLite migrations/stores, watcher ingestion, dispatch/control correlation, loop transitions, executor launch/supervision/result postflight, strategy coordination, SWARM/DAG worker lifecycle, worktree isolation/recovery, scheduler leases, browser/profile ownership, Sol-operation rehydration, and HTTP control seams;
- targeted cross-repository searches for unfinished work and related failure patterns.

Every tracked path was accounted for in the recursive inventory. The line-by-line semantic pass was intentionally deepest in code that can mutate repositories, launch processes, consume durable protocol markers, or reconstruct state after process loss. Generated artifacts and lockfile internals were not treated as independent orchestration logic.

## Findings

### F1 — CRITICAL: restart reconciliation can admit a second writer while an old executor is still alive

`StartupReconciler` marks every persisted executor attempt in `running` or `pending` as failed on startup and states that “no live process existed,” while the same code explicitly acknowledges that no safe startup helper exists to identify or terminate the previous process tree.

The durable `executor_runs` schema stores no PID, process creation identity, launch fingerprint, controller-instance ownership, or repository writer lease. `ExecutorRunner` owns the child handle only in memory.

After the campaign is moved to `RECOVERY_REQUIRED`, `RunStore.getActiveRun()` excludes it from active ownership. A later start can therefore create a new campaign/executor while the original child may still be modifying the same persistent checkout.

The strategy path has the same epistemic gap: `recoverAll()` assumes a restart means there is no live SWARM/DAG worker, marks durable worker state recoverable, and reconciles worktrees without process-identity evidence.

Impact: silent concurrent writers, Git/index corruption, mixed commits, stale result publication, and destruction of the single-actor guarantee.

Required direction: durable actor lease + durable child-process identity + conservative quarantine when liveness cannot be proven. Never kill a PID solely by numeric equality; PID-reuse/foreign-process safety is mandatory.

### F2 — CRITICAL: protocol markers can be consumed before their campaign transition is crash-durable

There are multiple split-brain crash windows:

1. `ExecutorService.handleTurnCompletion()` marks a dispatch `consumed` once it validates a result, then invokes the loop completion callback afterward.
2. `LoopService.applyIterationCompletion()` also consumes the dispatch before the next run transition / Sol wake continuation.
3. `LoopService.onControlDetected()` completes the browser Sol operation, then marks the Sol control `consumed`, then applies the run-state transition.
4. Watcher ingestion persists a marker and advances its durable observed Git position independently of whether the async loop callback ultimately applied the transition.

The watcher calls `onDispatchDetected` / `onControlDetected` only when it first creates the corresponding durable row. A restart therefore cannot rely on seeing the Git commit again to repair a marker that is already stored as consumed but whose campaign transition never landed.

Impact: a durable source of truth can say “already applied” while the state machine never applied it, permanently stranding or misreporting a campaign.

Required direction: crash-consistent transition inbox + transactional state application + replayable idempotent side-effect outbox. Marker consumption and the corresponding run mutation must be one SQLite transaction; browser/process/network side effects must happen after commit and be replayable.

### F3 — HIGH: critical async callback ownership is inconsistent

Production wiring uses fire-and-forget callback calls such as `void loopService.onDispatchDetected(...)`, `void loopService.onControlDetected(...)`, and `void loopService.onExecutorCompleted(...)` without a local rejection owner. The watcher callback contract is synchronous (`void`) even though the implementation it invokes is asynchronous.

Some newer coordinator paths correctly catch/track completion promises, which makes the older seams inconsistent rather than intentionally best-effort.

Impact: an asynchronous failure can become an unhandled rejection or invisible transition loss instead of durable recovery evidence.

Required direction: critical callbacks return/are awaited as `Promise<void>` or enqueue a durable transition intent. No naked promise from a state-machine mutation path.

### F4 — HIGH: shutdown during initialization can bypass teardown after resources have already started

`index.ts` installs signal handling before `buildApp()`, but when a signal arrives before `initialized` is assigned it releases the runtime lock and exits immediately. Its comment asserts that no Chromium page or executor child exists yet.

That assumption is false in the current service graph: `buildApp()` runs startup reconciliation before returning, and BrowserManager rehydration can retry an expired durable Sol wake. That path can launch automated Chrome during initialization. `buildApp()` also starts the watcher before returning.

A listen failure after `buildApp()` similarly closes the database directly instead of closing the assembled Fastify/runtime graph first.

Impact: orphan browser/process resources, stale profile ownership, callbacks into closed persistence, and unclean lifecycle evidence.

Required direction: abortable initialization plus a partial-construction cleanup stack; singleton release happens only after owned resources settle. Listen failure must run the same teardown path.

### F5 — HIGH: automated browser profile stale-lock recovery trusts the controller PID, not the Chrome process

Interactive setup correctly records the external Chrome PID as profile-lock owner. Automated browser ownership defaults to `process.pid` (the controller PID). If the controller dies while Chrome remains alive, the next controller can see the old controller PID as dead and reclaim the profile lock even though the actual Chrome process may still own the profile.

Impact: two Chrome processes can contend for the same persistent profile, risking profile corruption and false auth/readiness behavior.

Required direction: before reclaiming an automated stale lock, prove that no Chrome process is using the exact dedicated `--user-data-dir`. If proof is unavailable, quarantine the profile rather than guessing.

### F6 — MEDIUM: database constraints do not independently enforce several orchestration invariants

The schema has good foreign keys in newer tables, but older protocol tables carry `run_id` as unconstrained text, `runs.status` has no DB-level enum check, and there is no database-enforced one-actor-per-repository lease. `RunStore.updateStatus()` is read-then-write without expected-state compare-and-set semantics.

Application checks cover many ordinary races, but crash recovery and stale callbacks are exactly where defense-in-depth matters.

Required direction: add additive invariant tables / unique keys and compare-and-set transition primitives rather than rebuilding legacy tables unless migration risk is justified.

### F7 — MEDIUM: restart recovery conflates “controller lost the handle” with “worker is dead” across process/worktree state

Worktree recovery is careful about preserving dirty files, but it cannot know whether a live worker still owns that worktree. Staging recovery similarly assumes memory loss means ownership loss.

Required direction: process ownership reconciliation must run before worktree/staging cleanup classification. A live or uncertain owner protects its workspace from automatic cleanup.

## What is deliberately not selected

- No new UI/product feature campaign.
- No reimplementation of Milestones 0–24.
- No attempt to fake or close the external acceptance blockers in Changes 026/027 (Tailscale, authorized OpenCode, sanctioned installer lifecycle, long external soak).
- No generic distributed-systems framework or external queue dependency.
- No automatic killing of unknown/foreign processes.
- No force-reset/clean/force-push recovery behavior.

## Campaign acceptance bar

Change 028 is successful only when fault-injection proves all of the following:

1. killing the controller while a direct Windows/WSL executor is running can never result in a second repository writer after restart;
2. the same holds for SWARM/DAG workers and their worktrees;
3. PID reuse / unprovable liveness never causes Orca to kill a foreign process;
4. every detected dispatch/control/completion transition is either atomically applied or remains durably replayable;
5. no marker may be `consumed` while its required run transition is missing;
6. a crash after transaction commit but before browser/process/network side effect replays that effect idempotently;
7. startup SIGINT/SIGTERM and listen failure cannot strand browser/process/profile ownership;
8. all existing fast gates remain green and focused real-process failure tests pass on supported environments.

## Recommended implementation order

1. freeze fault-injection tests for F1/F2/F4 before redesign;
2. add additive execution ownership and transition-intent schema;
3. add process identity/probe abstraction and actor lease gate;
4. wire direct executor and strategy workers;
5. add transactional transition application + outbox replay;
6. migrate watcher/control/completion paths;
7. fix async callback ownership;
8. make initialization/shutdown abortable and profile reclaim conservative;
9. run crash matrix, full gates, and bounded endurance/failure loops;
10. update canonical docs/specs only after evidence is green.
