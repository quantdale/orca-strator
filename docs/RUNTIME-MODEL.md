# Orca-Strator Runtime Model

Status: **V1 behavioral contract**

This document defines the runtime semantics that later OpenSpec changes must implement. It does not require Change 001 to implement the autonomous loop yet.

## 1. Unit of orchestration

V1 uses the **repository** as the independent concurrency unit.

For each configured repository there is, at most:

- one active autonomous run;
- one configured Sol conversation URL;
- one configured executor CLI/model for that run;
- one active executor process;
- one active Sol review turn;
- one local watcher;
- one per-repository runtime state machine.

Different repositories are independent.

```text
Nightwatch     -> executor A / Sol A
TabDock        -> executor B / Sol B
SuperHabits    -> executor C / Sol C
```

All three may progress concurrently. V1 has no global executor concurrency cap.

Future multiple sessions/branches/executors inside one repository are intentionally deferred.

## 2. Sources of truth

Orca uses two durable domains with different purposes.

### Git/GitHub repository truth

Contains AI-visible cross-agent coordination artifacts:

- OpenSpec changes;
- implementation commits;
- dispatch markers;
- executor result manifests;
- Sol terminal/control decisions;
- normal source/test/docs state.

This is what Sol and executors can independently inspect.

### Local SQLite truth

Contains machine-local orchestration state:

- configured repositories;
- run IDs and timers;
- current runtime state;
- consumed dispatch IDs;
- last observed remote SHA;
- executor process metadata;
- wake attempts/timeouts;
- UI-visible events;
- recovery flags;
- operational locks.

SQLite does not replace GitHub as the cross-agent handoff record.

## 3. Per-repository actor rule

At most one **actor** owns progression for a repository at a time.

Actors are:

- `SOL` — architecture/review/specification turn;
- `EXECUTOR` — headless coding-agent turn;
- `NONE` — waiting/terminal/control state.

Do not run Sol and executor concurrently against the same repository in V1.

Other repositories may have their own actors simultaneously.

## 4. Core runtime states

Recommended canonical states:

### `IDLE`

Repository is configured but no autonomous run is active.

Allowed next states:

- `SOL_PENDING` when user starts a run with a high-level goal;
- recovery-related states when persisted state requires attention.

### `SOL_PENDING`

A Sol wake/review is required but has not yet been successfully submitted.

Typical causes:

- initial run start;
- executor result pushed;
- blocked/failed executor result requiring review;
- manual `Wake Sol`.

Allowed next states:

- `SOL_REVIEWING` after Playwright submits the trusted wake;
- `CHATGPT_BUSY` / browser error substate while retrying;
- `SOL_STALLED` after configured failure policy is exhausted;
- `PAUSED`/`STOPPED` according to control semantics.

### `SOL_REVIEWING`

The wake message has been submitted and Orca is waiting for a durable Git transition.

Completion is inferred from Git/GitHub, never by scraping Sol output.

Expected durable outcomes include:

- new isolated dispatch marker -> `EXECUTOR_PENDING`;
- terminal Sol control state -> corresponding terminal/runtime state.

### `EXECUTOR_PENDING`

A valid, unconsumed dispatch exists and the run permits a new executor handoff.

Allowed next states:

- `EXECUTING` after successful process launch;
- launch retry state;
- `EXECUTOR_UNAVAILABLE` after launch retries are exhausted;
- `DRAINING`/`STOPPED` if a run ceiling/control prevents dispatch.

### `EXECUTING`

Exactly one configured executor process owns the repository.

The executor may modify the checkout, run tests, reconcile Git, commit, and push.

Allowed next states:

- `RESULT_PENDING`/`SOL_PENDING` after a pushed result manifest;
- `PAUSED` after user Pause interrupts it;
- `EXECUTOR_INTERRUPTED` after crash/reboot/process loss;
- `EXECUTOR_UNAVAILABLE` on unrecoverable launch/process failure.

### `SOL_PENDING` after executor result

Any normal executor terminal result (`COMPLETED`, `BLOCKED`, `NEEDS_HUMAN`, `FAILED`) normally causes a Sol review wake unless the user has paused/stopped/drained the run.

The executor does not authoritatively end the high-level goal.

### `DRAINING`

A wall-clock/iteration ceiling or graceful Stop has prohibited new handoffs.

If an actor was already active when draining began, that actor may finish and publish its durable result.

Once the actor finishes, Orca transitions to `STOPPED` and does not wake/dispatch the next actor.

### `PAUSED`

Pause is designed to stop executor inference consumption immediately.

If `EXECUTING`:

1. request graceful interrupt where the CLI supports it;
2. after a short grace period, terminate the executor process tree if still running;
3. preserve the checkout exactly as-is;
4. do not wake Sol;
5. persist enough process/run state to resume deliberately.

If no executor is active, Pause prevents the next executor dispatch. A Sol turn already submitted need not be forcibly cancelled merely to save executor credits; when its Git update appears Orca records it but does not start an executor until Resume.

Resume returns to the appropriate pending state and instructs the executor to recover existing local work before continuing.

### `STOPPED`

No new actor may start. This is a clean halted state.

Graceful Stop uses draining semantics rather than killing the current actor.

### `GOAL_COMPLETE`

Authoritative Sol terminal decision that the high-level run goal is satisfied.

No further handoff occurs unless the user starts/resumes with a new goal.

### `NEEDS_HUMAN`

Sol determined a user decision/action is required.

No automatic continuation until user resolution.

### `BLOCKED`

Sol determined the run cannot currently proceed autonomously.

### `SOL_STALLED`

Playwright wake was submitted/retried but no expected durable Git transition appeared within the configured policy.

### `EXECUTOR_UNAVAILABLE`

The configured executor could not be successfully launched/contacted after the retry policy.

