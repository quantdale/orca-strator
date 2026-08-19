# Tasks: Bootstrap Control Plane

This checklist is the executable plan for Change 001. Complete in roughly this order unless implementation evidence makes a small reorder safer.

A task is checked only when its acceptance intent is actually satisfied.

## 0. Preflight and baseline

- [ ] 0.1 Read `AGENTS.md`, `docs/DEVELOPMENT.md`, `.agent/state.json`, proposal, delta spec, and design before coding.
- [ ] 0.2 Inspect local/remote `main` and preserve/reconcile any existing work before scaffolding.
- [ ] 0.3 Confirm the repository still has no implementation constraints that contradict the Change 001 design.
- [ ] 0.4 Select/document the supported Node runtime requirement based on a currently supported LTS suitable for the chosen SQLite implementation.
- [ ] 0.5 Record any implementation-time design adjustment in `design.md` rather than silently diverging.

### Checkpoint 0 exit

A fresh implementation session understands the exact stack/runtime choice and can begin scaffolding without unresolved foundational ambiguity.

---

## 1. Root workspace and tooling

- [ ] 1.1 Create root `package.json` with npm workspaces for `apps/*` and `packages/*`.
- [ ] 1.2 Add root `engines`/runtime requirement and package-manager expectation.
- [ ] 1.3 Create `apps/controller/package.json`.
- [ ] 1.4 Create `apps/ui/package.json`.
- [ ] 1.5 Create `apps/desktop/package.json`.
- [ ] 1.6 Create `packages/shared/package.json`.
- [ ] 1.7 Add root/base TypeScript configuration with strict settings.
- [ ] 1.8 Add package-specific TypeScript configs/build boundaries.
- [ ] 1.9 Establish one simple lint/format convention; avoid redundant tooling.
- [ ] 1.10 Establish one TypeScript test runner/workspace pattern where practical.
- [ ] 1.11 Add root scripts for `dev`, `build`, `typecheck`, `test`, and `lint` (script names may use normal npm conventions but must be documented).
- [ ] 1.12 Add `.gitignore` entries for dependencies/build output/local DB/runtime data/browser profiles/logs as applicable.
- [ ] 1.13 Confirm package dependency direction does not make `shared` depend on app packages.

### Verification 1

- [ ] 1.V1 Fresh `npm install` succeeds from root.
- [ ] 1.V2 Root typecheck command executes across the scaffold without undocumented package steps.
- [ ] 1.V3 Root test command executes even if test suites are initially minimal.
- [ ] 1.V4 Root build entrypoint is wired for all buildable packages.

### Checkpoint 1 exit

Workspace/tooling is committed in a coherent state; later tasks can build on stable package names/scripts.

---

## 2. Shared repository/API/event contracts

- [ ] 2.1 Define stable repository ID type/creation approach.
- [ ] 2.2 Define `ExecutionEnvironment = windows | wsl` runtime-safe contract.
- [ ] 2.3 Define repository persisted/read model.
- [ ] 2.4 Define repository create-input model with defaults.
- [ ] 2.5 Define repository update/patch model without allowing accidental immutable-ID replacement.
- [ ] 2.6 Define branch default `main`.
- [ ] 2.7 Define default max iterations = 20.
- [ ] 2.8 Define default max runtime = 480 minutes.
- [ ] 2.9 Enforce required display name, remote, path, executor CLI, executor model, and Sol conversation URL.
- [ ] 2.10 Enforce WSL distribution when environment is WSL.
- [ ] 2.11 Ensure Windows configuration does not require WSL distribution.
- [ ] 2.12 Validate positive integer ceilings.
- [ ] 2.13 Validate supported ChatGPT Sol conversation URL form.
- [ ] 2.14 Ensure repository schema contains no credential/API-key/browser-cookie fields.
- [ ] 2.15 Define health response contract.
- [ ] 2.16 Define repository API request/response/envelope contracts.
- [ ] 2.17 Define stable API error envelope and initial error codes.
- [ ] 2.18 Define real-time event envelope.
- [ ] 2.19 Define initial `repository.created`, `repository.updated`, and `repository.deleted` event contracts.
- [ ] 2.20 Export public shared contracts from a small package entrypoint.

### Tests 2

- [ ] 2.T1 Valid Windows configuration test.
- [ ] 2.T2 Valid WSL configuration test.
- [ ] 2.T3 Missing WSL distribution rejection.
- [ ] 2.T4 Empty/whitespace required fields rejection.
- [ ] 2.T5 Invalid/non-positive ceilings rejection.
- [ ] 2.T6 Create defaults applied correctly.
- [ ] 2.T7 Invalid Sol conversation URL rejected.
- [ ] 2.T8 Update/patch resulting object is revalidated.
- [ ] 2.T9 Typecheck proves controller/UI can import shared contracts without circular app dependencies.

