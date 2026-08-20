# Orca-Strator Observability and Failure Contract

Status: **normative behavioral guidance for V1**

Orca-Strator is intended to run unattended. A failure that cannot be explained after the fact is a product failure even if no code was lost.

## 1. Observability goals

For every configured repository/run, the user should eventually be able to answer:

- What state is it in now?
- Which actor owns it now: Sol, executor, or none?
- What was the last successful transition?
- What commit/dispatch/result caused that transition?
- Is an executor process alive?
- Is Sol waiting, busy, stalled, or complete?
- What retries happened?
- What should happen next?
- Does the user need to intervene?

## 2. Logging layers

Use two conceptual layers.

### Application logs

Controller-wide diagnostics:

- startup/shutdown;
- database migration;
- listener state;
- browser manager lifecycle;
- fatal/unhandled errors;
- Tailscale/setup information later.

### Repository/run activity

Repository-scoped structured events:

- watcher observations;
- dispatch accepted/rejected;
- executor launch/exit;
- pause/stop/kill controls;
- Git reconcile/push result metadata;
- result manifest detected;
- Sol wake attempt;
- ChatGPT busy/auth/browser conditions;
- Sol durable transition detected;
- runtime ceiling/drain;
- recovery decisions.

## 3. Structured log fields

Prefer structured records with stable fields instead of parsing prose.

Example:

```json
{
  "at": "2026-08-19T10:00:00.000Z",
  "level": "info",
  "component": "executor-manager",
  "event": "executor.started",
  "repositoryId": "repo-123",
  "runId": "run-456",
  "iteration": 7,
  "executor": "kimi",
  "model": "deepseek-v4-flash",
  "environment": "wsl",
  "pid": 12345
}
```

Do not log:

- API keys;
- auth cookies;
- browser storage state;
- full secrets-bearing environment variables;
- passwords;
- private token-bearing URLs.

## 4. Event naming

Use dot-separated stable event names.

Examples:

```text
controller.started
controller.stopped
repository.created
repository.updated
watcher.remote_changed
dispatch.accepted
dispatch.rejected
executor.launching
executor.started
executor.stdout
executor.stderr
executor.exited
executor.paused
executor.killed
result.detected
sol.wake_queued
sol.wake_submitted
sol.busy
sol.transition_detected
sol.stalled
run.draining
run.stopped
run.goal_complete
recovery.required
recovery.resumed
```

Not all need durable storage in the first milestones. The vocabulary should remain stable as subsystems land.

## 5. Failure taxonomy

Distinguish where the failure happened.

### Configuration failures

```text
CONFIG_INVALID
LOCAL_PATH_INVALID
WSL_DISTRIBUTION_INVALID
EXECUTOR_CONFIG_INVALID
SOL_URL_INVALID
```

### Git/watcher failures

```text
GIT_REMOTE_UNAVAILABLE
GIT_FETCH_FAILED
GIT_REBASE_FAILED
GIT_PUSH_FAILED
DISPATCH_INVALID
DISPATCH_DUPLICATE
DISPATCH_CONFLICT
```

### Executor failures

```text
EXECUTOR_NOT_FOUND
EXECUTOR_LAUNCH_FAILED
EXECUTOR_UNAVAILABLE
EXECUTOR_EXITED_UNEXPECTEDLY
EXECUTOR_INTERRUPTED
EXECUTOR_RESULT_MISSING
```

### Browser/Sol failures

```text
CHATGPT_AUTH_REQUIRED
CHATGPT_BUSY
BROWSER_LAUNCH_FAILED
BROWSER_AUTOMATION_FAILED
SOL_WAKE_FAILED
SOL_STALLED
```

### Runtime/control failures

```text
RECOVERY_REQUIRED
STATE_INVARIANT_VIOLATION
DATABASE_FAILURE
CONTROLLER_INTERNAL_ERROR
```

