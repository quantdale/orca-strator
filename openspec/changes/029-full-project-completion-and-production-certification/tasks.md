# Tasks: Full project completion and production certification

Checkboxes reflect implementation truth only. Never mark a task complete because code exists; mark it complete only when acceptance evidence exists on the current final tree.

## 0. Reconcile baseline and scope

- [ ] 0.1 Pull/reconcile `main`, record exact starting SHA, and confirm ancestry from planning baseline `0811c8d8e06739c193d7e509140dc4e55dd0ed9f` plus Change-029 planning commits.
- [ ] 0.2 Read `AGENTS.md`, `.agent/state.json`, Changes 026/027/028/029, canonical OpenSpec, ROADMAP, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, TEST-STRATEGY, SECURITY, DEVELOPMENT, OBSERVABILITY, packaging/release scripts and workflows before editing runtime logic.
- [ ] 0.3 Inventory every tracked file on the current tree and classify source/tests/scripts/workflows/docs/specs/packaging/agent metadata/local-data rules; record count and audit method in the final report.
- [ ] 0.4 Run baseline cheap gates: source integrity/version coherence, strict OpenSpec, focused ownership/transition tests, affected workspace typecheck.
- [ ] 0.5 Create an implementation ledger mapping every unchecked Change-028 task and every new Critical/High audit finding to owning files + tests.

## 1. Finish Change 028: durable process-attempt ownership

- [ ] 1.1 Give every real child spawn attempt a unique durable process-attempt identity correlated to executor run/packet/actor/controller instance.
- [ ] 1.2 Persist ownership for every actual attempt before launch admission is considered safe.
- [ ] 1.3 Separate PRE_SPAWN failure from POST_SPAWN ownership/admission failure.
- [ ] 1.4 A POST_SPAWN persistence failure must never enter generic retry until the prior child is verified terminated and durable attempt state is terminal.
- [ ] 1.5 UNKNOWN/PID_REUSED termination state must quarantine and abort; never retry into a possible second writer.
- [ ] 1.6 Install/track exit observation so a short-lived child exiting while ownership persistence awaits is recorded exactly once.
- [ ] 1.7 On exit, persist terminal process ownership before actor-lease release.
- [ ] 1.8 All-pre-spawn-failure paths must release/terminalize a reusable STARTING lease; any uncertain post-spawn path must quarantine instead.
- [ ] 1.9 Regression matrix covers ownership-write failure after spawn, verified-kill success, unverified-kill refusal, no-double-spawn retry, short-lived exit during ownership handshake, and all-pre-spawn-failed cleanup.

## 2. Finish Change 028: SWARM/DAG ownership and worktree safety

- [ ] 2.1 Acquire exactly one repository strategy lease for SWARM/DAG before admitting workers.
- [ ] 2.2 Persist each SWARM/DAG worker process as child ownership under the strategy lease.
- [ ] 2.3 Manual/raw executor and strategy starts cannot bypass the same durable lease gate.
- [ ] 2.4 Lease release waits for terminal/proven-dead descendants and strategy actor boundary.
- [ ] 2.5 Startup ownership reconciliation occurs before strategy recovery/worktree cleanup.
- [ ] 2.6 LIVE_MATCH or UNKNOWN worktree owners protect worktrees from sweep/release.
- [ ] 2.7 Proven-dead worker recovery preserves dirty evidence and yields truthful RECOVERY_REQUIRED state.
- [ ] 2.8 DAG staging cleanup cannot remove a checkout owned by live/uncertain worker process.
- [ ] 2.9 Concurrency/restart tests cover overlapping direct/strategy starts, prior live writer, recovery retry, direct-vs-strategy conflict, SWARM/DAG restart, two independent repositories, clean/dirty/live/unknown/orphan worktrees.

## 3. Finish Change 028: transition atomicity everywhere

- [ ] 3.1 Route SWARM/DAG completion and postflight continuation through atomic source-consume + run-transition processing.
- [ ] 3.2 Route Sol control through atomic control-consume + required run transition; browser close/wake is post-commit replayable effect.
- [ ] 3.3 Route dispatch detection/start authorization through durable transition intent rather than one in-memory callback.
- [ ] 3.4 Preserve strict run/repository/iteration/dispatch/strategy correlation and stale-marker rejection.
- [ ] 3.5 Make browser operation completion/page close replayable and harmless when already closed.
- [ ] 3.6 Add duplicate/stale/race/crash-window tests for dispatch, control, direct completion, SWARM completion, DAG completion and postflight retry.
- [ ] 3.7 Crash matrices prove there is no consumed-without-transition durable state for every source kind.

## 4. Finish Change 028: async lifecycle ownership and shutdown

