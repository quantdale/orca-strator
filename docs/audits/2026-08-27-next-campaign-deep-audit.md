# Repository-wide next-campaign deep re-audit — Change 028 continuation

Date: 2026-08-27  
Audit base: `a1de7ab072907baa09d8bdf21e1860125d8323ff` (`main`)  
Selected campaign: `028-durable-execution-ownership-and-crash-consistency`

## Executive verdict

Continue Change 028. Do **not** create a new feature campaign and do not archive 026/027.

The first Change 028 implementation slices are useful, but the current direct-executor ownership path is not yet safe enough to serve as the template for SWARM/DAG. The deep re-audit found several P0 defects inside the newly landed ownership foundation. They must be fixed before strategy ownership is expanded.

The original second critical class also remains open: dispatch/control/completion sources can still be durably consumed separately from their required run transition.

## Audit coverage

This pass used pushed GitHub `main` as source of truth and accounted for **453/453 tracked files**.

Coverage included:

- all controller source, tests, DB migrations/stores, ownership code, watcher, loop, executor adapters/runner/service, SWARM/DAG, worktree/integration, scheduler, browser/profile, runtime, HTTP routes, desktop supervisor, UI, shared protocol/types, schemas, scripts, workflows, docs, active OpenSpec changes, archived OpenSpec history, and repository state/instructions;
- content/pattern scanning for process launch/kill, detached promises, timers, broad/empty catches, transaction seams, and large stateful services;
- semantic re-read of the highest-risk call sites rather than relying on pattern counts;
- recent commit history, active OpenSpec task truth, and current push CI;
- open issue and PR check: none open at audit time.

Current push CI for `a1de7ab`: GitHub Actions run `32992659708`, `windows-gates`, **SUCCESS**.

Important complexity hotspots remain concentrated in `loop-service.ts` (~1.9k lines), `swarm-execution-service.ts` (~2.35k lines), `browser-manager.ts` (~0.94k lines), `executor-service.ts` (~0.92k lines), and `iteration-execution-coordinator.ts` (~0.94k lines). The campaign should reduce crash ambiguity at their boundaries rather than perform unrelated refactors.

## Landed foundation that should be preserved

By `a1de7ab`, Change 028 has landed:

- migration 24 with repository actor leases, process ownership rows, transition intents, and outbox tables;
- controller instance identity threaded into the runtime lock/app;
- `ProcessProbe` and `RepositoryActorLeaseService` primitives;
- startup actor-lease reconciliation before strategy recovery;
- direct executor repository lease acquisition;
- `ExecutorRunner.onSpawn` hook and direct process-row insertion;
- process terminalization attempt before lease release;
- focused ownership/direct-executor tests.

Do not discard this work. Repair its unsafe edges and then reuse the corrected primitive across strategies.

## Newly exposed P0 findings

### R1 — CRITICAL: Windows process identity capture cannot prove identity, but classification treats it as verified

`WindowsProcessProbe.capture(pid)` currently returns only `pid` + `capturedAtIso`. It does **not** capture the creation timestamp or executable name.

`WindowsProcessProbe.classify(record)` then treats missing `startMarker` and `executableName` as automatic matches:

- missing start marker => `markerMatches = true`;
- missing executable => `exeMatches = true`.

Therefore a current process at the same PID can become `LIVE_MATCH` with no durable anti-reuse evidence. `killVerifiedTree()` trusts that verdict and can invoke `taskkill /T /F`.

This violates the core Change 028 requirement: PID equality alone must never authorize kill.

**Required repair:** capture authoritative Windows creation time + executable identity at spawn, persist it, and require it for LIVE_MATCH. Incomplete identity => UNKNOWN.

### R2 — CRITICAL: Windows “dead PID” and “probe failed” are collapsed

`queryProcess()` returns `null` for both:

- no process found;
- PowerShell/CIM failure, timeout, parse failure, or access problem.

