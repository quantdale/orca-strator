# Tasks: Operational Intelligence & Executor Capabilities

## Planning/reconciliation

- [x] Read current Change 009 artifacts and canonical V1 docs.
- [x] Read the historical exploration branch without merging it.
- [x] Record the canonical already/partial/new/deferred delta.
- [x] Create this focused proposal, delta spec, design, and task list.

## Shared contracts and persistence

- [x] Add shared trace, capability, phase-policy, and permission contracts.
- [x] Add migrations and stores for trace events, run policy snapshots,
  capability probes, permission policies, and permission decisions.
- [x] Keep protocol data redacted and repository-scoped.

## Campaign ledger/read models

- [x] Subscribe the ledger to the existing redacting EventBus.
- [x] Add campaign list/detail/iteration/timeline read models and REST routes.
- [x] Preserve raw executor logs as a separate API.
- [x] Add unit, restart, failure, redaction, and multi-repository tests.

## Capability-aware execution

- [x] Extend the adapter seam with optional capabilities/probe/cancel/status/
  events/session/usage operations.
- [x] Implement honest STATIC/NON_INFERENCE probes for Kimi, Codex, generic,
  and deterministic test profiles.
- [x] Add capability GET/probe API and focused Windows/WSL tests.

## Unified budgets

- [x] Capture and expose effective per-run phase policy.
- [x] Route new budget classification through one policy vocabulary while
  preserving Change 009 wall-clock drain and retry semantics.
- [x] Add policy/restart/timeout negative-path tests.

## Autonomy permissions

- [x] Implement presets, custom rules, absolute invariant overrides, enforcement
  labels, and durable decisions.
- [x] Surface ASK as actionable attention without claiming unsupported blocking.
- [x] Add policy/check APIs and repository UI presentation.

## UI and verification

- [x] Add responsive campaign trace, readiness, policy, and permission panels.
- [x] Run focused tests while implementing.
- [x] At the checkpoint run `npm test`, applicable `npm run test:real`,
  `npm run typecheck`, `npm run build`, and `npm run lint`.
- [x] Update canonical specs, ROADMAP, README, and `.agent/state.json`; commit
  and push before advancing to Change 011.
