# Design: V1 Runtime Integration Hardening (Change 009)

## 1. Connection mechanism (Finding A)

The pipeline is connected with **explicit typed callbacks**, not tests calling transition methods.

`buildApp()` (and any test harness) wires the runtime graph once:

```
RepositoryService.events ──▶ WatcherService.reconcile repo set
WatcherService ──onDispatchDetected(repoId, dispatchId)──▶ LoopService.onDispatchDetected
LoopService ──▶ ExecutorService.startRun(repositoryId, dispatchId)
ExecutorService ──onExecutorCompleted(repoId, dispatchId, result)──▶ LoopService.onExecutorCompleted
LoopService ──▶ BrowserManager.submitSolWake(...)
```

Mechanism:

- `WatcherService` gains an optional `onDispatchDetected` callback set by `buildApp`. When `executePollCycle` confirms a new, unconsumed valid dispatch, it calls `onDispatchDetected(repoId, dispatchId)` **exactly once** (guarded by the consumed-record write inside the same synchronous path). Auto-watch is also driven by `RepositoryService` events (`repository.created`/`updated`/`deleted`) so new repos become watchable and removed/disabled repos stop being watched without controller restart.
- `ExecutorService` gains an optional `onExecutorCompleted(repositoryId, dispatchId, result)` callback invoked from `onExit` after the result contract is processed. It must NOT mark a dispatch consumed until the result contract is durably validated; if the result is invalid/incomplete it routes to recovery instead of success.
- `LoopService` stores `watcherService` and, if provided, an `executorStore`/result reader, and uses the callbacks for all transitions. The public API (`startRun`, Pause/Resume/Stop/Emergency Kill) remains the only external entry points; internal transition methods are invoked by the wiring, never by qualification tests.

Exactly-once: each transition is keyed on `(repositoryId, dispatchId, transitionKind)` and persisted before the dependent side-effect, so a duplicate event (e.g. watcher re-poll, browser wake retry) is idempotent.

## 2. Loop state semantics (G, M)

- `onExecutorCompleted` MUST NOT map ceiling/wall-clock/reached to `GOAL_COMPLETE`. Ceiling crossing while an actor is active ⇒ `DRAINING`; after the current actor finishes (executor result received) the run moves to `STOPPED` with a `CEILING_REACHED` reason flag (recorded in `lastError`/reason). The 8h ceiling is a run wall-clock ceiling, not a per-executor kill timeout; the true executor watchdog (separate, bounded) is independent of it.
- `submitSolWakeForRun` carries the **real** result status. The initial Sol wake (no prior executor result) passes `resultStatus: null` (or a distinct `INITIAL` sentinel) so it does not pretend `COMPLETED`. Subsequent wakes carry the actual executor result status.
- `StartupReconciler.reconcile()` resumes the **existing** active run: if `SOL_PENDING`/`SOL_REVIEWING` it re-attaches watcher state and idempotently resubmits a pending Sol wake (dedupe by an existing `pending` wake record); if `EXECUTING`/`EXECUTOR_PENDING` it sets `RECOVERY_REQUIRED` and preserves the dirty checkout; it never calls `startRun()` for an already-active run. All recovery failures are surfaced, never swallowed.

## 3. Status/terminal visibility (N)

- `RunStore` exposes `getActiveRun` (in-progress actors), `getLatestRun` (most recent regardless of state), and `getLatestTerminalRun` (most recent problem/terminal state). `LoopService.getStatus` returns `state` from the active run when present, else a `latestTerminal` summary so `BLOCKED`/`NEEDS_HUMAN`/`SOL_STALLED`/`EXECUTOR_UNAVAILABLE` are visible rather than collapsed to `IDLE`. `IDLE` means genuinely no relevant active/problem run.

## 4. Watcher lifecycle + Git correctness (B, C)

- `WatcherService.start()` watches all configured repos; repository events add/remove watches. Deleted/disabled repos stop being watched. Poll errors are published as `watcher.poll_completed` with `lastError` and surfaced (not swallowed).
- Poll cycle: (1) cheap remote HEAD query; (2) if HEAD moved, `git fetch origin main` so every referenced commit object exists locally; (3) `git rev-list --reverse lastObservedSha..remoteHeadSha` to get every unseen commit in chronological order; (4) inspect each commit independently with `CommitInspector`; (5) an isolated dispatch behind a later ordinary HEAD commit is still detected; (6) persist `lastObservedSha` **only after** each commit in the range has been safely inspected (record an actionable `RECOVERY`/error state for any commit that cannot be inspected, and do not advance past it).

## 5. Environment-aware Git (C)

- New `GitEnvironment` abstraction: `windows` → `git` with the Windows `cwd`; `wsl` → `wsl.exe -d <dist> --cd <linuxPath> -- git ...` (the Linux working tree, never a Windows path). The same boundary is used for fetch/status/rev-list/diff/show/commit/push/result inspection. A repo's `wslDistribution` and Linux `localPath` drive WSL execution; the Windows `localPath` is used only for non-Git local FS access (logs) where appropriate.

## 6. Executor invocation + result contract (D, E, F)