### `RECOVERY_REQUIRED`

A previous executor was interrupted in a state where automatic restart could modify an ambiguous dirty checkout. V1 requires explicit Resume/recovery action.

## 5. Executor result status versus run state

Do not confuse an executor's result with the high-level run state.

Executor result manifest statuses may include:

```text
COMPLETED
BLOCKED
NEEDS_HUMAN
FAILED
```

These describe the executor turn.

Normally all four result types are sent to Sol for authoritative review.

Example:

```text
executor result = BLOCKED
        |
        v
Sol reviews repository/error
        |
        +--> creates corrective OpenSpec + dispatch
        |
        +--> NEEDS_HUMAN
        |
        +--> BLOCKED
```

## 6. Transactional Sol dispatch

Sol must finish ordinary planning/spec/code commits before creating a dispatch marker.

Expected sequence:

```text
commit A: proposal/design/spec/task updates
commit B: optional other review/code fixes
...
commit N: final ordinary work
commit N+1: isolated dispatch marker ONLY
```

The watcher validates the final commit before launching an executor.

A dispatch marker appearing in a commit mixed with ordinary work is invalid and must not trigger execution.

The marker is immutable after commit; correction requires a new marker/dispatch ID.

## 7. Watcher idempotency

For every repository, Orca locally records:

- last observed remote branch SHA;
- dispatch IDs already consumed;
- dispatch commit SHA;
- current executor lock state.

A fetched commit may be inspected multiple times, but the same dispatch ID must never start two executors.

## 8. Playwright concurrency

Use one on-demand Chromium browser process with the dedicated Orca automation profile.

Within it, use one page/tab per repository currently requiring Sol.

```text
Chromium
├── Page: Nightwatch Sol URL
├── Page: TabDock Sol URL
└── Page: SuperHabits Sol URL
```

Rules:

- one page per active repository Sol operation;
- multiple repositories may have pages concurrently;
- never launch two Chromium processes against the same persistent profile;
- close a repository page after its expected durable Git transition is observed;
- close Chromium when zero Sol operations remain;
- if ChatGPT itself applies concurrency backpressure, queue/retry affected Sol submissions rather than trying to evade the service limit.

## 9. Sol wake contract

Playwright sends a trusted message generated by Orca, not arbitrary executor prose.

The wake tells Sol to:

- identify the repository/run/iteration;
- inspect the latest GitHub state;
- read the relevant result/OpenSpec artifacts;
- review the implementation;
- make corrective code/spec changes if useful;
- either create the next isolated dispatch or write a durable terminal/control decision.

Executor-controlled text should not be blindly interpolated into the wake prompt beyond validated identifiers/status metadata.

## 10. Sol completion detection

After wake submission, Orca watches the configured remote branch.

A Sol turn is complete only after an expected durable transition occurs.

Examples:

- isolated dispatch commit observed;
- Sol terminal marker/control state observed.

Normal chat-response completion, DOM text, or browser spinner state is not authoritative.

Default stall policy:

```text
wake attempt 1
   -> wait 20 min
   -> no durable transition
wake attempt 2
   -> wait 20 min
   -> no durable transition
SOL_STALLED
```

Timeouts are configurable.

## 11. ChatGPT busy/backpressure

When the UI indicates a simultaneous-request/busy condition:

1. dismiss only safe informational/confirmation UI when needed;
2. do not attempt to bypass the service-side restriction;
3. mark that submission as delayed/busy;
4. retry with bounded backoff;
5. keep unrelated executor work running;
6. expose the delay in the UI.

A busy condition is not the same as `SOL_STALLED` until wake submission/retry policy actually fails.

## 12. Run ceilings

Each run has independent ceilings:

- maximum iterations (default 20);
- maximum wall-clock runtime (default 480 minutes).

Ceilings are evaluated before starting a new handoff.

If reached while an actor is active:

```text
RUNNING -> DRAINING
current actor may finish
no next actor starts
-> STOPPED
```

Do not kill useful in-flight work solely because the timer crossed the boundary.

## 13. Control semantics

### Pause

- immediate executor-credit stop;
- interrupt/terminate executor if active;
- preserve checkout;
- no automatic Sol wake caused by the interrupted executor;
- resume later with recovery instructions.

### Stop

- graceful;
- allow current actor to finish;
- stop before next handoff.

### Emergency Kill

- immediately terminate active executor and/or browser operation requested by the user;
- persist failure/recovery state;
- never pretend the interrupted actor completed.

### Manual Wake Sol

Allowed only when per-repository Sol locking/idempotency rules make it safe. Do not submit duplicate concurrent Sol turns for the same repository.

### Manual Run Executor

Allowed only when a valid dispatch/current work contract exists or the UI clearly confirms an explicit recovery action. Do not invent work outside the repository contract.

## 14. Crash/reboot recovery

On controller startup:

1. load SQLite state;
2. inspect every repository that was active;
3. compare local Git state, remote Git state, dispatch/result markers, and recorded process state;
4. rehydrate safe waiting states automatically;
5. if an executor disappeared mid-turn leaving ambiguous local work, set `RECOVERY_REQUIRED`;
6. never discard the checkout to make recovery easier.

## 15. Invariants

The implementation must preserve these invariants:

1. At most one executor per repository in V1.
2. At most one active Sol turn per repository in V1.
3. Different repositories do not block each other's executors.
4. One consumed dispatch ID launches at most one executor turn.
5. Executor/model selection cannot change autonomously during a run.
6. A run ceiling prevents new handoffs; it does not corrupt an active actor.
7. Pause never silently discards partial executor work.
8. Playwright submission is not Sol completion; durable Git transition is.
9. Executor result is not authoritative high-level goal completion; Sol is.
10. Local operational state can be reconstructed/audited against durable Git state without relying on chat history.
