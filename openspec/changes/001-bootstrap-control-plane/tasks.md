# Tasks: Bootstrap Control Plane

## 1. Workspace scaffold

- [ ] 1.1 Create the npm workspace structure for `apps/controller`, `apps/ui`, `apps/desktop`, and `packages/shared`.
- [ ] 1.2 Add root TypeScript/build/test/lint configuration and documented workspace scripts.
- [ ] 1.3 Establish shared formatting/lint conventions without adding unnecessary tooling.
- [ ] 1.4 Confirm a fresh install can run the root typecheck/test/build entrypoints, even if application functionality is still minimal.

## 2. Shared contracts

- [ ] 2.1 Define repository ID, execution-environment, repository-configuration, API, and event contracts in `packages/shared`.
- [ ] 2.2 Add validation for required Windows vs WSL fields and default branch/runtime ceilings.
- [ ] 2.3 Add unit tests for valid/invalid repository configurations.

## 3. Controller and SQLite

- [ ] 3.1 Create the standalone Node/TypeScript controller entrypoint and configuration.
- [ ] 3.2 Add SQLite database initialization and a small migration mechanism.
- [ ] 3.3 Create the initial `repositories` table and storage/repository layer.
- [ ] 3.4 Implement repository CRUD service operations.
- [ ] 3.5 Implement `GET /api/health` and repository REST endpoints.
- [ ] 3.6 Add a WebSocket/event-stream foundation and publish repository mutation events.
- [ ] 3.7 Add controller/storage/API tests using an isolated temporary database.

## 4. Responsive React UI

- [ ] 4.1 Scaffold the React/Vite/TypeScript UI and app shell.
- [ ] 4.2 Add controller connection/health state.
- [ ] 4.3 Build a repository dashboard that supports multiple independent repository cards/rows.
- [ ] 4.4 Build add/edit repository configuration flow including Windows vs WSL fields, executor/model fields, Sol conversation URL, branch, and ceilings.
- [ ] 4.5 Build a repository detail/status foundation without pretending later autonomous features already exist.
- [ ] 4.6 Ensure core views remain usable at narrow phone-like viewport widths.
- [ ] 4.7 Add focused UI tests for repository rendering and configuration behavior where practical.

## 5. Electron Windows shell

- [ ] 5.1 Scaffold the Electron shell.
- [ ] 5.2 Load the shared UI in development and production/local modes.
- [ ] 5.3 Keep the Electron layer free of repository persistence/orchestration ownership.
- [ ] 5.4 Verify closing/reopening the desktop UI does not erase controller-persisted repository state when the controller remains running.

## 6. Integration and documentation

- [ ] 6.1 Add a simple development command/workflow for starting controller + UI + Electron together.
- [ ] 6.2 Document first-run development setup and verification commands in the README.
- [ ] 6.3 Exercise repository create/edit/restart persistence end-to-end.
- [ ] 6.4 Run the full typecheck/test/build verification baseline and fix regressions introduced by this change.
- [ ] 6.5 Update `.agent/state.json` to the next durable waypoint.
- [ ] 6.6 Once all Change 001 requirements are satisfied, archive/fold the delta spec into `openspec/specs/` and advance the roadmap to Change 002.
