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

V1 Git integration is fixed to `main`.

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
- last observed remote `main` SHA;
- executor process metadata;
- wake attempts/timeouts;
- UI-visible events;
- recovery flags;
- operational locks;
- automation-browser profile lock state/recovery metadata.

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

The wake message has been submitted and Orca is waiting for a durable Git transition on remote `main`.

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

The executor may modify the checkout, run tests, reconcile Git, commit, and push `main`.

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

`SOL_STALLED` is terminal-by-visibility but not final-by-decision. It stays
excluded from active-run ownership everywhere (`getActiveRun()` never returns
it), so a stalled campaign owns no actor and can be replaced by a newer
campaign at any time. The only Git-truthful closure path (Change 024): when a
detected Sol control references the LATEST stalled run of a repository by
exact runId — and no active run exists — a correctly correlated terminal
decision (`GOAL_COMPLETE`, `BLOCKED`, `NEEDS_HUMAN`) closes it directly.
`PAUSED` is rejected for a stalled campaign, and closure can never resurrect
an actor: no wake submission, no executor/strategy start, no scheduler
ownership, no wall-clock re-arm, no intermediate active state.

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

The watcher validates the final commit and `schemas/protocol/dispatch.schema.json` before launching an executor.

A dispatch marker appearing in a commit mixed with ordinary work is invalid and must not trigger execution.

The marker is immutable after commit; correction requires a new marker/dispatch ID.

## 7. Watcher idempotency

For every repository, Orca locally records:

- last observed remote `main` SHA;
- dispatch IDs already consumed;
- dispatch commit SHA;
- current executor lock state.

A fetched commit may be inspected multiple times, but the same dispatch ID must never start two executors.

## 8. Playwright concurrency and profile ownership

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

### Global automation-profile lock

The dedicated browser profile is a globally exclusive machine-local resource.

The following both require the same lock:

1. normal on-demand Browser Manager automation (headed on the genuine installed Chrome — Change 023 real qualification showed Cloudflare interstitials reject headless Chrome);
2. headed **Open ChatGPT Setup Browser** flow.

Therefore:

- setup browser cannot open while automated Chromium owns the profile;
- automated Chromium cannot launch while setup browser owns it;
- UI should expose the profile as `available`, `automation-active`, or `setup-active` rather than letting competing launches fail unpredictably;
- a stale lock after crash is recoverable only after verifying no matching browser process still owns the profile.

This lock is global because all repository Sol pages share the same authenticated profile.

## 9. Sol wake contract

Playwright sends a trusted message generated by Orca, not arbitrary executor prose.

The wake tells Sol to:

- identify the repository/run/iteration;
- inspect latest GitHub `main` state;
- read the relevant result/OpenSpec artifacts;
- review the implementation;
- make corrective code/spec changes if useful;
- either create the next isolated dispatch or write a durable terminal/control decision.

Executor-controlled text should not be blindly interpolated into the wake prompt beyond validated identifiers/status metadata.

## 10. Sol completion detection

After wake submission, Orca watches remote `main`.

A Sol turn is complete only after an expected durable transition occurs.

Examples:

- isolated valid dispatch commit observed;
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

- immediately terminate the selected repository's active executor and/or Sol browser page/operation;
- do not unnecessarily kill other repositories' browser pages if they share the same Chromium process and can remain healthy;
- persist failure/recovery state;
- never pretend the interrupted actor completed.

If a browser-process-wide failure/kill is unavoidable, all affected repository Sol operations must be reconciled independently and never falsely marked complete.

### Manual Wake Sol

Allowed only when per-repository Sol locking/idempotency rules make it safe. Do not submit duplicate concurrent Sol turns for the same repository.

### Manual Run Executor

Allowed only when a valid dispatch/current work contract exists or the UI clearly confirms an explicit recovery action. Do not invent work outside the repository contract.

## 14. Crash/reboot recovery

On controller startup:

1. load SQLite state;
2. inspect every repository that was active;
3. compare local Git state, remote `main`, dispatch/result markers, and recorded process state;
4. rehydrate safe waiting states automatically;
5. if an executor disappeared mid-turn leaving ambiguous local work, set `RECOVERY_REQUIRED`;
6. reconcile browser-profile lock state against actual browser processes;
7. never discard the checkout to make recovery easier.

## 15. Invariants

The implementation must preserve these invariants:

1. At most one executor per repository in V1.
2. At most one active Sol turn per repository in V1.
3. Different repositories do not block each other's executors.
4. One consumed dispatch ID launches at most one executor turn.
5. Executor/model selection cannot change autonomously during a run.
6. V1 repository Git orchestration uses `main`; no per-repository branch routing exists.
7. A run ceiling prevents new handoffs; it does not corrupt an active actor.
8. Pause never silently discards partial executor work.
9. Playwright submission is not Sol completion; durable Git transition is.
10. Executor result is not authoritative high-level goal completion; Sol is.
11. Only one browser process at a time may own the dedicated persistent automation profile.
12. Killing one repository's browser operation should not falsely complete or unnecessarily terminate unrelated repository Sol operations.
13. Local operational state can be reconstructed/audited against durable Git state without relying on chat history.

