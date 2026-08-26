# Change 028 execution prompt — durable execution ownership and crash consistency

**Status:** READY_TO_IMPLEMENT  
**Planned-From:** `4d1246aa2b9d5fbdd455d17d72b3259896f80432`  
**Target branch:** `main` (repository policy: commit/push directly; never force-push)  
**Campaign:** `028-durable-execution-ownership-and-crash-consistency`  
**Execution mode:** long autonomous hardening campaign. Use up to the user's requested ~12-hour session budget when useful, but do not pad runtime or wait artificially. If required work finishes earlier, spend remaining useful budget on fault injection, repeated crash/restart qualification, regression repair, and evidence—not new features.

## Mission

Implement Change 028 completely enough that Orca's unattended-execution safety is true across **controller process death**, not merely while one Node process remains alive.

The two non-negotiable outcomes are:

1. **No second writer after controller crash.** A lost ChildProcess handle is not proof the child died. Persist actor/process ownership, reconcile it conservatively, and block a replacement actor until prior ownership is proven dead or explicitly/verifiedly terminated.
2. **No consumed-without-applied transition.** Dispatch/control/completion protocol sources and their required run transitions must be crash-atomic; external effects happen from a durable idempotent outbox/replay path.

This is hardening of existing Milestone 6/17/23/24 promises. Do not invent another product feature.

## Read first — authoritative order

1. `AGENTS.md`
2. `.agent/state.json`
3. `.agent/PLANNER_HANDOFF.md`
4. `docs/audits/2026-08-26-next-campaign-crash-consistency.md`
5. `openspec/changes/028-durable-execution-ownership-and-crash-consistency/proposal.md`
6. all three delta specs under the change
7. `design.md`
8. `tasks.md`
9. relevant canonical specs / `docs/RUNTIME-MODEL.md`, `ARCHITECTURE.md`, `DATA-MODEL.md`, `OBSERVABILITY.md`

Then reconcile against current `main`. If newer commits already satisfy a requirement, prove it with tests and mark only the genuinely satisfied task; do not redo landed work.

## Planning findings you must close

### P0/critical class A — orphan writer uncertainty

Current startup reconciliation marks persisted active executors failed while explicitly having no safe proof the previous process is gone. Executor/worker PID identity is not durable. `RECOVERY_REQUIRED` falls outside active-run ownership, so a later campaign can start while an old process may still write.

Affected seams include at least:

- `apps/controller/src/loop/startup-reconciler.ts`
- `apps/controller/src/executor/executor-runner.ts`
- `apps/controller/src/executor/executor-service.ts`
- `apps/controller/src/executor/executor-store.ts`
- `apps/controller/src/strategy/swarm-execution-service.ts`
- `apps/controller/src/strategy/dag-execution-service.ts`
- `apps/controller/src/packets/worktree-isolation-service.ts`
- `apps/controller/src/loop/iteration-execution-coordinator.ts`
- `apps/controller/src/db/migrate.ts`

### P0/critical class B — split durable transition writes

Examples on planning base:

- valid executor completion can mark a dispatch consumed in ExecutorService before LoopService applies run continuation;
- LoopService also consumes dispatch before awaited continuation;
- Sol control flow closes Sol operation + consumes control before run transition;
- watcher durable observation and marker insertion are not equivalent to durable application; callback delivery is one-time/in-memory.

Close the defect class, not just one callsite.

### High class C — unowned asynchronous state callbacks

Production build wiring fires key loop mutation promises without local ownership. Convert to await/track/durable enqueue semantics and audit adjacent detached promises capable of state mutation/resource launch.

### High class D — unsafe init/listen failure teardown

`index.ts` assumes no browser/executor can exist before `buildApp` returns, but startup reconciliation can retry Sol/browser work and watcher starts before return. Signal/listen failure must run bounded cleanup before lock/DB release.

### High class E — automated profile stale lock

Automated profile lock uses controller PID as owner; a surviving Chrome can outlive that PID. Reclaim only after authoritative profile-process proof; otherwise quarantine.

## Required architecture

You may rename classes/tables if repository conventions justify it, but the following semantics are mandatory.

### 1. Controller instance epoch

