# Tasks: Bootstrap Control Plane

This checklist is the executable plan for Change 001. Complete it in roughly this order unless implementation evidence makes a small reorder safer.

A task is checked only when its acceptance intent is actually satisfied. Do not check a task merely because files were created.

## 0. Preflight and recovery

- [ ] 0.1 Read `AGENTS.md`, `.agent/state.json`, `docs/ROADMAP.md`, this change's proposal/spec/design/tasks, and the focused contracts relevant to the first implementation slice.
- [ ] 0.2 Inspect local/remote `main`, working-tree status, pending merge/rebase/cherry-pick state, and local-only commits before editing.
- [ ] 0.3 Preserve/reconcile any existing work rather than resetting or cleaning it away.
- [ ] 0.4 Confirm the active technology baseline from `docs/TECH-BASELINE.md` is still compatible with the local toolchain; document only material implementation-driven deviations.
- [ ] 0.5 Confirm V1 repository configuration is **main-only** and contains no branch field.
- [ ] 0.6 Confirm static repository configuration does not include run-goal/current-actor/current-iteration/process state.
- [ ] 0.7 Confirm the seeded `.gitattributes`, `.editorconfig`, `.gitignore`, and protocol schemas remain intentional and unmodified by scaffold generators unless deliberately reconciled.

### Checkpoint 0 exit

A fresh implementation session understands the exact scope and can scaffold without unresolved foundational ambiguity.

---

## 1. Root workspace and tooling

- [ ] 1.1 Create root `package.json` with npm workspaces for `apps/*` and `packages/*`.
- [ ] 1.2 Set/document Node 24 LTS engine requirement and npm package-manager expectation.
- [ ] 1.3 Create `apps/controller/package.json`.
- [ ] 1.4 Create `apps/ui/package.json`.
- [ ] 1.5 Create `apps/desktop/package.json`.
- [ ] 1.6 Create `packages/shared/package.json`.
- [ ] 1.7 Add root/base TypeScript configuration with strict settings.
- [ ] 1.8 Add package-specific TypeScript configs/build boundaries.
- [ ] 1.9 Establish one simple lint/format path; avoid redundant formatter/linter stacks.
- [ ] 1.10 Establish one Vitest-based TypeScript test pattern where practical.
- [ ] 1.11 Add root scripts for `dev`, `build`, `typecheck`, `test`, and `lint`.
- [ ] 1.12 Verify/extend the already-seeded `.gitignore` for any generated artifacts introduced by the actual scaffold; do not weaken browser/DB/secret ignores and do not ignore `.orca/` globally.
- [ ] 1.13 Verify `.gitattributes`/`.editorconfig` preserve stable Windows/WSL text behavior after scaffold generation.
- [ ] 1.14 Confirm dependency direction does not make `packages/shared` depend on any app package.
- [ ] 1.15 Avoid adding Turborepo/Nx/ORM/DI/plugin-framework infrastructure without concrete need.

### Verification 1

- [ ] 1.V1 Fresh root `npm install` succeeds.
- [ ] 1.V2 Root typecheck command executes across the scaffold.
- [ ] 1.V3 Root test command executes even if initial suites are small.
- [ ] 1.V4 Root build command is wired for all buildable packages.
- [ ] 1.V5 Root lint command executes consistently.
- [ ] 1.V6 `git status` after install/build/test does not expose dependencies, build output, local DB/browser/auth artifacts, or line-ending churn.

### Checkpoint 1 exit

Workspace/tooling is committed in a coherent state; later tasks can depend on stable package names/scripts.

---

## 2. Shared repository/API/event contracts

- [ ] 2.1 Define stable opaque repository ID type/creation approach.
- [ ] 2.2 Define `ExecutionEnvironment = "windows" | "wsl"` runtime-safe contract.
- [ ] 2.3 Define persisted/read `RepositoryRecord` with exactly the Change 001 configuration fields.
- [ ] 2.4 Define create-input model with ceiling defaults.
- [ ] 2.5 Define update/patch model without client-writable ID/timestamps.
- [ ] 2.6 Ensure **no branch field exists** in the V1 repository schema/create/update/API model.
- [ ] 2.7 Ensure no current-run fields exist in the static repository configuration contract.
- [ ] 2.8 Apply defaults: max iterations = 20; max runtime = 480 minutes.
- [ ] 2.9 Enforce non-empty display name, remote, path, executor CLI, executor model, and Sol conversation URL.
- [ ] 2.10 Enforce WSL distribution when environment is WSL.
- [ ] 2.11 Normalize Windows WSL distribution to null/unused semantics.
- [ ] 2.12 Validate positive integer ceilings.
- [ ] 2.13 Validate supported ChatGPT conversation URL shape.
- [ ] 2.14 Ensure repository schema contains no credential/API-key/browser-cookie fields.
- [ ] 2.15 Define health response contract.
- [ ] 2.16 Define repository API request/response envelopes.
- [ ] 2.17 Define stable API error envelope and initial error codes.
- [ ] 2.18 Define real-time event envelope.
- [ ] 2.19 Define `repository.created`, `repository.updated`, and `repository.deleted` events.
- [ ] 2.20 Export public contracts from a small package entrypoint.
- [ ] 2.21 Keep runtime types derivable/mechanically aligned with runtime schemas rather than duplicating ad-hoc validation.