### Checkpoint 2 exit

Repository configuration semantics are stable enough for SQL/API/UI to depend on them.

---

## 3. Controller configuration and startup skeleton

- [ ] 3.1 Create standalone controller entrypoint.
- [ ] 3.2 Add controller configuration loader for host, port, data directory, and environment overrides.
- [ ] 3.3 Default host to loopback only (`127.0.0.1` or equivalent documented loopback binding).
- [ ] 3.4 Choose/document a stable default controller port.
- [ ] 3.5 Resolve a normal Windows user-local application data directory for runtime persistence.
- [ ] 3.6 Support `ORCA_DATA_DIR` or equivalent override for development/tests.
- [ ] 3.7 Add basic startup/fatal-error logging without secrets.
- [ ] 3.8 Ensure controller can start independently of Vite/Electron.

### Verification 3

- [ ] 3.V1 Controller process starts on Windows from the documented command.
- [ ] 3.V2 Default listener is loopback-only.
- [ ] 3.V3 Test/dev data directory override works.

---

## 4. SQLite migration and storage layer

- [ ] 4.1 Confirm/select the smallest reliable SQLite implementation for the chosen Node runtime; document any deviation from the preferred built-in approach.
- [ ] 4.2 Add database open/close lifecycle.
- [ ] 4.3 Add migration metadata table/version mechanism.
- [ ] 4.4 Add ordered migration runner.
- [ ] 4.5 Ensure migrations are transactional where supported/appropriate.
- [ ] 4.6 Ensure failed migration is not marked successfully applied.
- [ ] 4.7 Add initial repositories-table migration.
- [ ] 4.8 Include stable ID, display name, remote, local path, branch, environment, WSL distribution, executor CLI/model, Sol URL, ceilings, timestamps.
- [ ] 4.9 Add readable DB constraints for environment/positive ceilings where useful.
- [ ] 4.10 Implement DB row -> shared-domain mapping.
- [ ] 4.11 Implement repository store `list`.
- [ ] 4.12 Implement repository store `get`.
- [ ] 4.13 Implement repository store `create`.
- [ ] 4.14 Implement repository store `update`.
- [ ] 4.15 Implement repository store `delete`.
- [ ] 4.16 Keep raw SQL/driver rows behind the controller storage layer.

### Tests 4

- [ ] 4.T1 Fresh temporary DB initializes and applies migrations.
- [ ] 4.T2 Reopening current DB is idempotent.
- [ ] 4.T3 Repository create/read round-trip.
- [ ] 4.T4 List multiple repositories.
- [ ] 4.T5 Update preserves ID/created timestamp and advances updated timestamp.
- [ ] 4.T6 Delete removes record.
- [ ] 4.T7 Close/reopen preserves records.
- [ ] 4.T8 Tests prove user runtime DB path is not touched.

### Checkpoint 4 exit

SQLite persistence is independently testable before HTTP/UI are added.

---

## 5. Repository service and controller API

- [ ] 5.1 Add repository service between HTTP handlers and storage.
- [ ] 5.2 Apply runtime validation/defaults before writes.
- [ ] 5.3 Generate stable repository IDs/timestamps in one clear layer.
- [ ] 5.4 Add not-found/domain error type/code.
- [ ] 5.5 Add internal/persistence error mapping without leaking raw stack traces to normal API clients.
- [ ] 5.6 Initialize the selected small HTTP framework/server.
- [ ] 5.7 Implement `GET /api/health` after DB readiness.
- [ ] 5.8 Implement `GET /api/repositories`.
- [ ] 5.9 Implement `POST /api/repositories`.
- [ ] 5.10 Implement `GET /api/repositories/:id`.
- [ ] 5.11 Implement `PATCH /api/repositories/:id`.
- [ ] 5.12 Implement `DELETE /api/repositories/:id`.
- [ ] 5.13 Return one stable error envelope for validation/not-found/internal failures.
- [ ] 5.14 Ensure invalid payloads never reach SQL-writing code.
- [ ] 5.15 Keep handlers thin; do not put SQL directly in route handlers.

### Tests 5