## 16. Effective phase budgets and permissions

At run creation Orca captures one effective `PhaseBudgetPolicy` in SQLite. It
contains campaign, Sol, executor, Git, and recovery ceilings. Repository edits
do not rewrite an active run's policy. Timeout/retry evidence uses distinct
classified reasons such as `EXECUTOR_START_TIMEOUT`,
`GIT_POSTFLIGHT_TIMEOUT`, `SOL_COMPLETION_TIMEOUT`, and
`WALL_CLOCK_CEILING`. The campaign wall-clock ceiling still enters `DRAINING`
and never kills the active actor.

Autonomy rules are explicit and executor-neutral. `ALLOW`, `ALLOW_ONCE`, `ASK`,
and `DENY` decisions are recorded with an enforcement label. `ASK` produces
actionable attention; it is never an invisible indefinite block. Absolute
invariants (no force-push by default, no dirty-work discard, no secret commit)
remain in force regardless of preset.

## 17. Usage and scheduler policy

Usage is optional evidence, not a completion signal. A native adapter/provider
may publish structured tokens, latency, retry/rate-limit, and cost values. A
generic adapter with no reliable source remains `UNKNOWN`; absence is never
converted into zero usage or estimated cost.

The scheduler is an explicit admission foundation for future intra-repository
fan-out. Null limits mean unlimited, so independent repositories do not wait on
an Orca-wide cap by default. A queued decision names the configured limit and
records when it becomes runnable. Recovery marks unconfirmed leases
`STALE_RECOVERABLE`; it never treats a lost lease as completed work. After all
startup sweeps complete, an idempotent reconciliation closes every remaining
`STALE_RECOVERABLE` row as `RELEASED` with truthful owning-run evidence and
publishes one `scheduler.lease_reconciled` event per closed lease, because
recovery is ownership-terminal and no old request ID can be re-admitted.

Role/model policy is explicit configuration only. A matching named rule may
select an exact future role executor/model; without one, the repository's
configured primary is returned unchanged. Sol and hidden heuristics cannot
switch the primary model.

## 18. Typed packets and writer isolation

Typed packets are an internal strategy contract, not a replacement for the
campaign/Sol dispatch protocol. A packet's result is never a goal-complete
signal. Before any parallel strategy can write, the packet must own a distinct
Git worktree/internal branch; the persistent main checkout is reserved for
deterministic integration.

Integration orders dependencies, detects path overlap, cherry-picks only
validated branch commits, aborts conflicts safely, and preserves independent
successes. Worker `COMPLETED`, `FAILED`, `BLOCKED`, `SKIPPED_DEPENDENCY`,
`CANCELLED`, and `INTEGRATION_CONFLICT` remain distinct. Sol will receive the
eventual structured iteration result in a later optional strategy; integration
does not mark the high-level campaign complete.

## 19. Optional swarm iteration state

Change 013 adds an intra-iteration strategy state below the persistent campaign
loop:

```text
Sol selects SWARM
  -> typed packet validation
  -> bounded scheduler admission
  -> isolated worker start/result (one worktree each)
  -> deterministic integration/reconciliation
  -> structured partial/final iteration result
  -> Sol review/replan
```

`SINGLE_AGENT` remains the ordinary path. Swarm states are `QUEUED`, `RUNNING`,
`PAUSED`, `STOPPING`, `COMPLETED`, `PARTIAL`, `BLOCKED`, `FAILED`,
`CANCELLED`, and `RECOVERY_REQUIRED`. Packet states retain the finer worker
outcomes, while the integration report records the final main-checkout
reconciliation.

PAUSE prevents new starts and cancels/pauses active workers through the adapter;
STOP cancels queued work and drains active workers; KILL terminates active
workers and preserves worktrees for recovery. A controller restart marks
orphaned active strategy/packet state recoverable and runs stale/dirty worktree
inspection. None of these transitions changes the enclosing run to
`GOAL_COMPLETE`; only Sol's existing outer loop may do that.

Change 017 closes the entry seam: a SWARM iteration is entered autonomously
when the durable dispatch marker authorizes it through its optional `strategy`
and `executionPlan` fields — not only through a manual REST start. The
`IterationExecutionCoordinator` enforces the same campaign/iteration ownership
boundary on both paths. When the strategy run finishes, its terminal status is
normalized for the enclosing loop: strategy `COMPLETED` maps to iteration
`COMPLETED`, `PARTIAL` maps to `BLOCKED` for Sol review, `BLOCKED` maps to
`BLOCKED`, and `FAILED`/`CANCELLED`/`RECOVERY_REQUIRED` map to recovery. The
mapping never produces `GOAL_COMPLETE`; Sol remains the completion authority.

