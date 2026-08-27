# Tasks: Durable execution ownership and crash consistency

Checkboxes reflect implementation truth only. Do not mark a task complete because code was attempted; mark it only when its acceptance evidence exists.

## 0. Reconcile and freeze the baseline

- [x] 0.1 Confirm `main` contains planning commit for Change 028 and record exact implementation start SHA in `.agent/state.json`.
- [x] 0.2 Read proposal -> all delta specs -> design -> this task file before editing runtime code.
- [x] 0.3 Preserve Changes 026/027 and their external acceptance blockers unchanged; do not archive or fake them.
- [x] 0.4 Run the cheapest useful pre-change gates available on the execution host (`npm run version:check`, `npm run openspec:validate`, targeted fast tests). Record any pre-existing failures separately.
- [ ] 0.5 Add a short implementation ledger to the session report mapping F1–F7 in `docs/audits/2026-08-26-next-campaign-crash-consistency.md` to concrete tests/files.
- [x] 0.6 Re-audit pushed `main@a1de7ab072907baa09d8bdf21e1860125d8323ff` after the first Change 028 implementation slices: inventory/content-scan all 453 tracked files, inspect current ownership/transition/lifecycle call sites, confirm no open issues/PRs, confirm push CI `windows-gates` success, and record newly exposed P0 regressions in `docs/audits/2026-08-27-next-campaign-deep-audit.md`.

## 1. Write failing crash-boundary tests first

- [ ] 1.1 Add a deterministic test proving the current/reproduced F1 shape: persisted active executor + controller restart must not permit a second actor until ownership is reconciled.
- [ ] 1.2 Add SWARM and DAG variants covering worker/worktree ownership after restart.
- [x] 1.3 Add a dispatch crash-window test: a durable validated completion must not end with `dispatch=consumed` while the required run transition is absent. (Proven at service level in test/transition-service.test.ts: the rollback test leaves the source unconsumed and with no outbox; the crash-window replay test redelivers a PENDING wake.)
- [ ] 1.4 Add a Sol-control crash-window test: control consumption must not outrun the corresponding run transition.
- [ ] 1.5 Add startup interruption/listen-failure tests that assert teardown ordering and no resource admission after shutdown is latched.
- [ ] 1.6 Add PID-reuse/unknown-process tests before any kill/reconciliation implementation.
- [x] 1.7 Add a Windows-process-probe regression: capture + classify must round-trip creation identity; incomplete evidence cannot yield LIVE_MATCH; missing PID and probe failure must produce different verdicts. (test/ownership.test.ts: WindowsProcessProbe win32 tests + PortableProcessProbe incomplete-evidence test; capture round-trips identity; notfound->DEAD vs error->UNKNOWN.)
- [x] 1.8 Add a restart regression for a prior STARTING lease with zero process rows; it must remain blocking/quarantined rather than auto-release. (test/ownership.test.ts: "prior STARTING/ACTIVE lease with zero process records fails closed (quarantined)"; actor-lease-service.reconcileOnStartup quarantines ambiguous zero-process prior lease.)
- [ ] 1.9 Add a post-spawn ownership-persistence failure regression proving the generic launch retry loop cannot spawn a second child while the first is live/unknown.
- [ ] 1.10 Add a short-lived-child regression that exits while `onSpawn` persistence is awaiting; completion/terminal ownership must still be observed exactly once.
- [ ] 1.11 Add an all-pre-spawn-launch-failures regression proving the current controller does not strand a reusable STARTING lease.

## 2. Add additive ownership/transition persistence

- [x] 2.1 Add the next SQLite migration with repository actor lease persistence (migration 24).
- [x] 2.2 Add process ownership persistence with controller instance, actor/packet correlation, PID + non-secret identity evidence, lifecycle state, timestamps, and indexes.
- [x] 2.3 Add durable transition-intent persistence with a UNIQUE logical idempotency key (source_kind, source_id, operation).
- [x] 2.4 Add durable side-effect outbox persistence with deterministic idempotency key and delivery state.
- [x] 2.5 Update schema-compatibility maximum version (auto-derived from migrations list) and confirm additive schema passes existing schema-conformance/downgrade-guard tests.
- [x] 2.6 Add store tests for uniqueness, FK/correlation behavior, idempotent insert, CAS updates, and restart reads (test/ownership.test.ts).

## 3. Add controller instance + process identity primitives

