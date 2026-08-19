# Tasks: Playwright Sol Bridge

Implement Milestone 4 browser automation, persistent profile locking, interactive setup browser, and input-only ChatGPT Sol wake submission.

## 1. Protocol contracts and wake message generation

- [ ] 1.1 Define `generateSolWakeMessage` in `@orca/shared` matching `docs/CROSS-AGENT-PROTOCOL.md`.
- [ ] 1.2 Add TypeScript types and schemas for `SolWakeRecord` and `BrowserStatus`.
- [ ] 1.3 Add unit tests for wake message generation and validation in `packages/shared`.

## 2. SQLite storage additions

- [ ] 2.1 Add migration `004_create_sol_wakes` for `sol_wakes` table.
- [ ] 2.2 Implement `SolWakeStore` in `apps/controller` for tracking wake submissions and statuses.
- [ ] 2.3 Add unit tests for `SolWakeStore` CRUD and migration rollback.

## 3. Profile lock manager and browser driver

- [ ] 3.1 Implement `ProfileLockManager` with PID liveness checks and stale-lock recovery.
- [ ] 3.2 Define `BrowserDriver` interface and implement `PlaywrightDriver` with persistent context.
- [ ] 3.3 Implement `MockBrowserDriver` for deterministic testing.
- [ ] 3.4 Add unit tests for `ProfileLockManager`.

## 4. Sol wake submitter and browser manager

- [ ] 4.1 Implement `SolWakeSubmitter` handling navigation, composer typing, and send verification.
- [ ] 4.2 Implement `BrowserManager` managing persistent browser lifecycle and page multiplexing.
- [ ] 4.3 Handle busy states, Cloudflare interstitials, and modal dialogs with backoff.
- [ ] 4.4 Emit real-time WebSocket events (`browser.started`, `browser.stopped`, `sol.wake_submitted`, `sol.wake_failed`).

## 5. REST endpoints and controller integration

- [ ] 5.1 Add REST endpoints: `GET /api/browser/status`, `POST /api/browser/setup/open`, `POST /api/browser/setup/close`, `POST /api/repositories/:id/wake`.
- [ ] 5.2 Integrate `BrowserManager` and `SolWakeStore` into controller lifecycle in `apps/controller/src/app.ts`.

## 6. Integration tests and qualification

- [ ] 6.1 Write integration tests proving interactive setup browser open/close and profile locking.
- [ ] 6.2 Write integration tests proving stale lock recovery.
- [ ] 6.3 Write integration tests proving successful wake submission and SQLite record update using `MockBrowserDriver`.
- [ ] 6.4 Write integration tests proving multiple repositories share browser process without cross-page interference.
- [ ] 6.5 Run full workspace verification: typecheck, test, build, lint.

## 7. Advance and transition

- [ ] 7.1 Fold/archive Milestone 4 once complete.
- [ ] 7.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [ ] 7.3 Create Milestone 5 OpenSpec (`005-autonomous-loop-engine`).
- [ ] 7.4 Commit and push transition to `main` and continue.
