# Delta for Control Plane Foundation — Review Hardening

## MODIFIED Requirements

### Requirement: Development workflow is reproducible from a clean checkout

The workspace SHALL provide root development and verification commands that work without relying on pre-existing ignored build output.

#### Scenario: Fresh checkout verification
- GIVEN a fresh checkout with no workspace `dist/` directories
- WHEN dependencies are installed and the documented root verification sequence is run
- THEN shared/controller/UI/desktop packages resolve correctly without undocumented manual prerequisite builds

#### Scenario: Root development stack
- GIVEN dependencies are installed on supported Windows
- WHEN `npm run dev` is executed
- THEN a controller runtime is actually listening, Vite is serving the UI, and Electron launches against the Vite development URL

#### Scenario: Controller dev command is runtime-capable
- GIVEN the controller workspace is developed independently
- WHEN its documented development command is run
- THEN source changes can be developed while an actual controller process runs; a compiler watch process alone does not satisfy this requirement

#### Scenario: Development shutdown
- GIVEN the root development stack is running
- WHEN the developer terminates it
- THEN managed child processes are cleaned up without intentionally leaving orphan controller/Vite/Electron watchers

---

### Requirement: Workspace technology baseline matches locked supported lines

The implementation SHALL use the technology lines locked in `docs/TECH-BASELINE.md` and `docs/DECISIONS.md` unless a specific evidence-backed incompatibility causes those documents to be revised first.

#### Scenario: Package manifest review
- GIVEN Change 001a is proposed complete
- WHEN root/workspace manifests and lockfile are compared with the technology baseline
- THEN React, Vite, Tailwind, Vitest, Electron, Node/npm expectations, and Node type definitions are on the approved compatible lines

#### Scenario: Necessary deviation
- GIVEN a locked dependency line cannot be used
- WHEN the implementation selects an alternative
- THEN the incompatibility evidence and corresponding baseline/decision update are committed before the alternative is treated as accepted

---

### Requirement: SQLite migrations are atomic with migration metadata

Each unapplied migration SHALL apply its migration body and its `schema_migrations` metadata insertion as one transaction or equivalent atomic unit.

#### Scenario: Successful migration
- GIVEN an unapplied migration
- WHEN its body and metadata insertion succeed
- THEN both effects are committed and the migration is recorded exactly once

#### Scenario: Migration body failure
- GIVEN a migration that performs a write and then throws/fails
- WHEN migration execution occurs
- THEN the transaction is rolled back, no migration metadata row is recorded, and startup does not report ready

#### Scenario: Metadata insertion failure
- GIVEN migration body execution succeeds but migration metadata cannot be recorded
- WHEN the migration unit fails
- THEN the body is rolled back rather than leaving an unrecorded partially-applied migration

---

### Requirement: Real-time event client reconnects correctly

The UI event client SHALL recover from transient WebSocket disconnect/error conditions and SHALL remain correct across React development lifecycle remounts.

#### Scenario: Transient close
- GIVEN an established WebSocket
- WHEN it closes unexpectedly while reconnect is desired
- THEN the client transitions to disconnected, schedules one bounded reconnect, reconnects, and the UI refetches authoritative REST state

#### Scenario: WebSocket error
- GIVEN an active WebSocket
- WHEN an error causes the socket to close
- THEN the error path does not suppress the reconnect that should follow

#### Scenario: Intentional disconnect then later reconnect
- GIVEN a previous owner intentionally disconnected the client
- WHEN a new owner starts/connects it later
- THEN reconnect intent is re-enabled and future transient failures can still reconnect

#### Scenario: React StrictMode setup-cleanup-setup
- GIVEN the app runs in React StrictMode during development
- WHEN effect setup/cleanup/setup occurs
- THEN the event channel is not left permanently unable to reconnect

#### Scenario: Multiple consumers
- GIVEN more than one component could subscribe to event state
- WHEN one consumer unmounts
- THEN remaining active consumers are not unintentionally disconnected because of accidental singleton lifetime ownership

