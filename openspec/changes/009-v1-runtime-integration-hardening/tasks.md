# Tasks: V1 Runtime Integration Hardening (Change 009)

Reopen V1 as NOT YET QUALIFIED. Resolve findings A–R with real production wiring and truthful qualification. Keep all fake/mock tests as regression coverage; do not use them as proof of real end-to-end autonomy.

## A. Wire the real autonomous pipeline

- [ ] A.1 Add `onDispatchDetected` callback to `WatcherService`; `buildApp` wires watcher → `loopService.onDispatchDetected` exactly once per new dispatch.
- [ ] A.2 Add `onExecutorCompleted(repositoryId, dispatchId, result)` callback to `ExecutorService`; `buildApp` wires executor → `loopService.onExecutorCompleted`.
- [ ] A.3 `LoopService` stores `watcherService` and uses callbacks for all transitions; no qualification test calls internal transition methods directly.
- [ ] A.4 Exactly-once transition guard keyed on `(repositoryId, dispatchId, transitionKind)`.
- [ ] A.5 Focused test: watcher detects real dispatch and the loop starts the executor WITHOUT a manual `onDispatchDetected` call.

## B. Watcher lifecycle + Git correctness

- [ ] B.1 Auto-watch configured repos on `start()`; add/remove watches on `repository.created`/`updated`/`deleted` without controller restart.
- [ ] B.2 On remote HEAD move: cheap HEAD query → `fetch origin main` → `rev-list --reverse lastObservedSha..remoteHeadSha` → inspect every unseen commit chronologically.
- [ ] B.3 Detect isolated dispatch behind a later ordinary HEAD commit.
- [ ] B.4 Persist `lastObservedSha` only after all commits in the range are safely inspected; record actionable error/recovery state for un-inspectable commits and do not advance past them.
- [ ] B.5 Publish poll errors observably (not swallowed).

## C. Windows/WSL Git environment adapters

- [ ] C.1 Environment-aware Git abstraction: Windows uses `git` with Windows cwd; WSL uses `wsl.exe -d <dist> --cd <linuxPath> -- git ...`.
- [ ] C.2 Apply the same boundary uniformly to fetch/status/rev-list/diff/show/commit/push/result inspection.
- [ ] C.3 Real Windows/WSL fixture tests for git operations.

## D. Executor invocation architecture

- [ ] D.1 Per-harness invocation profiles (Kimi Code, Codex) describing argument-array construction; no `<cli> --model <model> "<prompt>"` assumption.
- [ ] D.2 Inspect locally installed CLI `--help`/`--version` when available instead of guessing syntax.
- [ ] D.3 Remove `shell: true`; spawn executable + argument arrays directly; explicit PowerShell shell only when required.
- [ ] D.4 User remains the only authority for executor/model; no Sol dynamic switching.
- [ ] D.5 Locked launch/contact retry policy: up to 3 bounded attempts (not retries of failing implementation tests).

## E. Executor result contract (real)

- [ ] E.1 After child exit, read `.orca/results/<dispatch-id>.json`; validate structurally + semantically (runId/dispatchId/iteration/repository/SHAs/status).
- [ ] E.2 Verify intended code/result changes are committed and pushed to `main`; enforce isolated result/control protocol.
- [ ] E.3 Do NOT mark dispatch consumed solely because child exited 0; invalid/incomplete turn ⇒ recovery.
- [ ] E.4 Preserve COMPLETED / BLOCKED / NEEDS_HUMAN / FAILED, plus verification and blocker evidence.
- [ ] E.5 Truthful failure/recovery state.

## F. Git preflight / postflight

- [ ] F.1 Preflight: inspect working tree, preserve dirty work, fetch/reconcile remote main, never `reset --hard` merely to simplify, never auto force-push.
- [ ] F.2 Postflight: inspect actual files/commits, reconcile remote main if moved, verify result commit/SHA, surface unrecoverable conflict as structured blocker.

## G. Loop state semantics

- [ ] G.1 Sol alone authoritative for `GOAL_COMPLETE`. Do NOT derive it from max iteration / max wall-clock / draining / executor exit success.
- [ ] G.2 Ceiling crossing while actor active ⇒ `DRAINING`; current actor may finish; then `STOPPED` (CEILING_REACHED). Never kill actor merely due to ceiling.
- [ ] G.3 8h ceiling is run wall-clock, not per-executor kill timeout; separate executor watchdog.
- [ ] G.4 Initial Sol wake must not pretend `COMPLETED`; subsequent wakes carry real result status.

## H. Sol control markers

- [ ] H.1 `CommitInspector` detects isolated Sol-control commits (`.orca/sol-control/<id>.json`).
- [ ] H.2 Validate, associate with correct run/iteration, apply idempotently: GOAL_COMPLETE / BLOCKED / NEEDS_HUMAN / PAUSED.
- [ ] H.3 Observe alongside dispatch commits; never infer high-level completion from browser text or executor exit code.

## I. Pause / Resume / Stop / Emergency Kill