- [ ] 5.T1 Health is successful only after storage initialization.
- [ ] 5.T2 Empty repository list.
- [ ] 5.T3 Create -> get API round-trip.
- [ ] 5.T4 Create invalid WSL config -> structured client error.
- [ ] 5.T5 Update valid fields.
- [ ] 5.T6 Update resulting invalid config -> rejected without corrupting stored row.
- [ ] 5.T7 Unknown repository -> consistent 404/error code.
- [ ] 5.T8 Delete -> subsequent get not found.
- [ ] 5.T9 Internal failure path does not return raw stack trace as normal payload.

---

## 6. Real-time event foundation

- [ ] 6.1 Add one WebSocket/event endpoint/channel owned by controller.
- [ ] 6.2 Add connection lifecycle handling sufficient for UI reconnect.
- [ ] 6.3 Publish `repository.created` only after successful persistence.
- [ ] 6.4 Publish `repository.updated` only after successful persistence.
- [ ] 6.5 Publish `repository.deleted` only after successful persistence.
- [ ] 6.6 Include timestamp and repository identity in mutation events.
- [ ] 6.7 Keep events as synchronization hints; do not implement durable replay/event sourcing in Change 001.

### Tests 6

- [ ] 6.T1 Connected client receives create event.
- [ ] 6.T2 Connected client receives update/delete events.
- [ ] 6.T3 Failed mutation does not emit a false successful mutation event.
- [ ] 6.T4 Reconnected client can refetch authoritative state.

### Checkpoint 6 exit

Controller boundary (persistence + REST + events) is complete enough for UI implementation.

---

## 7. React/Vite responsive UI foundation

- [ ] 7.1 Scaffold React/Vite/TypeScript UI.
- [ ] 7.2 Add Tailwind CSS.
- [ ] 7.3 Add only the shadcn/ui primitives actually used by Change 001 screens.
- [ ] 7.4 Create application shell/navigation appropriate for desktop and narrow layouts.
- [ ] 7.5 Add typed controller API client module.
- [ ] 7.6 Add controller health/connection state (`connecting`, `connected`, `disconnected/error`).
- [ ] 7.7 Add WebSocket/event subscription with reconnect/refetch behavior.
- [ ] 7.8 Ensure UI remains usable when controller is offline.
- [ ] 7.9 Avoid direct controller-source/SQLite imports.

---

## 8. Repository dashboard and configuration UX

- [ ] 8.1 Build repository dashboard/list/card foundation.
- [ ] 8.2 Add useful empty state and Add Repository entry point.
- [ ] 8.3 Render multiple repositories independently.
- [ ] 8.4 Display environment, branch, path, executor CLI/model, and configuration status without fake runtime execution state.
- [ ] 8.5 Add repository detail route/view.
- [ ] 8.6 Display persisted Sol conversation URL and safety ceilings on detail view.
- [ ] 8.7 Build Add Repository form.
- [ ] 8.8 Build Edit Repository flow.
- [ ] 8.9 Include display name, remote, branch, environment, local path, executor CLI/model, Sol URL, ceilings.
- [ ] 8.10 Show WSL distribution only/required when environment is WSL.
- [ ] 8.11 Label WSL path as Linux path and Windows path as native Windows path.
- [ ] 8.12 Preserve useful form input after recoverable server validation errors.
- [ ] 8.13 Surface authoritative controller validation errors clearly.
- [ ] 8.14 Implement explicit repository delete action with basic confirmation to avoid accidental clicks.
- [ ] 8.15 Do not implement working Start/Pause/Sol/Executor controls yet; if shown for layout exploration, they must be clearly disabled/future-only.

### Responsive acceptance 8

- [ ] 8.R1 Dashboard primary content works around common phone width (~360–430px) without required horizontal scrolling.
- [ ] 8.R2 Repository form stacks/reflows sensibly at narrow width.
- [ ] 8.R3 Detail fields remain readable at narrow width.
- [ ] 8.R4 Primary navigation/action remains reachable at narrow width.

### Tests 8

- [ ] 8.T1 Dashboard renders multiple repository fixtures/API data.
- [ ] 8.T2 Empty state renders correctly.
- [ ] 8.T3 Controller-disconnected state is distinct from empty repository list.
- [ ] 8.T4 Windows form behavior.
- [ ] 8.T5 WSL conditional field/validation behavior.
- [ ] 8.T6 Server-side validation error is presented without losing recoverable input.
- [ ] 8.T7 Edit persists changed values through API.
- [ ] 8.T8 Delete removes repository from refreshed state.

### Checkpoint 8 exit

Shared browser UI fully exercises the real controller CRUD path before Electron integration.

---

## 9. Electron Windows shell