### Tests 2

- [ ] 2.T1 Valid Windows configuration.
- [ ] 2.T2 Valid WSL configuration.
- [ ] 2.T3 Missing WSL distribution rejection.
- [ ] 2.T4 Empty/whitespace required fields rejection.
- [ ] 2.T5 Invalid/non-positive ceilings rejection.
- [ ] 2.T6 Ceiling defaults applied correctly.
- [ ] 2.T7 Invalid Sol conversation URL rejected.
- [ ] 2.T8 Update/patch resulting object revalidated.
- [ ] 2.T9 Immutable ID/timestamps cannot be replaced through patch input.
- [ ] 2.T10 Configurable `branch` input is absent/rejected by the V1 schema strategy.
- [ ] 2.T11 Typecheck proves controller/UI can import shared contracts without circular app dependencies.

### Checkpoint 2 exit

Repository configuration semantics are stable enough for SQL/API/UI to depend on them.

---

## 3. Controller configuration and startup skeleton

- [ ] 3.1 Create standalone controller entrypoint.
- [ ] 3.2 Add configuration loader for host, port, data directory, log level, and environment overrides.
- [ ] 3.3 Default host to loopback only (`127.0.0.1` or documented equivalent).
- [ ] 3.4 Use/document stable default controller port (baseline 47100 unless implementation conflict appears).
- [ ] 3.5 Resolve a normal Windows user-local application data directory for runtime persistence.
- [ ] 3.6 Support `ORCA_DATA_DIR` override for development/tests.
- [ ] 3.7 Add basic startup/fatal-error logging without secrets.
- [ ] 3.8 Ensure controller starts independently of Vite/Electron.
- [ ] 3.9 Ensure readiness is not reported before required DB initialization.

### Verification 3

- [ ] 3.V1 Controller starts on Windows from documented command.
- [ ] 3.V2 Default listener is loopback-only.
- [ ] 3.V3 Test/dev data-directory override works.
- [ ] 3.V4 Fatal startup failure exits/reports clearly rather than advertising healthy state.

---

## 4. SQLite migration and storage layer

- [ ] 4.1 Confirm Node `node:sqlite` works for Change 001; if a concrete blocker requires replacement, preserve the storage interface and document the deviation first.
- [ ] 4.2 Add database open/close lifecycle.
- [ ] 4.3 Add migration metadata table/version mechanism.
- [ ] 4.4 Add ordered migration runner.
- [ ] 4.5 Make migration application transactional where practical.
- [ ] 4.6 Ensure failed migration is not marked successfully applied.
- [ ] 4.7 Add initial `repositories` table migration.
- [ ] 4.8 Include exactly: ID, display name, remote, local path, environment, WSL distribution, executor CLI/model, Sol URL, ceilings, timestamps.
- [ ] 4.9 Do **not** add a branch column.
- [ ] 4.10 Do **not** add run-goal/current-state/iteration/PID columns.
- [ ] 4.11 Add readable DB constraints for environment/positive ceilings where useful.
- [ ] 4.12 Implement DB row -> shared-domain mapping.
- [ ] 4.13 Implement repository store `list`.
- [ ] 4.14 Implement repository store `get`.
- [ ] 4.15 Implement repository store `create`.
- [ ] 4.16 Implement repository store `update`.
- [ ] 4.17 Implement repository store `delete`.
- [ ] 4.18 Keep raw SQL/driver rows behind the storage layer.

### Tests 4

- [ ] 4.T1 Fresh temporary DB initializes and applies migrations.
- [ ] 4.T2 Reopening current DB is idempotent.
- [ ] 4.T3 Repository create/read round-trip.
- [ ] 4.T4 Multiple repositories list independently.
- [ ] 4.T5 Update preserves ID/created timestamp and advances updated timestamp.
- [ ] 4.T6 Delete removes record.
- [ ] 4.T7 Close/reopen preserves records.
- [ ] 4.T8 Invalid service mutation does not partially corrupt a stored row.
- [ ] 4.T9 Tests prove user runtime DB path is untouched.
- [ ] 4.T10 Schema inspection proves branch/run-state columns were not accidentally introduced.

