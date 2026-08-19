# Tasks: Autonomous Loop Engine and Multi-Repository Concurrency

Implement Milestone 5 autonomous state machine, run persistence, multi-repository loop orchestration, and run controls.

## 1. Protocol contracts and state types

- [x] 1.1 Define `LoopState`, `RunRecord`, and `RunStatus` in `@orca/shared` matching `docs/RUNTIME-MODEL.md`.
- [x] 1.2 Add event types for loop state transitions in `packages/shared/src/events.ts`.
- [x] 1.3 Add unit tests for loop state transition validity in `packages/shared`.

## 2. SQLite storage additions

- [x] 2.1 Add migration `005_create_runs` for `runs` table.
- [x] 2.2 Implement `RunStore` in `apps/controller` for tracking active and historical runs.
- [x] 2.3 Add unit tests for `RunStore` CRUD, status transitions, and migration rollback.

## 3. Autonomous loop runner and state machine

- [x] 3.1 Implement `RepositoryLoopRunner` managing state transitions for a single repository.
- [x] 3.2 Handle forward loop: `SOL_PENDING` -> `SOL_REVIEWING` -> `EXECUTOR_PENDING` -> `EXECUTING` -> `SOL_PENDING`.
- [x] 3.3 Enforce single-actor exclusivity per repository (never Sol and executor simultaneously).
- [x] 3.4 Handle terminal and control states (`GOAL_COMPLETE`, `BLOCKED`, `NEEDS_HUMAN`, `PAUSED`, `STOPPED`, `DRAINING`).

## 4. Multi-repository loop service

- [x] 4.1 Implement `LoopService` managing concurrent loop runners across multiple repositories.
- [x] 4.2 Expose methods: `startRun`, `pauseRun`, `resumeRun`, `stopRun`, `getRunStatus`.
- [x] 4.3 Emit real-time WebSocket events (`loop.state_changed`).

## 5. REST endpoints and controller integration

- [x] 5.1 Add REST endpoints: `GET /api/repositories/:id/runs/active`, `POST /api/repositories/:id/runs/start`, `POST /api/repositories/:id/runs/pause`, `POST /api/repositories/:id/runs/resume`, `POST /api/repositories/:id/runs/stop`.
- [x] 5.2 Integrate `LoopService` into controller lifecycle in `apps/controller/src/app.ts`.

## 6. Integration tests and qualification

- [x] 6.1 Write integration tests proving full autonomous loop cycle for a repository.
- [x] 6.2 Write integration tests proving iteration limit ceiling enforcement.
- [x] 6.3 Write integration tests proving pause, resume, and stop controls.
- [x] 6.4 Write integration tests proving two repositories run autonomous loops concurrently and independently.
- [x] 6.5 Run full workspace verification: typecheck, test, build, lint.

## 7. Advance and transition

- [x] 7.1 Fold/archive Milestone 5 once complete.
- [x] 7.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [x] 7.3 Create Milestone 6 OpenSpec (`006-responsive-ui-experience`).
- [x] 7.4 Commit and push transition to `main` and continue.
