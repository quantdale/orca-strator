# Final Project Completion Report — Orca-Strator

**Umbrella change:** `029-full-project-completion-and-production-certification`  
**Dependency order:** `028` → `027` → `026` → final certification  
**Report generated:** 2026-08-28 (continuation session; supersedes the 05:50+08:00 revision)  
**Start SHA (planning baseline):** `0811c8d8e06739c193d7e509140dc4e55dd0ed9f` + `77c0d7f6cd7fba354a11225f9dc291ff0da3add1` (Change-029 planning)  
**Continuation session start SHA:** `f63ddf0`  
**Final SHA:** see §10  
**Branch:** `claude/complete-entire-thing-n7u6i9` (session-scoped; the operator's branch instruction overrides the repository's direct-to-`main` default for this session — no force-push either way)  
**Hosts:** two, and every claim below names which one produced it.
- **W** — Windows 11 Pro 10.0.26200 x64, Node 24.3.0. Produced all packaging, installer, endurance, multi-repo, backup and release evidence. Not available in the continuation session.
- **L** — Linux gate host (container), Node 24.20.0. Produced the continuation session's fast tier, typecheck, build, lint, strict OpenSpec, integrity and — for the first time — the complete 15-suite real-process tier in one process.
---

## 1. Tracked file inventory (final candidate)

**Method:** `git ls-files | wc -l` + classification by top-level directory, verified on `main@659d92d`.

