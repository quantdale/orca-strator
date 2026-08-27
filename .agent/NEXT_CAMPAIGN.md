# Orca-Strator next campaign — 12-hour full project completion run

**Mode:** autonomous implementation + hardening + certification  
**Target branch:** `main`  
**Umbrella change:** `029-full-project-completion-and-production-certification`  
**Dependency order:** finish `028` -> reconcile/close `027` -> reconcile/close `026` -> final repository certification  
**Planning baseline:** `0811c8d8e06739c193d7e509140dc4e55dd0ed9f` plus Change-029 planning commits  
**Objective:** make the documented project genuinely complete and production-ready, not merely “mostly implemented”  
**Session budget:** target approximately **12 hours of useful autonomous work**. Do not idle to consume time. If engineering finishes early, spend remaining useful budget on crash/restart, contention, lifecycle, endurance, packaging and multi-repository stress until confidence saturates.

## Mission

Pull the latest repository and execute the OpenSpec work to completion. The authoritative task ledger is:

`openspec/changes/029-full-project-completion-and-production-certification/tasks.md`

Change 029 is an umbrella completion campaign. It does **not** supersede unfinished truth in Changes 026/027/028. Finish those dependencies first, then certify the whole product.

You are explicitly authorized to edit implementation, tests, scripts, workflows, docs, OpenSpec, and agent state; run supported local test/package/failure-injection commands; commit coherent slices; and push useful completed work to `main`. Never force-push, destroy unknown work, weaken safety invariants, or fabricate qualification evidence.

## Read before editing

Read in this order:

1. `AGENTS.md`
2. `.agent/state.json`
3. `.agent/EXECUTION_PROMPT.md`
4. this file
5. `openspec/changes/028-durable-execution-ownership-and-crash-consistency/{proposal.md,design.md,tasks.md}` and every delta spec beneath it
6. `openspec/changes/029-full-project-completion-and-production-certification/{proposal.md,design.md,tasks.md}`
7. Change 027 proposal/design/tasks and delta specs
8. Change 026 proposal/design/tasks and delta specs
9. canonical `openspec/specs/**`
10. `README.md`, ROADMAP, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, TEST-STRATEGY, SECURITY, DEVELOPMENT, OBSERVABILITY/FAILURES docs
11. root/workspace package manifests, Windows CI/package workflows, packaging/release/backup scripts, desktop supervisor, controller startup/runtime/migration/browser/executor/strategy/scheduler paths

Then reconcile against **pulled current `main`**. Do not reset to an old SHA or trust stale task wording over current code/tests.

## Non-negotiable invariants

### One repository writer

At most one mutating logical repository actor may exist. Direct, SWARM and DAG flows must share the same durable actor boundary. A strategy owns one lease; workers are child process ownership, not competing repository leases. LIVE/UNKNOWN prior ownership blocks or quarantines.

### PID is not identity

No kill/reclaim may rely on PID alone. Only sufficient LIVE_MATCH identity authorizes termination. DEAD, PID_REUSED and UNKNOWN remain distinct and fail closed.

### Spawn is an irreversible epistemic boundary

Once the OS has actually spawned a child, generic launch retry is forbidden until that exact attempt is durably known terminal and verified dead. If termination cannot be proven, quarantine. Every real OS attempt gets a unique durable attempt identity.

### Durable source transition atomicity

Dispatch/control/completion source consumption and its required run transition occur in one SQLite transaction. External browser/Git/process/network work occurs only after commit through replayable/idempotent outbox or an equivalent durable once-only boundary.

### No unowned critical async mutation

Every callback/promise that can mutate durable orchestration state or launch resources is awaited, tracked, or durably enqueued. No naked fire-and-forget on correctness-critical paths.

### Shutdown is a latch

After shutdown starts, no new resource admission. Signal during construction, build failure, browser rehydrate, ownership reconciliation or Fastify listen failure must converge on bounded deterministic teardown before DB/singleton ownership is released.

### Worktree/profile recovery fails closed

