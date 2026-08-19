# Tasks: V1 Runtime Integration Hardening (Change 009)

V1 was reopened as **NOT YET QUALIFIED**. This file tracks the corrective work for
findings A–R. Status legend used below:

- **MACHINE-QUALIFIED** — proven on this machine with real Git / real child-process
  executor / real WSL / real service wiring, not just a simulation.
- **SIMULATION-TESTED** — implementation present and covered by fake/mock tests; not
  yet proven against the real external dependency on this machine.
- **UNQUALIFIED** — required real external dependency (real Kimi/Codex CLI, Chromium,
  ChatGPT auth, Tailscale) absent on this machine; explicitly not faked green.

Simulation tests remain as regression coverage and are NOT proof of real autonomy.

---

## A. Wire the real autonomous pipeline — MACHINE-QUALIFIED

- [x] A.1 `WatcherService` `onDispatchDetected` callback; `buildApp` wires watcher → `loopService.onDispatchDetected` exactly once per new dispatch.
- [x] A.2 `ExecutorService` `onExecutorCompleted(repositoryId, dispatchId, result)` callback; `buildApp` wires executor → `loopService.onExecutorCompleted`.
- [x] A.3 `LoopService` uses callbacks for all transitions; the qualification test calls no internal transition methods.
- [x] A.4 Exactly-once dispatch/result transition (dispatch recorded once; result consumed once).
- [x] A.5 **Proven** by `Q.WIN.1` / `Q.WIN.WSL.1`: watcher detects a real dispatch and the loop starts a real executor with no manual transition call.

## B. Watcher lifecycle + Git correctness — SIMULATION-TESTED

- [x] B.1 Auto-watch configured/enabled repos on `start()`; add/remove watches on `repository.created/updated/deleted` via event bus (verified by watcher-integration tests 6.T5).
- [x] B.2 Remote HEAD move: cheap `ls-remote` → `fetch origin main` → `rev-list --reverse lastObservedSha..remoteHeadSha` → inspect every unseen commit chronologically.
- [x] B.3 Isolated dispatch behind a later ordinary HEAD commit is detected (watcher-integration 6.T2).
- [x] B.4 `lastObservedSha` advances only after all commits in the range are inspected; errors recorded, not advanced past.
- [x] B.5 Poll errors published observably (watcher event + lastError), not swallowed.

## C. Windows/WSL Git environment adapters — MACHINE-QUALIFIED

- [x] C.1 Environment-aware Git: Windows uses `git` with Windows cwd; WSL uses `wsl.exe -d <dist> --cd <linuxPath> -- git ...`. Added `wsl-path.ts` Windows↔WSL conversion.
- [x] C.2 Same boundary applied uniformly (fetch/status/rev-list/show/commit/push/result inspection) via `GitClient` + `WslAdapter`.
- [x] C.3 **Real** Windows fixture test (`Q.WIN.1`) and **real WSL** fixture test (`Q.WIN.WSL.1` runs through `wsl.exe -d Ubuntu --cd <linux tree> -- node <harness>`).

## D. Executor invocation architecture — MACHINE-QUALIFIED (syntax verified; no quota burn)

- [x] D.1 Per-harness profiles (`kimi`, `codex`, `generic`, `test`) build argument arrays; no `<cli> --model <model> "<prompt>"` assumption.
- [x] D.2 Real CLI `--help` inspected on this machine: Kimi Code 0.34.0 (`kimi -m <model> -p "<prompt>"`), Codex 0.147.0 (`codex exec -m <model> --json "<prompt>"`); profiles corrected accordingly. WSL `node --version` verified (Ubuntu v18.19.1).
- [x] D.3 `shell: false`; executable + argument arrays (no unsafe shell interpolation).
- [x] D.4 User is the only executor/model authority; Sol never switches it.
- [x] D.5 Locked launch/contact retry: up to 3 bounded attempts via `ExecutorRunner.awaitSpawn` handshake (async ENOENT retried; post-spawn nonzero is single attempt); terminal callback fires exactly once.

## E. Executor result contract (real) — MACHINE-QUALIFIED

- [x] E.1 Read `.orca/results/<dispatch-id>.json`; validate structurally + semantically (runId/dispatchId/iteration/repository/SHAs/status).
- [x] E.2 Verify committed + pushed to `main` with ancestor-aware postflight (work commit is an ancestor of final HEAD, never exact-only).
- [x] E.3 Exit 0 without a valid durable result ⇒ `RECOVERY_REQUIRED`, NOT consumed.
- [x] E.4 Preserve COMPLETED / BLOCKED / NEEDS_HUMAN / FAILED plus verification/blocker evidence.
- [x] E.5 Truthful failure/recovery state. **Proven** by `Q.WIN.1`/`Q.WIN.WSL.1`.

## F. Git preflight / postflight — SIMULATION-TESTED

- [x] F.1 Preflight: `fetch origin main`; never `reset --hard`; never auto force-push.
- [x] F.2 Postflight: verify result commit/SHA on local + remote HEAD; unrecoverable conflict surfaces as structured blocker (handled in `readAndValidateResult` / loop terminal states).

