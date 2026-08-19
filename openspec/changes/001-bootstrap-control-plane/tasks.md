# Tasks: Bootstrap Control Plane

This checklist is the executable plan for Change 001. Complete roughly in order unless implementation evidence makes a small reorder safer.

A task is checked only when its acceptance intent is actually satisfied. Do not check tasks merely because files were created.

## 0. Preflight and recovery

- [x] 0.1 Read `AGENTS.md`, `.agent/state.json`, `docs/ROADMAP.md`, this change's proposal/spec/design/tasks, and focused contracts relevant to first slice.
- [x] 0.2 Inspect local/remote `main`, working tree, local-only commits, and pending merge/rebase/cherry-pick state before editing.
- [x] 0.3 Preserve/reconcile existing work rather than resetting/cleaning it away.
- [x] 0.4 Confirm `docs/TECH-BASELINE.md` is compatible with local toolchain; document material deviations before depending on them.
- [x] 0.5 Confirm V1 repository configuration is main-only and contains no branch field.
- [x] 0.6 Confirm static repository config contains no run goal/current actor/current iteration/process state.
- [x] 0.7 Confirm seeded `.gitattributes`, `.editorconfig`, `.gitignore`, and protocol schemas remain intentional.
- [x] 0.8 Confirm Change 001 networking target: shared UI uses relative `/api`; Vite proxies in dev; controller serves built SPA + API/WebSocket on one origin in built mode; Tailscale itself remains later scope.

### Checkpoint 0 exit

No unresolved foundational ambiguity remains for scaffolding.

---

## 1. Root workspace and tooling

- [x] 1.1 Create root `package.json` with npm workspaces for `apps/*` and `packages/*`.
- [x] 1.2 Set/document Node 24 LTS engine and npm expectation.
- [x] 1.3 Create packages for controller, UI, desktop, shared.
- [x] 1.4 Add strict base TypeScript config and package-specific boundaries.
- [x] 1.5 Establish one simple lint/format path; avoid redundant stacks.
- [x] 1.6 Establish Vitest-based TypeScript test pattern where practical.
- [x] 1.7 Add root `dev`, `build`, `typecheck`, `test`, `lint` scripts.
- [x] 1.8 Verify/extend seeded `.gitignore` for generated artifacts; never weaken DB/browser/auth/secret ignores and never ignore `.orca/` globally.
- [x] 1.9 Verify `.gitattributes`/`.editorconfig` survive scaffold generation and prevent Windows/WSL line-ending churn.
- [x] 1.10 Confirm `packages/shared` depends on no app package.
- [x] 1.11 Avoid Turborepo/Nx/ORM/DI/plugin-framework infrastructure absent concrete need.

### Verification 1

- [x] 1.V1 Fresh root `npm install` succeeds.
- [x] 1.V2 Root typecheck runs.
- [x] 1.V3 Root test command runs.
- [x] 1.V4 Root build command is wired.
- [x] 1.V5 Root lint command runs.
- [x] 1.V6 Install/build/test do not expose generated/runtime/secret files or line-ending churn in Git status.

---

## 2. Shared repository/API/event contracts

- [x] 2.1 Define stable opaque repository ID.
- [x] 2.2 Define runtime-safe `ExecutionEnvironment = "windows" | "wsl"`.
- [x] 2.3 Define persisted/read `RepositoryRecord` with exactly Change 001 fields.
- [x] 2.4 Define create-input model with ceiling defaults.
- [x] 2.5 Define patch model without client-writable ID/timestamps.
- [x] 2.6 Ensure no branch field exists in V1 repository schemas/API model.
- [x] 2.7 Ensure no current-run fields exist in static repository config.
- [x] 2.8 Defaults: max iterations 20; max runtime 480 minutes.
- [x] 2.9 Enforce non-empty display name, remote, path, executor CLI/model, Sol conversation URL.
- [x] 2.10 Enforce WSL distro for WSL; normalize it to null/unused for Windows.
- [x] 2.11 Validate positive integer ceilings.
- [x] 2.12 Validate supported ChatGPT conversation URL shape.
- [x] 2.13 Ensure no credential/API-key/browser-cookie fields.
- [x] 2.14 Define health response, CRUD envelopes, stable error envelope/codes, event envelope and repository mutation events.
- [x] 2.15 Export public contracts from small package entrypoint.
- [x] 2.16 Keep TypeScript and runtime validation mechanically aligned rather than duplicate ad-hoc validators.