Generate one random controller instance ID per process. It is diagnostic ownership identity, not an auth secret. Persist it with actor/process ownership.

### 2. Durable repository actor lease

Use SQLite uniqueness to enforce one repository execution actor. SINGLE_AGENT owns one lease; SWARM/DAG each own one strategy lease while their workers get subordinate process records.

In-memory maps remain optimizations only.

### 3. Durable process ownership + conservative probe

Capture child PID and stable, non-secret process identity immediately after real spawn. Reconciliation verdicts must distinguish live match, dead, PID reused, and unknown/unprovable.

Never kill on PID alone. Never auto-clear UNKNOWN. A live/unknown prior actor blocks a second writer.

### 4. Transition inbox + transaction application

Persist an idempotent transition intent for protocol events. Source consume + required run mutation + required outbox rows happen in one SQLite transaction with expected-state/CAS predicates.

No external I/O inside that transaction.

### 5. Side-effect outbox/replay

After commit, deliver browser/process/network side effects from durable idempotent intent. Reuse existing durable Sol-operation semantics rather than creating a second wake truth source.

If actor start is outboxed, actor lease/process ownership is the logical exactly-once spawn boundary.

### 6. Abortable construction + unified teardown

Shutdown can latch while `buildApp` is in flight. Partial construction must clean itself. Listen failure must call the assembled runtime teardown, not close DB first. Runtime singleton release is last after owned resources settle/bounded recovery is persisted.

### 7. Browser profile quarantine

Dead controller PID != dead Chrome. Check exact dedicated profile ownership. If uncertain, refuse acquisition and expose actionable quarantine.

## Ordered implementation workstreams

Follow `tasks.md`; this section is an execution emphasis, not a second checklist.

### Workstream A — reproduce before repair

Create deterministic failing tests for:

- direct executor alive across controller restart + second-start attempt;
- SWARM/DAG worker ownership across restart;
- dispatch consumed before run continuation crash;
- control consumed before run transition crash;
- SIGTERM during startup reconciliation;
- PID reuse/unknown probe.

Do this early so architecture is driven by observable failures.

### Workstream B — persistence + ownership primitive

Add additive migration (current schema max is 23 at planning time), stores, controller instance ID, process probe, actor lease service. Update schema compatibility/backup tests.

Keep migration low-risk and additive.

### Workstream C — direct executor integration

Add ExecutorRunner spawn hook, persist each actual spawned attempt, bind direct executor to actor lease, persist exit before release, preserve launch retry/pause/kill/watchdog behavior.

Pay special attention to spawn-success / ownership-write-failure. That path must not create an untracked writer.

### Workstream D — strategy/worktree integration

Acquire one strategy actor lease. Persist every worker process below it. Reorder restart reconciliation: actor/process truth before worker/worktree/staging cleanup. Protect live/unknown-owned worktrees.

Do not serialize legitimate SWARM/DAG workers unnecessarily.

### Workstream E — transition processor

Introduce idempotent transition intents, CAS run updates, one-transaction marker consume + run state + outbox creation, startup replay, terminal stale/rejected intents.

Remove premature dispatch consumption from ExecutorService.

Migrate dispatch, control, direct completion, and strategy completion/postflight continuation carefully. Preserve postflight remote publication truth: COMPLETED is still not success unless remote publication is confirmed as current code requires.

### Workstream F — async ownership

Make watcher and direct executor completion paths awaitable/tracked. Every detached state mutation/resource-launch Promise must have a clear owner. Keep teardown-safe catches only where durable state has already made the operation recoverable.

### Workstream G — lifecycle/profile

Implement abortable build cleanup; fix listen failure; prevent rehydrate/start after shutdown latch. Harden automated browser stale profile lock with exact-profile process probe/quarantine.

### Workstream H — qualification

Run exhaustive state tests plus real subprocess fault injection. Repair every Critical/High regression introduced or exposed by this change before declaring it review-ready.

## Safety constraints

