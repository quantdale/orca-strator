# Change 028 continuation prompt — 12-hour crash-safety hardening campaign

**Status:** IMPLEMENTING / CONTINUE FROM LATEST MAIN  
**Deep-audit base:** `a1de7ab072907baa09d8bdf21e1860125d8323ff`  
**Target branch:** `main` — direct commits/pushes per repository policy; NEVER force-push  
**Campaign:** `028-durable-execution-ownership-and-crash-consistency`  
**Session budget:** use the requested **~12 hours** for useful implementation, fault injection, regression repair, and qualification. Do not idle, sleep, or invent unrelated features to fill time.

## Mission

Finish Change 028 so Orca remains safe when the controller dies at the worst possible instruction boundary.

The campaign has two primary invariants:

1. **No second repository writer while prior ownership is live or uncertain.**
2. **No protocol source may be durably consumed without its required run transition being durably applied.**

The 2026-08-27 deep re-audit found that the first ownership slice is not yet safe enough to copy into SWARM/DAG. Fix the direct/Windows ownership regressions first.

## Read first

In order:

1. `AGENTS.md`
2. `.agent/state.json`
3. `.agent/PLANNER_HANDOFF.md`
4. `docs/audits/2026-08-27-next-campaign-deep-audit.md`
5. `docs/audits/2026-08-26-next-campaign-crash-consistency.md`
6. Change 028 `proposal.md`
7. all three Change 028 delta specs
8. Change 028 `design.md`
9. Change 028 `tasks.md`
10. relevant canonical docs: `docs/RUNTIME-MODEL.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/OBSERVABILITY-AND-FAILURES.md`, `docs/TEST-STRATEGY.md`

Then reconcile against pulled `main`. Do not reset to the audit base and do not redo landed work without evidence.

## Current implementation truth

Preserve these landed pieces unless a failing regression requires repair:

- SQLite migration 24 ownership/process/transition/outbox tables;
- controller instance ID and runtime-lock diagnostics;
- ownership stores and actor-lease service;
- direct repository lease acquisition;
- `ExecutorRunner.onSpawn` hook;
- direct process ownership insertion;
- startup lease reconciliation before strategy recovery.

However, do **not** assume commit messages prove task completion. The deep re-audit re-opened Windows identity/kill acceptance and identified spawn/retry gaps.

## P0 work that comes first

### P0-A — Windows identity wildcard / unsafe verified-kill basis

Current `WindowsProcessProbe.capture()` records no creation marker/name. Current `classify()` treats missing identity as a wildcard match.

Fix this before any more kill/recovery wiring:

- capture creation/start marker + executable identity from the actual spawned PID;
- persist it before admission;
- missing required identity => UNKNOWN, never LIVE_MATCH;
- distinguish PID NOT_FOUND => DEAD from CIM/query failure => UNKNOWN;
- verified kill refuses incomplete/PID_REUSED/UNKNOWN evidence;
- add deterministic Windows-semantics tests through an injectable query seam plus supported-host real evidence where practical.

### P0-B — zero-process prior lease must fail closed

A prior STARTING/ACTIVE lease with zero process rows is not proof no child exists: the controller may have died after OS spawn but before insertion.

Reconcile this state to quarantine unless separate durable evidence proves the spawn boundary was never crossed.

### P0-C — post-spawn ownership failure must not generic-retry

After a real child spawns, an `onSpawn` persistence failure currently bubbles into `launchWithRetry()`.

Required behavior:

- explicitly distinguish PRE_SPAWN failure vs POST_SPAWN admission/ownership failure;
- post-spawn failure may retry only after verified termination + durable terminal attempt evidence;
- unknown/unverified termination => quarantine + abort, no second spawn;
- every real OS spawn gets a distinct durable process attempt ID;
- if all failures are genuinely pre-spawn, safely release/terminalize the current instance's STARTING lease.

### P0-D — no unobserved short-lived exit during ownership handshake

Install exit/error observation before an awaitable `onSpawn` hook can yield, or explicitly reconcile an already-exited child after the hook. Preserve exactly-once completion.

### P0-E — split transition writes remain open

