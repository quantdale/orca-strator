# Change 010: Operational Intelligence & Executor Capabilities

## Status

**Implementing**

## Why

Change 009 made the V1 production pipeline truthful and restart-safe, but its
operational information is still distributed across run, dispatch, executor,
Sol, watcher, and event records. The next safe step is to make that information
queryable and to expose executor readiness and policy boundaries without
changing Orca's persistent campaign model.

## Goals

1. Add a normalized campaign trace/read model that links existing durable data
   instead of copying raw logs into a giant table.
2. Add static and harmless non-inference capability probes for Kimi, Codex,
   generic CLI, and the deterministic test adapter; persist and expose honest
   readiness results.
3. Extend the executor adapter seam with optional, feature-detected capability
   operations while preserving the generic CLI and current Kimi/Codex paths.
4. Capture one effective phase-budget policy per run and classify phase
   expiration reasons without killing an active actor at a campaign wall-clock
   boundary.
5. Add an executor-neutral autonomy permission policy with presets, explicit
   enforcement labels, durable decisions, and actionable `ASK` attention.
6. Expose campaign history, iteration/timeline views, capability probing,
   effective policy, and permission policy through REST and the responsive UI.

## Non-goals

- No same-repository parallel writers, worktrees, swarm, DAG, or graph composer.
- No dynamic or opaque model/provider routing.
- No mandatory OpenCode dependency or provider-specific orchestration logic.
- No replacement of existing Change 009 stores, callbacks, controls, or Git
  truth; this change adds read models and seams around them.
- No fabricated inference, usage, cost, auth, or permission-enforcement claims.

## User-visible outcome

For every repository, the user can inspect recent and historical campaigns,
follow an iteration timeline with correlation IDs and durations, see where a
failure or recovery occurred, test executor readiness without silently making a
model request, inspect the effective run policy, and understand whether a
permission rule is native, Orca-enforced, advisory, or unsupported.

## Risks and mitigations

- Existing event shapes do not always carry every correlation field: the ledger
  stores nullable references and resolves known dispatch/run relationships from
  SQLite rather than guessing.
- Generic CLIs cannot guarantee permission enforcement: snapshots explicitly say
  `ADVISORY_ONLY` or `UNSUPPORTED`.
- Adding policy must not alter Change 009 safety: effective policy is snapshotted
  at run creation, absolute Git invariants remain hard-coded, and wall-clock
  expiration remains a drain boundary.

## Success criteria

- A production-built app can list and detail a campaign without parsing raw logs.
- A real temporary repository can run STATIC/NON_INFERENCE probes with persisted
  results and no model request.
- Existing generic/Kimi/Codex invocation and control tests remain green.
- A run exposes a durable effective budget policy and classified trace events.
- Permission decisions are durable and `ASK` produces an actionable event/state,
  while unsupported native enforcement is never reported as blocked.
- Focused tests cover normal, restart, failure, redaction, and multi-repository
  separation behavior.