`classify()` converts null to UNKNOWN. That is safe against accidental kill, but it prevents authoritative DEAD reconciliation and makes the semantics incapable of distinguishing the required states.

**Required repair:** structured query result such as FOUND / NOT_FOUND / ERROR. NOT_FOUND => DEAD; ERROR/undecidable => UNKNOWN.

### R3 — CRITICAL: prior actor lease with zero process rows auto-releases

`RepositoryActorLeaseService.reconcileOnStartup()` classifies the associated process list and releases the lease when there is no blocking verdict. For an empty list, no blocking element exists, so the lease is released.

But the dangerous crash window is exactly:

1. repository lease acquired;
2. child crosses OS spawn;
3. controller dies before process ownership insert.

A restarted controller sees the prior lease plus zero process rows and currently treats it as safe to release, permitting a second writer.

**Required repair:** a prior STARTING/ACTIVE lease with zero process rows is ambiguous unless separate durable pre-spawn/admission evidence proves no child crossed spawn. Default must be quarantine.

### R4 — CRITICAL: post-spawn ownership failure can enter generic launch retry

`ExecutorRunner.start()` awaits real spawn, then awaits `onSpawn`. If ownership persistence/capture fails, the error propagates to `ExecutorService.launchWithRetry()`, which treats the failure like ordinary inability to start and may call `runner.start()` again.

That means a post-spawn failure can create a replacement child. If termination of the first child was unverified or failed, two writers can exist within one launch sequence.

**Required repair:** explicit pre-spawn vs post-spawn failure classification. Never generic-retry after real spawn unless prior child termination is verified and durably terminal. Unknown => quarantine + abort.

### R5 — HIGH/CRITICAL: retry attempts are not uniquely represented

Direct ownership insertion uses `id: runAttemptId`. Generic launch retry reuses the same runner/runAttemptId. Change 028 requires each real spawn attempt to be distinguishable.

A second real spawn cannot safely reuse the first process-row identity.

**Required repair:** parent executor run ID plus distinct process attempt ID / attempt ordinal for each OS spawn.

### R6 — HIGH: child exit listeners are installed after awaitable ownership persistence

`ExecutorRunner.start()` currently performs:

1. spawn;
2. await spawn handshake;
3. await `onSpawn`;
4. install exit/error handling.

A short-lived child can exit while `onSpawn` is awaiting DB/OS work. Node does not replay an already-emitted exit event to a later listener.

**Required repair:** install exit/error observation before the awaited ownership hook, or explicitly reconcile child terminal state after the hook. Completion must remain exactly once.

### R7 — HIGH: all-pre-spawn launch failure can strand the STARTING lease

The direct executor acquires/binds a durable lease before `launchWithRetry`. When all attempts fail before successful spawn, the executor attempt is marked failed, but the new actor lease is not explicitly released/terminalized in that failure branch.

This can wedge subsequent starts even though no child exists.

**Required repair:** distinguish safe pre-spawn failure and release/terminalize the current instance's STARTING lease; never use this cleanup for an uncertain post-spawn failure.

## Original Change 028 findings still open

### F2 — CRITICAL: consumed source and required run transition are not crash-atomic

Current examples remain:

- `ExecutorService.handleTurnCompletion()` marks a valid dispatch consumed before the loop callback applies continuation;
- `LoopService.applyIterationCompletion()` consumes dispatch before awaited continuation/Sol wake;
- `LoopService.completePostflightRetry()` consumes before the next continuation;
- `LoopService.onControlDetected()` completes the Sol browser operation, marks control consumed, and only then mutates run state;
- watcher ingestion invokes one-time in-memory callbacks after durable marker creation.

Migration 24 created transition/outbox tables, but no transaction application service currently owns these semantics.

### F3 — HIGH: critical async callbacks remain fire-and-forget

`app.ts` still contains naked state-mutating calls such as:

- `void loopService.onDispatchDetected(...)`;
- `void loopService.onControlDetected(...)`;
- `void loopService.onExecutorCompleted(...)`.

Watcher callback types remain synchronous despite invoking async state-machine work.