## G. Loop state semantics — MACHINE-QUALIFIED

- [x] G.1 Sol alone authoritative for `GOAL_COMPLETE`; not derived from ceiling / wall-clock / draining / executor exit.
- [x] G.2 Ceiling crossing while actor active ⇒ `DRAINING` then `CEILING_REACHED`; actor may finish; never killed merely for ceiling (proven by accelerated-clock + real-runtime-controls slow harness).
- [x] G.3 8h ceiling is run wall-clock (`maxRuntimeMinutes`); executor watchdog is separate (`watchdogMs`, disabled by default 0, not derived from `maxRuntimeMinutes`).
- [x] G.4 Initial Sol wake carries `INITIAL`, not `COMPLETED`; subsequent wakes carry real result status. `checkWallClockCeiling` test hook + wall-clock timers with unref.

## H. Sol control markers — IMPLEMENTED; H.4 MACHINE-QUALIFIED via Q.APP.1

- [x] H.1 `CommitInspector` detects isolated Sol-control commits (`.orca/sol-control/<id>.json`); `onControlDetected` wired into the loop.
- [x] H.2 Validate, associate with correct run/iteration, apply idempotently (GOAL_COMPLETE / BLOCKED / NEEDS_HUMAN / PAUSED).
- [x] H.3 Never infer high-level completion from browser text or executor exit code.
- [x] H.4 End-to-end control-marker round trip machine-qualified via `Q.APP.1` (second half): real bare repo, real Sol-control commit pushed to main, production watcher detects it and loop applies GOAL_COMPLETE without calling `onControlDetected` directly.

## I. Pause / Resume / Stop / Emergency Kill — IMPLEMENTED; I.5 MACHINE-QUALIFIED via real-runtime-controls

- [x] I.1 Pause: terminates executor, preserves working tree, no Sol wake, state ⇒ PAUSED.
- [x] I.2 Resume: restarts SAME dispatch with recovery bootstrap (not merely SOL_REVIEWING).
- [x] I.3 Stop: graceful drain; current actor may finish; next handoff prevented; no immediate kill.
- [x] I.4 Emergency Kill: separate destructive op; terminates selected repo executor/browser page; truthful RECOVERY_REQUIRED.
- [x] I.5 Real pause-mid-execution / stop / kill machine-qualified via `real-runtime-controls.test.ts` deterministic slow harness (`ORCA_SLOW_MS`): pause preserves partial work, resume continues SAME dispatch with `ORCA_RECOVERY=true`, stop drains to STOPPED, kill isolates per-repo.

## J. Browser profile ownership — SIMULATION-TESTED

- [x] J.1 In-process mode ownership (INTERACTIVE_SETUP / AUTOMATED) + cross-process profile lock (`ProfileLockManager`).
- [x] J.2 Incompatible overlap prevented; stale lock recovery verifies ownership.

## K. Playwright self-contained and safe — MACHINE-QUALIFIED (provisioning)

- [x] K.1 `PlaywrightDriver` dynamically imports `playwright-core`; no dependency on another project's binary at code level.
- [x] K.2 Diagnostics/provisioning seam (`src/browser/provisioning.ts` + `GET /api/system/provisioning`); Chromium verified present on this machine (`playwright-core` 1.62.1, `chromium-1234/chrome-win64/chrome.exe` exists); actionable status (ready/missing) shown in Settings.
- [x] K.3 Removed `--disable-blink-features=AutomationControlled` and `--no-sandbox`; no anti-detection; no CAPTCHA/rate-limit/private-API bypass.

## L. Real ChatGPT wake lifecycle — IMPLEMENTED (code) + MACHINE-QUALIFIED (page lifecycle)

- [x] L.1 Exact configured conversation URL; composer/send adapter; busy-UI dismissal path (selectors + body-text detection, not exception-string inference).
- [x] L.2 Backpressure queue with bounded retry/backoff; auth/logout detection; Cloudflare/CAPTCHA/verification ⇒ ATTENTION_REQUIRED.
- [x] L.3 ~20-min Sol wait, one retry, then SOL_STALLED via `BrowserManager` coordinator (`SolOperationRecord` with deadline/retry, per-repo timeout, `checkSolTimeouts` fake-clock testable; `setSolStalledHandler` -> Loop `SOL_STALLED`); duplicate wake idempotency on full message intent.
- [x] L.4 Page lifecycle: keep repo page alive until expected Git transition (dispatch/control) arrives; `completeSolOperation(repoId, runId)` closes only that repo's page; Chromium closes when active Sol pages reach zero; one repo failure does not terminate unrelated pages.

## M. Startup / crash recovery — MACHINE-QUALIFIED (code)

- [x] M.1 `StartupReconciler` resumes EXISTING active run (rehydration), never `startRun()` duplicate.
- [x] M.2 EXECUTING interrupted by process loss ⇒ RECOVERY_REQUIRED; dirty checkout preserved; explicit Resume required.
- [x] M.3 Reconstruct from SQLite + Git; idempotent pending-wake resubmit; restore watchers; prevent duplicate execution.
- [x] M.4 Recovery failures are logged, not swallowed.