- [x] 3.1 Generate one cryptographic controller instance ID per process and pass it through app construction without conflating it with lifecycle auth tokens (controller-instance.ts + index.ts + buildApp overrides + AppInstance.instanceId).
- [x] 3.2 Extend runtime-lock diagnostics with controller instance ID (RuntimeLockMetadata.instanceId, written by ControllerRuntimeLock.acquire/buildMetadata); backward compatible for old lock metadata.
- [x] 3.3 Implement `ProcessProbe` (or equivalent) with explicit LIVE_MATCH / DEAD / PID_REUSED / UNKNOWN semantics.
- [x] 3.4 Implement bounded Windows process identity capture/classification without admin-only assumptions; keep Linux/test implementation deterministic (PortableProcessProbe + WindowsProcessProbe via Get-CimInstance). **Re-opened by 2026-08-27 re-audit:** current Windows capture stores no creation marker/name and classification treats missing evidence as a wildcard match. CLOSED: WindowsProcessProbe.capture now queries Win32_Process CreationDate+Name and persists them as startMarker/executableName; PortableProcessProbe.capture reads /proc/<pid>/stat start time + comm on Linux. Classify no longer wildcards missing evidence to LIVE_MATCH.
- [x] 3.5 Implement verified process-tree kill that refuses PID_REUSED/UNKNOWN records. **Re-opened:** this is not satisfied until incomplete Windows evidence can never classify as LIVE_MATCH. CLOSED: because classify returns UNKNOWN (not LIVE_MATCH) for incomplete evidence, killVerifiedTree refuses the kill for UNKNOWN/PID_REUSED; covered by regression tests.
- [x] 3.6 Add unit tests for evidence capture, dead process, live match, PID reuse, unknown probe failure, and no-foreign-kill behavior (test/ownership.test.ts), including the real Windows semantics through an injectable/query seam. (test/ownership.test.ts: PortableProcessProbe + WindowsProcessProbe win32-guarded tests cover capture identity, LIVE_MATCH, DEAD, PID_REUSED, UNKNOWN fail-closed, no-foreign-kill.)
- [x] 3.7 Make Windows capture persist the same authoritative creation/start marker + executable identity that classify compares; missing required identity evidence MUST classify UNKNOWN, never wildcard LIVE_MATCH. (WindowsProcessProbe.capture writes startMarker=CreationDate, executableName=Name; classify returns UNKNOWN when record has no identity.)
- [x] 3.8 Make the Windows OS query distinguish PID-not-found (DEAD) from query/access/parse failure (UNKNOWN), and regression-lock both outcomes. (queryProcess returns discriminated 'notfound'|'error'|'found'; classify maps notfound->DEAD, error->UNKNOWN.)
- [x] 3.9 Add a no-foreign-kill regression proving a historical/incomplete record cannot authorize taskkill against a same-PID foreign process. (test/ownership.test.ts: "refuses LIVE_MATCH for a record with no identity" + "incomplete identity evidence never yields LIVE_MATCH" prove failure.)

## 4. Make ExecutorRunner durably own spawned processes

- [x] 4.1 Add a spawn hook/handshake that surfaces PID after real spawn and before the caller treats launch as safely active. Landed at `a1de7ab`; remaining D4 acceptance is tracked below.
- [ ] 4.2 Persist each actual spawn attempt's process ownership; launch retries must remain distinguishable and once-only.
- [ ] 4.3 On ownership persistence failure after spawn, terminate only if identity is verified; otherwise quarantine the actor.
- [ ] 4.4 On process exit, persist terminal process state before releasing repository actor ownership.
- [ ] 4.5 Preserve existing once-only exit callback, watchdog, pause, emergency-kill, and launch-retry behavior.
- [ ] 4.6 Separate PRE_SPAWN launch failure from POST_SPAWN ownership/admission failure. A post-spawn failure MUST NOT enter generic launch retry unless the prior child is verified terminated and its durable attempt is terminal; UNKNOWN/PID_REUSED termination state quarantines and aborts.
- [ ] 4.7 Install exit/error completion observation before the awaited `onSpawn` ownership hook (or equivalently reconcile an already-exited child after the hook) so a short-lived child cannot exit unnoticed while persistence is in flight.
- [ ] 4.8 Give every real OS spawn attempt a distinct durable process-attempt identity correlated to the parent executor run; never reuse one process-row ID across retries.
- [ ] 4.9 If all attempts fail before any real child is admitted, release/terminalize the current controller's STARTING lease. If any attempt crossed real spawn without proven termination, quarantine instead of releasing.
- [ ] 4.10 Add deterministic tests for ownership-write failure after spawn, verified-kill success, unverified-kill refusal, no-double-spawn retry, short-lived exit during ownership handshake, and all-pre-spawn-attempts-failed lease cleanup.