---

### Requirement: SPA routes support direct browser reload

The shared React application SHALL use browser pathname/history routing consistent with the controller's SPA fallback contract.

Required route semantics include equivalents of:

```text
/
/repositories/new
/repositories/:id
/repositories/:id/edit
```

#### Scenario: Navigate to repository detail
- GIVEN a configured repository
- WHEN the UI navigates to its detail route
- THEN the browser URL uses the expected pathname rather than requiring a hash-only route

#### Scenario: Direct detail reload
- GIVEN the browser starts directly at `/repositories/<id>`
- WHEN the controller serves the SPA shell and repository data loads
- THEN the React application renders that repository detail screen rather than falling back to the repository list

#### Scenario: Direct edit reload
- GIVEN the browser starts directly at `/repositories/<id>/edit`
- WHEN the application loads
- THEN the corresponding edit screen is resolved after repository data is available

---

### Requirement: Sol conversation URL identifies a dedicated conversation

Repository configuration SHALL reject generic ChatGPT pages and accept only conversation URL forms deliberately supported by Orca.

#### Scenario: Normal conversation URL
- GIVEN `https://chatgpt.com/c/<conversation-id>`
- WHEN repository configuration is validated
- THEN it is accepted when the identifier is otherwise valid

#### Scenario: Generic ChatGPT page
- GIVEN a URL such as `https://chatgpt.com/pricing`, `/settings`, or an arbitrary single-segment path
- WHEN repository configuration is validated
- THEN it is rejected as not being a dedicated Sol conversation URL

#### Scenario: Wrong host
- GIVEN a non-ChatGPT HTTPS URL
- WHEN repository configuration is validated
- THEN it is rejected

---

### Requirement: Acceptance evidence corresponds to executed behavior

OpenSpec completion checkboxes SHALL only be checked when the stated behavior was actually exercised or proven by an appropriate automated test.

#### Scenario: Electron launch acceptance
- GIVEN an Electron-launch verification task
- WHEN it is marked complete
- THEN evidence includes an actual Electron launch/smoke path on Windows rather than only a unit test of URL string construction

#### Scenario: One-command dev acceptance
- GIVEN the root development-stack task
- WHEN it is marked complete
- THEN the command was exercised with controller runtime, Vite, and Electron actually active

#### Scenario: Clean-checkout command evidence
- GIVEN the milestone verification claims root test/typecheck/build success
- WHEN evidence is recorded
- THEN it identifies a run that did not depend on stale ignored build artifacts

---

### Requirement: Documentation and durable state reflect actual review status

README, roadmap/OpenSpec status, and `.agent/state.json` SHALL describe the same current milestone/change state.

#### Scenario: Corrective change active
- GIVEN Change 001a is under implementation
- WHEN a fresh `/go` session reads durable state
- THEN it is directed to Change 001a and not to Milestone 2

#### Scenario: Corrective change complete
- GIVEN all Change 001a requirements are satisfied
- WHEN the final checkpoint is written
- THEN state becomes `READY_FOR_REVIEW` and explicitly requests a second Milestone 1 review before watcher work

---

## ADDED Requirements

### Requirement: Unknown API routes use an appropriate API error identity

Unknown `/api/*` routes SHALL return a JSON 404 envelope whose code/message identifies an unknown API route rather than incorrectly claiming a repository record was not found.

#### Scenario: Unknown API endpoint
- GIVEN `GET /api/not-a-real-route`
- WHEN the request is handled
- THEN it returns JSON 404 and a route-appropriate stable error code/message, never SPA HTML

---

### Requirement: Controller configuration rejects invalid runtime values early

Controller startup configuration SHALL validate values such as port/host/data paths enough to fail clearly before passing nonsensical values deeper into runtime APIs.

#### Scenario: Invalid port
- GIVEN `ORCA_PORT` is non-numeric or outside the valid TCP port range
- WHEN configuration loads
- THEN startup fails with a clear configuration error rather than propagating `NaN` or an invalid port into Fastify
