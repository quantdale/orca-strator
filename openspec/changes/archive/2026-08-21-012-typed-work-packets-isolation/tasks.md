# Tasks: Typed Work Packets & Parallel-Writer Isolation

## Planning/reconciliation

- [x] Fold Change 011 and activate this focused OpenSpec on `main`.
- [x] Reconfirm current hardened main is authoritative over historical
  exploration documentation.
- [x] Keep swarm/DAG disabled until this change's real qualification gates pass.

## Typed packet/result contracts

- [x] Add versioned shared packet/result/provenance/status contracts.
- [x] Add SQLite packet/result/worktree/integration persistence and restart
  coverage.
- [x] Add packet/result REST APIs with structured correlation and safe-path
  validation.

## Worktree isolation

- [x] Implement deterministic Windows/WSL Git worktree/internal-branch
  allocation with persisted ownership/base SHA.
- [x] Implement clean-only release, dirty-work preservation, stale/orphan
  recovery, and no-force cleanup.
- [x] Add real Windows and conditional real WSL qualification.

## Integration/reconciliation

- [x] Implement dependency ordering, deterministic changed-path conflict
  detection, safe cherry-pick/abort, partial success, and final report.
- [x] Preserve COMPLETED, FAILED, BLOCKED, SKIPPED_DEPENDENCY, CANCELLED, and
  INTEGRATION_CONFLICT distinctions.
- [x] Add API/integration/failure-path tests and no shared-checkout evidence.

## Checkpoint

- [x] Run `npm test`, applicable `npm run test:real`, `npm run typecheck`,
  `npm run build`, and `npm run lint` on the final tree.
- [x] Fold canonical specs, reconcile docs/state/ROADMAP/README, commit and
  push Change 012, then continue to Change 013 only if the qualification gate
  remains green.