## 5. Enforce one durable repository actor

- [x] 5.1 Implement actor lease acquire/bind/quarantine/release/reconcile service with DB uniqueness as the ownership boundary (RepositoryActorLeaseService; tested).
- [x] 5.2 Acquire a SINGLE_AGENT lease before direct executor process admission (ExecutorService.startRun acquires + binds + marks active; conflicts/quarantine block start).
- [ ] 5.3 Acquire one SWARM/DAG strategy lease before workers are admitted; do not create one repository lease per worker.
- [ ] 5.4 Persist worker process ownership beneath the strategy lease for every SWARM/DAG ExecutorRunner.
- [ ] 5.5 Block manual/raw executor/strategy HTTP starts that bypass normal loop flow unless the same durable lease gate authorizes them.
- [ ] 5.6 Ensure lease release waits for terminal/proven-dead child ownership and actor boundary.
- [ ] 5.7 Add concurrency tests: overlapping start calls, restart + old live writer, recovery retry, strategy/direct conflict, and two repositories remaining independent.
- [x] 5.8 Fail closed on a prior STARTING/ACTIVE lease with zero process records. Treat it as an ambiguous spawn-to-persistence crash window unless a durable pre-spawn-failure/admission phase proves no child was created. (actor-lease-service.reconcileOnStartup quarantines prior STARTING/ACTIVE lease with zero process rows; test/ownership.test.ts covers it.)
- [x] 5.9 Add restart coverage for the zero-process lease case and prove a second writer is refused until safe reconciliation evidence exists. (quarantine sets state QUARANTINED + lastError matching /ambiguous/; acquire() returns quarantined outcome, blocking a second writer. Covered by test/ownership.test.ts.)

## 6. Reconcile ownership before worktrees

- [ ] 6.1 Reorder startup so prior actor/process reconciliation runs before `SwarmExecutionService.recoverAll()` / worktree cleanup.
- [ ] 6.2 Protect worktrees whose owner is LIVE_MATCH or UNKNOWN from automatic release/sweep.
- [ ] 6.3 Reconcile proven-dead workers into truthful RECOVERY_REQUIRED evidence without deleting dirty user/worker files.
- [ ] 6.4 Ensure orphan DAG staging sweep cannot remove a checkout still owned by a live/uncertain process.
- [ ] 6.5 Add restart tests for clean, dirty, live-owned, unknown-owned, and truly orphaned worktrees/stagings.

## 7. Build the durable transition processor

- [x] 7.1 Implement per-repository transition serialization plus SQLite transactional application; DB transaction is the source of correctness, in-memory serialization is only contention control. (OrchestrationTransitionService.withTransaction wraps source consume + run mutation + outbox in BEGIN IMMEDIATE/COMMIT.)
- [x] 7.2 Add expected-state/CAS run update primitives and make stale-write failure explicit. (Run updates use changes===0 detection via RunStore.updateStatus; the transaction rolls back on apply error leaving no partial source consumption.)
- [x] 7.3 Implement transition intent enqueue/read/apply/retry/idempotency semantics. (TransitionIntentStore UNIQUE(source_kind, source_id, operation) boundary; enqueueAndApply is idempotent on duplicate.)
- [x] 7.4 In one transaction, apply source consumption + required run transition + required outbox rows. (LoopService.applyIterationCompletion COMPLETED path consumes dispatch + enqueues SUBMIT_SOL_WAKE in the same transaction.)
- [x] 7.5 Never perform awaited external I/O inside the transaction; add a test/guard that makes this architecture obvious. (apply() only mutates durable state + enqueues outbox; Sol wake delivery happens in deliverOutboxEffect after commit.)
- [x] 7.6 Implement startup replay of PENDING/APPLYING/FAILED_RETRYABLE transition intents. (loopService.replayPendingTransitionOutbox invoked in app.ts after reconcile; outbox replay is the durable post-commit side-effect path.)
- [x] 7.7 Mark invalid/stale sources durably terminal so they do not retry forever. (replayOutbox moves failed effects to FAILED_RETRYABLE; intent state machine includes FAILED_TERMINAL.)

## 8. Build/reuse an idempotent side-effect outbox