Do not collapse all of these into `FAILED`; the UI and recovery behavior differ.

## 6. Retry policy principles

Retry only errors likely to be transient.

Good retry candidates:

- remote fetch temporary failure;
- executor launch/contact transient failure;
- ChatGPT busy/backpressure;
- temporary browser navigation failure.

Bad blind retry candidates:

- invalid dispatch structure;
- invalid repository config;
- persistent Git conflict that executor could not resolve;
- authentication required;
- invariant violation.

Retries must be bounded and visible.

## 7. Executor launch retry

Default planned policy:

```text
attempt 1
 -> failure
short delay
attempt 2
 -> failure
longer delay
attempt 3
 -> failure
EXECUTOR_UNAVAILABLE
```

Exact delays are implementation-level configurable constants.

Do not launch three executors concurrently as a retry mechanism.

## 8. Sol stall policy

Default:

```text
wake 1 submitted
 -> wait 20 minutes
 -> no durable Git transition
wake 2 submitted
 -> wait 20 minutes
 -> no durable Git transition
SOL_STALLED
```

The timeout starts after successful wake submission, not while ChatGPT is still queued/busy before submission.

## 9. ChatGPT busy/backpressure

Busy is a transport condition, not a Sol review completion.

When detected:

1. record `sol.busy`;
2. dismiss only safe informational UI if required;
3. keep the wake pending;
4. retry with bounded backoff;
5. do not claim the wake was submitted until the actual message submission succeeded;
6. do not try to evade a service-side concurrency limit.

## 10. Dispatch rejection diagnostics

A rejected dispatch should say exactly why.

Examples:

```text
DISPATCH_INVALID: marker commit modified 3 non-control files
DISPATCH_DUPLICATE: dispatchId 0047 already consumed
DISPATCH_CONFLICT: repository already has active executor
```

The UI should expose the marker/commit SHA when available.

## 11. Process output

Executor stdout/stderr should be streamed to the UI where practical and retained only according to a bounded logging policy later.

The controller should capture:

- process launch command metadata without secrets;
- PID/process tree identity;
- start/end time;
- exit code/signal;
- bounded tail of output for diagnostic summary when needed.

Do not let unbounded terminal output grow SQLite indefinitely.

## 12. Health versus readiness

Controller `/api/health` in Change 001 means the service/database are operational.

Later, repository-level readiness is separate:

```text
controller healthy != every repository runnable
```

A repository can be configured but blocked by missing local path, executor, auth, or WSL distro.

## 13. UI status hierarchy

Each repository should eventually show:

1. high-level state badge (`EXECUTING`, `SOL_REVIEWING`, `PAUSED`, etc.);
2. current actor;
3. current iteration / ceilings;
4. elapsed time;
5. last transition;
6. latest warning/error if any;
7. next expected action.

Avoid making users infer state from raw logs alone.

## 14. Notification threshold

Notify the user for actionable or terminal conditions:

- `GOAL_COMPLETE`;
- `NEEDS_HUMAN`;
- `SOL_STALLED`;
- `EXECUTOR_UNAVAILABLE`;
- auth/browser failure requiring user action;
- unrecoverable Git issue;
- runtime/iteration ceiling reached;
- emergency kill/recovery required.

Do not notify for every normal successful iteration.

## 15. Recovery evidence

On crash/restart, log the reconciliation inputs:

- SQLite previous state;
- local HEAD/status;
- remote branch HEAD;
- last consumed dispatch;
- last result marker;
- whether recorded PID still exists.

The recovery decision should be explainable from those inputs.

## 16. Invariant violations

If Orca observes an impossible combination, fail safe and surface it.

Examples:

- two executor PIDs recorded active for one repository;
- current state `SOL_REVIEWING` with a second Sol wake being submitted;
- consumed dispatch launched again;
- runtime marked `GOAL_COMPLETE` while a new executor starts.