### Tests 2

- [x] 2.T1 Valid Windows config.
- [x] 2.T2 Valid WSL config.
- [x] 2.T3 Missing WSL distro rejected.
- [x] 2.T4 Empty required fields rejected.
- [x] 2.T5 Invalid ceilings rejected.
- [x] 2.T6 Ceiling defaults correct.
- [x] 2.T7 Invalid Sol URL rejected.
- [x] 2.T8 Patch merged result revalidated.
- [x] 2.T9 Immutable identity/timestamps cannot be patched.
- [x] 2.T10 Branch input absent/rejected under V1 strategy.
- [x] 2.T11 Controller/UI can import shared contracts without circular app dependencies.

### Checkpoint 2 exit

Repository semantics are stable for SQL/API/UI.

---

## 3. Controller configuration and startup skeleton

- [x] 3.1 Create standalone controller entrypoint/app builder.
- [x] 3.2 Add config loader for host, port, data dir, log level, optional UI dist dir, environment.
- [x] 3.3 Default to loopback only and documented port baseline 47100 unless real conflict appears.
- [x] 3.4 Resolve normal Windows local app-data root.
- [x] 3.5 Support `ORCA_DATA_DIR` override for tests/dev.
- [x] 3.6 Add startup/fatal logging without secrets.
- [x] 3.7 Ensure controller starts independently of Vite/Electron.
- [x] 3.8 Ensure readiness not reported before required DB initialization.

### Verification 3

- [x] 3.V1 Controller starts on Windows.
- [x] 3.V2 Default listener loopback-only.
- [x] 3.V3 Test/dev data override works.
- [x] 3.V4 Fatal startup failure is clear and not falsely healthy.

---

## 4. SQLite migration and storage layer

- [x] 4.1 Confirm `node:sqlite` works; document smallest replacement first if a concrete blocker appears.
- [x] 4.2 Add DB open/close lifecycle.
- [x] 4.3 Add migration metadata/version mechanism and ordered runner.
- [x] 4.4 Make migration application transactional where practical and never record failed migration as applied.
- [x] 4.5 Add initial `repositories` migration with exactly static config fields from `docs/DATA-MODEL.md`.
- [x] 4.6 Do not add branch column.
- [x] 4.7 Do not add run-goal/current-state/iteration/PID columns.
- [x] 4.8 Add readable environment/ceiling DB constraints where useful.
- [x] 4.9 Implement row mapper and store `list/get/create/update/delete`.
- [x] 4.10 Keep raw SQL/driver rows behind storage layer.

### Tests 4

- [x] 4.T1 Fresh temp DB migrates.
- [x] 4.T2 Reopen idempotent.
- [x] 4.T3 CRUD round-trips and multiple records.
- [x] 4.T4 Update preserves ID/createdAt, advances updatedAt.
- [x] 4.T5 Invalid mutation does not partially corrupt row.
- [x] 4.T6 Close/reopen preserves records.
- [x] 4.T7 Tests never touch user DB.
- [x] 4.T8 Schema inspection proves no branch/run-state leakage.

---

## 5. Repository service and controller API

- [x] 5.1 Add repository service between HTTP handlers and storage.
- [x] 5.2 Apply validation/defaults before writes and generate IDs/timestamps in one layer.
- [x] 5.3 Add domain/not-found/internal error mapping without raw stack leakage.
- [x] 5.4 Initialize Fastify app/server.
- [x] 5.5 Implement `GET /api/health` after DB readiness.
- [x] 5.6 Implement repository list/create/get/patch/delete routes.
- [x] 5.7 Ensure invalid payloads never reach SQL writes.
- [x] 5.8 Keep handlers thin; no SQL in routes.
- [x] 5.9 Ensure serialized API contains no branch or runtime-only/secret data.

### Tests 5

