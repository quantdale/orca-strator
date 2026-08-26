# Tasks: Durable execution ownership and crash consistency

Checkboxes reflect implementation truth only. Do not mark a task complete because code was attempted; mark it only when its acceptance evidence exists.

## 0. Reconcile and freeze the baseline

- [ ] 0.1 Confirm `main` contains planning commit for Change 028 and record exact implementation start SHA in `.agent/state.json`.
- [ ] 0.2 Read proposal -> all delta specs -> design -> this task file before editing runtime code.
- [ ] 0.3 Preserve Changes 026/027 and their external acceptance blockers unchanged; do not archive or fake them.
- [ ] 0.4 Run the cheapest useful pre-change gates available on the execution host (`npm run version:check`, `npm run openspec:validate`, targeted fast tests). Record any pre-existing failures separately.
- [ ] 0.5 Add a short implementation ledger to the session report mapping F1–F7 in `docs/audits/2026-08-26-next-campaign-crash-consistency.md` to concrete tests/files.

## 1. Write failing crash-boundary tests first

- [ ] 1.1 Add a deterministic test proving the current/reproduced F1 shape: persisted active executor + controller restart must not permit a second actor until ownership is reconciled.
- [ ] 1.2 Add SWARM and DAG variants covering worker/worktree ownership after restart.
- [ ] 1.3 Add a dispatch crash-window test: a durable validated completion must not end with `dispatch=consumed` while the required run transition is absent.
- [ ] 1.4 Add a Sol-control crash-window test: control consumption must not outrun the corresponding run transition.
- [ ] 1.5 Add startup interruption/listen-failure tests that assert teardown ordering and no resource admission after shutdown is latched.
- [ ] 1.6 Add PID-reuse/unknown-process tests before any kill/reconciliation implementation.

## 2. Add additive ownership/transition persistence

- [ ] 2.1 Add the next SQLite migration with repository actor lease persistence.
- [ ] 2.2 Add process ownership persistence with controller instance, actor/packet correlation, PID + non-secret identity evidence, lifecycle state, timestamps, and indexes.
- [ ] 2.3 Add durable transition-intent persistence with a UNIQUE logical idempotency key.
- [ ] 2.4 Add durable side-effect outbox persistence with deterministic idempotency key and delivery state.
- [ ] 2.5 Update schema-compatibility maximum version and all backup/migration/version tests affected by the additive schema.
- [ ] 2.6 Add store tests for uniqueness, FK/correlation behavior, idempotent insert, CAS updates, and restart reads.

## 3. Add controller instance + process identity primitives

- [ ] 3.1 Generate one cryptographic controller instance ID per process and pass it through app construction without conflating it with lifecycle auth tokens.
- [ ] 3.2 Extend runtime-lock diagnostics with controller instance ID if useful; preserve backward compatibility for old lock metadata.
- [ ] 3.3 Implement `ProcessProbe` (or equivalent) with explicit LIVE_MATCH / DEAD / PID_REUSED / UNKNOWN semantics.
- [ ] 3.4 Implement bounded Windows process identity capture/classification without admin-only assumptions; keep Linux/test implementation deterministic.
- [ ] 3.5 Implement verified process-tree kill that refuses PID_REUSED/UNKNOWN records.
- [ ] 3.6 Add unit tests for evidence capture, dead process, live match, PID reuse, unknown probe failure, and no-foreign-kill behavior.

## 4. Make ExecutorRunner durably own spawned processes

- [ ] 4.1 Add a spawn hook/handshake that surfaces PID after real spawn and before the caller treats launch as safely active.
- [ ] 4.2 Persist each actual spawn attempt's process ownership; launch retries must remain distinguishable and once-only.
- [ ] 4.3 On ownership persistence failure after spawn, terminate only if identity is verified; otherwise quarantine the actor.
- [ ] 4.4 On process exit, persist terminal process state before releasing repository actor ownership.
- [ ] 4.5 Preserve existing once-only exit callback, watchdog, pause, emergency-kill, and launch-retry behavior.

## 5. Enforce one durable repository actor

- [ ] 5.1 Implement actor lease acquire/bind/quarantine/release/reconcile service with DB uniqueness as the ownership boundary.
- [ ] 5.2 Acquire a SINGLE_AGENT lease before direct executor process admission.
- [ ] 5.3 Acquire one SWARM/DAG strategy lease before workers are admitted; do not create one repository lease per worker.
- [ ] 5.4 Persist worker process ownership beneath the strategy lease for every SWARM/DAG ExecutorRunner.
- [ ] 5.5 Block manual/raw executor/strategy HTTP starts that bypass normal loop flow unless the same durable lease gate authorizes them.
- [ ] 5.6 Ensure lease release waits for terminal/proven-dead child ownership and actor boundary.
- [ ] 5.7 Add concurrency tests: overlapping start calls, restart + old live writer, recovery retry, strategy/direct conflict, and two repositories remaining independent.

## 6. Reconcile ownership before worktrees

- [ ] 6.1 Reorder startup so prior actor/process reconciliation runs before `SwarmExecutionService.recoverAll()` / worktree cleanup.
- [ ] 6.2 Protect worktrees whose owner is LIVE_MATCH or UNKNOWN from automatic release/sweep.
- [ ] 6.3 Reconcile proven-dead workers into truthful RECOVERY_REQUIRED evidence without deleting dirty user/worker files.
- [ ] 6.4 Ensure orphan DAG staging sweep cannot remove a checkout still owned by a live/uncertain process.
- [ ] 6.5 Add restart tests for clean, dirty, live-owned, unknown-owned, and truly orphaned worktrees/stagings.

## 7. Build the durable transition processor

- [ ] 7.1 Implement per-repository transition serialization plus SQLite transactional application; DB transaction is the source of correctness, in-memory serialization is only contention control.
- [ ] 7.2 Add expected-state/CAS run update primitives and make stale-write failure explicit.
- [ ] 7.3 Implement transition intent enqueue/read/apply/retry/idempotency semantics.
- [ ] 7.4 In one transaction, apply source consumption + required run transition + required outbox rows.
- [ ] 7.5 Never perform awaited external I/O inside the transaction; add a test/guard that makes this architecture obvious.
- [ ] 7.6 Implement startup replay of PENDING/APPLYING/FAILED_RETRYABLE transition intents.
- [ ] 7.7 Mark invalid/stale sources durably terminal so they do not retry forever.

## 8. Build/reuse an idempotent side-effect outbox

- [ ] 8.1 Implement outbox claim/deliver/retry/terminal semantics with deterministic effect keys.
- [ ] 8.2 Reuse BrowserManager's existing durable Sol-operation intent for Sol-wake idempotency rather than creating a competing wake protocol.
- [ ] 8.3 Make browser operation completion/page close replayable and harmless when already closed.
- [ ] 8.4 If actor start is delivered through outbox, make actor lease/process ownership the exactly-once logical spawn boundary.
- [ ] 8.5 Replay pending outbox items during startup only after execution ownership reconciliation.
- [ ] 8.6 Add duplicate-delivery and crash-after-commit-before-delivery tests for every effect kind introduced.

## 9. Remove premature dispatch/control consumption

- [ ] 9.1 Remove dispatch consumption from `ExecutorService.handleTurnCompletion()`; completion validation reports durable evidence but does not independently consume the protocol source.
- [ ] 9.2 Route direct executor completion through the transition processor so dispatch consume + run transition are atomic.
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
- [ ] 16.4 Update `docs/OBSERVABILITY.md` with new recovery/quarantine events/diagnostics.
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