Use a clear `STATE_INVARIANT_VIOLATION` rather than silently guessing.

## 17. Campaign trace and readiness

The campaign ledger stores redacted structured event references with phase,
correlation IDs, timestamps, computed durations, retries, recovery, controls,
and classified failure boundaries. Campaign history is queryable through REST
and the UI without scraping raw executor output; bounded raw logs remain a
separate diagnostic surface.

Executor readiness is a separate capability snapshot. Probe level and last
probe time are always visible, and auth/model state remains UNKNOWN when a
provider response was not safely obtained. Usage/cost fields are deliberately
not fabricated by this change.

## 18. Usage and scheduler evidence

Change 011 adds structured `usage_metrics` and scheduler decision records to the
operational evidence model. Usage values identify executor/provider/model and
retain nullable partial fields. Exact and estimated cost are separate statuses;
an unavailable provider metric is `UNKNOWN`, not a fabricated zero.

Scheduler queue evidence includes request ID, repository/run/iteration,
policy snapshot, status, limiting dimension, reason, queued time, runnable time,
and restart recovery state. The default policy is explicitly unlimited for
independent repositories. Role resolution records whether an explicit
user-authored rule or repository default supplied the identity.

## 19. Packet and worktree evidence

Packet history records structured requirements, allowed/read paths, dependency
IDs, selected policy identity, budget, verification expectations, and typed
result status. Worktree evidence records deterministic branch/path, base and
worker commit, environment, lifecycle, and cleanup/recovery reason. Dirty
worktrees become `CLEANUP_REQUIRED` rather than silently disappearing.

Integration reports identify the deterministic order, integrated packet IDs,
final main commit, partial successes, dependency skips, and conflict blockers.
Raw worker prose is not the coordination protocol.

## 20. Swarm strategy evidence

The ledger records `strategy.started`, worker queued/started/completed,
strategy control, integration completed, recovery, and strategy completed
events with strategy-run/packet/worktree/scheduler correlation. A swarm detail
read model exposes effective concurrency, each typed packet/result, controls,
integration status, scheduler decision IDs, usage metric IDs, and recovery
blockers. Queue events retain the configured limiting dimension and reason.

Worker process logs remain bounded diagnostics. They are never required to
reconstruct whether a worker committed, whether integration succeeded, or why a
packet was cancelled/blocked. A strategy `COMPLETED`/`PARTIAL` status is an
iteration result, not a high-level campaign success signal.

## 21. DAG evidence

DAG events use the existing strategy timeline with `strategy: "DAG"`, stable
strategy/node/packet IDs, scheduler decisions, control reasons, integration
status, and structured result references. The DAG detail read model exposes
node dependency state and effective packet budgets without requiring log
parsing. Cycle/dependency validation failures are returned as actionable API
errors before a worker or worktree exists.

## 22. Optional OpenCode adapter evidence

OpenCode health, API generation, route readiness, and classified drift are
stored in the normal capability snapshot and surfaced through the existing
capability API/Settings read model. Native SSE events are useful live
observations only; they are not replayable campaign truth and are not required
to reconstruct a run. Structured assistant-message token/cost fields may feed
the existing usage ledger, while absent telemetry remains UNKNOWN.

An unavailable endpoint, missing OpenAPI document, malformed response, timeout,
or unsupported operation is reported distinctly as `OPENCODE_UNAVAILABLE`,
`OPENCODE_API_DRIFT`, or `OPENCODE_API_UNSUPPORTED`. The adapter remains
experimental because the observed OpenCode API may be hybrid or migrating.

## 23. Topology projection

The UI topology is derived from the campaign ledger/read model and does not
create new operational truth. A missing dispatch, result, worker, node,
integration report, or usage metric is rendered as not recorded/UNKNOWN. The
projection preserves partial successes, dependency waits, permission attention,
recovery, cancellation, and integration conflict so a strategy cannot appear
green merely because one child succeeded.
