# Tasks: Runtime Recovery, Ceilings, and Hardening

Implement Milestone 6 crash recovery, wall-clock budget ceilings, recovery resolution REST endpoint, and log retention.

## 1. Wall-clock ceilings and draining

- [ ] 1.1 Add `maxRuntimeMinutes` checking and `DRAINING` transition in `LoopService`.
- [ ] 1.2 Add unit tests for wall-clock ceiling enforcement in `packages/shared` and controller.

## 2. Startup crash reconciler

- [ ] 2.1 Implement `StartupReconciler` in `apps/controller/src/loop/startup-reconciler.ts`.
- [ ] 2.2 Reconcile orphaned `EXECUTING` runs to `RECOVERY_REQUIRED`.
- [ ] 2.3 Reconcile `SOL_PENDING` / `SOL_REVIEWING` runs seamlessly.
- [ ] 2.4 Integrate `StartupReconciler` into controller startup in `apps/controller/src/app.ts`.

## 3. Recovery REST API

- [ ] 3.1 Add `POST /api/repositories/:id/runs/recover` endpoint in `apps/controller/src/http/routes/runs.ts`.
- [ ] 3.2 Support recovery actions: `retry`, `stop`, `complete`.

## 4. Log retention manager

- [ ] 4.1 Implement `LogRotator` in `apps/controller/src/executor/log-rotator.ts` to prune old executor log files.
- [ ] 4.2 Add unit tests for log pruning and retention policies.

## 5. Integration tests and qualification

- [ ] 5.1 Write integration tests proving startup crash recovery marks `RECOVERY_REQUIRED` on interrupted executor runs.
- [ ] 5.2 Write integration tests proving manual recovery API (`retry` / `stop` / `complete`).
- [ ] 5.3 Write integration tests proving wall-clock budget triggers `DRAINING` and finishes gracefully.
- [ ] 5.4 Run full workspace verification: typecheck, test, build, lint.

## 6. Advance and transition

- [ ] 6.1 Fold/archive Milestone 6 once complete.
- [ ] 6.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [ ] 6.3 Create Milestone 7 OpenSpec (`007-remote-phone-experience`).
- [ ] 6.4 Commit and push transition to `main` and continue.