- [x] 5.T1 Health readiness behavior.
- [x] 5.T2 Empty list.
- [x] 5.T3 Create/get round-trip.
- [x] 5.T4 Invalid WSL -> structured validation error.
- [x] 5.T5 Valid and invalid patch behavior.
- [x] 5.T6 Stable 404.
- [x] 5.T7 Delete behavior.
- [x] 5.T8 Internal failure does not leak raw stack.
- [x] 5.T9 Branch field absent/rejected.

---

## 6. Real-time event foundation

- [x] 6.1 Implement WebSocket endpoint at canonical `/api/events`.
- [x] 6.2 Add connection lifecycle sufficient for reconnect.
- [x] 6.3 Publish create/update/delete events only after persistence success.
- [x] 6.4 Include timestamp/repository identity sufficient for refetch.
- [x] 6.5 Keep events as sync hints; no durable replay/event sourcing.

### Tests 6

- [x] 6.T1 Create/update/delete events received.
- [x] 6.T2 Failed mutation emits no false success event.
- [x] 6.T3 Reconnected client can refetch authoritative state.

---

## 7. React/Vite UI and same-origin client foundation

- [x] 7.1 Scaffold React/Vite/TypeScript UI.
- [x] 7.2 Add Tailwind and only shadcn primitives actually used.
- [x] 7.3 Create app shell/navigation appropriate for wide and narrow layouts.
- [x] 7.4 Add typed API client using relative `/api/*` paths; do not hard-code production localhost host.
- [x] 7.5 Add WebSocket client deriving `ws:`/`wss:` and host from current page origin.
- [x] 7.6 Configure Vite dev proxy for `/api/*` and `/api/events` WebSocket to controller.
- [x] 7.7 Add controller health states (`connecting`, `connected`, `disconnected/error`).
- [x] 7.8 Add event reconnect/refetch behavior.
- [x] 7.9 Ensure UI remains usable when controller offline.
- [x] 7.10 Avoid controller-source/SQLite imports and duplicated component-level networking logic.

### Tests 7

- [x] 7.T1 Relative REST route construction.
- [x] 7.T2 HTTP page yields same-origin `ws:` event URL.
- [x] 7.T3 HTTPS synthetic page origin yields same-origin `wss:` event URL.
- [x] 7.T4 No production client behavior requires `127.0.0.1`/`localhost` API host.
- [x] 7.T5 Vite proxy smoke proves same client works in development.

---

## 8. Repository dashboard and configuration UX

- [x] 8.1 Build dashboard/list/card and useful empty state.
- [x] 8.2 Render multiple repositories independently.
- [x] 8.3 Display real configuration only; do not fake runtime execution state.
- [x] 8.4 Do not add branch selector/control; `main` automatic.
- [x] 8.5 Add detail route/view.
- [x] 8.6 Build Add/Edit form with display name, remote, environment, path, optional/required WSL distro, executor CLI/model, Sol URL, ceilings.
- [x] 8.7 Preserve form input after recoverable server validation errors and show authoritative errors clearly.
- [x] 8.8 Add explicit delete with confirmation.
- [x] 8.9 Do not implement functioning Start/Pause/Sol/Executor controls.

### Responsive acceptance 8

- [x] 8.R1 Core dashboard works ~360–430px without required horizontal scrolling.
- [x] 8.R2 Form stacks sensibly.
- [x] 8.R3 Detail readable.
- [x] 8.R4 Primary navigation/action reachable.

### Tests 8

- [x] 8.T1 Multiple repos and empty state.
- [x] 8.T2 Offline distinct from empty.
- [x] 8.T3 Windows and WSL form behavior.
- [x] 8.T4 Server validation preserves input.
- [x] 8.T5 Edit/delete flows.
- [x] 8.T6 No branch input rendered.

---

## 9. Controller-served built SPA

- [x] 9.1 Add minimal static serving for known UI build directory in production-like mode.
- [x] 9.2 Reserve `/api/*` and `/api/events` before SPA fallback.
- [x] 9.3 Serve `/assets/*` from build output only; no directory browsing.
- [x] 9.4 Add SPA history fallback for non-API client routes such as `/repositories/:id`.
- [x] 9.5 Ensure data directory, SQLite, logs, browser-profile, environment files, and arbitrary local paths cannot be served.
- [x] 9.6 Avoid wildcard CORS; built flow is same-origin.
- [x] 9.7 Add practical production-like local command/smoke path: build UI, start controller serving it, open/use browser without Vite.