## N. Status / terminal state visibility — MACHINE-QUALIFIED (code)

- [x] N.1 `LoopService.getStatus` distinguishes active run / latest run / latest terminal-problem state.
- [x] N.2 Problem states (BLOCKED, NEEDS_HUMAN, SOL_STALLED, EXECUTOR_UNAVAILABLE, RECOVERY_REQUIRED, CEILING_REACHED, ATTENTION_REQUIRED) remain visible; IDLE means genuinely no relevant active/problem run.

## O. Real log / activity streaming — MACHINE-QUALIFIED

- [x] O.1 Structured events published (executor stdout/stderr, watcher, Sol wake/browser, state transitions, Git/recovery) via `EventBus`.
- [x] O.2 Bounded disk retention (`log-rotator`) + **secret redaction at the bus** (URL credentials, secret-named fields) so nothing leaks to the UI websocket.

## P. Tailscale status truthfulness — MACHINE-QUALIFIED (code); UNQUALIFIED (real phone route)

- [x] P.1 `detectTailscaleStatus` honestly reports not_installed / not_running / not_authenticated / serve_not_configured / configured / unknown. On this machine it returns **not_installed** (CLI absent) — never falsely "configured".
- [x] P.2 Controller stays loopback-only; no Funnel/public exposure; setup guidance provided when auto-config is out of scope.
- [ ] P.3 Real private same-origin phone-route smoke is **UNQUALIFIED** on this machine (Tailscale not installed); left as manual verification.

## Q. Real qualification tier — PARTIAL MACHINE-QUALIFIED

- [x] Q.1 Real temp Git repo + bare remote; real watcher poll/fetch and an actual isolated dispatch commit (watcher-integration + `real-runtime-qualification` + `real-runtime-buildapp`).
- [x] Q.2 Production watcher automatically causes loop to start executor with no manual transition call (`Q.WIN.1`); `Q.APP.1` proves the **production buildApp lifecycle** (no manual service graph, no watcherService.start / onDispatchDetected / onExecutorCompleted) auto-watches enabled repos, holds disabled unwatched, and stops cleanly on shutdown.
- [x] Q.3 Real child-process execution on Windows (`Q.WIN.1`) AND real WSL execution via `wsl.exe` with Linux working tree (`Q.WIN.WSL.1`) — both **run on this machine**.
- [x] Q.4 Deterministic harmless test executor (`real-executor-harness.mjs`) for process/Git/result-protocol qualification; now with slow mode (`ORCA_SLOW_MS` writes partial before sleep) and status/exit overrides.
- [x] Q.5 Real Kimi Code / Codex syntax verified on this machine: Kimi 0.34.0 (`kimi -m <model> -p "<prompt>"`), Codex 0.147.0 (`codex exec -m <model> --json "<prompt>"`), Chromium executable present (`chromium-1234`). Profiles corrected; no quota burned. Execution still UNQUALIFIED without auth/further harness burn.
- [x] Q.6 Real result manifest written/validated/committed/pushed then automatically routed back into the loop (`Q.WIN.1`/`Q.WIN.WSL.1` + validation corpus `executor-result-validation` + `executor-launch-retry` + nonzero-exit preserves valid manifest).
- [x] Q.7 Real multi-repository concurrency — **MACHINE-QUALIFIED** via `Q.WIN.3` (two repos, one assembled controller, concurrent child processes) plus `real-runtime-controls` kill-isolation.
- [x] Q.8 Chromium provisioning — **MACHINE-QUALIFIED** for executable presence (`provisioning.ts` + `GET /api/system/provisioning`); headed setup reuse still UNQUALIFIED without ChatGPT auth.
- [x] Q.10 **Production buildApp controller** proves remote Git dispatch → watcher → loop → real executor process → durable result → loop → Sol wake, mocking only the external ChatGPT browser driver (`Q.APP.1`); `Q.WIN.1/WSL.1` remain service-graph qualification, `Q.APP.1` is the stronger production gate.
- [x] Q.11 Real Pause/Resume/Stop/Kill + wall-clock ceiling — **MACHINE-QUALIFIED** via `real-runtime-controls.test.ts` (pause preserves partial, resume SAME dispatch `ORCA_RECOVERY=true`; stop drains to STOPPED; kill isolates; ceiling does not kill active executor).
- [ ] Q.9 Real ChatGPT wake (if auth available) and Tailscale phone-route (if installed) — **UNQUALIFIED** on this machine (auth/Tailscale absent).

## R. Reconcile documentation and completion state — IN PROGRESS

- [x] R.1 `.agent/state.json` updated to NOT_YET_QUALIFIED / hardening with honest waypoint.
- [ ] R.2 Update README, ROADMAP, canonical specs to distinguish IMPLEMENTED / SIMULATION-TESTED / MACHINE-QUALIFIED / MANUALLY-QUALIFIED / UNQUALIFIED / BLOCKED (this pass).
- [x] R.3 No false Windows/WSL/Playwright/Tailscale qualification claims (Tailscale honestly reports not_installed; WSL is genuinely machine-qualified; Chromium/ChatGPT/Tailscale-route explicitly UNQUALIFIED).