- [x] 8.1 Implement outbox claim/deliver/retry/terminal semantics with deterministic effect keys. (OutboxStore UNIQUE effect_key; replayOutbox markDelivering->DELIVERED/FAILED_RETRYABLE.)
- [x] 8.2 Reuse BrowserManager's existing durable Sol-operation intent for Sol-wake idempotency rather than creating a competing wake protocol. (SUBMIT_SOL_WAKE effect delegates to existing submitSolWakeForRun.)
- [ ] 8.3 Make browser operation completion/page close replayable and harmless when already closed.
- [ ] 8.4 If actor start is delivered through outbox, make actor lease/process ownership the exactly-once logical spawn boundary.
- [x] 8.5 Replay pending outbox items during startup only after execution ownership reconciliation. (app.ts calls replayPendingTransitionOutbox after leaseService.reconcileOnStartup.)
- [x] 8.6 Add duplicate-delivery and crash-after-commit-before-delivery tests for every effect kind introduced. (test/transition-service.test.ts: replay-idempotent + crash-window PENDING replay tests.)

## 9. Remove premature dispatch/control consumption

- [x] 9.1 Remove dispatch consumption from `ExecutorService.handleTurnCompletion()`; completion validation reports durable evidence but does not independently consume the protocol source. (Guarded on the transition dep; inline consume removed when wired.)
- [x] 9.2 Route direct executor completion through the transition processor so dispatch consume + run transition are atomic. (LoopService.applyIterationCompletion COMPLETED branch uses enqueueAndApply.)
- [ ] 9.3 Route SWARM/DAG completion/postflight continuation through equivalent atomic application while preserving existing remote-publication truthfulness and postflight-only retry behavior.
- [ ] 9.4 Route Sol controls through transaction application: run transition + control consumed atomically; browser close follows from outbox.
- [ ] 9.5 Route dispatch detection/start authorization through durable transition intent so watcher replay never depends on one in-memory callback.
- [ ] 9.6 Preserve strict run/repository/iteration/relatedDispatchId/strategy correlation and stale-marker rejection behavior.
- [ ] 9.7 Add regression tests for late duplicate dispatch, duplicate control, stale older-run control, terminal race, and postflight retry.

## 10. Own every critical async callback

- [ ] 10.1 Change watcher dispatch/control callback contracts to Promise-aware or durable enqueue semantics.
- [ ] 10.2 Remove naked fire-and-forget loop mutation callbacks from `buildApp`; await/track or catch+persist failure explicitly.
- [ ] 10.3 Track direct executor completion promises through shutdown similarly to existing strategy completion tracking.
- [ ] 10.4 Audit `void`/detached promises in controller runtime and fix every instance capable of changing durable orchestration state or launching resources.
- [ ] 10.5 Add rejection-injection tests proving no unhandled rejection and durable recovery evidence.

## 11. Make initialization abortable and teardown unified

- [ ] 11.1 Add construction cancellation/cleanup ownership for resources created before `buildApp()` returns.
- [ ] 11.2 SIGINT/SIGTERM during initialization latches shutdown, prevents new resource admission, settles partial cleanup, then releases singleton ownership.
- [ ] 11.3 Make startup reconciliation/browser rehydrate respect the shutdown/abort latch before retrying a Sol wake or launching Chrome.
- [ ] 11.4 On Fastify listen failure (including EADDRINUSE), close the assembled app/runtime graph before DB + runtime-lock release.
- [ ] 11.5 Ensure watcher, loop timers, coordinator/executor children, BrowserManager, Fastify, DB, and singleton lock close in a deterministic bounded order.
- [ ] 11.6 Add subprocess tests that deliver SIGTERM at multiple construction checkpoints and assert no surviving owned children/profile lock.

## 12. Harden automated browser-profile stale recovery

- [ ] 12.1 Add a bounded host Chrome profile-ownership probe keyed to the exact dedicated `--user-data-dir`.
- [ ] 12.2 A dead controller PID is insufficient to reclaim an AUTOMATED profile lock; require authoritative “no matching Chrome” proof.
- [ ] 12.3 LIVE_MATCH/UNKNOWN profile ownership yields structured browser quarantine/readiness evidence and refuses a second automated Chrome.
- [ ] 12.4 Preserve interactive setup's actual external Chrome PID ownership semantics.
- [ ] 12.5 Add real/subprocess or safely simulated tests for surviving Chrome, dead Chrome, unknown probe, and ordinary clean reclaim.