Migration 24 tables exist, but semantics are not wired. Current source-consumption crash windows still include:

- ExecutorService valid-result dispatch consumption before loop continuation;
- LoopService dispatch consumption before awaited Sol continuation;
- postflight retry dispatch consumption before continuation;
- Sol browser operation close + control consumed before run transition;
- watcher one-shot callbacks after durable marker creation.

Implement the transition processor; do not patch one callsite and leave the defect class.

## Ordered execution workstreams

### Workstream 1 — failing tests before repair

Start with Change 028 Tasks **1.7-1.11** plus the original crash tests:

- Windows capture/classify round-trip and no-wildcard LIVE_MATCH;
- DEAD vs UNKNOWN Windows query behavior;
- zero-process prior lease restart;
- post-spawn ownership-write failure no-double-spawn;
- short child exits while ownership hook awaits;
- all-pre-spawn failures do not strand a lease;
- direct controller-death + surviving child second-start refusal.

Do not weaken assertions to fit current code.

### Workstream 2 — close direct ownership safety

Finish/re-qualify Tasks 3.4-3.9, 4.2-4.10, and 5.8-5.9.

Key design rule: **spawn is an irreversible epistemic boundary**. After it occurs, the system must either durably know/verify the child or quarantine.

Preserve pause, kill, watchdog, launch retry, OpenCode adapter behavior, WSL behavior, and once-only completion.

### Workstream 3 — strategy + worktree ownership

Only after Workstream 2 is green:

- acquire exactly one SWARM/DAG repository actor lease per strategy run;
- persist every worker process beneath it with unique process attempt identity;
- block manual HTTP strategy starts through the same durable gate;
- reconcile process ownership before worker/worktree/staging recovery;
- protect LIVE_MATCH/UNKNOWN/PID_REUSED-owned worktrees;
- never serialize legitimate worker concurrency merely to simplify ownership.

Use existing `real-strategy-*`, `real-swarm`, `real-dag`, and worktree fixtures instead of building a parallel test universe.

### Workstream 4 — transition inbox + CAS + outbox

Implement a focused transition service over migration-24 tables:

- per-repository application serialization for contention only;
- SQLite transaction is correctness boundary;
- expected-state/CAS run mutations with explicit `changes === 0` stale failure;
- source consume + run mutation + outbox enqueue in one transaction;
- no browser/Git/process/network await inside transaction;
- replay PENDING/APPLYING/FAILED_RETRYABLE after ownership reconciliation;
- terminalize stale/rejected sources durably;
- deterministic outbox effect keys and idempotent replay.

Reuse existing durable Sol-operation intent; do not create a second competing Sol wake truth source.

### Workstream 5 — migrate all transition producers

Move these through durable application:

- watcher dispatch detection/start authorization;
- direct executor completion;
- SWARM/DAG completion and postflight retry;
- Sol controls;
- any adjacent completion/control seam that can consume durable protocol truth.

Remove premature consumption from `ExecutorService.handleTurnCompletion()`.

Preserve strict repository/run/iteration/dispatch correlation and the existing rule that strategy COMPLETED is not successful without confirmed remote publication.

### Workstream 6 — own async state mutation

Fix all controller-runtime detached promises capable of durable mutation or resource launch.

At minimum:

- watcher dispatch/control callback contracts become Promise-aware or durable-enqueue;
- `app.ts` no longer uses naked `void loopService.onDispatchDetected/onControlDetected/onExecutorCompleted`;
- direct completion promises are tracked through shutdown;
- strategy completion tracking remains bounded and correct;
- failure injection proves no unhandled rejection and leaves durable recovery evidence.

Best-effort UI refresh/log-only promises are not the same risk; prioritize state/resource ownership.

### Workstream 7 — abortable initialization + unified teardown

Replace the stale `index.ts` assumption that nothing can exist before `buildApp` returns.

Required:

- construction AbortController / lifecycle latch;
- partial-construction cleanup stack;
- no resource admission after shutdown is latched;
- startup Sol/browser rehydrate honors abort;
- SIGTERM/SIGINT during initialization waits bounded cleanup before singleton release;
- listen failure closes assembled runtime graph before DB/lock release;
- deterministic order for watcher/timers/coordinator/executors/browser/Fastify/DB/lock.

