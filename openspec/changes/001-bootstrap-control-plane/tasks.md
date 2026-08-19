# Tasks: Bootstrap Control Plane

This checklist is the executable plan for Change 001. Complete roughly in order unless implementation evidence makes a small reorder safer.

A task is checked only when its acceptance intent is actually satisfied. Do not check tasks merely because files were created.

## 0. Preflight and recovery

- [ ] 0.1 Read `AGENTS.md`, `.agent/state.json`, `docs/ROADMAP.md`, this change's proposal/spec/design/tasks, and focused contracts relevant to first slice.
- [ ] 0.2 Inspect local/remote `main`, working tree, local-only commits, and pending merge/rebase/cherry-pick state before editing.
- [ ] 0.3 Preserve/reconcile existing work rather than resetting/cleaning it away.
- [ ] 0.4 Confirm `docs/TECH-BASELINE.md` is compatible with local toolchain; document material deviations before depending on them.
- [ ] 0.5 Confirm V1 repository configuration is main-only and contains no branch field.
- [ ] 0.6 Confirm static repository config contains no run goal/current actor/current iteration/process state.
- [ ] 0.7 Confirm seeded `.gitattributes`, `.editorconfig`, `.gitignore`, and protocol schemas remain intentional.
- [ ] 0.8 Confirm Change 001 networking target: shared UI uses relative `/api`; Vite proxies in dev; controller serves built SPA + API/WebSocket on one origin in built mode; Tailscale itself remains later scope.

### Checkpoint 0 exit

No unresolved foundational ambiguity remains for scaffolding.

---

## 1. Root workspace and tooling

- [ ] 1.1 Create root `package.json` with npm workspaces for `apps/*` and `packages/*`.
- [ ] 1.2 Set/document Node 24 LTS engine and npm expectation.
- [ ] 1.3 Create packages for controller, UI, desktop, shared.
- [ ] 1.4 Add strict base TypeScript config and package-specific boundaries.
- [ ] 1.5 Establish one simple lint/format path; avoid redundant stacks.
- [ ] 1.6 Establish Vitest-based TypeScript test pattern where practical.
- [ ] 1.7 Add root `dev`, `build`, `typecheck`, `test`, `lint` scripts.
- [ ] 1.8 Verify/extend seeded `.gitignore` for generated artifacts; never weaken DB/browser/auth/secret ignores and never ignore `.orca/` globally.
- [ ] 1.9 Verify `.gitattributes`/`.editorconfig` survive scaffold generation and prevent Windows/WSL line-ending churn.
- [ ] 1.10 Confirm `packages/shared` depends on no app package.
- [ ] 1.11 Avoid Turborepo/Nx/ORM/DI/plugin-framework infrastructure absent concrete need.

### Verification 1

- [ ] 1.V1 Fresh root `npm install` succeeds.
- [ ] 1.V2 Root typecheck runs.
- [ ] 1.V3 Root test command runs.
- [ ] 1.V4 Root build command is wired.
- [ ] 1.V5 Root lint command runs.
- [ ] 1.V6 Install/build/test do not expose generated/runtime/secret files or line-ending churn in Git status.

---

## 2. Shared repository/API/event contracts

- [ ] 2.1 Define stable opaque repository ID.
- [ ] 2.2 Define runtime-safe `ExecutionEnvironment = "windows" | "wsl"`.
- [ ] 2.3 Define persisted/read `RepositoryRecord` with exactly Change 001 fields.
- [ ] 2.4 Define create-input model with ceiling defaults.
- [ ] 2.5 Define patch model without client-writable ID/timestamps.
- [ ] 2.6 Ensure no branch field exists in V1 repository schemas/API model.
- [ ] 2.7 Ensure no current-run fields exist in static repository config.
- [ ] 2.8 Defaults: max iterations 20; max runtime 480 minutes.
- [ ] 2.9 Enforce non-empty display name, remote, path, executor CLI/model, Sol conversation URL.
- [ ] 2.10 Enforce WSL distro for WSL; normalize it to null/unused for Windows.
- [ ] 2.11 Validate positive integer ceilings.
- [ ] 2.12 Validate supported ChatGPT conversation URL shape.
- [ ] 2.13 Ensure no credential/API-key/browser-cookie fields.
- [ ] 2.14 Define health response, CRUD envelopes, stable error envelope/codes, event envelope and repository mutation events.
- [ ] 2.15 Export public contracts from small package entrypoint.
- [ ] 2.16 Keep TypeScript and runtime validation mechanically aligned rather than duplicate ad-hoc validators.

