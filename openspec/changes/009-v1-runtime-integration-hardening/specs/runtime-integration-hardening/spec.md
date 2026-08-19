# Spec: V1 Runtime Integration Hardening (Change 009)

This delta spec defines the externally meaningful contract for hardening the V1 production runtime path. It modifies the behavior previously described in `autonomous-loop-engine`, `repository-watch-dispatch`, `headless-executor-runtime`, `playwright-sol-bridge`, `runtime-recovery-hardening`, and `end-to-end-autonomy-qualification` where those specs assumed wiring that did not exist or semantics that were wrong.

## Requirement: Real autonomous pipeline connection

The watcher, loop, executor, result contract, and Sol wake MUST be connected in production via explicit typed callbacks wired once at startup, not by tests invoking internal transition methods.

- Scenario: A valid isolated dispatch commit appears on remote `main` and is detected by the running watcher.
  - Then the loop SHALL automatically move the active run to `EXECUTING` and start the configured executor, without any explicit call to `onDispatchDetected`.
- Scenario: The executor process completes a valid result contract.
  - Then `ExecutorService` SHALL invoke `onExecutorCompleted` and the loop SHALL proceed to the next decision, without any explicit call to `onExecutorCompleted`.
- Scenario: The same dispatch or wake event is observed more than once.
  - Then the corresponding transition SHALL execute exactly once.

## Requirement: Loop state authority and ceilings

Sol alone is authoritative for `GOAL_COMPLETE`. The loop MUST NOT derive `GOAL_COMPLETE` from reaching the iteration ceiling, the wall-clock ceiling, draining, or executor exit success.

- Scenario: The iteration or wall-clock ceiling is crossed while an actor is active.
  - Then the run SHALL transition to `DRAINING`, allow the current actor to finish, then transition to `STOPPED` with a ceiling-reached reason; the actor SHALL NOT be killed merely because the ceiling was reached.
- Scenario: The initial Sol wake is submitted for a run.
  - Then the wake message SHALL NOT assert a `COMPLETED` executor result status; subsequent wakes SHALL carry the real executor result status.

## Requirement: Startup crash rehydration

On startup the reconciler MUST resume an existing active run rather than create a duplicate.

- Scenario: A run is `SOL_PENDING`/`SOL_REVIEWING` at startup.
  - Then the reconciler SHALL re-attach watcher state and resubmit a pending Sol wake idempotently; it SHALL NOT call `startRun` for the already-active run.
- Scenario: A run was `EXECUTING`/`EXECUTOR_PENDING` when the controller process was lost.
  - Then the reconciler SHALL mark the run `RECOVERY_REQUIRED`, preserve the dirty checkout, and require explicit Resume where the contract requires it.
- Scenario: A recovery operation fails.
  - Then the failure SHALL be surfaced, not silently swallowed.

## Requirement: Status and terminal-state visibility

Problem and terminal states MUST remain visible to the UI; `IDLE` means genuinely no relevant active or problem run.

- Scenario: A run reaches `BLOCKED`, `NEEDS_HUMAN`, `SOL_STALLED`, or `EXECUTOR_UNAVAILABLE`.
  - Then `getStatus` SHALL report the problem state (and a terminal summary where relevant), not collapse it to `IDLE`.

## Requirement: Watcher Git correctness

The watcher MUST watch configured repositories automatically, accept new repositories without restart, stop watching deleted/disabled repositories, and process every unseen commit in order.

- Scenario: Remote `main` HEAD moves ahead of `lastObservedSha` by multiple commits including an isolated dispatch behind a later ordinary commit.
  - Then the watcher SHALL fetch remote `main`, walk every unseen commit `lastObservedSha..remoteHeadSha` chronologically, and detect the isolated dispatch.
- Scenario: A commit cannot be safely inspected.
  - Then the watcher SHALL record an actionable error/recovery state and SHALL NOT advance `lastObservedSha` past that commit.
- Scenario: A poll fails.
  - Then the error SHALL be published observably.

## Requirement: Environment-aware Git