### Tests 9

- [x] 9.T1 `/` serves SPA.
- [x] 9.T2 known asset serves correctly.
- [x] 9.T3 deep-link route serves SPA shell.
- [x] 9.T4 `/api/health` remains API and is never SPA HTML.
- [x] 9.T5 unknown `/api/*` is not converted to SPA shell.
- [x] 9.T6 runtime-data paths not statically accessible.
- [x] 9.T7 same-origin REST and WebSocket work from built UI.

---

## 10. Electron Windows shell

- [x] 10.1 Scaffold Electron main process.
- [x] 10.2 Configure BrowserWindow with `contextIsolation: true` and safe baseline.
- [x] 10.3 Do not enable broad renderer Node integration for controller/storage access.
- [x] 10.4 Load Vite UI in development.
- [x] 10.5 In built/local mode prefer loading controller-served Orca origin.
- [x] 10.6 Keep Electron free of direct SQLite/repository persistence ownership.
- [x] 10.7 Tolerate controller-unavailable state.
- [x] 10.8 Ensure close/reopen BrowserWindow does not erase controller data.

### Verification 10

- [x] 10.V1 Electron launches on Windows.
- [x] 10.V2 Same dashboard works inside Electron.
- [x] 10.V3 CRUD goes through controller API.
- [x] 10.V4 Close/reopen Electron while controller persists; data remains.

---

## 11. Root workflow and documentation

- [x] 11.1 Add practical root dev command coordinating controller + Vite + Electron.
- [x] 11.2 Ensure controller can still start independently.
- [x] 11.3 Document runtime prerequisites, install, dev, build, typecheck, test, lint.
- [x] 11.4 Document local SQLite/runtime data location and test/dev override.
- [x] 11.5 Document Change 001 is configuration/control-plane only.
- [x] 11.6 Document V1 automatically uses `main` and branch config deferred.
- [x] 11.7 Document same-origin runtime seam and that Tailscale configuration is later scope.
- [x] 11.8 Ensure docs never instruct committing browser/session/database secrets.

---

## 12. End-to-end Change 001 acceptance

- [x] 12.1 Fresh dependency install.
- [x] 12.2 Start controller independently; health ready.
- [x] 12.3 Start full dev stack and verify Vite relative API/event proxy.
- [x] 12.4 Create one Windows and one WSL repository via UI.
- [x] 12.5 Verify list/detail/edit/delete/persistence through restart.
- [x] 12.6 Close/reopen Electron while controller remains; data remains.
- [x] 12.7 Exercise narrow phone-like viewport.
- [x] 12.8 Build UI and run controller-served production-like web mode without Vite.
- [x] 12.9 Directly reload a client deep link and verify SPA fallback.
- [x] 12.10 Verify same-origin REST/WebSocket in built mode.
- [x] 12.11 Verify controller loopback-only.
- [x] 12.12 Confirm API/DB/UI contain no configurable branch field.
- [x] 12.13 Confirm DB/config contain no active-run state fields.
- [x] 12.14 Confirm static server cannot expose runtime data.
- [x] 12.15 Confirm install/build/test/runtime artifacts remain clean under seeded hygiene.
- [x] 12.16 Run root typecheck/test/build/lint and fix introduced regressions or record truthful blockers.

---

## 13. Completion and review handoff

- [x] 13.1 Reconcile implementation against final delta spec/design, not only checkboxes.
- [x] 13.2 Update all checkboxes accurately.
- [x] 13.3 Record concise final verification evidence in waypoint.
- [x] 13.4 Commit/push all intended work to `main`.
- [x] 13.5 Set `.agent/state.json` to `READY_FOR_REVIEW` with precise checkpoint/next action.
- [ ] 13.6 Stop for deep Sol/ChatGPT GitHub review before Change 002.
- [ ] 13.7 After review acceptance, fold/archive Change 001 delta into canonical `openspec/specs/` and advance roadmap/state.

### Final exit gate

Change 001 is not accepted merely because app launches. Review must confirm controller/Electron ownership, minimal main-only static config, Windows/WSL semantics, deterministic persistence/API/events, same-origin UI/API/WebSocket seam, responsive UI, security/hygiene, and absence of premature automation.