- New **executor invocation profiles** keyed by CLI name (e.g. `kimi-code`, `codex`) describing how to build the argument array and how to probe the locally installed binary (`--help`/`--version` discovery) without guessing syntax. Profiles are data + small adapter functions; no dynamic model routing (user owns executor/model). Avoid `shell: true`; spawn executable + argument arrays directly; only use an explicit PowerShell shell when a profile genuinely requires it.
- Locked launch/contact retry policy: up to **3 bounded attempts** for inability to start/contact the harness (not three retries because implementation tests fail).
- **Result contract**: after the child exits, the runner/executor reads `.orca/results/<dispatch-id>.json` from the repository working tree, validates it structurally and semantically (runId/dispatchId/iteration/repository/SHAs/status), verifies intended code/result state is committed and pushed to `main`, and only then marks the dispatch consumed. If the child exited 0 but produced no valid durable result/commit, that is an **invalid/incomplete executor turn** (recovery/retry), not success. Verification and blocker evidence are preserved. The isolated result/control protocol is enforced.
- **Preflight/postflight**: before execution inspect working tree, preserve dirty work, fetch/reconcile remote `main`, never `reset --hard` merely to simplify, never auto force-push. After execution reconcile remote `main`, verify the result commit/SHA, surface unrecoverable conflict as structured blocker.

## 7. Controls (I, H)

- **Pause**: terminate executor promptly (stop inference usage), preserve working tree exactly, do not wake Sol, state ⇒ `PAUSED`.
- **Resume**: restart the **same** unfinished dispatch with the configured executor and a recovery bootstrap instructing it to inspect/preserve partial work and continue; not merely `SOL_REVIEWING`.
- **Stop**: graceful drain — current actor may finish, no next handoff, do not immediately kill the executor.
- **Emergency Kill**: separate destructive op — immediately terminate the selected repository's active executor/browser page where possible; preserve truthful `RECOVERY_REQUIRED`/interrupted state.
- **Sol control markers (H)**: `CommitInspector` also detects isolated Sol-control commits (`.orca/sol-control/<id>.json`): `GOAL_COMPLETE` / `BLOCKED` / `NEEDS_HUMAN` / `PAUSED`. They are validated, associated with the correct run/iteration, and applied idempotently. High-level completion is never inferred from browser text or executor exit code.

## 8. Browser (J, K, L)

- **Profile ownership (J)**: explicit in-process browser **mode** (INTERACTIVE_SETUP vs AUTOMATED) plus cross-process profile lock. Modes prevent incompatible overlap: if automated Chromium owns the profile, headed setup cannot silently reuse it; if setup owns it, automated wake queues/fails with actionable state. Stale lock recovery verifies real ownership.
- **Self-contained (K)**: fresh install has a supported Chromium provisioning/setup path; do not depend on another project's browser binary. Diagnostics/setup status for Playwright dependency, Chromium availability, profile dir, and auth readiness. Remove `--disable-blink-features=AutomationControlled` and `--no-sandbox` unless a documented requirement proves otherwise. No anti-detection, no CAPTCHA/rate-limit/private-API bypass.
- **Real wake lifecycle (L)**: exact configured conversation URL; resilient composer/send selector adapter; safe informational-busy dismissal; ChatGPT busy/backpressure queue with bounded retry/backoff; auth/logout detection; Cloudflare/CAPTCHA/verification ⇒ `ATTENTION_REQUIRED`; configurable ~20-minute Sol wait, one retry, then `SOL_STALLED`; duplicate wake idempotency; after submit, wait for the expected Git/GitHub transition, correlate with the correct repo/run/iteration, close that repo page when its Sol op completes, and close Chromium when active Sol pages reaches zero; one repo failure must not terminate unrelated repo pages.

## 9. Observability (O) and Tailscale (P)

- **O**: `ExecutorService` publishes bounded structured `executor.log` events (stdout/stderr); watcher/browser/state-transition/Git/recovery events already flow via `EventBus`. Disk log retention is bounded (existing `log-rotator`). No secrets in logs.
- **P**: Tailscale status detects not-installed / not-running / not-authenticated / Serve-not-configured / configured-reachable / unknown. Controller stays loopback-only; no Funnel/public exposure. If full automatic configuration is out of scope, the feature is labeled setup guidance rather than falsely reporting "configured".

## 10. Qualification (Q) and documentation (R)

- Keep all fake/mock tests (regression). Add a **real** qualification tier that starts the assembled controller (`buildApp`) and proves: real temp Git repo + bare remote; real watcher poll/fetch + real isolated dispatch commit; production watcher automatically drives the loop to start a real executor (no manual transition call); real child-process executor writes/commits/pushes a valid `.orca/results/<id>.json`; the loop routes it back; a deterministic harmless test executor qualifies the process/Git/result protocol; optionally the locally installed real Kimi Code/Codex adapter is qualified without burning inference; real restart reconstruction; real Pause/Resume/Stop/Emergency Kill; real multi-repo concurrency; Chromium provisioning smoke; headed setup profile reuse; (if auth available) a harmless real wake; (if Tailscale installed) private same-origin phone-route smoke, else explicitly `UNQUALIFIED`. ChatGPT response may be mocked only at the external boundary; the internal wiring being qualified must be real.
- **R**: `state.json`, `README`, `ROADMAP`, canonical specs, and Change 009 tasks distinguish `IMPLEMENTED` / `SIMULATION-TESTED` / `MACHINE-QUALIFIED` / `MANUALLY-QUALIFIED` / `UNQUALIFIED / BLOCKED`.

## Recommended implementation order

1. A (callback wiring) + G (loop semantics) + M (rehydration) + N (status) — smallest change with biggest truth impact.
2. B (watcher git correctness) + C (env-aware git).
3. D (invocation profiles) + E/F (result contract + preflight/postflight).
4. I (controls) + H (sol control markers).
5. J/K/L (browser) + O (logging) + P (tailscale).
6. Q (real qualification) + R (docs).

Each step is verified with focused tests; broad typecheck/test/build/lint runs at checkpoints.
