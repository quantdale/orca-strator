# Tasks: Usage Telemetry & Explicit Scheduler Policy

## Planning/reconciliation

- [x] Fold Change 010 and activate this focused OpenSpec on `main`.
- [x] Reconfirm no OpenFlow exploration behavior overrides current main.
- [x] Preserve independent-repository concurrency and user-owned executor/model
  selection as hard invariants.

## Usage telemetry

- [x] Add shared usage metric/summary contracts with exact/estimated/unknown
  semantics and validation.
- [x] Add usage persistence, ledger correlation, adapter capture seam, and
  usage/campaign APIs.
- [x] Add no-fabrication, partial metric, restart, negative, and UI coverage.

## Scheduler policy

- [x] Add persisted transparent optional limits and admission decision records.
- [x] Implement explicit queue/reason/runnable/release/recovery semantics with
  unlimited cross-repository defaults.
- [x] Add policy/decision APIs and operational UI presentation.
- [x] Add two-repository isolation, limit, restart, and failure-path tests.

## Role/model policy

- [x] Add repository-scoped user-authored role/model rules and exact fallback.
- [x] Add policy/resolve APIs and primary/default UI presentation.
- [x] Add explicit-rule, fallback, invalid-rule, and no-dynamic-routing tests.

## Checkpoint

- [x] Run `npm test`, applicable `npm run test:real`, `npm run typecheck`,
  `npm run build`, and `npm run lint`.
- [x] Fold canonical specs, reconcile docs/state/ROADMAP/README, commit and
  push Change 011, then continue to Change 012.