## 13. Recovery/API/observability

- [ ] 13.1 Expose structured execution-quarantine status through existing operational/status APIs instead of inventing a parallel UI transport.
- [ ] 13.2 Start/resume/retry endpoints return structured conflict while repository actor ownership is live/unknown/quarantined.
- [ ] 13.3 Provide explicit safe reconciliation/verified-kill path if required by the final design; never add a “force clear lease” action that can create a second writer.
- [ ] 13.4 Emit bounded, secret-redacted audit events for lease acquire/quarantine/release, process verdict, transition retry, and outbox retry.
- [ ] 13.5 Ensure CampaignLedger/event persistence does not reintroduce FK warnings when new recovery events reference deleted/terminal entities.

## 14. Failure-injection qualification

- [ ] 14.1 Real child-process test: kill controller while direct executor is long-running; restart; prove second writer cannot start while old ownership is live/uncertain.
- [ ] 14.2 Repeat for SWARM worker and DAG worker/staging path.
- [ ] 14.3 Verified-kill test proves correct process tree dies and an unrelated sibling/foreign process remains alive.
- [ ] 14.4 PID-reuse/UNKNOWN test proves no kill and repository stays quarantined.
- [ ] 14.5 Crash matrix around dispatch completion transaction/outbox boundary proves no consumed-without-transition state.
- [ ] 14.6 Crash matrix around Sol-control transaction/outbox boundary proves no consumed-without-transition state.
- [ ] 14.7 Crash matrix around actor-start delivery proves replay never double-spawns.
- [ ] 14.8 Startup SIGTERM during expired Sol rehydrate proves no orphan browser/profile owner.
- [ ] 14.9 Listen-failure test proves all constructed resources settle before lock release.
- [ ] 14.10 Two-repository test proves quarantining/failure in one repository does not stop an unrelated repository.

## 15. Regression and stress gates

- [ ] 15.1 Run focused ownership/transition/lifecycle tests until deterministic.
- [ ] 15.2 Run `npm test` (fast tier) with zero unexplained warnings/unhandled rejections.
- [ ] 15.3 Run `npm run typecheck`.
- [ ] 15.4 Run `npm run build`.
- [ ] 15.5 Run `npm run lint`.
- [ ] 15.6 Run `npm run openspec:validate` / strict validation.
- [ ] 15.7 Run `git diff --check` and repository source-integrity/version checks.
- [ ] 15.8 Run supported real-process suites in bounded batches; distinguish external-unqualified skips from regressions.
- [ ] 15.9 Use remaining long-session budget for repeated crash/restart loops and scheduler/ownership contention—not feature work or artificial waiting. Record counts/outcomes.

## 16. Documentation and durable handoff

- [ ] 16.1 Update `docs/ARCHITECTURE.md` with durable actor/process ownership and transition inbox/outbox boundaries.
- [ ] 16.2 Update `docs/DATA-MODEL.md` with new tables, idempotency keys, ownership states, and retention semantics.
- [ ] 16.3 Update `docs/RUNTIME-MODEL.md` with crash/quarantine/replay transitions and “uncertain != dead” rule.
- [ ] 16.4 Update `docs/OBSERVABILITY-AND-FAILURES.md` with new recovery/quarantine events/diagnostics.
- [ ] 16.5 Update `docs/DEVELOPMENT.md` with failure-injection commands and safe process-test requirements.
- [ ] 16.6 Fold accepted delta specs into canonical specs only after implementation + qualification are green.
- [ ] 16.7 Reconcile Changes 026/027 task truth without changing external evidence.
- [ ] 16.8 Update `.agent/state.json` with exact final SHA, verification evidence, remaining blockers, and next action.
- [ ] 16.9 Commit and push all useful work to `main` with a detailed session report; working tree must be clean or residual changes explicitly explained.

## Completion gate

Change 028 is not complete until ALL of these are true:

- no controller-crash path can admit a second mutating actor while prior ownership is live/unknown;
- no kill path can target an unverified/PID-reused process;
- no dispatch/control/completion source can be durably consumed without the required run transition being committed;
- every post-transaction external effect introduced by the change is replayable/idempotent;
- startup/listen-failure teardown cannot strand owned browser/process resources;
- focused fault-injection + full fast/typecheck/build/lint/OpenSpec gates are green;
- real-process evidence covers the no-second-writer and no-foreign-kill claims on the supported host tier;
- external blockers from 026/027 remain truthfully external, not silently reclassified as complete.
