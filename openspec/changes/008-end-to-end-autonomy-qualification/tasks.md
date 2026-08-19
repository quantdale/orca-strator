# Tasks: End-to-End Autonomy Qualification

Implement Milestone 8 full-matrix autonomy qualification tests and V1 roadmap completion.

## 1. End-to-end qualification test suite

- [ ] 1.1 Implement `apps/controller/test/e2e-autonomy-qualification.test.ts` covering multi-repo concurrent loops, Windows/WSL matrix, and Sol wake bridge.
- [ ] 1.2 Add qualification tests for crash recovery, state reconstruction, and manual recovery workflows.
- [ ] 1.3 Add qualification tests for iteration and runtime ceilings.
- [ ] 1.4 Add qualification tests for Tailscale guidance and notification dispatch.

## 2. Full-stack verification

- [ ] 2.1 Run full workspace typecheck across `@orca/shared`, `@orca/controller`, `@orca/ui`, `@orca/desktop`.
- [ ] 2.2 Run full test suite across all 30+ test suites.
- [ ] 2.3 Run full workspace production build and linting.

## 3. Finalize and archive V1 Roadmap

- [ ] 3.1 Fold/archive Milestone 8 once complete.
- [ ] 3.2 Update `docs/ROADMAP.md` and `.agent/state.json` marking V1 roadmap complete.
- [ ] 3.3 Update `README.md` reflecting completed V1 autonomous development orchestrator.
- [ ] 3.4 Commit and push final state to `main`.