### Workstream 8 — browser profile quarantine + recovery surface

For automated profile stale recovery:

- query host Chrome processes for exact dedicated `--user-data-dir`;
- matching live Chrome => quarantine;
- authoritative absence => reclaim;
- undecidable => quarantine;
- preserve interactive external Chrome PID semantics.

Expose structured 409/status diagnostics for live/unknown/quarantined actor/profile ownership. Never add a force-clear action capable of creating a second writer.

### Workstream 9 — full qualification and 12-hour hardening

After core implementation is green, keep using the session budget productively:

- repeated direct/SWARM/DAG controller-kill + restart loops;
- PID-reuse/foreign sibling kill safety;
- dispatch/control crash matrices around every transaction/outbox boundary;
- actor-start replay no-double-spawn;
- startup SIGTERM at multiple construction checkpoints;
- EADDRINUSE/listen-failure cleanup;
- two-repository independence;
- copied-DB migration/restart loops;
- process/worktree/profile leak checks;
- scan logs for unhandled rejections, FK warnings, duplicate effects, stale leases.

Repair every reproducible Critical/High regression inside scope before review-ready.

## Gate requirements

Before READY_FOR_REVIEW, run and record:

1. focused ownership/process-probe/direct-runner tests;
2. SWARM/DAG ownership/worktree restart tests;
3. transition CAS/idempotency/outbox crash tests;
4. lifecycle/profile failure tests;
5. `npm test`;
6. `npm run typecheck`;
7. `npm run build`;
8. `npm run lint`;
9. `npm run openspec:validate`;
10. `git diff --check`;
11. source-integrity + version checks;
12. supported real-process suites in bounded batches;
13. current GitHub push CI after each major checkpoint when available.

External Change 026/027 assertions remain external-unqualified unless the required sanctioned/authorized resource genuinely exists. Never fake them.

## Git/checkpoint discipline

Work directly on `main` per repository policy:

- pull/reconcile before each coherent slice;
- preserve unknown dirty work;
- never reset hard / clean / force-push;
- implement + focused tests;
- update OpenSpec task truth immediately;
- commit detailed coherent slices;
- push;
- update `.agent/state.json` at meaningful waypoints.

A future agent must be able to resume from the first genuinely incomplete task without this chat.

## 12-hour cadence

Use this as an indicative schedule, not a reason to skip dependencies:

- **0-2h:** R1-R7 failing tests + Windows/direct ownership closure;
- **2-4h:** SWARM/DAG lease/worker/worktree ownership;
- **4-7h:** transition processor/outbox + producer migration;
- **7-9h:** async ownership + abortable lifecycle + browser quarantine;
- **9-12h:** crash matrices, repeated race loops, full gates, regression repair, docs/state/final report.

If a workstream finishes early, advance to the next one or deepen fault injection. Do not stop after one green patch while useful Change 028 work remains.

## Completion rules

### READY_FOR_REVIEW

Only when all Change 028 semantic requirements are implemented and qualified, including real-process no-second-writer/no-foreign-kill evidence on the supported host tier.

### Genuine safety blocker

If the OS cannot provide the evidence needed for safe ownership:

- fail closed;
- do not invent a permissive fallback;
- commit/push safe progress;
- record exact blocker/evidence/task IDs in state.

### Tool/session boundary

If the harness ends before completion, push a coherent checkpoint and exact waypoint. Do not leave crucial truth only in terminal output.

## Final session report

The final commit/report must include:

- starting and final SHA;
- implementation slices and files;
- exact actor/process ownership model;
- Windows identity evidence semantics;
- process-attempt/retry semantics;
- migration/CAS/outbox architecture;
- crash matrix counts/outcomes;
- direct + SWARM + DAG real-process evidence;
- process/worktree/profile leak checks;
- fast/typecheck/build/lint/OpenSpec/source-integrity results;
- CI result(s);
- Critical/High defects found/fixed;
- remaining Medium/Low debt;
- unchanged external blockers from 026/027;
- exact next action.

**Execute the campaign. Do not create Change 029 while Change 028 safety invariants remain open.**