## 20. Optional DAG strategy

`DAG` is an explicit intra-iteration strategy. A request first persists a
packet-linked node definition and rejects unknown dependencies, cycles, and
packet mismatch. Nodes move through `QUEUED`, `WAITING_DEPENDENCY`, `STARTING`,
`RUNNING`, `WAITING_PERMISSION`, `RETRYING`, terminal typed states, and
`INTEGRATING` while the shared strategy run carries pause/stop/kill/recovery
state. A worker commit or a green DAG does not complete the campaign; the
structured DAG result returns to Sol for review and the next action.

DAG iterations use the same autonomous dispatch entry (`strategy: "DAG"` plus
an execution plan) and the same normalized completion mapping as SWARM; a
finished DAG never completes the campaign by itself.

## 21. Optional OpenCode execution capability

An explicitly configured OpenCode CLI remains inside the same executor actor
boundary:

```text
Sol dispatch -> OpenCodeAdapter -> ExecutorRunner -> structured result/Git
             -> Sol review
```

The adapter may additionally use an explicitly configured OpenCode server for
native session operations, but only after a manual non-inference health/OpenAPI
probe. Feature readiness is independent for sessions, history, prompt/wait,
events, cancellation, permissions, model/provider visibility, subagents, and
usage. API drift is classified and surfaced; it is never silently converted to
generic success or a different model. `SINGLE_AGENT` remains the normal path,
and a native session completion still requires the ordinary Git/result and Sol
completion boundaries.

## 22. Topology is an observability projection

Change 016 does not add a runtime state machine. It projects the existing
durable sequence and optional strategy records into a responsive view:

```text
CampaignDetail -> topology cards
               -> actual worker/node dependencies/status
               -> integration evidence
               -> Sol-owned next action
```

Missing records remain `UNKNOWN`/`QUEUED`; partial, blocked, skipped,
cancelled, conflict, and recovery states remain distinct. Presets are explicit
policy hints and never start a strategy, select a model, or change the outer
loop.

## 23. Authoritative strategy postflight and concurrency hardening (Change 018)

A `SWARM`/`DAG` iteration is durably successful only when the engine reached
`COMPLETED` AND its remote publication is `PUBLISHED` with remote verification.
Otherwise the run enters a structured retryable postflight/recovery state with
durable evidence on the strategy record, run state, and event stream; the
authorizing dispatch is not consumed as successful and no COMPLETED Sol wake is
sent. Retrying such an iteration retries publication/postflight only — workers
are never rerun — and pending-publication state survives controller restart. A
retry refuses while the campaign is mid-flight on a newer iteration.

Remote advancement is classified explicitly (`UP_TO_DATE`, `LOCAL_AHEAD`,
`REMOTE_AHEAD`, `DIVERGED`). Safe advancement reconciles integrated work
forward before writing the result manifest; unsafe divergence blocks
truthfully; force-push and history discarding remain forbidden. The manifest's
`finalCommitSha` is the actual post-reconciliation HEAD, with the original
pre-reconciliation integration SHA preserved separately.

DAG dependency staging lands on one strategy-owned lineage derived from the
immutable `strategyBaseSha`; persistent user main is not mutated merely to
prepare downstream nodes. Exactly one integration operation owns a strategy's
lineage at a time, so simultaneous worker completions serialize without Git
index-lock failures. A node's input snapshot is exactly `strategyBaseSha` plus
its accepted transitive dependency commits (node base SHA and dependency input
SHAs are persisted), and an interrupted strategy continues along the same
staged lineage after restart.

Campaign controls are awaited and acknowledged: Pause refuses while a
stop/ceiling drain is pending (a graceful Stop is not cancellable by Pause),
and Resume of a non-PAUSED campaign is an explicit 409 conflict rather than a
silent no-op. Resume failure never marks the campaign `EXECUTING`; campaign
state never contradicts strategy-actor state.

Normal controller shutdown stops strategy admissions, requests worker
termination (including the launch-retry window), awaits child termination
within a bounded grace, persists recovery state, settles completion callbacks,
preserves worktrees, and only then closes the database — `fastify.close()`
alone leaves no orphan children and no DB-closed callback errors. At startup,
orphaned active executor runs are marked failed, orphaned DAG staging
checkouts are swept, persisted `ADMITTED` scheduler leases become
`STALE_RECOVERABLE`, and a final idempotent reconciliation closes those stale
leases as `RELEASED` with one observable event per closed lease.

Executor starts are serialized per repository (Change 019):
`ExecutorService.startRun` acquires a per-repository start intent
synchronously before its first `await`, refuses an overlapping concurrent
start with a structured validation error instead of spawning a second runner,
and releases the intent on every exit path so failures never wedge later
authorized starts.
