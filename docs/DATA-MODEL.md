# Orca-Strator V1 Data Model

Status: **normative for Change 001 unless implementation evidence forces revision**

This document defines the first persistent data model and separates repository configuration from later runtime/run state.

## 1. Persistence principles

1. SQLite is local machine runtime persistence.
2. Git/GitHub remains the durable cross-agent handoff/source of truth for repository work.
3. Change 001 persists configuration only; later milestones add watcher/run/executor/Sol tables.
4. Secrets, API keys, browser cookies, and auth tokens do not belong in normal relational repository records.
5. Schema evolution happens only through ordered migrations.
6. Tests use isolated temporary databases.
7. V1 uses `main` as a runtime invariant rather than storing a configurable branch column.

## 2. Migration metadata

Recommended minimal metadata table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

Migration rules:

- migration versions are monotonically increasing integers;
- each migration runs at most once;
- migration + metadata insertion should be one transaction where supported;
- failure must not record the migration as applied;
- reopening a current DB is idempotent;
- application startup fails clearly if required migrations cannot complete.

## 3. `repositories` table

Baseline SQL shape:

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  github_remote TEXT NOT NULL,
  local_path TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('windows', 'wsl')),
  wsl_distribution TEXT,
  executor_cli TEXT NOT NULL,
  executor_model TEXT NOT NULL,
  sol_conversation_url TEXT NOT NULL,
  max_iterations INTEGER NOT NULL DEFAULT 20 CHECK (max_iterations > 0),
  max_runtime_minutes INTEGER NOT NULL DEFAULT 480 CHECK (max_runtime_minutes > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (environment = 'wsl' AND wsl_distribution IS NOT NULL AND length(trim(wsl_distribution)) > 0)
    OR environment = 'windows'
  )
);
```

The exact SQLite syntax may be adjusted for the selected driver/runtime, but the invariants must remain.

Do not add a `branch` column in V1. `main` is fixed by the runtime protocol and becomes schema-worthy only when branch/session orchestration is actually introduced.

## 4. Field semantics

### `id`

Stable Orca-local repository identifier.

Requirements:

- generated once on create;
- never changed by PATCH;
- safe for URL path use;
- not derived solely from display name because names may change/collide.

UUID is acceptable and simple.

### `display_name`

Human-facing label such as `Nightwatch`.

- trimmed;
- non-empty;
- does not need to equal GitHub repository name.

### `github_remote`

GitHub remote identity/URL used later by watcher/Git operations.

Change 001 should validate presence and basic form, not make network availability a hard create-time dependency unless the implementation explicitly adds a separate connectivity check.

### `local_path`

Repository working directory in the configured execution environment.

- Windows environment: native Windows path semantics.
- WSL environment: Linux path semantics inside selected distribution.

Change 001 stores configuration; later milestones verify/operate on the path.

### Integration branch

V1 always uses `main`.

This is intentionally **not** stored in repository configuration. All watcher/executor/Sol protocol behavior assumes `main` until a future multi-session/branch design explicitly revises the schema.

### `environment`

Exactly:

```text
windows
wsl
```

### `wsl_distribution`

Required for `wsl`.

Examples:

```text
Ubuntu
Ubuntu-24.04
```

For `windows`, normalized persisted value should preferably be `NULL`.

### `executor_cli`

User-owned executor harness identifier/config string.

Examples may later include:

```text
kimi
codex
claude
opencode
```

Change 001 should not hardcode a closed enum unless the UI deliberately provides presets with an advanced/custom option. Future executor adapters will normalize this field.

### `executor_model`

User-selected model/configuration string.

This must remain user-owned; Sol must not modify it autonomously during a run.

### `sol_conversation_url`

Exact dedicated ChatGPT conversation URL for this repository.

Requirements:

- HTTPS;
- ChatGPT host accepted by current product configuration;
- identifies a conversation path rather than generic homepage when possible;
- stored as configuration only; no auth token embedded.

### `max_iterations`

Default `20`.

Positive integer.

Later run state copies/snapshots the effective value so changing repository defaults does not ambiguously mutate an already-running session.

### `max_runtime_minutes`

Default `480` (8 hours).

Positive integer.

Same snapshot principle as iteration ceiling later.

### timestamps

Use UTC ISO-8601 strings consistently.

`created_at` never changes.

`updated_at` advances on successful mutation.

## 5. Domain models

Recommended logical distinction:

```ts
interface RepositoryRecord {
  id: string;
  displayName: string;
  githubRemote: string;
  localPath: string;
  environment: "windows" | "wsl";
  wslDistribution: string | null;
  executorCli: string;
  executorModel: string;
  solConversationUrl: string;
  maxIterations: number;
  maxRuntimeMinutes: number;
  createdAt: string;
  updatedAt: string;
}
```

Create input omits:

- `id`;
- timestamps;
- ceiling fields may be optional because they have defaults.

Patch input:

- all mutable configuration fields optional;
- `id`, `createdAt`, `updatedAt` not client writable;
- merged result is validated as a complete repository configuration before persistence.

## 6. Normalization rules

Before persistence:

- trim human/config strings where whitespace is not meaningful;
- apply default ceilings;
- normalize empty Windows `wslDistribution` to null;
- reject WSL config without a non-empty distribution;
- reject non-positive/non-integer ceilings;
- reject empty required fields;
- validate Sol conversation URL.

Do not silently normalize obviously contradictory data into a different semantic configuration.

## 7. Uniqueness policy

V1 does not require display-name uniqueness.

The application should avoid accidental duplicate repository entries where practical, but do not introduce a brittle uniqueness constraint on `github_remote` or `local_path` until the product semantics are proven. The same remote might intentionally exist in separate local execution locations later.

Stable identity is the `id`.

## 8. Delete semantics

Change 001 repository deletion is hard delete of the configuration record.

Later runtime milestones must prevent unsafe deletion of a repository with an active run or dependent runtime records.

Change 001 UI should use explicit confirmation.

## 9. Future tables — reserved conceptually, not implemented in Change 001

Later milestones are expected to add separate tables roughly along these responsibility boundaries:

```text
runs
runtime_state / repository_runtime
consumed_dispatches
executor_attempts
sol_wake_attempts
events / activity_log (if durable history is required)
```

Do not pre-create them merely because they are anticipated.

A future branch-per-session design may add branch/session-routing fields in a dedicated migration. Do not pre-seed unused branch configuration now.

## 10. Persistence tests

Minimum tests:

1. fresh migration;
2. migration reopening/idempotency;
3. valid Windows row round-trip;
4. valid WSL row round-trip;
5. invalid WSL row blocked before/at storage boundary;
6. multiple records list independently;
7. patch preserves ID/created time;
8. patch advances updated time;
9. invalid patch does not partially corrupt existing row;
10. delete works;
11. controller restart/reopen preserves records;
12. test DB never touches real `%LOCALAPPDATA%` data;
13. API/domain model does not accidentally reintroduce a configurable branch field in V1.

## 11. Post-V1 operational intelligence tables

Change 010 adds normalized operational records without replacing the existing
run/dispatch/executor/Sol tables:

- `campaign_trace_events` stores redacted event references, nullable run/
  iteration/dispatch/result/control IDs, phase, timestamp, status, failure
  reason, and optional duration. It is a read-model input, not a duplicate log
  or full result payload.
- `run_policies` stores one serialized effective `PhaseBudgetPolicy` per run.
  It is captured at run creation so later repository edits do not rewrite
  history.
- `executor_capability_probes` stores probe level, overall readiness, and a
  structured capability snapshot for a repository/executor/model/environment.
- `permission_policies` stores the repository's explicit preset/custom rules.
- `permission_decisions` stores repository/run/iteration-linked outcomes and
  honest enforcement type (`NATIVE_EXECUTOR`, `ORCA_ENFORCED`,
  `ADVISORY_ONLY`, or `UNSUPPORTED`).

Raw executor output remains in bounded log files and the executor-log API. Git
and result manifests remain durable cross-agent truth; these tables are local
operational/read-model truth.

## 12. Usage, scheduler, and explicit role policy tables

Change 011 adds three normalized policy/telemetry areas:

- `usage_metrics` stores only structured executor/provider values, with nullable
  token/latency/retry/rate-limit fields and separate `EXACT`, `ESTIMATED`, and
  `UNKNOWN` cost status. It links to repository/run/iteration/dispatch and
  executor-run where those identities are available.
- `scheduler_policies` stores one explicit application policy. Null limits mean
  unlimited; the default therefore does not cap independent repositories.
- `scheduler_decisions` stores admission status, request identity, policy
  snapshot, limiting dimension, reason, queued/runnable/resolved timestamps,
  and stale-recovery evidence.
- `role_model_policies` stores repository-scoped user-authored future role
  rules. A missing rule does not overwrite repository executor configuration;
  resolution falls back to that exact configured executor/model.

Usage records are referenced by the campaign ledger through structured events,
not copied into a second trace table. No raw browser/CLI output is scraped to
invent usage or cost.

## 13. Typed packets, worktrees, and integration tables

Change 012 adds:

- `work_packets`, which stores the versioned structured packet JSON plus
  repository/campaign/run/iteration/status indexes;
- `work_packet_results`, which stores one correlated typed result envelope per
  packet;
- `isolated_worktrees`, which stores deterministic path/branch/base SHA,
  environment, lifecycle, ownership, release, and recovery evidence;
- `integration_reports`, which stores the structured integrated/partial/conflict
  result and commit provenance.

These rows are local orchestration truth. Worker changes remain Git commits on
internal branches; the persistent repository `main` checkout remains the
integration target. No table or cleanup path authorizes force-push, reset, or
discard of dirty worker/user files.

## 14. Optional swarm strategy tables

Change 013 adds a small lifecycle anchor around the normalized packet/worktree
records:

- `execution_strategy_runs` stores one explicit `SWARM` strategy for a
  campaign/run/iteration, its packet ID set, effective worker bound, lifecycle
  status, control state, timestamps, blocker, and final structured report;
- `execution_strategy_controls` stores append-only PAUSE/STOP/KILL/RESUME
  decisions with strategy/run/iteration correlation and reason.

The strategy row is a read-model anchor, not a replacement for packet results,
worktree provenance, integration reports, scheduler decisions, usage metrics,
or the campaign trace. A strategy row may be `COMPLETED` or `PARTIAL` while the
enclosing campaign remains under Sol review; it never stores a goal-complete
authority.

## 15. DAG nodes (Change 014)

`execution_strategy_runs.strategy` accepts `DAG` after migration 020. Migration
021 adds `execution_dag_nodes`, keyed by `(strategy_run_id, node_id)` with a
unique packet link per strategy. Each row stores explicit node dependencies,
the effective packet budget snapshot, lifecycle status, attempt/retry ceiling,
waiting/control reason, timestamps, and the packet result reference.

DAG node rows are subordinate to the strategy run and packet/result records.
They do not replace typed work packets, Git worktree provenance, integration
reports, scheduler decisions, usage metrics, or the enclosing campaign run.

Migration 022 (`022_execution_strategy_loop_integration`, Change 017) adds the
loop-integration durability columns:

- `execution_strategy_runs.dispatch_id` — nullable reference to the authorizing
  `dispatches` row (`ON DELETE SET NULL`), indexed by
  `idx_execution_strategy_runs_dispatch`; it links a strategy run to the
  dispatch that authorized it, including autonomous campaign-loop starts;
- `execution_strategy_runs.strategy_base_sha` — the immutable deterministic
  base SHA the strategy was started against, captured once at start;
- `execution_dag_nodes.dependency_input_shas_json` — `NOT NULL DEFAULT '[]'`;
  materializes the dependency input SHAs each node waited on;
- `isolated_worktrees.dependency_input_shas_json` — `NOT NULL DEFAULT '[]'`;
  records the same provenance on the worktree that produced the node's result.

There is no new dispatch-table column: strategy selection lives on the dispatch
marker itself as optional `strategy` and `executionPlan` fields, so legacy V1
markers without them resolve to `SINGLE_AGENT`. The dispatch row/marker remains
the durable authorization; the strategy run stores only its correlation and
base SHA.

## 16. Optional OpenCode capability evidence (Change 015)

No OpenCode-specific SQLite table is required. The existing
`executor_capability_probes.snapshot_json` may carry an optional `opencode`
object containing a sanitized endpoint, experimental flag, observed API
generation/version, route readiness, and observation time. Probe issues remain
in the existing classified issue list. Structured native usage is stored in the
existing `usage_metrics` table only after an explicit adapter operation returns
numeric provider/session fields; missing values remain NULL.

OpenCode sessions, events, and permissions are not campaign truth. The
campaign ledger continues to reference normalized events, strategy records,
typed results, and Git references rather than copying HTTP transcripts.

## 17. Topology and preset projection (Change 016)

The topology UI adds no SQLite table. `ExecutionTopologyView` is a small
projection vocabulary over `CampaignDetail`; its cards retain IDs, statuses,
dependencies, durations, executor/model/environment, usage references, and
durable references without becoming a second source of truth. The shared
`ExecutionStrategyPreset` catalog is versioned immutable reference data with
`autoStart: false`; it never creates packets, nodes, model routes, or campaign
rows.

## 18. Change 018 persistence notes

Change 018 adds no new tables. Durable postflight/retry truth reuses existing
stores: blocked publications persist evidence on the strategy-run row and run
recovery fields (`lastError`/`RECOVERY_REQUIRED`), leave the authorizing
dispatch unconsumed so postflight retry can find the iteration, and record
structured `loop.postflight_blocked` / retry events in the campaign trace.
Manifest publication provenance (post-reconciliation final commit SHA plus the
pre-reconciliation integration SHA) lives in the published result manifest on
Git, not in a new local table.

Two existing tables gain behavior rather than schema: `permission_decisions`
rows are durable and resolvable — resolution persists the user outcome
(`ALLOW`/`ALLOW_ONCE`/`DENY`) and `resolved_at` on the decision row — and their
enforcement labeling follows capability-probe evidence (`NATIVE_EXECUTOR` when
the rich permission API is READY, otherwise `ADVISORY_ONLY`). Scheduler lease
recovery at startup marks persisted `ADMITTED` rows `STALE_RECOVERABLE`, and
startup reconciliation marks orphaned active executor runs failed; both reuse
the existing status vocabularies. Startup reconciliation then closes leftover
`STALE_RECOVERABLE` rows as `RELEASED` with truthful reasons (Change 019),
still within the same status vocabulary.
