# Change 009: V1 Runtime Integration Hardening

## Status

**Ready for implementation (corrective)**

This change reopens the V1 roadmap as **NOT YET QUALIFIED** for genuine production autonomy. It is not a new feature; it is a hardening campaign that makes the already-built services actually connected and correct in production.

## Why

Milestones 0–8 were marked complete with `V1_ROADMAP_COMPLETE` and "136 tests passing". On inspection, the existing tests are **simulation tests**: they manually invoke internal transition methods (`loopService.onDispatchDetected(...)`, `loopService.onExecutorCompleted(...)`) and use fake executors / mock browsers. The production code is **not actually wired together**:

- `WatcherService` is constructed with no callback into `LoopService`, and `LoopService` never stores or calls `WatcherService`. Nothing connects a detected dispatch to the loop in production.
- `ExecutorService` completion (`onExit`) marks a dispatch `consumed` purely on process exit code 0 and never calls back into `LoopService`. The loop never learns an executor finished.
- `LoopService` converts iteration/wall-clock ceiling and executor-exit into `GOAL_COMPLETE`, violating the rule that Sol alone is authoritative for high-level completion.
- `StartupReconciler` calls `startRun()` against an already-active run, which throws and is silently swallowed by `.catch()`, so a restart never resumes the existing run.
- `getActiveRun()` filters out `BLOCKED` / `NEEDS_HUMAN` / `SOL_STALLED` / `EXECUTOR_UNAVAILABLE`, so problem states are reported as `IDLE`.
- The watcher inspects only `remoteHeadSha` (HEAD) and never walks every unseen commit from `lastObservedSha..remoteHeadSha` chronologically, can skip an isolated dispatch behind an ordinary HEAD commit, advances `lastObservedSha` even when inspection failed, and never fetches remote `main` first.
- The executor result contract is fake: exit code 0 ⇒ success; there is no reading/validating of `.orca/results/<dispatch-id>.json`, no preflight/postflight, no truthful recovery state.
- Executor invocation assumes `<cli> --model <model> "<prompt>"`, uses `shell: true` (unsafe interpolation), and has no per-harness profile for the actual locally installed Kimi Code / Codex CLIs. WSL execution uses the Windows path as `--cd` rather than the configured Linux working tree.
- There is no environment-aware Git adapter for WSL (run Git through `wsl.exe` with the Linux working directory).
- Browser profile ownership is PID-only; Playwright self-containment, real ChatGPT wake lifecycle, Tailscale status truthfulness, and real log streaming are all unimplemented or misleading.

The V1 completion claim is therefore **unsubstantiated**. This change proves the real path works.

## Goals

1. **Wire the real autonomous pipeline in production** (Finding A): a valid dispatch detected by the watcher deterministically causes the loop to start the executor; executor completion deterministically returns to the loop; the loop wakes Sol when policy allows; Orca waits for a durable Git transition; the next decision proceeds. Exactly-once per transition. No test may qualify the production path by manually calling internal transition methods.
2. **Correct Git/WSL correctness** (B, C): auto-watch configured/new repositories, stop deleted/disabled ones, surface poll errors; fetch then walk every unseen commit chronologically; never advance `lastObservedSha` past an un-inspectable commit; environment-aware Git execution (WSL via `wsl.exe` with Linux cwd).
3. **Implement the real executor result contract** (D, E, F): per-harness invocation profiles (Kimi Code, Codex) inspected from locally installed `--help`/`--version`; locked launch/contact retry policy; read/validate the durable `.orca/results/<dispatch-id>.json` manifest; preflight/postflight Git; truthful recovery state; never mark a dispatch consumed solely because the child exited 0.
4. **Correct loop/ceiling/pause/stop/recovery semantics** (G, I, M): Sol is the only authority for `GOAL_COMPLETE`; ceiling crossing ⇒ `DRAINING` ⇒ `STOPPED`/`CEILING_REACHED` without killing the actor; initial wake must not pretend `COMPLETED`; distinct Pause (terminate executor, preserve tree) / Resume (restart same dispatch with recovery bootstrap) / Stop (graceful drain) / Emergency Kill (separate destructive op); startup rehydration resumes the existing run instead of duplicating it.
5. **Browser, controls, observability, status** (H, J, K, L, N, O, P): in-process mode ownership + cross-process profile lock; Chromium provisioning/diagnostics; real ChatGPT wake lifecycle with busy/backpressure, auth/CAPTCHA ⇒ `ATTENTION_REQUIRED`, timeout+retry ⇒ `SOL_STALLED`, correct page/Chromium lifecycle; Sol control markers wired and applied idempotently; truthful status/terminal state visibility; bounded structured log streaming; honest Tailscale status.
6. **Add a real qualification tier** (Q): tests that start the assembled controller services and prove the full pipeline using real Git repositories/remotes, real child-process execution, and a durable result manifest, with the external ChatGPT response mocked only at the transport boundary. Keep all deterministic fake/mock tests as regression tests but stop treating them as proof of real end-to-end autonomy.
7. **Reconcile documentation honestly** (R): `state.json`, `README`, `ROADMAP`, canonical specs, and Change 009 tasks distinguish `IMPLEMENTED`, `SIMULATION-TESTED`, `MACHINE-QUALIFIED`, `MANUALLY-QUALIFIED`, `UNQUALIFIED / BLOCKED`. No claim is made for Windows/WSL/Playwright/Tailscale behavior that did not actually occur on this machine.

## Non-goals

- No new deferred post-V1 features (multi-session per repository, branch routing, dynamic executor/model selection by Sol, macOS/Linux desktop, public exposure, distributed executors).
- No change to locked product decisions (D-001 … D-036) unless implementation evidence forces a revision, which would be recorded explicitly.

## Major risks

- The real pipeline depends on locally installed CLIs, Chromium, and (optionally) ChatGPT auth, which may be absent; qualification must degrade honestly to `UNQUALIFIED` / `MANUALLY-QUALIFIED` rather than fake success.
- Broad refactors risk breaking the existing 136 simulation tests; those tests are preserved as regression coverage and only corrected where they encode the wrong production semantics (e.g. ceiling ⇒ `GOAL_COMPLETE`).

## Success / review criteria

- A production-assembled controller (no manual transition-method calls in the qualified test) moves a repository: Git dispatch ⇒ watcher ⇒ loop ⇒ executor process ⇒ durable result manifest ⇒ loop ⇒ Sol wake transport boundary.
- All Findings A–R have a concrete, verified resolution or an explicitly recorded, honest blocker.
- Documentation truthfully reflects what was actually exercised on the machine.
