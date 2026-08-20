# OpenFlow-Inspired Evolution: Canonical Design Delta

Status: **canonical design input for post-V1 work; not an OpenFlow compatibility contract**

The historical exploration is preserved on the remote branch
`exploration/openflow-inspired-orca-evolution`. It is documentation-only and
non-binding. Current `main`, Change 009, and the focused OpenSpecs below remain
authoritative.

## Already exists on current `main`

- Durable per-repository campaign/run state in SQLite.
- Executor-run records, dispatch/result/control records, and idempotency guards.
- Durable Sol-operation intent, timeout retry, BUSY retry, and restart recovery.
- Windows and WSL process adapters, executor invocation profiles, and process-tree controls.
- Structured event publication, redaction, bounded logs, and a responsive status UI.
- Git preflight/postflight foundations, remote-main truth, result manifests, and no destructive Git defaults.
- Sol-owned outer-loop completion, single active actor per repository, and independent cross-repository execution.

## Partially exists

- Events and existing tables contain the raw ingredients for a trace, but there is no first-class campaign read model, phase duration view, or history API.
- Invocation profiles exist, but adapter capabilities and readiness are not modeled or probed as a durable contract.
- Timeouts and retries exist in several services, but there is no persisted effective per-run phase policy with one vocabulary of classified reasons.
- UI exposes current run state and raw logs, but not a unified campaign/iteration timeline.
- Executor identity is recorded, but reliable usage/cost and autonomy decisions are not yet represented.

## New work approved by this campaign

Change 010 adds the normalized operational foundation: a queryable campaign
ledger/read model, executor-neutral capability probes, capability-aware adapter
seams, one persisted phase-budget policy per run, and an explicit autonomy
permission policy with honest enforcement labels and actionable `ASK` state.

## Explicitly deferred to later focused changes

- Usage/cost telemetry, transparent scheduler limits, and explicit role/model policy foundation (Change 011).
- Typed work packets, isolated worktrees, integration/reconciliation, and partial-failure contracts (Change 012).
- Optional same-repository swarm (Change 013), optional DAG strategy (Change 014), and optional rich OpenCode adapter evaluation (Change 015).
- Execution-topology observability UI and reusable strategy presets (Change 016 and a later preset slice).
- Visual workflow composition, OpenFlow import/compatibility, mandatory OpenCode, opaque model routing, unrestricted same-checkout writers, and public collaboration features remain out of scope.

## Design consequence

The adopted shape is:

```text
Persistent Orca campaign -> Sol -> one iteration -> chosen executor strategy
    -> structured durable result -> Git -> Sol -> repeat
```

OpenFlow-like capabilities are subordinate runtime facilities. They do not
replace Git as durable cross-agent truth, SQLite as local orchestration truth,
or Sol as the high-level completion/replanning authority.