- **Total tracked files at the final SHA:** **471** (463 at `659d92d`; +1 `outbox-effect-delivery.test.ts`, +3 folded canonical specs, +4 repo-local MCP/add-on files from `f63ddf0`; the Change-028 archive move is a rename, not an addition)
  - `apps`: 211 (apps/controller/src 93, apps/desktop/src 3, apps/ui/src 20, packages/shared/src 21, tests 91 (apps/controller/test 78 + fixtures), app scaffolding)
  - `openspec`: 156 (openspec/* 156 + schemas/protocol 3)
  - `packages`: 29
  - `docs`: 22 (docs/* 21 + README.md)
  - `scripts`: 20 (scripts/* 20)
  - `.agent`: 5
  - `schemas`: 3
  - `tests`: 2
  - `.github`: 2
  - `.agents`: 2
  - root manifests/configs: 11 (`.editorconfig`, `.gitattributes`, `.gitignore`, `package.json`, `package-lock.json`, `AGENTS.md`, `.opencode/`, `.kimi-code/`, `tsconfig.base.json`, `README.md`)

**Archive method:** `git ls-files` is source of truth; `check-source-integrity.mjs` also validates that 210 tracked source files resolve 735 relative imports without untracked placeholders (209/722 before this session's new test).

---

## 2. Critical/High findings and fixes (this campaign)

All items below were **locally reproducible** P0/Critical per `docs/audits/2026-08-27-next-campaign-deep-audit.md` F1-F7 or discovered during Phase A-D. Each fix landed on `main` and is covered by a new or existing deterministic test.

| # | Finding | Severity | Files / Lines | Fix Commit | Test / Evidence |
|---|---------|----------|---------------|------------|-----------------|
| F-D9.5-dispatch | Dispatch detection (normal + draining) consumed dispatch marker via one in-memory callback without durable transaction; crash between consume and `runs` update left `consumed-without-transition` | Critical | `loop/loop-service.ts` ~290-400 (112 lines), `app.ts:transitionService` wiring | `a02657e` | New path: `enqueueAndApply(DISPATCH)` atomically `dispatchStore.updateStatus(consumed)` + `runStore.updateStatus(EXECUTOR_PENDING/CEILING)` + `COMPLETE_SOL_OPERATION`/`START_EXECUTION_ACTOR` outbox; `crash-matrices.test.ts` 7 kinds × duplicate/rollback (17 tests), fast 469/469 |
| F-D9.5-drain | `applyIterationCompletion` DRAINING branch did ceiling/stop via separate `runStore.updateStatus` without dispatch consumption atomicity; `FAIL_*` terminal branches also non-atomic | Critical | `loop/loop-service.ts` ~918-1080 | `a02657e` | Same transition outbox for `DISPATCH/DRAIN` + `FAIL_DRAIN` + `FAIL_TERMINAL`; legacy inline fallback retained for tests without wiring |
| F-D9.4-Sol | `LoopService.onControlDetected` consumed `SOL_CONTROL` and then updated run in two steps; browser close fired before commit, not replayable | Critical | `loop/loop-service.ts` `onControlDetected` + `deliverOutboxEffect` | `8dab027` | `enqueueAndApply(SOL_CONTROL)` + `COMPLETE_SOL_OPERATION` outbox; `deliverOutboxEffect` replays on startup after `reconcileOnStartup` |
| F-D4-forge | `ExecutorService.onExecutorCompleted` was `() => void` fire-and-forget; caller `app.ts` did `void loopService.onExecutorCompleted(...)` discarding the Promise, allowing unhandled rejection and shutdown race | High | `executor/executor-service.ts:51-60,125-129,664-671`, `app.ts:323-329` | `a02657e` (promise-aware) + `0f558ac` (await) | Type `void|Promise<void>`, `await` with `reportCompletionFailure`; fast 469/469, typecheck clean |
| F-D4-lifecycle-init | `buildApp` took no `AbortSignal`; `index.ts` handled SIGTERM before `initialized` by `lock.release(); process.exit(0)` without aborting in-flight startup, and `EADDRINUSE` only closed DB+lock, leaking watcher/loop/coordinator/browser/fastify | High | `app.ts:127-136`, `index.ts:102-175` | `a02657e` | `buildApp({signal})` with `throwIfAborted`, `AbortController` + 200ms settle, `EADDRINUSE` full teardown `watcherService.stop()/loopService.shutdown()/coordinator.shutdown()/browserManager.shutdown()/fastify.close()/db.close()/lock.release()` |
| F-D10.4-void | Same fire-and-forget pattern across runtime (found via `grep "void "`). Critical path `onExecutorCompleted` now tracked like strategy promises | High | `app.ts:324` | `0f558ac` | Audit `grep void` triaged; `void refreshSystemChrome().catch` retained as bounded best-effort (not durable mutation) |
| F-profile-probe | `WindowsProcessProbe.capture` previously stored no `CreationDate`/`Name`; `classify` wildcarded missing evidence to `LIVE_MATCH`, enabling foreign kill | Critical | `ownership/process-probe.ts`, `profile-lock.ts` | `a1cabfc` | Probe now queries `Get-CimInstance Win32_Process CreationDate,Name`; missing identity → `UNKNOWN` → `killVerifiedTree` refuses; 2/2 profile-lock tests |
| F-watcher-cb | Watcher dispatch/control callbacks were sync, not durably enqueued, so single in-memory callback loss lost work | High | `watcher/watcher-service.ts`, `loop/loop-service.ts` | `bcb7c36` | Callbacks now `Promise<void>`; `onExecutorCompleted` await lineage |
| Matrices | No explicit duplicate/stale/race/crash-window tests for every source kind | Critical | new file `crash-matrices.test.ts` 203 lines | `a30097b` | 17 tests covering `DISPATCH`×2, `SOL_CONTROL`, `EXECUTOR_COMPLETION`, `STRATEGY_COMPLETION`×3 (SWARM/DAG/postflight) for duplicate idempotency, rollback (no consumed-without-transition), concurrent race serialization, stale marker, outbox replay-idempotency (469/469) |
| Docs drift | `ARCHITECTURE.md` §12 lacked durable ownership/transition/outbox boundary; `tasks.md` 028 had 64 unchecked boxes now evidenced | High | `docs/ARCHITECTURE.md` + `openspec/changes/028/.../tasks.md` | `8b33c26` | ARCHITECTURE §12.1 added; tasks.md 64 ticks with evidence commits; `openspec:validate` 28/28 still green |
| F-13.4-audit | No bounded secret-redacted audit events for lease/quarantine/process/transition/outbox | High | `events/event-bus.ts` 84 lines, `actor-lease-service.ts` 145 lines, `process-probe.ts` 30 lines, `transition-service.ts` 101 lines | `543188b` | `redactSecrets` (key-name + URL credential, 512-char truncation, 2KiB bound), 8 event types `lease.*`/`process.verdict`/`transition.retry`/`outbox.retry`/`recovery.decision` mapped to RECOVERY/RETRYING; 32 tests |
| F-13.5-FK | CampaignLedger could reintroduce FK warnings when recovery events reference deleted/terminal entities | High | `campaign-ledger-store.ts` 23 lines, `campaign-ledger-service.ts` 27 lines | `543188b` | Bounded `data_json` 4KiB, strings 2KiB, `isAuditTrace` guard prevents FK violation on nullable `runId`; no FK warnings in 5× loops |
| F-harness-endurance | `test:endurance:short` cycle 1 readiness timeout 125s due to orphan `Orca-Strator.exe` holding port/lock | High | `scripts/package/endurance.mjs` 17 lines | `659d92d` | Retry any cycle on contention + `Get-NetTCPConnection` port free; verified `ENDURANCE_SHORT_MODE_PASSED` 6/6 cycles |
| F-harness-smoke | `smoke:package` teardown `killPidOnly` threw on already-exited desktop (focus-handoff) | Medium | `scripts/package/package-smoke.mjs` 2 lines | `659d92d` | `killPidOnly` now swallows not-found; verified `PACKAGE_RUNTIME_QUALIFIED` 13/13 PASS |

**Deep audit re-run (2026-08-28T05:45):**
- `grep -rn "TODO|FIXME"` → only `CREATE TEMP TABLE` hits (false positive on `TEMP`), no genuine TODO/FIXME.
- `grep "void "` triage: 1 critical fire-and-forget fixed (0f558ac); remaining `void`s are `void` return types, `void refreshSystemChrome().catch` (bounded, not mutation), `void spawned.exit.then` (Chrome lifecycle, not orchestration state), method signatures.
- `grep "taskkill|process.kill"` → only via `killVerifiedTree` with `LIVE_MATCH` guard (D3); `killPidOnly` in harnesses now swallows not-found correctly.
- `grep "BEGIN|COMMIT"` → only inside `OrchestrationTransitionService.withTransaction` (no I/O inside tx, verified by `transition-service.test.ts` D8 rollback).
- Unbounded retries: checked `MAX_LAUNCH_ATTEMPTS=3`, `POSTFLIGHT_REMOTE_ATTEMPTS=2`, backoff caps in browser/waker, no unbounded `while(true)`.
- Path traversal/symlink quoting: `worktree-isolation-service.ts` uses `path.resolve` + allowlist; Windows quoting via `git` PowerShell quoting validated in existing tests.

**Remaining locally reproducible blocker after this report:** see §8 and blockers in `.agent/state.json` — `CHANGE_028_REMAINING_CRITICAL_C6_C7_AND_MATRICES` now narrowed to `14.1-14.4/14.8` (real-process controller-kill while direct/SWARM/DAG running, verified-kill sibling, PID-reuse/UNKNOWN quarantine, SIGTERM during Sol rehydrate) and `15.x` real-tier bounded batches (remaining real suites beyond 5× loops). Endurance + multi-repo harnesses now PASS; 13.4/13.5 audit/FK fixed. No new Critical/High beyond those tracked.


---

## 2A. Critical findings of the 2026-08-28 continuation session (Linux gate host)

The prior campaign recorded the real-process tier as `PARTIAL / SIMULATED` and
classified the remaining suites as external-blocked. That classification was
wrong: the suites were **unrun**, not external. `REAL_TIER_BASH_CAP` was a host
process-budget limit, not a property of the tests. Running the full tier on a
host without that cap exposed **four Critical defects that the fast tier cannot
see**, three of which were introduced by Change 028 itself.

| # | Finding | Severity | Files | Fix commit | Evidence |
|---|---------|----------|-------|------------|----------|
| C-028-A | `deliverOutboxEffect()` had no `START_EXECUTION_ACTOR` branch. An unhandled effect kind falls off the end of the if-chain, returns normally, and is marked DELIVERED — so every autonomous turn consumed its dispatch, moved the run to `EXECUTOR_PENDING`, and then never started an executor. The exact consumed-without-effect state this campaign exists to prevent. | **Critical** | `loop/loop-service.ts` | `718f336` | `real-runtime-buildapp` 2/2; new `outbox-effect-delivery.test.ts` 4/4 |
| C-028-B | `onStrategyCompleted()` treated `dispatch.status === "consumed"` as "already applied". 028 moved consumption to `DISPATCH_START`, so this returned early for **every** SWARM/DAG completion: strategies ran, integrated and published to the remote, then the run was never transitioned and Sol was never woken. | **Critical** | `loop/loop-service.ts` | `9a11051` | `real-strategy-loop-swarm` 4/4, `real-strategy-loop-dag` 2/2 (both files were entirely red) |
| C-028-C | `completePostflightRetry()` and `retryPendingPostflight()` used the same stale inference, so a postflight-blocked iteration could never be recovered and the retry sweep could never find a candidate — silently invalidating the documented contract that `markPostflightBlocked` leaves the dispatch findable. | **Critical** | `loop/loop-service.ts`, `loop/iteration-execution-coordinator.ts` | `9a11051`, `8ec3b86` | `real-strategy-postflight` 3/3, `real-strategy-movement` 8/8 |
| C-028-D | `completePostflightRetry()` recorded no durable transition for its republish, so the retry was not idempotent: every later sweep found the same record again. | **Critical** | `loop/loop-service.ts` | `8ec3b86` | movement "idempotent: a further sweep finds nothing pending" |
| H-HOST-A | `chrome-discovery.ts` composed Windows probe paths with the host `path` flavour; on a POSIX host it built `C:\Program Files/Google/...`, which can never match a real layout. | High | `browser/chrome-discovery.ts` | `f30c2f6` | `chrome-discovery.test.ts` 5 previously-failing tests |
| H-HOST-B | `executorIdentityMatches()` took `path.basename()` of a user-configured Windows CLI path. On a POSIX host that returns the whole string, so every valid executor result was rejected. Matters for the in-scope WSL executor tier. | High | `executor/executor-service.ts` | `f30c2f6` | `executor-result-validation.test.ts` 4 previously-failing tests |
| H-HOST-C | `PortableProcessProbe.isPidAlive()` trusted signal 0 alone. An unreaped killed child stays addressable as a zombie, so a terminated process classified `LIVE_MATCH`/`UNKNOWN`: the repository would stay quarantined forever and `killVerifiedTree` would report terminating a process that was already gone. | High | `ownership/process-probe.ts` | `f30c2f6` | `ownership.test.ts` 2 previously-failing tests |

**Why the fast tier missed all four Critical defects:** `crash-matrices.test.ts`
exercises `OrchestrationTransitionService` with its own test deliverer and its
own synthetic protocol source, so it can prove the transaction boundary is sound
while remaining blind to whether production wires an effect handler at all, and
blind to what production infers from `dispatch.status`. The regression guard
added in `outbox-effect-delivery.test.ts` closes the first hole structurally: any
`effectKind` enqueued anywhere under `src` must have a delivery branch, verified
by removing the branch and watching the test fail.

**Test-truth changes in this session were semantics updates, never weakenings.**
Change 028 deliberately moved dispatch consumption from the END of a turn to its
START. Eleven assertions across four real-tier files still used
`dispatch.status` as an end-of-turn or not-yet-started signal. Each now asserts
the invariant its own comment describes — a completed executor run for the
dispatch, or `iterationCompletedSuccessfully(dispatchId) === false` — and every
original assertion about run state, wakes, manifests, worktrees and remote
content is unchanged.

---

## 2B. Change 028 implementation ledger: F1–F7 → files and tests

Maps the findings of `docs/audits/2026-08-26-next-campaign-crash-consistency.md`
to the code and tests that discharge them (Change 028 task 0.5).

| Finding | Owning implementation | Proving tests |
|---------|----------------------|---------------|
| **F1** — restart reconciliation can admit a second writer while an old executor is alive | `ownership/actor-lease-service.ts` (one durable repository actor lease, `reconcileOnStartup` before strategy recovery), `ownership/ownership-store.ts` (migration 24/25 lease + process ownership), `ownership/process-probe.ts` (`WindowsProcessProbe` CIM creation-date identity, `PortableProcessProbe` `/proc` identity, `killVerifiedTree` refuses non-`LIVE_MATCH`), `executor/executor-runner.ts` (`onSpawn` handshake, per-attempt UUID) | `ownership.test.ts` (probe verdicts, no-wildcard `LIVE_MATCH`, zero-process lease quarantine), `executor-ownership.test.ts` (no-second-writer, post-spawn failure quarantine), `real-strategy-shutdown-restart.test.ts` |
| **F2** — protocol markers consumed before their transition is crash-durable | `ownership/transition-service.ts` (`enqueueAndApply` single `BEGIN IMMEDIATE` transaction, unique `(source_kind, source_id, operation)` intent, `orchestration_outbox` with deterministic effect keys), `loop/loop-service.ts` (DISPATCH / SOL_CONTROL / completion producers, `deliverOutboxEffect`, `replayPendingTransitionOutbox`) | `transition-service.test.ts` (commit/rollback, duplicate, replay), `crash-matrices.test.ts` 17/17 across all four source kinds, `outbox-effect-delivery.test.ts` (delivery + replay no-double-spawn) |
| **F3** — inconsistent async callback ownership | `watcher/watcher-service.ts` (callbacks return `Promise<void>`), `executor/executor-service.ts` (`onExecutorCompleted` promise-aware), `app.ts` (awaited rather than `void`-discarded), `loop/iteration-execution-coordinator.ts` (`pendingCompletions` tracked through shutdown) | `watcher-integration.test.ts`, `executor-shutdown-paths.test.ts`, `lifecycle-shutdown.test.ts`, `real-runtime-buildapp.test.ts` (production wiring, no manual transition calls) |
| **F4** — shutdown during initialization bypasses teardown | `app.ts` (`buildApp({signal})`, `throwIfAborted`, partial-construction cleanup), `index.ts` (SIGTERM/SIGINT latch before singleton release, `EADDRINUSE` closes the assembled graph first) | `lifecycle-shutdown.test.ts` (SIGTERM at multiple construction checkpoints, EADDRINUSE full teardown), `singleton-lock.test.ts` |
| **F5** — profile stale-lock recovery trusts the controller PID | `browser/profile-lock.ts` (host Chrome probe keyed to the exact dedicated `--user-data-dir`, `UNKNOWN` fails closed, no force-clear action) | `profile-lock.test.ts`, `browser-integration.test.ts` |
| **F6** — DB constraints do not independently enforce orchestration invariants | migrations 24–26 (`FOREIGN KEY ... ON DELETE CASCADE`, `UNIQUE` intent/outbox keys, lease uniqueness), expected-state/CAS run mutation with explicit stale failure in `ownership/transition-service.ts` | `database.test.ts`, `schema-conformance.test.ts`, `campaign-ledger-integrity.test.ts`, `crash-matrices.test.ts` stale/CAS cases |
| **F7** — restart recovery conflates lost handle with dead worker | `strategy/worktree-isolation-service.ts` (`LIVE_MATCH`/`UNKNOWN` owners protect a worktree from sweep), ownership reconciliation ordered before worktree/staging recovery in `app.ts` | `real-worktree-isolation.test.ts`, `swarm.test.ts`, `dag.test.ts`, `real-strategy-dag-concurrency.test.ts` |

---

## 3. Change closure status

### Change 028 — Durable execution ownership and crash consistency

- **Status:** **COMPLETE — folded and archived.** All 125 tasks are ticked with evidence; the three delta specs are folded into `openspec/specs/` and the change is archived as `openspec/changes/archive/2026-08-28-028-durable-execution-ownership-and-crash-consistency`.
- **Closed in the continuation session:** the four Critical defects in §2A (undelivered `START_EXECUTION_ACTOR` effect and three stale `dispatch consumed = iteration done` inferences), plus the F1–F7 ledger (§2B) that task 0.5 required. The full 15-suite real-process tier now runs green in one process on host L, which is what previously blocked archive.
- **Evidence:**
  - Migrations: 24 actor lease, 25 process ownership, 26 transition intent+outbox (FK `ON DELETE CASCADE`, `UNIQUE` keys).
  - `C1` direct ownership: `ExecutorRunner` attempt identity (`RUN_ATTEMPT_ID_PATTERN` UUID), `processOwnershipStore.create` before admission, `onSpawn` handshake, `launchWithRetry` distinguish PRE vs POST, short-lived exit observed via `exitPromise` before `onSpawn` await.
  - `C2` SWARM/DAG lease: `RepositoryActorLeaseService` ONE lease per repo, `strategyRunStore` worker rows beneath lease, `SwarmExecutionService.recoverAll` reordered after `reconcileOnStartup`, `LIVE|UNKNOWN` protects sweep (checked in `worktree-isolation-service.ts`).
  - `C3` transition: `OrchestrationTransitionService` per-repo `withTransaction` (`BEGIN IMMEDIATE`), `DISPATCH`/`SOL_CONTROL`/`EXECUTOR_COMPLETION`/`STRATEGY_COMPLETION` all atomic via `enqueueAndApply`; outbox `orchestration_outbox` replay after `reconcileOnStartup`; `LoopService` D9.5 paths with fallback.
  - `C4` lifecycle: watcher callbacks `Promise<void>`, `onExecutorCompleted` Promise-aware + `app.ts` await, `AbortController` startup cancellation, `EADDRINUSE` full teardown, deterministic order.
  - `C5` browser: `profile-lock.ts` exact `--user-data-dir` probe via `Get-CimInstance`, `UNKNOWN` fails closed, stale lock bounded idempotent recovery, no `force-clear`.
  - Tests: `ownership.test.ts` (Windows probe, quarantine, zero-process lease), `transition-service.test.ts` (D8 commit/rollback, D7 duplicate, D9 replay), `crash-matrices.test.ts` 17/17, `executor-ownership.test.ts` (quarantine, no-second-writer), `profile-lock.test.ts` 2/2.
  - Gates: fast 469/469 (×5 deterministic 51/51 loops), typecheck/lint/build/openSpec clean, integrity 209/722, diff-check clean, backup-restore PASS, crash-recovery PACKAGED_CRASH_RECOVERY_QUALIFIED, endurance ENDURANCE_SHORT_MODE_PASSED 6/6, multi-repo MULTI_REPO_PACKAGED_STRESS_QUALIFIED, upgrade UNPACKED_UPGRADE_PRESERVATION_QUALIFIED, package smoke PACKAGE_RUNTIME_QUALIFIED 13/13.
  - **Fixed since 0f558ac:** `13.4` audit events (`543188b` redactSecrets + 8 event types, 32 tests), `13.5` FK-safe ledger (bounded 4KiB, isAuditTrace guard), `ENDURANCE_SHORT` harness retry (`659d92d` 6/6 PASS), `MULTI_REPO` (`659d92d` 4-repo concurrent PASS), `PACKAGE` smoke teardown fix (`659d92d` 13/13 PASS).
  - **Correction to the prior revision:** it recorded the remaining real-process suites as external-blocked. They were unrun, not external — `REAL_TIER_BASH_CAP` was a property of host W's process budget, not of the tests. Running them exposed four Critical defects (§2A). The lesson is recorded here deliberately: "cannot run here" must never be filed as "requires an external environment".
### Change 027 — Fresh-clone integrity and production resilience

- **Status:** **CLOSED for engineering; two genuinely external acceptance items remain and the change stays unarchived until they are obtained.**
- **Blocker honest:** `TAILSCALE_PHONE_ROUTE_EXTERNAL_UNQUALIFIED`, `INSTALLER_EXECUTION_SANCTIONED_ENV_ONLY`, plus residual `026/027` battery items (`real-repo battery 9.2/11.2/12.2/13-16`, `PACKAGE_RUNTIME_QUALIFIED` partial) require sanctioned Windows workflow/authorized resources. Task file reconciled to evidence; no silent reclassification.
- **Local evidence:** fast/typecheck/build/lint/openspec/version/integrity/diff-check all green on the final tree on host L, plus the complete real-process tier (§4). `ARCHITECTURE.md`/ROADMAP wording not overstated.
- **Why it is not archived:** archiving would assert acceptance evidence that does not exist. Task 5.1's `package+smoke where environment permits` and the Tailscale phone route need host W or a sanctioned environment. Everything that does not need one is done.

### Change 026 — Installed release/lifecycle and endurance

- **Status:** **CLOSED for engineering; the installer lifecycle and long endurance remain genuinely external and the change stays unarchived until they are obtained.**
- **Local pass:** `backup-restore` PASS, `build` PASS, `version:check` OK, `ENDURANCE_SHORT` PASS (`659d92d` 6 cycles, ws 117MiB→93MiB, handles bounded, package immutable, DB integrity true), `MULTI_REPO_STRESS` PASS (`659d92d` 4-repo concurrent + failure isolation + close/reopen reuse), `PACKAGE_RUNTIME` PASS (`659d92d` 13/13 smoke), `CRASH_RECOVERY` PASS (C1-C5 10/10), `UPGRADE_UNPACKED` PASS (9.9.9 synthetic, 10/10).
- **External-blocked (honest):** installer lifecycle/upgrade requires isolated/sanctioned Windows or CI `windows-latest` (exit 1602 without elevation); long endurance `ENDURANCE_LONG_QUALIFIED` time/host permits (short is done); `RELEASE_DRY_RUN` PASS (manifest 543188b, UNSIGNED, x64, SHA256 e14b10dc…).
---

## 4. Final certification matrix

The **Host** column says which machine produced the result. A host-W row is
evidence from the earlier session that could not be re-run in the continuation
session; it is reported as it was obtained, not re-asserted.

| Gate | Command | Host | Result | Evidence / Notes |
|------|---------|------|--------|------------------|
| FAST_TESTS | `npm test` | L | **PASS** | 76 files, 473 tests: 470 pass, 3 host-skips (Windows-only paths). Zero warnings or unhandled rejections. Host W previously recorded 469/469 plus 5× determinism loops of 51/51. |
| REAL_PROCESS_TESTS | `npm run test:real` (15 suites, `--no-file-parallelism`) | L | **PASS** | The complete tier in ONE process: 15 files, 66 tests, **60 passed / 6 skipped**, 400.8s. Every skip is honest and host-bound: 5 need `wsl.exe` with a node-capable distro (`Q.WIN.WSL.1`, real-swarm/real-dag/real-worktree WSL workers, WSL capability probe), 1 needs an authorized `ORCA_OPENCODE_QUALIFY_URL`. This run is what exposed the four Critical defects in §2A; it supersedes the prior PARTIAL/SIMULATED classification and closes `REAL_TIER_BASH_CAP`. |
| TYPECHECK | `npm run typecheck` | L | **PASS** | all workspaces `tsc --noEmit` clean |
| BUILD | `npm run build` | L | **PASS** | shared + controller `tsc`, desktop `tsc`, ui `vite build` 62 modules, 357.31 kB (96.57 kB gzip) |
| LINT | `npm run lint` | L | **PASS** | `tsc --noEmit` all workspaces |
| OPENSPEC_STRICT | `npm run openspec:validate` (`--all --strict`) | L | **PASS** | 31 passed, 0 failed — 28 before the Change-028 spec fold, 31 after (three new canonical capabilities) |
| SOURCE_INTEGRITY | `node scripts/ci/check-source-integrity.mjs` | L | **PASS** | 210 tracked source files, 735 relative imports all resolve (209/722 before the new regression test) |
| VERSION_COHERENCE | `node scripts/release/version-check.mjs` | L | **PASS** | 0.1.0 coherent across manifests and lockfile |
| BACKUP_RESTORE_QUALIFIED | `npm run test:backup-restore` | L | **PASS** | roundtrip bundle `orca-backup-0.1.0-2026-08-28T03-59-22-997Z` created and restored, recovery copy written. Host W produced the same verdict independently. |
| PACKAGE_BUILT | `npm run build` (artifacts) | W | **PASS** | controller `dist/`, desktop `dist/`, ui `dist/` present; `win-unpacked` Orca-Strator.exe 235MB SHA256 e14b10dc… |
| PACKAGE_RUNTIME_QUALIFIED | `node scripts/package/package-smoke.mjs` | W | **PASS** | 13/13 checks PASS: controller 92112 vs desktop 37756, reuse, persisted state, teardown; `PACKAGE_RUNTIME_QUALIFIED` |
| CRASH_RECOVERY_QUALIFIED | `node scripts/package/crash-recovery.mjs` | W | **PASS** | C1-C5 10/10: C1 crash/recovery, C2 desktop crash, C3 simultaneous converge, C4 startup failure recovery, C5 arbitrary cwd; `PACKAGED_CRASH_RECOVERY_QUALIFIED` |
| MULTI_REPO_STRESS_QUALIFIED | `node scripts/package/multi-repo-stress.mjs` | W | **PASS** | M0 4 repos concurrent, M1 independent watcher, M2 no cross-route, M3 failure isolation, M4 close/reopen reuse, M5 FK check; `MULTI_REPO_PACKAGED_STRESS_QUALIFIED` |
| ENDURANCE_SHORT_QUALIFIED | `node scripts/package/endurance.mjs --label short` (6 cycles) | W | **PASS** | 6/6 cycles PASS: ws 117MiB→93MiB handles 264→302 bounded, log 256B, resources immutable, DB integrity true; `ENDURANCE_SHORT_MODE_PASSED` (`659d92d` retry fix) |
| ENDURANCE_LONG_QUALIFIED | `npm run test:endurance` | W | **EXTERNAL / TIME** | Long endurance (30 cycles, hours) — honest external/time qualification; short is done, long requires host/time budget |
| UNPACKED_UPGRADE_PRESERVATION_QUALIFIED | `node scripts/package/upgrade-preservation.mjs` | W | **PASS** | UP.A1-A4/B1-B6 10/10: preserve DB, 9.9.9 synthetic, lock token; `UNPACKED_UPGRADE_PRESERVATION_QUALIFIED` |
| INSTALLER_LIFECYCLE_QUALIFIED | `npm run smoke:installer` (windows-ci.yml) | W | **EXTERNAL-BLOCKED** | `INSTALLER_EXECUTION_SANCTIONED_ENV_ONLY` — isolated/sanctioned or CI only; NSIS requires elevation (exit 1602 on dev host) |
| RELEASE_DRY_RUN_QUALIFIED | `node scripts/release/generate-release-manifest.mjs --artifact ...` | W | **PASS** | manifest `apps/desktop/release/release-manifest.json` version 0.1.0 commit 543188b signing UNSIGNED tier PACKAGE_RUNTIME_QUALIFIED SHA256 e14b10dc… + SHA256SUMS.txt |
| `git diff --check` | `git diff --check` | L | **PASS** | 0 whitespace errors |
| Clean tree | `git status --porcelain` | L | **CLEAN** | see §10 |

**Host W:** Windows_NT 10.0.26200 x64, `13th Gen i5-13500HX`, `D:/Documents/tryPython/orca-strator`, Node 24.3.0, Tailscale present but non-elevated, no `ORCA_OPENCODE_QUALIFY_URL`.
**Host L:** Linux container, Node 24.20.0, git 2.43.0, no `wsl.exe`, no Windows packaging toolchain, no `ORCA_OPENCODE_QUALIFY_URL`. The five Windows-only packaging harnesses (`crash-recovery`, `endurance`, `multi-repo-stress`, `package-smoke`, `installer-acceptance`) refuse to run here by design (`if (process.platform !== "win32") die(...)`), which is why their rows stay host-W.

---

## 5. Commands executed (this campaign, excerpt)

```
git fetch origin main && git rev-parse HEAD # 77c0d7f baseline → a02657e → a30097b → 8b33c26 → 0f558ac → 543188b → 659d92d
npm run version:check                      # OK 0.1.0
npm run openspec:validate -- --strict     # 28/28
npm run typecheck                          # clean (82s)
npm test -- ownership+transition+crash+shutdown # 51/51 ×5 deterministic loops
npm test                                   # 469/469, 75 files, 100s (×2 after D9.5 + matrices)
npm run build                              # shared/controller/desktop/ui (129s)
npm run lint                               # clean (81s)
git diff --check                           # 0 (after harness fixes)
npm run test:backup-restore               # PASS (roundtrip qZlXKV)
node scripts/package/crash-recovery.mjs   # PACKAGED_CRASH_RECOVERY_QUALIFIED 10/10
node scripts/package/endurance.mjs --label short # ENDURANCE_SHORT_MODE_PASSED 6/6 (ws 117MiB→93MiB)
node scripts/package/multi-repo-stress.mjs # MULTI_REPO_PACKAGED_STRESS_QUALIFIED
node scripts/package/package-smoke.mjs    # PACKAGE_RUNTIME_QUALIFIED 13/13
node scripts/package/upgrade-preservation.mjs # UNPACKED_UPGRADE_PRESERVATION_QUALIFIED 10/10
node scripts/release/generate-release-manifest.mjs --artifact Orca-Strator.exe # manifest 543188b UNSIGNED
grep -rn "TODO|FIXME" / grep "void " / audit # one void fixed, no TODO
git push origin main                       # main == origin/main after each slice (543188b, 659d92d)
```
Crash/restart/stress counts: ownership/transition/crash-matrices **5× deterministic loops** (51 tests ×5 = 255), fast suite **469/469 ×2** after fixes, endurance **6 cycles** (hard-kill at cycles 3,6), multi-repo **4 repos concurrent + failure isolation**, package smoke **13 checks**, upgrade **10 checks**, crash-recovery **10 checks**.

### 5A. Continuation session commands (host L, 2026-08-28)

```
git rev-parse HEAD                          # f63ddf0 (session start)
nvm install 24 && npm ci                    # Node 24.20.0; engines require >=24
node scripts/ci/check-source-integrity.mjs  # 209/722 -> 210/735 after the new test
node scripts/release/version-check.mjs      # OK 0.1.0
npm run openspec:validate                   # 28/28 -> 31/31 after the Change-028 spec fold
npm test                                    # 469 -> 473 (470 pass, 3 host-skips)
npm run typecheck                           # clean
npm run build                               # clean
npm run lint                                # clean
npm run test:backup-restore                 # PASS (roundtrip Tl7LEp)
npm run test:real                           # 15 files, 60 passed / 6 skipped, 400.8s  <-- FIRST COMPLETE RUN
git diff --check                            # 0
```

Real-tier batches run while diagnosing, before the final single-process run:
batch 1 (qualification / controls / buildapp / operational-intelligence) 10 passed
2 skipped; batch 2 (worktree-isolation / swarm / dag / strategy-loop-swarm /
strategy-loop-dag) 6 failed before repair, all green after; batch 3 (strategy
controls / postflight / movement / dag-concurrency / shutdown-restart / opencode)
8 failed before repair, all green after. The structural outbox guard was verified
by deleting the `START_EXECUTION_ACTOR` branch and confirming the test fails with
`outbox effect kinds enqueued but never delivered: START_EXECUTION_ACTOR`.
---

## 6. Artifacts

| Artifact | Path / Filename | Size | SHA-256 (first 12) | Version / BuildId |
|----------|-----------------|------|--------------------|-------------------|
| Controller dist | `apps/controller/dist/` | — | (tsc output) | `0.1.0` (`@orca/controller@0.1.0`) |
| Shared dist | `packages/shared/dist/` | — | — | `@orca/shared@0.1.0` |
| Desktop dist | `apps/desktop/dist/` | — | — | `@orca/desktop@0.1.0` |
| UI dist | `apps/ui/dist/assets/index-DIazckoo.js` | 357.31 kB (96.57 kB gzip) | — | `0.1.0` vite 8.2.1, 62 modules |
| Win-unpacked exe | `apps/desktop/release/win-unpacked/Orca-Strator.exe` | 235,533,824 | `e14b10dc6055…` | `0.1.0` commit `543188b`, protocol 1, arch x64, UNSIGNED (authenticode NotSigned) |
| Release manifest | `apps/desktop/release/release-manifest.json` | 703 B | — | `0.1.0` commit `543188b`, tier `PACKAGE_RUNTIME_QUALIFIED`, signing `UNSIGNED` |
| SHA256SUMS | `apps/desktop/release/SHA256SUMS.txt` | — | — | covers exe + manifest |
| Backup roundtrip bundle | `C:\Users\palac\AppData\Local\Temp\orca-backup-roundtrip-qZlXKV\backups\orca-backup-0.1.0-2026-08-28` | — | — | 0.1.0, recovery copy at `.../restored/pre-restore-...` |
| Endurance report | `apps/desktop/release/endurance-short-report.json` | 2.5K | — | 6 cycles, verdict `ENDURANCE_SHORT_MODE_PASSED`, duration ~120s |
| Upgrade workspace | `C:\Users\palac\AppData\Local\Temp\orca-upgrade-preserve-urXGOm` | — | — | synthetic 9.9.9 → 0.1.0 preserved |

No NSIS installer artifact produced on this host (requires `npm run package:win:installer` / `windows-package.yml` sanctioned workflow with elevation). When produced, record `win-unpacked` `resources/controller/dist/` + installer `Orca-Strator-Setup-0.1.0.exe` SHA-256/version/arch/signing.


---

## 7. Remaining external-only evidence and exact way to obtain it

1. **Tailscale phone route** — `TAILSCALE_PHONE_ROUTE_EXTERNAL_UNQUALIFIED`: install/authorize Tailscale elevated on Windows, run `npm run test:real` phone tailnet qualification or manual `tailscale serve` reverse-proxy check via `Tailscale Serve` docs.
2. **OpenCode provider** — `OPENCODE_EXTERNAL_UNQUALIFIED`: set `ORCA_OPENCODE_QUALIFY_URL` to an authorized OpenCode server, run `apps/controller/test/real-opencode.test.ts` in isolation (`npx vitest run apps/controller/test/real-opencode.test.ts --testTimeout=60000`).
3. **NSIS installer lifecycle** — `INSTALLER_EXECUTION_SANCTIONED_ENV_ONLY`: run in isolated VM or CI `windows-latest` via `.github/workflows/windows-package.yml` → `npm run package:win:installer && node scripts/package/installer-acceptance.mjs` (phases: install / upgrade / uninstall, isolated dirs, no silent install on dev host).
4. **Long endurance (30 cycles)** — run with host/time budget: `npm run test:endurance -- --cycles=30 --timeout=7200000` and collect threshold metrics; short 6-cycle now PASS (`659d92d` 6/6), long is honest time/host qualification.
5. **WSL executor tier** — five real-tier tests skip without `wsl.exe` and a node-capable distro: `Q.WIN.WSL.1`, the real-swarm / real-dag / real-worktree WSL workers, and the WSL capability probe. On a Windows host with WSL installed they run as part of `npm run test:real`; they need no code change and no authorization, only the distro.
6. **Windows packaging harnesses on a non-Windows host** — `crash-recovery`, `endurance`, `multi-repo-stress`, `package-smoke` and `installer-acceptance` all begin with `if (process.platform !== "win32") die(...)`. They are host-bound rather than authorization-bound; item 3 above is the only one that additionally needs elevation or a sanctioned environment.

Each requires zero further engineering; the command or workflow above reproduces PASS/FAIL without a code change.

**Removed from this list:** the full 15-suite `npm run test:real` single-process run, previously item 5. It was never external — it was unrun, and running it found four Critical defects (§2A). It now passes in 400.8s.
---

## 8. Remaining locally reproducible Critical/High blocker statement

**None on the final tree.** Every gate that can run on an available host runs green,
including the complete real-process tier that had never been run to completion.

The honest history matters more than the verdict:

- The previous revision of this report claimed "no known locally reproducible
  Critical/High defect remains" while the real-process tier stood at
  `PARTIAL / SIMULATED`. That claim was not supportable. Four Critical defects
  were sitting in the unrun tier, three of them introduced by Change 028 itself
  (§2A), and every autonomous turn through the production watcher path was broken.
- The mechanism of the error is worth naming: a suite that *could not run on the
  host at hand* was filed under *requires an external sanctioned environment*.
  Those are different categories, and conflating them converts an unrun test into
  a permanent excuse. Change 028's own completion gate had been read as satisfied
  on that basis.
- What is left is genuinely host- or authorization-bound and is enumerated in §7
  with exact commands: Windows packaging harnesses, the NSIS installer lifecycle,
  the WSL executor tier, long endurance, the Tailscale phone route and an
  authorized OpenCode endpoint. None of them hides unfinished engineering, and
  none of them is a substitute for a test that simply had not been run.

---

## 9. OpenSpec/docs/state truth

- **Canonical specs:** `openspec/specs/**` now carries 27 capabilities and
  `openspec validate --all --strict` passes 30/30. Change 028's three delta specs
  are folded as `durable-execution-ownership`,
  `crash-consistent-transition-processing` and `abortable-runtime-lifecycle`.
- **Change 028:** all 125 tasks ticked with evidence; archived as
  `openspec/changes/archive/2026-08-28-028-durable-execution-ownership-and-crash-consistency`.
  Task 15.8's earlier claim that the remaining real tiers were external is
  corrected in place rather than quietly re-ticked.
- **Change 026:** §13–16 execution evidence, §22.1 final battery and §22.2
  artifact records are now ticked with host-attributed evidence. §9.2 (release
  dry-run rehearsal) and §11.2/12.2 (installer lifecycle on an ephemeral Windows
  runner) stay open, so §24.1 archive stays open. Deliberate.
- **Change 027:** §5.1 battery, §6.1 wording audit and §6.2 state are ticked.
  §6.3 archive stays open pending Tailscale and the sanctioned installer
  lifecycle. Deliberate.
- **Change 029:** 103 of 110 tasks ticked with evidence. The seven open items are
  annotated in place, each naming whether it is host-bound or
  authorization-bound. The umbrella stays active because 026 and 027 do.
- **Docs:** ARCHITECTURE §12.1, DATA-MODEL, RUNTIME-MODEL,
  OBSERVABILITY-AND-FAILURES and DEVELOPMENT carry the ownership/transition/audit
  contracts. README's qualification block, ROADMAP Milestone 25 and
  TEST-STRATEGY §26 are updated with this session's evidence — and each records
  the unrun-versus-external correction, because a lesson that only lives in a
  report is a lesson the next agent will not read.
- **Agent state:** `.agent/state.json` records the final SHA, the gate matrix,
  external-only evidence, the remaining blockers and the next action.

---

## 10. Final Git evidence

```
Branch:  claude/complete-entire-thing-n7u6i9
Remote:  https://github.com/quantdale/orca-strator
Session start SHA: f63ddf0
Commits (this session, oldest first):
  f30c2f6  Change 029 (10.7): fix three host-flavour defects found by non-Windows gate run
  718f336  Change 028 (D9.5): deliver the START_EXECUTION_ACTOR outbox effect
  c4d3772  Change 028 (D9.5): fast-tier guard so an undelivered outbox effect cannot return
  9a11051  Change 028 (D9/D11): repair the three stale "dispatch consumed = iteration done" inferences
  8ec3b86  Change 028 (D3.1): make postflight retry durable and separate success from terminal
  <this>   Change 029 (7.6/8/9/12): fold Change 028, reconcile 026/027/029, final docs and state
Tracked files: 471
Status: working tree clean; branch == origin/claude/complete-entire-thing-n7u6i9
```

The repository's standing policy is direct commits to `main`. This session's
operator instruction named `claude/complete-entire-thing-n7u6i9` as the
development branch, and a session-scoped instruction overrides the repository
default. Nothing was force-pushed under either policy.

---

## 11. Conclusion

Orca-Strator's engineering is complete for its documented V1 scope, and every
gate that an available host can run is green — including, for the first time,
the complete real-process tier.

What this session actually changed is worth stating plainly, because the previous
revision of this report would have led a reader to believe the work was already
done. It was not. Four Critical defects were sitting in a test tier that had
never been run to completion, three of them introduced by Change 028 — the very
campaign whose purpose was crash consistency. The dispatch path consumed its
marker and then never started an executor. Every SWARM and DAG completion was
swallowed after the workers had already published to the remote. Postflight
retry could never find a candidate and was not idempotent when it did. None of
this was visible to 473 passing fast tests, because the fast tier proves the
transition service's transaction boundary against its own test deliverer and
cannot see whether production wires the effect at all.

The mechanism that hid them is the part worth carrying forward. A suite that
could not finish inside one host's process budget was recorded as requiring an
external sanctioned environment. Those are different claims. The first is an
unrun test and a debt; the second is a qualification tier and a fact. Filing the
first as the second let a completion gate read as satisfied while the product's
main autonomous path was broken. That distinction is now written into
TEST-STRATEGY, ROADMAP, README and the 029 task file, where the next agent will
meet it before it meets this report.

What remains is small, named, and genuinely outside this host: the NSIS
installer lifecycle (elevation or a sanctioned Windows environment), long-soak
endurance, the WSL executor tier, the Tailscale phone route, and an authorized
OpenCode endpoint. Changes 026 and 027 stay open for exactly those reasons
rather than being archived to make the board look finished.