Never sweep a worktree or reclaim a browser profile while a live or uncertain process may own it. Preserve dirty evidence. Dead controller PID alone is not proof an exact Chrome profile is unowned.

### Qualification labels are evidence, not optimism

Do not call PACKAGE_RUNTIME_QUALIFIED, INSTALLER_LIFECYCLE_QUALIFIED, ENDURANCE_LONG_QUALIFIED, etc. unless the required command/workflow actually ran on the correct host/environment and passed.

## Execution order

### Phase A — baseline truth and exhaustive inventory

- pull/reconcile `main`; record start SHA;
- inventory every tracked file and classify it;
- run source-integrity, version coherence, strict OpenSpec and focused ownership/transition tests;
- map every unchecked Change-028 item and any new Critical/High finding to files/tests;
- preserve previous external blockers exactly until evidence changes.

### Phase B — finish direct process-attempt ownership

Close all remaining Change-028 direct runner/ownership gaps:

- unique attempt identity per real spawn;
- pre-spawn vs post-spawn failure taxonomy;
- no retry after uncertain post-spawn failure;
- verified-kill-only cleanup;
- exit observation installed before/around awaited ownership persistence;
- terminal process state before lease release;
- correct STARTING cleanup when no real spawn occurred;
- deterministic regressions for every crash window.

Do not move on while a direct executor can plausibly double-spawn after crash/persistence failure.

### Phase C — finish SWARM/DAG ownership and worktree safety

- one strategy lease per repository actor;
- durable worker process ownership beneath it;
- raw/manual starts use the same gate;
- startup ownership reconciliation before strategy/worktree recovery;
- live/unknown ownership protects worktrees/staging;
- dead-worker recovery preserves dirty evidence;
- direct-vs-strategy and restart races covered.

### Phase D — finish transition atomicity for every source

Move all remaining producers through the durable transition processor:

- SWARM completion;
- DAG completion;
- postflight continuation/retry;
- Sol control;
- watcher dispatch/start authorization;
- browser close/operation completion side effects.

Add duplicate/stale/race/crash matrices. There must be no durable consumed-without-transition state.

### Phase E — own async lifecycle + unified shutdown

Audit the controller runtime for every detached promise, timer and callback. Fix correctness-critical fire-and-forget mutation. Add lifecycle cancellation/cleanup ownership from the first constructed resource through final shutdown. Test SIGTERM/SIGINT at multiple construction checkpoints and EADDRINUSE/listen failure.

### Phase F — browser stale-profile recovery + operator diagnostics

Implement exact `--user-data-dir` process ownership probing, fail-closed reclaim, safe diagnostics, redacted audit events, and explicit reconciliation/verified-kill tooling only if it cannot create a second writer. Never add “force clear”.

### Phase G — Change 028 failure injection and closure

Run repeated real child/process restart tests for direct/SWARM/DAG, PID reuse/no-foreign-kill, transition crash matrices, actor-start replay, startup signal interruption, listen failure and two-repository isolation. Fix every reproducible Critical/High defect. Reconcile docs/specs/tasks; archive Change 028 only when its completion gate is actually met.

### Phase H — close Change 027

Run its full final committed-source battery. Correct any stale claims in docs/ROADMAP/state/canonical specs. Archive only when evidence is current on the final tree.

### Phase I — close Change 026 as far as reality permits

Run local release dry-run, package runtime smoke, backup/restore, unpacked upgrade, crash recovery, short endurance, multi-repo stress, and long endurance where host/time permit. Use sanctioned Windows workflow for installer lifecycle/upgrade qualification if available. If that environment is genuinely unavailable, leave the narrow qualification as EXTERNAL-BLOCKED with exact workflow/command—not as unfinished engineering and not as a fake PASS.

### Phase J — final repository-wide audit

On the final candidate SHA, re-inventory every tracked file and inspect executable/configuration paths for:

- TODO/FIXME/temp bypasses;
- detached async mutations;
- unsafe child process launch/kill;
- non-atomic durable transitions;
- migration/schema/version drift;
- ignored required source/package inputs;
- secret leakage/unsafe logs;
- unbounded retries/timers/logs;
- missing timeout/abort propagation;
- path traversal, symlink and Windows quoting hazards;
- singleton/profile/worktree ownership races;
- test-only assumptions leaking into production;
- stale docs/OpenSpec/agent-state claims.

Trace end-to-end flows, not isolated files:

`bootstrap/config -> DB/migrations -> singleton -> watcher -> dispatch -> direct/SWARM/DAG -> completion/postflight -> Sol wake/control -> browser -> scheduler -> shutdown/restart`

and

`desktop supervisor -> install/upgrade/uninstall -> backup/restore -> package -> release/rollback`.

Fix every reproducible Critical/High finding, add regression evidence, then audit again.

## Required final gates

Run and record the exact result of all supported gates on the final candidate tree:

- `npm test`
- `npm run test:real` (classified environment skips only)
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `npm run openspec:validate`
- `npm run version:check`
- source-integrity guard
- `git diff --check`
- `npm run test:backup-restore`
- `npm run package:win` / installer variant where supported
- `npm run smoke:package`
- `npm run smoke:installer` where sanctioned
- `npm run test:crash-recovery`
- `npm run test:endurance:short`
- `npm run test:endurance` when time/host permits
- `npm run test:stress:repos`
- `npm run test:upgrade:unpacked`
- release dry-run/manifest/tag-integrity checks without publishing a production release

Do not replace a failing required gate with a smaller test and call the tier green.

## Use the 12-hour budget intelligently

Do not stop after the first green full suite. If useful budget remains:

1. repeat crash/restart loops around the exact durability boundaries changed;
2. run direct/SWARM/DAG contention and restart races repeatedly;
3. alternate two repositories to prove isolation;
4. repeat browser/profile startup/shutdown/recovery cycles;
5. run short/long endurance in bounded batches;
6. inspect logs for unhandled rejections, FK warnings, stale leases, duplicate effects, orphan PIDs/worktrees/profiles;
7. rerun package/runtime smoke after late fixes;
8. re-run the whole fast/type/build/lint/OpenSpec battery after any cross-cutting repair.

Do not invent features merely to fill time.

## Commit/push discipline

Work directly on `main` per repository policy unless current repo instructions say otherwise.

For each coherent slice:

- reconcile latest remote first;
- preserve unknown dirty work;
- implement + focused regression tests;
- update OpenSpec checkbox truth immediately after evidence exists;
- commit with a detailed message naming defect/invariant/tests;
- push;
- periodically confirm CI on pushed SHA;
- update `.agent/state.json` at meaningful durable waypoints.

Never use `git reset --hard`, destructive clean, force-push, or history rewriting against useful work.

## Final deliverable

Create/update:

`docs/audits/FINAL-PROJECT-COMPLETION-REPORT.md`

It must include:

- start SHA and final SHA;
- exhaustive tracked-file inventory count/classification;
- Critical/High findings and exact fixes/tests;
- Change 028/027/026 closure status;
- full certification matrix with PASS / FAIL / EXTERNAL-BLOCKED / N/A;
- exact commands and relevant result counts;
- crash/restart/stress/endurance iteration counts;
- artifact filenames/sizes/SHA-256/version/buildId/arch/signing/tier where produced;
- remaining external-only evidence and exact way to obtain it;
- statement of any known remaining locally reproducible Critical/High blocker (target: none);
- confirmation that OpenSpec/docs/state reflect implementation truth;
- final `main == origin/main` and clean-working-tree evidence.

## Stop condition

Stop only when all locally solvable engineering is complete, all supported local certification gates are green, the final deep audit finds no known locally reproducible Critical/High defect, documentation/OpenSpec/state are reconciled, useful work is committed/pushed, and any remaining blocker is genuinely external qualification with exact execution instructions.

The objective is **full project completion**, not simply progress.