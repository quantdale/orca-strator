# Tasks: Playwright Sol Bridge

Implement Milestone 4 browser automation, persistent profile locking, interactive setup browser, and input-only ChatGPT Sol wake submission.

## 1. Protocol contracts and wake message generation

- [x] 1.1 Define `generateSolWakeMessage` in `@orca/shared` matching `docs/CROSS-AGENT-PROTOCOL.md`.
- [x] 1.2 Add TypeScript types and schemas for `SolWakeRecord` and `BrowserStatus`.
- [x] 1.3 Add unit tests for wake message generation and validation in `packages/shared`.

## 2. SQLite storage additions

- [x] 2.1 Add migration `004_create_sol_wakes` for `sol_wakes` table.
- [x] 2.2 Implement `SolWakeStore` in `apps/controller` for tracking wake submissions and statuses.
- [x] 2.3 Add unit tests for `SolWakeStore` CRUD and migration rollback.

## 3. Profile lock manager and browser driver

- [x] 3.1 Implement `ProfileLockManager` with PID liveness checks and stale-lock recovery.
- [x] 3.2 Define `BrowserDriver` interface and implement `PlaywrightDriver` with persistent context.
- [x] 3.3 Implement `MockBrowserDriver` for deterministic testing.
- [x] 3.4 Add unit tests for `ProfileLockManager`.

## 4. Sol wake submitter and browser manager

- [x] 4.1 Implement `SolWakeSubmitter` handling navigation, composer typing, and send verification.
- [x] 4.2 Implement `BrowserManager` managing persistent browser lifecycle and page multiplexing.
- [x] 4.3 Handle busy states, Cloudflare interstitials, and modal dialogs with backoff.
- [x] 4.4 Emit real-time WebSocket events (`browser.started`, `browser.stopped`, `sol.wake_submitted`, `sol.wake_failed`).

## 5. REST endpoints and controller integration

- [x] 5.1 Add REST endpoints: `GET /api/browser/status`, `POST /api/browser/setup/open`, `POST /api/browser/setup/close`, `POST /api/repositories/:id/wake`.
- [x] 5.2 Integrate `BrowserManager` and `SolWakeStore` into controller lifecycle in `apps/controller/src/app.ts`.

## 6. Integration tests and qualification

- [x] 6.1 Write integration tests proving interactive setup browser open/close and profile locking.
- [x] 6.2 Write integration tests proving stale lock recovery.
- [x] 6.3 Write integration tests proving successful wake submission and SQLite record update using `MockBrowserDriver`.
- [x] 6.4 Write integration tests proving multiple repositories share browser process without cross-page interference.
- [x] 6.5 Run full workspace verification: typecheck, test, build, lint.

## 7. Advance and transition

- [x] 7.1 Fold/archive Milestone 4 once complete.
- [x] 7.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [x] 7.3 Create Milestone 5 OpenSpec (`005-autonomous-loop-engine`).
- [x] 7.4 Commit and push transition to `main` and continue.
