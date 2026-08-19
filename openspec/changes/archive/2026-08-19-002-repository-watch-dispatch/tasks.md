# Tasks: Repository Watcher and Transactional Dispatch

Implement Milestone 2 remote Git watcher, dispatch schema validation, transactional commit isolation, SQLite tracking, and API observability.

## 1. Protocol contracts and shared validation

- [x] 1.1 Define TypeScript types and Zod schema for `DispatchMarker` in `@orca/shared` matching `schemas/protocol/dispatch.schema.json`.
- [x] 1.2 Add path safety validation preventing path traversal in `changePath`.
- [x] 1.3 Add unit tests for valid and invalid dispatch payloads in `packages/shared`.

## 2. SQLite storage additions

- [x] 2.1 Add migration `002_create_dispatches` for `dispatches` and `watcher_state` tables.
- [x] 2.2 Implement `DispatchStore` in `apps/controller` for storing and retrieving dispatches, statuses, and watcher state.
- [x] 2.3 Add unit tests for `DispatchStore` CRUD, idempotency, and migration rollback.

## 3. Git client and commit inspector

- [x] 3.1 Implement `GitClient` helper in `apps/controller` for executing `git ls-remote`, `git fetch`, `git log`, `git diff-tree`, `git show`.
- [x] 3.2 Implement `CommitInspector` to verify isolated dispatch commits (only 1 file added: `.orca/dispatch/<id>.json`).
- [x] 3.3 Add unit tests for `CommitInspector` with various commit fixtures (isolated valid, mixed work, file modifications, multiple files).

## 4. Repository watcher service

- [x] 4.1 Implement `WatcherService` managing per-repository polling loops.
- [x] 4.2 Poll `refs/heads/main` only; ignore non-main branches.
- [x] 4.3 Handle errors gracefully with backoff and record `last_error` in `watcher_state`.
- [x] 4.4 Emit WebSocket events (`watcher.dispatch_detected`, `watcher.dispatch_rejected`, `watcher.poll_completed`).
- [x] 4.5 Ensure multiple repositories poll independently and concurrently.

## 5. REST endpoints and controller integration

- [x] 5.1 Add `GET /api/repositories/:id/watcher` endpoint returning current watcher status.
- [x] 5.2 Add `GET /api/repositories/:id/dispatches` endpoint listing historical dispatches.
- [x] 5.3 Integrate `WatcherService` into `buildApp()` lifecycle in `apps/controller/src/app.ts`.

## 6. Integration tests and verification

- [x] 6.1 Create temporary bare Git remote fixture helpers for tests.
- [x] 6.2 Write integration test proving ordinary commit on remote `main` does not trigger dispatch.
- [x] 6.3 Write integration test proving isolated dispatch commit launches detection exactly once.
- [x] 6.4 Write integration test proving repeated polling on the same commit is idempotent.
- [x] 6.5 Write integration test proving mixed commit is rejected with structured reason.
- [x] 6.6 Write integration test proving two repositories detect dispatches independently.
- [x] 6.7 Run full root verification: typecheck, test, build, lint.

## 7. Advance and transition

- [x] 7.1 Fold/archive Milestone 2 once complete.
- [x] 7.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [x] 7.3 Create Milestone 3 OpenSpec (`003-headless-executor-runtime`).
- [x] 7.4 Commit and push transition to `main` and continue.