### Checkpoint 4 exit

SQLite persistence is independently testable before HTTP/UI are added.

---

## 5. Repository service and controller API

- [ ] 5.1 Add repository service between HTTP handlers and storage.
- [ ] 5.2 Apply runtime validation/defaults before writes.
- [ ] 5.3 Generate stable IDs/timestamps in one clear layer.
- [ ] 5.4 Add not-found/domain error type/code.
- [ ] 5.5 Map persistence/internal errors without leaking raw stack traces.
- [ ] 5.6 Initialize Fastify controller server.
- [ ] 5.7 Implement `GET /api/health` after DB readiness.
- [ ] 5.8 Implement `GET /api/repositories`.
- [ ] 5.9 Implement `POST /api/repositories`.
- [ ] 5.10 Implement `GET /api/repositories/:id`.
- [ ] 5.11 Implement `PATCH /api/repositories/:id`.
- [ ] 5.12 Implement `DELETE /api/repositories/:id`.
- [ ] 5.13 Return one stable error envelope for validation/not-found/internal failures.
- [ ] 5.14 Ensure invalid payloads never reach SQL-writing code.
- [ ] 5.15 Keep handlers thin; no SQL in routes.
- [ ] 5.16 Ensure API serialization contains no branch field or secret/runtime-only data.

### Tests 5

- [ ] 5.T1 Health succeeds only after storage initialization.
- [ ] 5.T2 Empty repository list.
- [ ] 5.T3 Create -> get API round-trip.
- [ ] 5.T4 Invalid WSL config -> structured 422-style client error.
- [ ] 5.T5 Update valid fields.
- [ ] 5.T6 Update producing invalid merged config -> rejected without corrupting stored row.
- [ ] 5.T7 Unknown repository -> consistent 404/error code.
- [ ] 5.T8 Delete -> subsequent get not found.
- [ ] 5.T9 Internal failure path does not return raw stack trace as normal payload.
- [ ] 5.T10 Branch field is absent/rejected according to the strict V1 request contract.

---

## 6. Real-time event foundation

- [ ] 6.1 Add one WebSocket/event endpoint/channel owned by controller.
- [ ] 6.2 Add connection lifecycle handling sufficient for UI reconnect.
- [ ] 6.3 Publish `repository.created` only after successful persistence.
- [ ] 6.4 Publish `repository.updated` only after successful persistence.
- [ ] 6.5 Publish `repository.deleted` only after successful persistence.
- [ ] 6.6 Include timestamp and repository identity in mutation events.
- [ ] 6.7 Keep events as synchronization hints; do not implement durable replay/event sourcing.

### Tests 6

- [ ] 6.T1 Connected client receives create event.
- [ ] 6.T2 Connected client receives update/delete events.
- [ ] 6.T3 Failed mutation does not emit false success event.
- [ ] 6.T4 Reconnected client can refetch authoritative state.

### Checkpoint 6 exit

Controller boundary (persistence + REST + events) is complete enough for UI implementation.

---

## 7. React/Vite responsive UI foundation

- [ ] 7.1 Scaffold React/Vite/TypeScript UI.
- [ ] 7.2 Add Tailwind CSS.
- [ ] 7.3 Add only shadcn/ui primitives actually used by Change 001.
- [ ] 7.4 Create application shell/navigation appropriate for desktop and narrow layouts.
- [ ] 7.5 Add typed controller API client module.
- [ ] 7.6 Add controller connection/health states (`connecting`, `connected`, `disconnected/error`).
- [ ] 7.7 Add WebSocket/event subscription with reconnect/refetch behavior.
- [ ] 7.8 Ensure UI remains usable when controller is offline.
- [ ] 7.9 Avoid direct controller-source/SQLite imports.
- [ ] 7.10 Keep server/repository data flow centralized enough that components do not invent inconsistent retry/error logic.

---

## 8. Repository dashboard and configuration UX

