# Tasks: Headless Executor Runtime

Implement Milestone 3 headless executor execution, environment adapters, process supervision, result manifest validation, SQLite run tracking, and run controls.

## 1. Protocol contracts and result validation

- [x] 1.1 Define TypeScript types and Zod schema for `ExecutorResult` in `@orca/shared` matching `schemas/protocol/executor-result.schema.json`.
- [x] 1.2 Add unit tests for valid, blocked, failed, and invalid result manifests in `packages/shared`.

## 2. SQLite storage additions

- [x] 2.1 Add migration `003_create_executor_runs` for `executor_runs` table.
- [x] 2.2 Implement `ExecutorStore` in `apps/controller` for tracking run attempts, statuses, and log paths.
- [x] 2.3 Add unit tests for `ExecutorStore` CRUD, status transitions, and migration rollback.

## 3. Environment adapters and bootstrap prompt

- [x] 3.1 Implement `WindowsPowerShellAdapter` for executing commands with environment variables in Windows.
- [x] 3.2 Implement `WslAdapter` for executing commands in WSL with configured distribution and path.
- [x] 3.3 Implement `generateBootstrapPrompt` in `@orca/shared` for constructing standard agent instructions.
- [x] 3.4 Add unit tests for adapters and prompt generation.

## 4. Process supervisor and log streaming

- [x] 4.1 Implement `ExecutorRunner` supervising child process lifecycles.
- [x] 4.2 Capture stdout/stderr in bounded memory buffers and append to disk log files.
- [x] 4.3 Implement tree-kill on Windows (`taskkill /pid /T /F`) and WSL.
- [x] 4.4 Implement runtime timeout ceiling enforcement.
- [x] 4.5 Emit real-time WebSocket events (`executor.started`, `executor.log`, `executor.completed`, `executor.failed`, `executor.paused`, `executor.killed`).

## 5. Operational controls and REST endpoints

- [x] 5.1 Implement `pause()`, `resume()`, `kill()`, and `stop()` in `ExecutorService`.
- [x] 5.2 Add REST endpoints: `GET /api/repositories/:id/executor`, `GET /api/repositories/:id/executor/logs`, `POST /api/repositories/:id/executor/pause`, `POST /api/repositories/:id/executor/resume`, `POST /api/repositories/:id/executor/kill`.
- [x] 5.3 Integrate `ExecutorService` into controller lifecycle in `apps/controller/src/app.ts`.

## 6. Fake executor simulator and integration tests

- [x] 6.1 Implement `FakeExecutor` qualification simulator.
- [x] 6.2 Write integration tests proving successful execution, verification parsing, and result recording.
- [x] 6.3 Write integration tests proving runtime ceiling timeout termination.
- [x] 6.4 Write integration tests proving pause/resume and emergency kill controls.
- [x] 6.5 Run full workspace verification: typecheck, test, build, lint.

## 7. Advance and transition

- [x] 7.1 Fold/archive Milestone 3 once complete.
- [x] 7.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [x] 7.3 Create Milestone 4 OpenSpec (`004-playwright-sol-bridge`).
- [x] 7.4 Commit and push transition to `main` and continue.
