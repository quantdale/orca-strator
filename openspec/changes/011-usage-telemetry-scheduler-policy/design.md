# Design: Usage Telemetry & Explicit Scheduler Policy

## 1. Normalized usage records

Add a `usage_metrics` table and shared `UsageMetric` contract rather than
duplicating executor logs. A metric may be partial. Numeric fields are nullable
and only populated when a native adapter/provider response supplies them.
`costStatus` is `EXACT`, `ESTIMATED`, or `UNKNOWN`; an estimated value is never
returned as exact. The source identifies whether the value came from a native
executor/provider response or a structured adapter result.

Adapters expose the optional usage hook introduced by Change 010. The
executor service may persist a non-empty, validated response after a turn; the
current Windows/WSL generic adapters expose no usage, so normal V1 runs remain
unknown. No UI scraping or inference request is added.

Campaign read models include usage metrics and a summary. A
`executor.usage_recorded` event links the metric to the existing campaign
ledger without copying all telemetry into the trace table.

## 2. Explicit scheduler policy

Persist one application scheduler policy with nullable limits:

- total active inference sessions;
- per-provider and per-model active sessions;
- future per-repository subagent sessions;
- optional CPU/RAM and spend/token budgets.

Null means unlimited. The default policy has all limits null, preserving
cross-repository concurrency. `SchedulerService` evaluates an explicit
admission request, records `ADMITTED`, `QUEUED`, or `REJECTED` with the exact
limiting dimension and `runnableAt`, and exposes release/recovery operations.
The service is a future fan-out seam; today's single-agent path does not
silently acquire a global slot or change execution semantics.

The durable decision record is append-oriented. In-memory active leases are
reconciled from explicit release/recovery calls, and a restart can mark stale
leases as recoverable rather than treating them as successful execution.

## 3. Explicit role/model policy

Persist repository-scoped `RoleModelPolicy` rules. A rule names a role and the
exact executor CLI/model/provider selected by the user. The resolver has only
two outcomes:

- an explicitly authored matching rule;
- the repository's configured executor/model when no matching rule exists.

There is no heuristic, fallback, provider rotation, or Sol-selected dynamic
switch. The primary role always reports the repository configuration as the
authoritative primary selection. The policy is preparation for future packet
roles, not permission to spend another quota today.

## 4. API/UI

Add repository usage and campaign usage endpoints, scheduler policy/decision
endpoints, and role-policy read/write/resolve endpoints. Extend the existing
operational panel with a compact usage truthfulness summary, scheduler default
and limits, and explicit primary/role policy identity. The UI labels unknown
metrics and does not render absent values as zero.

## 5. Verification

Test persistence and restart recovery, unknown/estimated/exact validation,
ledger correlation, two-repository unrestricted default admission, explicit
queue reasons, role fallback/rule resolution, and negative no-fabrication
paths. Real qualification uses local child/Git fixtures only; provider
telemetry remains unqualified unless a trustworthy native source exists.