### F4 — HIGH: initialization/listen teardown remains unsafe

`index.ts` still releases the singleton lock and calls `process.exit()` when a signal arrives before `buildApp()` returns, based on the stale claim that no child/browser exists yet. But `buildApp()` can perform startup rehydrate/browser work and starts the watcher before returning.

Listen failure closes the DB directly without first closing the assembled runtime graph.

### F5 — HIGH: automated Chrome profile recovery still trusts controller PID

A dead controller PID is not proof the dedicated automated Chrome is dead. Exact `--user-data-dir` ownership must be probed; uncertainty quarantines.

### F7 — HIGH: SWARM/DAG recovery still assumes workers died with the controller

`SwarmExecutionService.recoverAll()` still writes “controller restarted without a live swarm worker” without process identity evidence. Strategy leases/process rows are not yet wired beneath the repository actor boundary, and worktree/staging recovery therefore cannot yet distinguish live/unknown owners.

## State/spec drift found

- `.agent/state.json` used a development status not allowed by its own schema and carried an undeclared `implementationStartSha` despite `additionalProperties: false`. The refreshed waypoint uses valid `IMPLEMENTING` state and keeps the start SHA in narrative evidence.
- the old execution prompt referenced `docs/OBSERVABILITY.md`; the tracked canonical file is `docs/OBSERVABILITY-AND-FAILURES.md`.
- Change 028 task 4.1 is now genuinely landed, but 3.4-3.6 cannot remain accepted because the Windows implementation fails the stated identity/verified-kill semantics.

## Ordered campaign recommendation

1. **Freeze R1-R7 with failing tests first.**
2. Repair Windows capture/classification/verified-kill semantics.
3. Close the direct spawn-to-persistence gap: failure typing, unique process attempts, exit observation, correct lease release/quarantine.
4. Only then wire one repository strategy lease plus subordinate SWARM/DAG worker records.
5. Protect worktree/staging recovery using live/dead/unknown process truth.
6. Implement transition processor + CAS + one-transaction source/run/outbox application.
7. Remove premature dispatch/control consumption and route watcher/executor/strategy callbacks through durable transition intents.
8. Own all critical async work through await/tracking/durable enqueue.
9. Make construction abortable and listen failure use unified teardown.
10. Add exact-profile Chrome quarantine and recovery APIs/diagnostics.
11. Run the full real-process crash matrix, then fast/typecheck/build/lint/OpenSpec/source-integrity gates.
12. Spend remaining useful 12-hour budget on repeated race/failure loops, not new features.

## 12-hour execution budget

The executor should treat this as one long hardening session. Indicative allocation:

- hours 0-2: failing regressions + Windows/direct ownership repair;
- hours 2-4: strategy lease/worker ownership + worktree recovery;
- hours 4-7: transition processor/outbox + dispatch/control/completion migration;
- hours 7-9: async ownership + abortable lifecycle + browser profile quarantine;
- hours 9-12: failure injection, repeated crash/restart contention, full gates, regression repair, docs/state/final report.

This is a work budget, not permission to sleep or pad runtime. If one workstream finishes early, use the remaining budget on the next gate, stress loops, and Critical/High repair.

## Completion bar

Change 028 is review-ready only when:

- incomplete/missing Windows identity can never authorize a kill;
- dead PID and unknown probe failure are distinguishable;
- zero-process prior leases cannot silently reopen the repository;
- post-spawn ownership failure cannot double-spawn;
- each real spawn attempt is durably unique and short-lived exits are observed exactly once;
- direct, SWARM, and DAG writers are all governed by the same durable repository ownership boundary;
- live/unknown worker ownership protects worktrees/staging;
- dispatch/control/completion consumption is transactionally coupled to required run mutation;
- external effects are replayable/idempotent;
- init/listen teardown cannot strand owned resources;
- profile reclaim is conservative;
- required fault-injection and regression gates are green;
- Changes 026/027 external acceptance remains truthfully external.