### Tests 2

- [ ] 2.T1 Valid Windows config.
- [ ] 2.T2 Valid WSL config.
- [ ] 2.T3 Missing WSL distro rejected.
- [ ] 2.T4 Empty required fields rejected.
- [ ] 2.T5 Invalid ceilings rejected.
- [ ] 2.T6 Ceiling defaults correct.
- [ ] 2.T7 Invalid Sol URL rejected.
- [ ] 2.T8 Patch merged result revalidated.
- [ ] 2.T9 Immutable identity/timestamps cannot be patched.
- [ ] 2.T10 Branch input absent/rejected under V1 strategy.
- [ ] 2.T11 Controller/UI can import shared contracts without circular app dependencies.

### Checkpoint 2 exit

Repository semantics are stable for SQL/API/UI.

---

## 3. Controller configuration and startup skeleton

- [ ] 3.1 Create standalone controller entrypoint/app builder.
- [ ] 3.2 Add config loader for host, port, data dir, log level, optional UI dist dir, environment.
- [ ] 3.3 Default to loopback only and documented port baseline 47100 unless real conflict appears.
- [ ] 3.4 Resolve normal Windows local app-data root.
- [ ] 3.5 Support `ORCA_DATA_DIR` override for tests/dev.
- [ ] 3.6 Add startup/fatal logging without secrets.
- [ ] 3.7 Ensure controller starts independently of Vite/Electron.
- [ ] 3.8 Ensure readiness not reported before required DB initialization.

### Verification 3

- [ ] 3.V1 Controller starts on Windows.
- [ ] 3.V2 Default listener loopback-only.
- [ ] 3.V3 Test/dev data override works.
- [ ] 3.V4 Fatal startup failure is clear and not falsely healthy.

---

## 4. SQLite migration and storage layer

- [ ] 4.1 Confirm `node:sqlite` works; document smallest replacement first if a concrete blocker appears.
- [ ] 4.2 Add DB open/close lifecycle.
- [ ] 4.3 Add migration metadata/version mechanism and ordered runner.
- [ ] 4.4 Make migration application transactional where practical and never record failed migration as applied.
- [ ] 4.5 Add initial `repositories` migration with exactly static config fields from `docs/DATA-MODEL.md`.
- [ ] 4.6 Do not add branch column.
- [ ] 4.7 Do not add run-goal/current-state/iteration/PID columns.
- [ ] 4.8 Add readable environment/ceiling DB constraints where useful.
- [ ] 4.9 Implement row mapper and store `list/get/create/update/delete`.
- [ ] 4.10 Keep raw SQL/driver rows behind storage layer.

### Tests 4

- [ ] 4.T1 Fresh temp DB migrates.
- [ ] 4.T2 Reopen idempotent.
- [ ] 4.T3 CRUD round-trips and multiple records.
- [ ] 4.T4 Update preserves ID/createdAt, advances updatedAt.
- [ ] 4.T5 Invalid mutation does not partially corrupt row.
- [ ] 4.T6 Close/reopen preserves records.
- [ ] 4.T7 Tests never touch user DB.
- [ ] 4.T8 Schema inspection proves no branch/run-state leakage.

---

## 5. Repository service and controller API

- [ ] 5.1 Add repository service between HTTP handlers and storage.
- [ ] 5.2 Apply validation/defaults before writes and generate IDs/timestamps in one layer.
- [ ] 5.3 Add domain/not-found/internal error mapping without raw stack leakage.
- [ ] 5.4 Initialize Fastify app/server.
- [ ] 5.5 Implement `GET /api/health` after DB readiness.
- [ ] 5.6 Implement repository list/create/get/patch/delete routes.
- [ ] 5.7 Ensure invalid payloads never reach SQL writes.
- [ ] 5.8 Keep handlers thin; no SQL in routes.
- [ ] 5.9 Ensure serialized API contains no branch or runtime-only/secret data.

### Tests 5