- [ ] 4.1 Make watcher dispatch/control callbacks Promise-aware or durably enqueue their work.
- [ ] 4.2 Remove naked fire-and-forget durable mutation/resource-launch callbacks from app construction and runtime.
- [ ] 4.3 Track direct executor completion promises through shutdown like strategy completion promises.
- [ ] 4.4 Audit every `void`/detached promise in controller runtime; await, track, or persist recovery evidence for every critical mutation path.
- [ ] 4.5 Add rejection-injection tests proving no unhandled rejection and truthful durable recovery state.
- [ ] 4.6 Add construction cancellation/cleanup ownership for resources created before `buildApp()` completes.
- [ ] 4.7 SIGINT/SIGTERM during initialization latches shutdown, prevents new admission, settles partial cleanup, then releases singleton ownership.
- [ ] 4.8 Startup ownership reconciliation/browser rehydrate honors abort/shutdown latch.
- [ ] 4.9 Fastify listen failure, including EADDRINUSE, closes the fully assembled runtime graph before DB/singleton release.
- [ ] 4.10 Teardown order is deterministic and bounded across watchers, timers, executors/coordinators, BrowserManager, Fastify, DB and singleton lock.
- [ ] 4.11 Subprocess tests inject SIGTERM at multiple construction checkpoints and prove no surviving owned child/profile lock.

## 5. Finish Change 028: browser-profile stale recovery and observability

- [ ] 5.1 Add bounded host Chrome profile-ownership probe keyed to exact dedicated `--user-data-dir`.
- [ ] 5.2 Dead controller PID alone cannot authorize profile reclaim.
- [ ] 5.3 Live/unknown exact-profile Chrome ownership blocks reclaim/quarantines safely.
- [ ] 5.4 Proven stale profile lock recovery is bounded, idempotent and regression-tested.
- [ ] 5.5 Provide explicit safe operator reconciliation/verified-kill path if required; never add unsafe force-clear lease.
- [ ] 5.6 Emit bounded secret-redacted audit events for lease acquire/quarantine/release, process verdict, transition/outbox retry and recovery decisions.
- [ ] 5.7 Campaign/event persistence remains FK-clean when referenced entities are terminal/deleted.

## 6. Change 028 failure injection and qualification

- [ ] 6.1 Kill controller while direct executor runs; restart; prove no second writer while old ownership is live/uncertain.
- [ ] 6.2 Repeat for SWARM and DAG worker/staging paths.
- [ ] 6.3 Verified-kill test kills correct tree while unrelated/foreign sibling remains alive.
- [ ] 6.4 PID-reuse/UNKNOWN test performs no kill and leaves repository quarantined.
- [ ] 6.5 Crash matrix around dispatch completion transaction/outbox boundary.
- [ ] 6.6 Crash matrix around Sol-control transaction/outbox boundary.
- [ ] 6.7 Crash matrix around actor-start delivery proves replay cannot double-spawn.
- [ ] 6.8 Startup SIGTERM during Sol/browser rehydrate leaves no orphan browser/profile owner.
- [ ] 6.9 Listen-failure test proves all resources settle before singleton release.
- [ ] 6.10 Two-repository test proves quarantine/failure isolation.
- [ ] 6.11 Run focused ownership/transition/lifecycle suites repeatedly until deterministic.
- [ ] 6.12 Run full fast tier, typecheck, build, lint, strict OpenSpec, diff-check, source-integrity/version gates.
- [ ] 6.13 Use remaining long-session capacity for repeated crash/restart and ownership-contention loops; record run counts/outcomes.

## 7. Close Change 028 documentation/spec truth

- [ ] 7.1 ARCHITECTURE documents actor/process ownership and transition inbox/outbox boundaries.
- [ ] 7.2 DATA-MODEL documents tables, idempotency keys, ownership states and retention.
- [ ] 7.3 RUNTIME-MODEL documents crash/quarantine/replay transitions and `uncertain != dead`.
- [ ] 7.4 OBSERVABILITY documents recovery/quarantine events and diagnostics.
- [ ] 7.5 DEVELOPMENT documents failure-injection commands and safe real-process requirements.
- [ ] 7.6 Reconcile all Change-028 checkboxes with current-tree evidence, fold accepted deltas into canonical specs, archive only when all acceptance gates are true.

## 8. Close Change 027 fresh-clone/resilience truth

- [ ] 8.1 Run final committed-source battery: `npm test`, `npm run test:real` with classified skips only, `npm run typecheck`, `npm run build`, `npm run lint`, strict OpenSpec, diff-check, integrity/version checks, package/smoke where environment permits.
- [ ] 8.2 Re-audit docs/ROADMAP wording so no earlier campaign overstates fresh-clone, package, upgrade or runtime qualification.
- [ ] 8.3 Reconcile `.agent/state.json`, canonical specs and archive Change 027 only after final evidence passes.

## 9. Close Change 026 installed release/lifecycle truth