Git operations for WSL repositories MUST execute through the configured distribution with the Linux working tree, not Windows `git` against a `/home/...` path.

- Scenario: A repository is configured with `environment: wsl` and a Linux `localPath` plus `wslDistribution`.
  - Then Git operations SHALL run as `wsl.exe -d <dist> --cd <linuxPath> -- git ...`.

## Requirement: Executor invocation profiles

Executor invocation MUST use per-harness profiles rather than a fixed `<cli> --model <model> "<prompt>"` assumption, and MUST avoid unsafe shell interpolation.

- Scenario: A repository is configured with the Kimi Code or Codex CLI.
  - Then the argument array SHALL be built from the harness profile discovered from the locally installed binary; the user-selected executor/model SHALL be used unchanged; Sol SHALL NOT switch it.

## Requirement: Executor result contract

The executor result contract MUST be enforced against the durable `.orca/results/<dispatch-id>.json` manifest.

- Scenario: The executor process exits 0 but no valid result manifest is committed/pushed to `main`.
  - Then the turn SHALL be treated as invalid/incomplete (recovery), and the dispatch SHALL NOT be marked consumed.
- Scenario: A valid manifest is produced with status `BLOCKED`/`NEEDS_HUMAN`/`FAILED`.
  - Then that status and its verification/blocker evidence SHALL be preserved and routed to Sol.

## Requirement: Operational controls

Pause, Resume, Stop, and Emergency Kill MUST have distinct, locked semantics.

- Scenario: Pause is requested while the executor is running.
  - Then the executor SHALL be terminated promptly, the working tree preserved exactly, Sol SHALL NOT be woken, and the state SHALL become `PAUSED`.
- Scenario: Resume is requested.
  - Then the SAME unfinished dispatch SHALL be restarted with a recovery bootstrap; the state SHALL NOT merely become `SOL_REVIEWING`.
- Scenario: Stop is requested.
  - Then the run SHALL drain gracefully: the current actor may finish, no next handoff starts, and the executor SHALL NOT be immediately killed.
- Scenario: Emergency Kill is requested.
  - Then the selected repository's active executor/browser page SHALL be terminated separately and destructively, preserving a truthful `RECOVERY_REQUIRED`/interrupted state.

## Requirement: Sol control markers

Isolated Sol-control commits MUST be detected, validated, associated with the correct run/iteration, and applied idempotently.

- Scenario: A Sol-control commit declares `GOAL_COMPLETE`/`BLOCKED`/`NEEDS_HUMAN`/`PAUSED`.
  - Then the loop SHALL apply that decision idempotently; high-level completion SHALL NOT be inferred from browser text or executor exit code.

## Requirement: Browser ownership and wake lifecycle

Browser profile ownership MUST be explicit and the wake lifecycle MUST be real and safe.

- Scenario: Automated Chromium owns the profile.
  - Then headed setup SHALL NOT silently reuse it; if setup owns it, automated wake SHALL queue/fail with actionable state; stale lock recovery SHALL verify real ownership.
- Scenario: A wake is submitted to ChatGPT.
  - Then the controller SHALL use the exact configured conversation URL, handle busy/backpressure with bounded retry, treat auth/CAPTCHA/verification as `ATTENTION_REQUIRED`, wait for the expected Git/GitHub transition (~20 min, one retry, then `SOL_STALLED`), close the repo page when complete, and close Chromium when no Sol operations remain.

## Requirement: Tailscale status truthfulness

Tailscale status MUST reflect reality.

- Scenario: Tailscale is not installed, not running, not authenticated, or Serve is not configured.
  - Then status SHALL report the honest condition; if automatic configuration is out of scope, the feature SHALL be labeled setup guidance rather than falsely reporting "configured".

## Requirement: Real qualification tier

The V1 completion claim requires qualification of the real production path.

- Scenario: The assembled real controller services are started against real temporary Git repositories with a real child-process executor.
  - Then remote Git dispatch → watcher → loop → executor process → durable executor result → loop → Sol wake transport boundary SHALL be proven without manually invoking internal transition methods; the external ChatGPT response MAY be mocked only at the transport boundary.