- [ ] 9.1 Scaffold Electron main process for Windows V1.
- [ ] 9.2 Configure BrowserWindow with safe baseline settings.
- [ ] 9.3 Do not enable broad renderer Node integration solely for controller/storage access.
- [ ] 9.4 Load Vite UI URL in development.
- [ ] 9.5 Load built/shared UI in a production-like local mode.
- [ ] 9.6 Keep Electron free of direct SQLite access.
- [ ] 9.7 Keep Electron free of repository persistence ownership.
- [ ] 9.8 Tolerate controller unavailable state by allowing UI connection/error UX to render.
- [ ] 9.9 Ensure closing/reopening BrowserWindow does not erase controller-persisted data.

### Verification 9

- [ ] 9.V1 Electron launches on the supported Windows development machine.
- [ ] 9.V2 Same repository dashboard works inside Electron.
- [ ] 9.V3 Add/edit operations in Electron go through controller API.
- [ ] 9.V4 Close Electron while controller remains running; reopen and confirm data remains.

---

## 10. Root development workflow and documentation

- [ ] 10.1 Add a practical root dev command that coordinates controller + Vite + Electron without requiring three manually managed terminal windows.
- [ ] 10.2 Ensure controller can still be started independently for testing/headless development.
- [ ] 10.3 Document supported prerequisites/runtime in README.
- [ ] 10.4 Document install command.
- [ ] 10.5 Document root dev command.
- [ ] 10.6 Document build/typecheck/test/lint commands.
- [ ] 10.7 Document where local SQLite/runtime data is stored and how test/dev override works.
- [ ] 10.8 Document that Change 001 is configuration/control-plane only and does not yet execute agents.
- [ ] 10.9 Ensure docs do not instruct users to commit browser/session/database secrets.

---

## 11. End-to-end Change 001 acceptance

Perform a clean manual/integration pass on Windows:

- [ ] 11.1 Start from a fresh/clean dependency install path.
- [ ] 11.2 Start controller independently and confirm health.
- [ ] 11.3 Start full dev stack.
- [ ] 11.4 Create one native Windows repository record through UI.
- [ ] 11.5 Create one WSL repository record through UI.
- [ ] 11.6 Verify both appear independently on dashboard/detail.
- [ ] 11.7 Edit both and verify persistence.
- [ ] 11.8 Restart controller and confirm records remain.
- [ ] 11.9 Close/reopen Electron while controller persists and confirm records remain.
- [ ] 11.10 Exercise a narrow phone-like viewport and confirm core flows are usable.
- [ ] 11.11 Verify controller remains loopback-only by default.
- [ ] 11.12 Confirm no runtime DB/browser profile/auth data is tracked by Git.
- [ ] 11.13 Confirm no functioning watcher/executor/Playwright/autonomous loop slipped into Change 001.

### Full verification

- [ ] 11.V1 `npm run typecheck` (or documented equivalent) passes.
- [ ] 11.V2 `npm test` passes, or any known pre-existing/intentional limitation is explicitly documented and accepted before completion.
- [ ] 11.V3 `npm run build` passes.
- [ ] 11.V4 `npm run lint` passes if lint is part of the chosen baseline.
- [ ] 11.V5 Review package boundaries/dependencies for accidental Electron/controller/UI coupling.

---

## 12. Durable completion and review handoff

- [ ] 12.1 Re-read the final delta spec and confirm implementation matches it.
- [ ] 12.2 Update this task list accurately; do not check unverified work.
- [ ] 12.3 Update README if implementation commands/choices changed.
- [ ] 12.4 Update `docs/ARCHITECTURE.md` only for genuine implementation-proven refinements, not incidental details.
- [ ] 12.5 Update `.agent/state.json` with final Change 001 checkpoint, last verification, and next action.
- [ ] 12.6 Fold/archive completed delta requirements into canonical `openspec/specs/` according to the project's OpenSpec completion convention.
- [ ] 12.7 Mark Milestone 1 complete in `docs/ROADMAP.md` only after the exit gate is satisfied.
- [ ] 12.8 Set the next durable action to **deep Sol/ChatGPT repository review before Change 002** rather than immediately implementing watcher code.
- [ ] 12.9 Commit/push the final coherent checkpoint to `main`.

## Definition of done

Change 001 is complete when:

- all required tasks/scenarios are satisfied;
- root verification is repeatable;
- controller/UI/Electron boundaries match the design;
- repository configuration persists and validates correctly;
- responsive UI supports multiple repositories;
- no later autonomous milestone was prematurely implemented;
- durable state clearly requests the post-foundation deep review.
