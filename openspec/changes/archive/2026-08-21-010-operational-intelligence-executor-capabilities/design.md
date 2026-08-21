# Design: Operational Intelligence & Executor Capabilities

## 1. Boundaries

Change 009 remains the runtime authority. Change 010 adds four controller
services around it:

```text
EventBus -> CampaignLedgerService -> normalized trace tables/read models
Repository + executor profile -> CapabilityProbeService -> capability store
Repository/run -> PhaseBudgetService -> run policy snapshot
Repository/run/action -> PermissionPolicyService -> policy + decisions
```

The services are standalone TypeScript modules with SQLite stores and small
HTTP route adapters. The UI consumes read models; it does not infer phases from
raw executor output.

## 2. Campaign ledger

Add `campaign_trace_events` with nullable `run_id`, `iteration`, `dispatch_id`,
`result_id`, and `control_id` references, plus `phase`, `event_type`, timestamp,
classified status/failure reason, optional duration, and redacted structured
JSON. Existing `dispatches`, `executor_runs`, `sol_wakes`, `sol_controls`, and
`runs` remain the source records; the trace stores event references and
summaries, not duplicate logs or full result payloads.

`CampaignLedgerService` subscribes once to the already-redacting `EventBus`.
It maps events to stable phases, resolves omitted run/iteration references from
known dispatches or the latest run, and exposes:

- campaign list/read model;
- campaign detail with existing dispatch/executor/wake/control references;
- iteration detail;
- ordered timeline with computed phase durations where timestamps permit.

Raw executor log files remain behind the existing executor-log API.

## 3. Capability model and probes

`ExecutorCapabilitySnapshot` separates:

- CLI installed/version/path;
- Windows/WSL working directory and Git readiness;
- invocation/headless/resume/cancellation support;
- auth and model recognition statuses;
- optional rich capabilities;
- probe level (`STATIC`, `NON_INFERENCE`, `INFERENCE`), timestamp, and typed
  error classifications.

`CapabilityProbeService` uses direct argv child processes and harmless checks.
Settings/GET calls default to STATIC. NON_INFERENCE may check the working tree,
Git remote/readiness, and adapter help/version but never sends a model request.
INFERENCE is an explicit request carrying `allowInference: true`; the initial
implementation returns `NOT_RUN`/`UNKNOWN` for provider inference because no
provider burn is authorized implicitly.

Profiles are data-owned in `executor/profiles.ts`. The orchestration engine
asks an adapter/profile for capabilities; it does not branch on Kimi/Codex/
OpenCode names. The deterministic test adapter is a first-class profile for
qualification only.

## 4. Capability-aware adapter seam

Keep required `spawn()` and `killProcessTree()` for compatibility. Add optional
feature-detected methods and a capability descriptor:

```text
ExecutorAdapter
  capabilities(context?)
  probe(context, level)
  spawn(context)
  cancel(context, reason)       optional; kill fallback remains safe
  pause/resume/status/events/session/usage  optional
```

Windows and WSL adapters advertise process cancellation and environment facts.
Generic/Kimi/Codex invocation remains selected by the profile registry. Missing
optional operations are represented as unsupported and degrade to existing
bounded process supervision.

## 5. Unified phase-budget policy

At run creation, `PhaseBudgetService` captures a versioned effective
`PhaseBudgetPolicy` in `run_policies`. It derives campaign limits from the
repository configuration and applies explicit defaults for Sol, executor, Git,
and recovery phases. Historical runs therefore do not change when settings are
edited later.

Every expiry is represented by a specific `BudgetFailureReason`, for example
`EXECUTOR_START_TIMEOUT`, `GIT_POSTFLIGHT_TIMEOUT`,
`SOL_COMPLETION_TIMEOUT`, or `WALL_CLOCK_CEILING`. The existing wall-clock
timer continues to enter `DRAINING` and never kills an active actor. The policy
is exposed in status/history APIs and is the single source for new policy-aware
code; existing Change 009 retry semantics are preserved while their constants
are gradually consumed through this seam.

## 6. Permission policy

`PermissionPolicyService` stores a repository policy with presets
`CONSERVATIVE`, `BALANCED`, `UNATTENDED`, or `CUSTOM`, plus durable decisions
linked to run/iteration/action. Rules use executor-neutral action classes and
outcomes `ALLOW`, `ALLOW_ONCE`, `ASK`, `DENY`.

The decision result also carries an enforcement type:

- `NATIVE_EXECUTOR` only when the selected adapter advertises a permission API;
- `ORCA_ENFORCED` for checks actually intercepted by Orca;
- `ADVISORY_ONLY` when recorded/displayed but not technically enforceable;
- `UNSUPPORTED` when no meaningful enforcement exists.

Force-push, dirty-tree discard, and secret-commit protections remain absolute
Orca invariants. `ASK` records a pending attention decision and publishes a
redacted actionable event; it does not block a process forever or claim that a
generic CLI was denied.

## 7. API/UI

Add repository-scoped endpoints:

```text
GET  /api/repositories/:id/campaigns
GET  /api/repositories/:id/campaigns/:runId
GET  /api/repositories/:id/campaigns/:runId/iterations/:iteration
GET  /api/repositories/:id/campaigns/:runId/timeline
GET  /api/repositories/:id/executor/capabilities
POST /api/repositories/:id/executor/probe
GET  /api/repositories/:id/phase-policy
GET  /api/repositories/:id/permissions
PUT  /api/repositories/:id/permissions
POST /api/repositories/:id/permissions/check
```

The repository detail screen adds compact responsive sections for recent
campaigns, current trace, phase durations/failure markers, executor readiness,
effective policy, and permission enforcement. It does not become a graph
composer and raw logs remain a separate view.

## 8. Verification

- Store/unit tests for trace correlation, phase duration derivation, policy
  snapshots, capability classifications, and permission presets/invariants.
- Controller integration tests for APIs and EventBus-to-ledger persistence.
- Real local child-process/Git probes for Windows; WSL probe coverage when the
  machine has a usable distribution, otherwise an explicit unqualified test.
- Restart/recovery tests verify snapshots and trace history survive controller
  recreation.
- Multi-repository tests verify trace and policies never cross repository IDs.