- [ ] 5.T1 Health readiness behavior.
- [ ] 5.T2 Empty list.
- [ ] 5.T3 Create/get round-trip.
- [ ] 5.T4 Invalid WSL -> structured validation error.
- [ ] 5.T5 Valid and invalid patch behavior.
- [ ] 5.T6 Stable 404.
- [ ] 5.T7 Delete behavior.
- [ ] 5.T8 Internal failure does not leak raw stack.
- [ ] 5.T9 Branch field absent/rejected.

---

## 6. Real-time event foundation

- [ ] 6.1 Implement WebSocket endpoint at canonical `/api/events`.
- [ ] 6.2 Add connection lifecycle sufficient for reconnect.
- [ ] 6.3 Publish create/update/delete events only after persistence success.
- [ ] 6.4 Include timestamp/repository identity sufficient for refetch.
- [ ] 6.5 Keep events as sync hints; no durable replay/event sourcing.

### Tests 6

- [ ] 6.T1 Create/update/delete events received.
- [ ] 6.T2 Failed mutation emits no false success event.
- [ ] 6.T3 Reconnected client can refetch authoritative state.

---

## 7. React/Vite UI and same-origin client foundation

- [ ] 7.1 Scaffold React/Vite/TypeScript UI.
- [ ] 7.2 Add Tailwind and only shadcn primitives actually used.
- [ ] 7.3 Create app shell/navigation appropriate for wide and narrow layouts.
- [ ] 7.4 Add typed API client using relative `/api/*` paths; do not hard-code production localhost host.
- [ ] 7.5 Add WebSocket client deriving `ws:`/`wss:` and host from current page origin.
- [ ] 7.6 Configure Vite dev proxy for `/api/*` and `/api/events` WebSocket to controller.
- [ ] 7.7 Add controller health states (`connecting`, `connected`, `disconnected/error`).
- [ ] 7.8 Add event reconnect/refetch behavior.
- [ ] 7.9 Ensure UI remains usable when controller offline.
- [ ] 7.10 Avoid controller-source/SQLite imports and duplicated component-level networking logic.

### Tests 7

- [ ] 7.T1 Relative REST route construction.
- [ ] 7.T2 HTTP page yields same-origin `ws:` event URL.
- [ ] 7.T3 HTTPS synthetic page origin yields same-origin `wss:` event URL.
- [ ] 7.T4 No production client behavior requires `127.0.0.1`/`localhost` API host.
- [ ] 7.T5 Vite proxy smoke proves same client works in development.

---

## 8. Repository dashboard and configuration UX

- [ ] 8.1 Build dashboard/list/card and useful empty state.
- [ ] 8.2 Render multiple repositories independently.
- [ ] 8.3 Display real configuration only; do not fake runtime execution state.
- [ ] 8.4 Do not add branch selector/control; `main` automatic.
- [ ] 8.5 Add detail route/view.
- [ ] 8.6 Build Add/Edit form with display name, remote, environment, path, optional/required WSL distro, executor CLI/model, Sol URL, ceilings.
- [ ] 8.7 Preserve form input after recoverable server validation errors and show authoritative errors clearly.
- [ ] 8.8 Add explicit delete with confirmation.
- [ ] 8.9 Do not implement functioning Start/Pause/Sol/Executor controls.

### Responsive acceptance 8

- [ ] 8.R1 Core dashboard works ~360–430px without required horizontal scrolling.
- [ ] 8.R2 Form stacks sensibly.
- [ ] 8.R3 Detail readable.
- [ ] 8.R4 Primary navigation/action reachable.

### Tests 8

- [ ] 8.T1 Multiple repos and empty state.
- [ ] 8.T2 Offline distinct from empty.
- [ ] 8.T3 Windows and WSL form behavior.
- [ ] 8.T4 Server validation preserves input.
- [ ] 8.T5 Edit/delete flows.
- [ ] 8.T6 No branch input rendered.

---

## 9. Controller-served built SPA

- [ ] 9.1 Add minimal static serving for known UI build directory in production-like mode.
- [ ] 9.2 Reserve `/api/*` and `/api/events` before SPA fallback.
- [ ] 9.3 Serve `/assets/*` from build output only; no directory browsing.
- [ ] 9.4 Add SPA history fallback for non-API client routes such as `/repositories/:id`.
- [ ] 9.5 Ensure data directory, SQLite, logs, browser-profile, environment files, and arbitrary local paths cannot be served.
- [ ] 9.6 Avoid wildcard CORS; built flow is same-origin.
- [ ] 9.7 Add practical production-like local command/smoke path: build UI, start controller serving it, open/use browser without Vite.