- [ ] 8.1 Build repository dashboard/list/card foundation.
- [ ] 8.2 Add useful empty state and Add Repository entry point.
- [ ] 8.3 Render multiple repositories independently.
- [ ] 8.4 Display environment, path, executor CLI/model, and configuration status without fake runtime execution state.
- [ ] 8.5 Do not add a branch selector/control; V1 uses `main` automatically.
- [ ] 8.6 Add repository detail route/view.
- [ ] 8.7 Display persisted Sol conversation URL and safety ceilings on detail view.
- [ ] 8.8 Build Add Repository form.
- [ ] 8.9 Build Edit Repository flow.
- [ ] 8.10 Include display name, remote, environment, local path, executor CLI/model, Sol URL, ceilings.
- [ ] 8.11 Show WSL distribution only/required when environment is WSL.
- [ ] 8.12 Label WSL path as Linux path and Windows path as native Windows path.
- [ ] 8.13 Preserve useful form input after recoverable server validation errors.
- [ ] 8.14 Surface authoritative controller validation errors clearly.
- [ ] 8.15 Implement explicit repository delete action with confirmation.
- [ ] 8.16 Do not implement working Start/Pause/Sol/Executor controls yet; any visual seam must be clearly non-functional/future-only.

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
- [ ] 8.T9 No branch input is rendered in V1.

### Checkpoint 8 exit

Shared browser UI fully exercises the real controller CRUD path before Electron integration.

---

## 9. Electron Windows shell

- [ ] 9.1 Scaffold Electron main process for Windows V1.
- [ ] 9.2 Configure BrowserWindow with `contextIsolation: true` and safe baseline settings.
- [ ] 9.3 Do not enable broad renderer Node integration solely for controller/storage access.
- [ ] 9.4 Load Vite UI URL in development.
- [ ] 9.5 Load built/shared UI in a production-like local mode.
- [ ] 9.6 Keep Electron free of direct SQLite access.
- [ ] 9.7 Keep Electron free of repository persistence ownership.
- [ ] 9.8 Tolerate controller unavailable state by allowing UI connection/error UX to render.
- [ ] 9.9 Ensure closing/reopening BrowserWindow does not erase controller-persisted data.

### Verification 9

- [ ] 9.V1 Electron launches on supported Windows development machine.
- [ ] 9.V2 Same repository dashboard works inside Electron.
- [ ] 9.V3 Add/edit operations in Electron go through controller API.
- [ ] 9.V4 Close Electron while controller remains running; reopen and confirm data remains.

---

## 10. Root development workflow and documentation

- [ ] 10.1 Add a practical root dev command that coordinates controller + Vite + Electron without requiring three manually managed terminal windows.
- [ ] 10.2 Ensure controller can still start independently for testing/headless development.
- [ ] 10.3 Document supported prerequisites/runtime in README.
- [ ] 10.4 Document install command.
- [ ] 10.5 Document root dev command.
- [ ] 10.6 Document build/typecheck/test/lint commands.
- [ ] 10.7 Document where local SQLite/runtime data is stored and how test/dev override works.
- [ ] 10.8 Document that Change 001 is configuration/control-plane only and does not yet execute agents.
- [ ] 10.9 Ensure docs do not instruct users to commit browser/session/database secrets.
- [ ] 10.10 Document that V1 operates on `main` automatically and branch configuration is intentionally deferred.

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
- [ ] 11.12 Inspect API/DB/UI and confirm no configurable branch field exists.
- [ ] 11.13 Inspect DB/config and confirm no active-run state fields were prematurely persisted.
- [ ] 11.14 Inspect Git status after normal install/build/test/runtime activity and confirm seeded ignore/line-ending policy works.
- [ ] 11.15 Run root `typecheck`, `test`, `build`, and `lint` verification.
- [ ] 11.16 Fix regressions introduced by Change 001 or record truthful blockers/evidence.

---

## 12. Change completion and review handoff

- [ ] 12.1 Reconcile implementation against the final delta spec/design, not just task checkboxes.
- [ ] 12.2 Update every checkbox to reflect actual acceptance state.
- [ ] 12.3 Run final relevant verification and capture concise evidence in the waypoint.
- [ ] 12.4 Ensure useful intended work is committed and pushed to `main`.
- [ ] 12.5 Set `.agent/state.json` to `READY_FOR_REVIEW` with precise checkpoint/next action.
- [ ] 12.6 Stop for a deep Sol/ChatGPT GitHub review before creating/implementing Change 002.
- [ ] 12.7 After review acceptance, fold/archive the Change 001 delta into canonical `openspec/specs/` and advance roadmap/state according to the repository's OpenSpec lifecycle.

### Final exit gate

Change 001 is not considered accepted merely because the app launches. The deep review must confirm:

- controller/Electron ownership boundary is real;
- static configuration remains minimal and main-only;
- Windows/WSL semantics are coherent;
- persistence/API/events are testable and deterministic;
- UI is responsive and uses the real controller boundary;
- security/hygiene baselines are intact;
- no later autonomous subsystem leaked into this milestone.