- NEVER `git reset --hard`, `git clean`, discard unknown dirty work, or force push.
- NEVER kill an unverified/unknown/PID-reused process.
- NEVER infer “dead” from “controller restarted.”
- NEVER hold SQLite transaction across awaited browser/Git-network/process I/O.
- NEVER mark a protocol marker consumed before its required run transition is atomically durable.
- NEVER solve duplicate delivery by deleting audit evidence.
- NEVER weaken dispatch/control correlation, remote publication verification, permission policy, scheduler isolation, or existing profile auth safety.
- NEVER fake Tailscale/OpenCode/installer/soak evidence from Changes 026/027.
- Keep secrets, auth cookie values, provider tokens, and sensitive command/env data out of new process/transition records and logs.
- Maintain Windows-first behavior and WSL compatibility.

## Test/qualification requirements

Minimum required evidence before READY_FOR_REVIEW:

1. process probe + actor lease unit tests;
2. DB migration/store/idempotency/CAS tests;
3. real child process survives controller-loss fixture and duplicate-start refusal;
4. SWARM and DAG restart ownership tests;
5. verified kill keeps unrelated foreign/sibling process alive;
6. dispatch crash matrix at each transaction/outbox boundary;
7. control crash matrix at each transaction/outbox boundary;
8. actor-start replay double-spawn test;
9. startup SIGTERM and listen-failure teardown tests;
10. automated profile surviving-Chrome/unknown/reclaim tests;
11. two-repository independence test;
12. existing focused loop/strategy/postflight/runtime-controls/productization tests;
13. full fast tier;
14. typecheck/build/lint;
15. strict OpenSpec validation;
16. source-integrity/version/diff checks;
17. supported real-process suites in bounded batches.

If a real external dependency is unavailable, mark only that specific external assertion unqualified. Do not substitute a mock and call it real-qualified.

## Long-session policy (~12-hour requested budget)

Do not stop after the first green patch if useful hardening work remains. Once core requirements are implemented:

- repeat crash/restart matrices many times to catch race windows;
- run competing-start loops across two repositories;
- run kill/shutdown while workers are at different launch/completion phases;
- run migration/restart loops on copied fixture DBs;
- inspect logs for unhandled rejections, FK warnings, duplicate events, stale leases, orphan worktrees, or leaked child PIDs;
- profile control-plane overhead if the new stores introduce obvious hot-path regressions;
- fix reproducible Critical/High findings inside scope.

Do not burn time by sleeping, rerunning identical green tests without purpose, polishing UI, or inventing new features merely to occupy the requested duration.

## Git and checkpoint discipline

Repository policy is direct `main` integration.

For each coherent slice:

1. reconcile `git status` / latest remote main;
2. preserve unrelated dirty work;
3. implement + focused tests;
4. update OpenSpec task truth;
5. commit with a meaningful message;
6. push to `main`;
7. periodically update `.agent/state.json` so a fresh agent can resume without this conversation.

Never make a false “clean” claim if uncommitted work exists.

## Completion / stop rules

Continue until one of these is true:

### A. READY_FOR_REVIEW

All Change 028 semantic requirements are implemented, required internal gates are green, real-process no-second-writer/no-foreign-kill evidence exists, docs/state are updated, useful work is committed/pushed.

### B. Genuine blocker

A blocker prevents safe continuation (for example an OS API cannot provide safe identity evidence). In that case:

- do NOT guess around the safety constraint;
- commit/push all safe progress;
- record exact blocker, attempted approaches, evidence, affected task IDs, and safest next action in `.agent/state.json`;
- leave the system fail-closed.

### C. Session/tool boundary

If the harness ends before completion, leave a detailed waypoint and pushed coherent checkpoint. The next agent must be able to resume from the first incomplete checkbox without redoing the audit.

## Final report requirements

The final commit/session report must include:

- start SHA and final SHA;
- files/systems changed;
- exact ownership/transition architecture landed;
- migration version and compatibility notes;
- crash/failure-injection matrix with pass/fail counts;
- real child-process evidence and process-leak check;
- fast/typecheck/build/lint/OpenSpec results;
- real-suite results and explicit external skips;
- Critical/High defects found and fixed during campaign;
- remaining Medium/Low debt intentionally deferred;
- Changes 026/027 residual blockers unchanged unless genuinely qualified;
- exact next action.

Execute the campaign now. Do not return to planning unless implementation evidence invalidates the design; if it does, update the OpenSpec artifacts in the same branch and continue.
