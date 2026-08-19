# Tasks: Private Phone Access and Notifications

Implement Milestone 7 mobile responsive UI, Tailscale Serve system guidance, and notification routing.

## 1. System and Tailscale guidance endpoint

- [ ] 1.1 Add `GET /api/system/tailscale` endpoint in `apps/controller/src/http/routes/system.ts`.
- [ ] 1.2 Register system routes in `apps/controller/src/app.ts`.
- [ ] 1.3 Add tests for `GET /api/system/tailscale`.

## 2. Notification manager and alert routing

- [ ] 2.1 Implement `shouldNotifyEvent` in `@orca/shared` matching notification-worthy baseline.
- [ ] 2.2 Add unit tests for notification criteria in `packages/shared`.

## 3. Responsive UI and mobile run controls

- [ ] 3.1 Enhance `RepositoryList` and `RepositoryDetail` in `apps/ui` with mobile run controls (Start, Pause, Resume, Stop, Recover).
- [ ] 3.2 Add Tailscale setup banner in UI.
- [ ] 3.3 Add component tests in `apps/ui/test/` for mobile controls and notification triggering.

## 4. Integration tests and qualification

- [ ] 4.1 Write integration tests proving same-origin relative `/api` and WebSocket event handling on mobile viewport.
- [ ] 4.2 Write integration tests proving notification filtering logic.
- [ ] 4.3 Run full workspace verification: typecheck, test, build, lint.

## 5. Advance and transition

- [ ] 5.1 Fold/archive Milestone 7 once complete.
- [ ] 5.2 Update `docs/ROADMAP.md` and `.agent/state.json`.
- [ ] 5.3 Create Milestone 8 OpenSpec (`008-end-to-end-autonomy-qualification`).
- [ ] 5.4 Commit and push transition to `main` and continue.