- [ ] I.1 Pause (during executor): terminate executor promptly, preserve working tree, do not wake Sol, state ⇒ PAUSED.
- [ ] I.2 Resume: restart SAME unfinished dispatch with recovery bootstrap; not merely SOL_REVIEWING.
- [ ] I.3 Stop: graceful drain; current actor may finish; prevent next handoff; do not immediately kill executor.
- [ ] I.4 Emergency Kill: separate destructive op; terminate selected repo's active executor/browser page; truthful RECOVERY_REQUIRED/interrupted state.
- [ ] I.5 Expose distinct API/UI controls; test all four semantics.

## J. Browser profile ownership

- [ ] J.1 In-process browser mode ownership (INTERACTIVE_SETUP / AUTOMATED) plus cross-process profile lock.
- [ ] J.2 Modes prevent incompatible overlap; stale lock recovery verifies real ownership.

## K. Playwright self-contained and safe

- [ ] K.1 Fresh install has supported Chromium provisioning/setup path; no dependency on another project's browser binary.
- [ ] K.2 Diagnostics/setup status: Playwright dep, Chromium availability, profile dir, auth readiness.
- [ ] K.3 Remove `--disable-blink-features=AutomationControlled` and `--no-sandbox` unless documented; no anti-detection; no CAPTCHA/rate-limit/private-API bypass.

## L. Real ChatGPT wake lifecycle

- [ ] L.1 Exact configured conversation URL; resilient composer/send adapter; safe busy-UI dismissal.
- [ ] L.2 Busy/backpressure queue with bounded retry/backoff; auth/logout detection; Cloudflare/CAPTCHA/verification ⇒ ATTENTION_REQUIRED.
- [ ] L.3 ~20-min Sol wait, one retry, then SOL_STALLED; duplicate wake idempotency.
- [ ] L.4 After submit, wait for expected Git/GitHub transition; correlate with correct repo/run/iteration; close that repo page when Sol op completes; close Chromium when active Sol pages reaches zero; one repo failure must not terminate unrelated repo pages.

## M. Startup / crash recovery

- [ ] M.1 `StartupReconciler` resumes EXISTING active run (rehydration) instead of `startRun()` duplicate.
- [ ] M.2 EXECUTING interrupted by process loss ⇒ RECOVERY_REQUIRED; preserve dirty checkout; require explicit Resume where contract says so.
- [ ] M.3 Reconstruct active state from SQLite + Git; resume safe waiting/watcher states; idempotent pending wake resubmit; restore watchers; prevent duplicate dispatch/executor/wake execution.
- [ ] M.4 Never swallow recovery failures silently.

## N. Status / terminal state visibility

- [ ] N.1 Distinguish active run / latest run / latest terminal/problem state.
- [ ] N.2 UI continues displaying why a run stopped and exposes recovery actions; IDLE means genuinely no relevant active/problem run.

## O. Real log / activity streaming

- [ ] O.1 Publish bounded structured log/activity events (executor stdout/stderr, watcher, Sol wake/browser, state transitions, Git/recovery).
- [ ] O.2 Bounded disk retention; no secret leakage.

## P. Tailscale status truthfulness

- [ ] P.1 Detect/report honestly: not installed / not running / not authenticated / Serve not configured / configured-reachable / unknown.
- [ ] P.2 Controller loopback-only; no Funnel/public exposure; label setup guidance if auto-config out of scope.

## Q. Real qualification tier

- [ ] Q.1 Real temp Git repo + bare remote; real watcher poll/fetch and an actual isolated dispatch commit.
- [ ] Q.2 Production watcher automatically causes loop to start executor without manual transition calls.
- [ ] Q.3 Real child-process execution through Windows path; real WSL execution via `wsl.exe` with Linux working tree.
- [ ] Q.4 Deterministic harmless test executor for process/Git/result-protocol qualification.
- [ ] Q.5 Separate qualification of locally installed real Kimi Code/Codex adapter without burning unnecessary inference.
- [ ] Q.6 Real result manifest written/validated/committed/pushed then automatically routed back into the loop.
- [ ] Q.7 Real controller restart/reconstruction tests; real Pause/Resume/Stop/Emergency Kill; real multi-repo concurrency.
- [ ] Q.8 Chromium provisioning smoke; headed setup browser smoke + persistent profile reuse.
- [ ] Q.9 If ChatGPT auth available, prove a real harmless wake; if Tailscale installed, private same-origin phone-route smoke; else explicitly UNQUALIFIED.
- [ ] Q.10 At least one test starts the assembled REAL controller services and proves remote Git dispatch → watcher → loop → executor process → durable executor result → loop → Sol wake transport boundary, mocking only the truly external ChatGPT response.

## R. Reconcile documentation and completion state

- [ ] R.1 Update `.agent/state.json` (NOT_YET_QUALIFIED / hardening; honest waypoint).
- [ ] R.2 Update README, ROADMAP, canonical specs, Change 009 tasks to distinguish IMPLEMENTED / SIMULATION-TESTED / MACHINE-QUALIFIED / MANUALLY-QUALIFIED / UNQUALIFIED / BLOCKED.
- [ ] R.3 No false Windows/WSL/Playwright/Tailscale qualification claims.