### Tests 9

- [ ] 9.T1 `/` serves SPA.
- [ ] 9.T2 known asset serves correctly.
- [ ] 9.T3 deep-link route serves SPA shell.
- [ ] 9.T4 `/api/health` remains API and is never SPA HTML.
- [ ] 9.T5 unknown `/api/*` is not converted to SPA shell.
- [ ] 9.T6 runtime-data paths not statically accessible.
- [ ] 9.T7 same-origin REST and WebSocket work from built UI.

---

## 10. Electron Windows shell

- [ ] 10.1 Scaffold Electron main process.
- [ ] 10.2 Configure BrowserWindow with `contextIsolation: true` and safe baseline.
- [ ] 10.3 Do not enable broad renderer Node integration for controller/storage access.
- [ ] 10.4 Load Vite UI in development.
- [ ] 10.5 In built/local mode prefer loading controller-served Orca origin.
- [ ] 10.6 Keep Electron free of direct SQLite/repository persistence ownership.
- [ ] 10.7 Tolerate controller-unavailable state.
- [ ] 10.8 Ensure close/reopen BrowserWindow does not erase controller data.

### Verification 10

- [ ] 10.V1 Electron launches on Windows.
- [ ] 10.V2 Same dashboard works inside Electron.
- [ ] 10.V3 CRUD goes through controller API.
- [ ] 10.V4 Close/reopen Electron while controller persists; data remains.

---

## 11. Root workflow and documentation

- [ ] 11.1 Add practical root dev command coordinating controller + Vite + Electron.
- [ ] 11.2 Ensure controller can still start independently.
- [ ] 11.3 Document runtime prerequisites, install, dev, build, typecheck, test, lint.
- [ ] 11.4 Document local SQLite/runtime data location and test/dev override.
- [ ] 11.5 Document Change 001 is configuration/control-plane only.
- [ ] 11.6 Document V1 automatically uses `main` and branch config deferred.
- [ ] 11.7 Document same-origin runtime seam and that Tailscale configuration is later scope.
- [ ] 11.8 Ensure docs never instruct committing browser/session/database secrets.

---

## 12. End-to-end Change 001 acceptance

- [ ] 12.1 Fresh dependency install.
- [ ] 12.2 Start controller independently; health ready.
- [ ] 12.3 Start full dev stack and verify Vite relative API/event proxy.
- [ ] 12.4 Create one Windows and one WSL repository via UI.
- [ ] 12.5 Verify list/detail/edit/delete/persistence through restart.
- [ ] 12.6 Close/reopen Electron while controller remains; data remains.
- [ ] 12.7 Exercise narrow phone-like viewport.
- [ ] 12.8 Build UI and run controller-served production-like web mode without Vite.
- [ ] 12.9 Directly reload a client deep link and verify SPA fallback.
- [ ] 12.10 Verify same-origin REST/WebSocket in built mode.
- [ ] 12.11 Verify controller loopback-only.
- [ ] 12.12 Confirm API/DB/UI contain no configurable branch field.
- [ ] 12.13 Confirm DB/config contain no active-run state fields.
- [ ] 12.14 Confirm static server cannot expose runtime data.
- [ ] 12.15 Confirm install/build/test/runtime artifacts remain clean under seeded hygiene.
- [ ] 12.16 Run root typecheck/test/build/lint and fix introduced regressions or record truthful blockers.

---

## 13. Completion and review handoff

- [ ] 13.1 Reconcile implementation against final delta spec/design, not only checkboxes.
- [ ] 13.2 Update all checkboxes accurately.
- [ ] 13.3 Record concise final verification evidence in waypoint.
- [ ] 13.4 Commit/push all intended work to `main`.
- [ ] 13.5 Set `.agent/state.json` to `READY_FOR_REVIEW` with precise checkpoint/next action.
- [ ] 13.6 Stop for deep Sol/ChatGPT GitHub review before Change 002.
- [ ] 13.7 After review acceptance, fold/archive Change 001 delta into canonical `openspec/specs/` and advance roadmap/state.

### Final exit gate

Change 001 is not accepted merely because app launches. Review must confirm controller/Electron ownership, minimal main-only static config, Windows/WSL semantics, deterministic persistence/API/events, same-origin UI/API/WebSocket seam, responsive UI, security/hygiene, and absence of premature automation.