- [ ] 9.1 Perform local release-script dry run without creating/publishing a production tag.
- [ ] 9.2 Execute installer lifecycle/upgrade acceptance through sanctioned ephemeral Windows workflow when available; otherwise preserve exact EXTERNAL-BLOCKED status and workflow instructions.
- [ ] 9.3 Run package runtime smoke, backup/restore, unpacked upgrade preservation, crash recovery, short endurance and multi-repo stress on final tree where supported.
- [ ] 9.4 Run long endurance when host/time budget permits and report threshold metrics honestly.
- [ ] 9.5 Record package artifact filename/size/SHA-256/version/buildId/architecture/signing/qualification tier.
- [ ] 9.6 Reconcile Change-026 final battery and archive only when all non-external evidence is complete and external evidence is either obtained or explicitly retained as external qualification.

## 10. Whole-repository deep audit after implementation

- [ ] 10.1 Re-inventory every tracked file on final candidate SHA; compare count/classification to baseline.
- [ ] 10.2 Scan executable/config files for TODO/FIXME/temp bypasses, detached async mutation, unsafe spawn/kill, non-atomic transitions, stale migrations/schema/version assumptions, ignored required inputs, secret leakage, unbounded retries/logs/timers, missing timeout/abort propagation, path traversal/symlink/Windows quoting, singleton/profile/worktree races and test-only production assumptions.
- [ ] 10.3 Trace end-to-end flows: config/bootstrap -> DB/migrations -> singleton -> watcher -> dispatch -> direct/SWARM/DAG -> completion/postflight -> Sol wake/control -> browser close -> scheduler -> shutdown/restart.
- [ ] 10.4 Trace desktop supervisor/install/upgrade/uninstall/backup/restore/package/release flows end-to-end.
- [ ] 10.5 Trace every persistent table/store migration and relationship for crash consistency, idempotency, FK integrity and retention.
- [ ] 10.6 Trace every HTTP/WebSocket/desktop bridge mutation surface for authorization, correlation and durable invariants.
- [ ] 10.7 Fix every reproducible Critical/High finding and add regression evidence before proceeding.
- [ ] 10.8 Re-run audit after fixes until no known locally reproducible Critical/High finding remains.

## 11. Final production certification matrix

- [ ] 11.1 FAST_TESTS
- [ ] 11.2 REAL_PROCESS_TESTS
- [ ] 11.3 TYPECHECK
- [ ] 11.4 BUILD
- [ ] 11.5 LINT
- [ ] 11.6 OPENSPEC_STRICT
- [ ] 11.7 SOURCE_INTEGRITY
- [ ] 11.8 VERSION_COHERENCE
- [ ] 11.9 BACKUP_RESTORE_QUALIFIED
- [ ] 11.10 PACKAGE_BUILT
- [ ] 11.11 PACKAGE_RUNTIME_QUALIFIED
- [ ] 11.12 CRASH_RECOVERY_QUALIFIED
- [ ] 11.13 MULTI_REPO_STRESS_QUALIFIED
- [ ] 11.14 ENDURANCE_SHORT_QUALIFIED
- [ ] 11.15 ENDURANCE_LONG_QUALIFIED or explicit bounded external/time qualification note
- [ ] 11.16 UNPACKED_UPGRADE_PRESERVATION_QUALIFIED
- [ ] 11.17 INSTALLER_LIFECYCLE_QUALIFIED or exact EXTERNAL-BLOCKED evidence
- [ ] 11.18 RELEASE_DRY_RUN_QUALIFIED
- [ ] 11.19 `git diff --check`, clean working tree, no generated/local artifacts accidentally tracked.

## 12. Final docs, state and handoff

- [ ] 12.1 README accurately states supported scope, prerequisites, installation/run path, backup/restore, recovery and qualification limits.
- [ ] 12.2 ROADMAP contains final project status without stale “future milestone” work that is actually required for documented scope.
- [ ] 12.3 ARCHITECTURE/RUNTIME-MODEL/DATA-MODEL/SECURITY/DEVELOPMENT/TEST-STRATEGY/OBSERVABILITY agree with implementation.
- [ ] 12.4 OpenSpec canonical specs contain all accepted behavior; completed changes archived truthfully.
- [ ] 12.5 `.agent/state.json` records exact final SHA, completion/qualification matrix, external-only evidence, remaining blockers and next action.
- [ ] 12.6 Produce `docs/audits/FINAL-PROJECT-COMPLETION-REPORT.md` with file inventory, findings/fixes, exact commands/results, stress counts, artifact hashes, qualification matrix and any external-only acceptance.
- [ ] 12.7 Commit coherent final documentation/state, push all useful work, confirm `main == origin/main`, and leave a clean tree.

## Completion gate

Do NOT declare Orca-Strator complete unless all locally executable items above are true and no known locally reproducible Critical/High defect remains. External sanctioned installer/release evidence may remain explicitly external, but it must be the only remaining category and must not conceal unfinished engineering.