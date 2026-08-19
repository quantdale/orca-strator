# Delta for Control Plane Foundation

## Purpose

Establish the runnable Windows control plane that later autonomous repository orchestration features can extend without coupling runtime truth to Electron or duplicating desktop/mobile state paths.

## ADDED Requirements

### Requirement: TypeScript workspace has explicit application boundaries

The system SHALL use a TypeScript workspace with separate controller, UI, desktop, and shared-contract packages.

The baseline logical structure SHALL include:

- `apps/controller`;
- `apps/ui`;
- `apps/desktop`;
- `packages/shared`.

#### Scenario: Shared contracts do not depend on applications
- GIVEN the workspace is installed
- WHEN dependency relationships are inspected
- THEN `packages/shared` does not depend on controller, UI, or Electron application packages

#### Scenario: UI cannot bypass the controller boundary
- GIVEN the UI is built
- WHEN repository data is read or changed
- THEN the UI uses controller API/contracts and does not directly import controller storage/SQLite implementation

#### Scenario: Root verification commands are available
- GIVEN dependencies are installed
- WHEN the documented root build/typecheck/test commands run
- THEN each workspace participates through documented scripts without requiring undocumented manual package-by-package steps

---

### Requirement: Background controller owns persisted/runtime control-plane state

The system SHALL run repository persistence and controller API state in a standalone Node.js/TypeScript controller process architecturally separate from the Electron window/renderer lifecycle.

#### Scenario: Controller runs without Electron
- GIVEN a supported Windows development environment
- WHEN the controller is started without opening Electron
- THEN health and repository API operations are available normally

#### Scenario: Desktop UI closes
- GIVEN the controller is running and repository configuration exists
- WHEN the Electron window is closed
- THEN controller-owned repository configuration remains persisted and accessible

#### Scenario: Desktop UI reopens
- GIVEN the controller remained running after Electron closed
- WHEN Electron is opened again
- THEN the UI reconnects to the controller and displays persisted repositories without recreating them

#### Scenario: Controller is unavailable
- GIVEN the Electron/shared UI is open
- WHEN the controller cannot be reached
- THEN the UI presents a clear disconnected/error state instead of crashing or silently using stale direct database access

---

### Requirement: Controller binds locally in Change 001

The controller SHALL bind to a loopback interface by default and SHALL NOT expose a public internet listener in Change 001.

#### Scenario: Normal development startup
- GIVEN default configuration
- WHEN the controller starts
- THEN it listens on `127.0.0.1` (or equivalent loopback-only binding) using the documented port

#### Scenario: Phone/public networking is not prematurely implemented
- GIVEN Change 001 is complete
- WHEN controller networking configuration is inspected
- THEN Tailscale/public binding is not required for normal operation and no public listener is enabled by default

---

### Requirement: Controller health represents readiness

The controller SHALL expose a health endpoint that reports success only after required startup initialization, including persistence initialization, has completed.

#### Scenario: Healthy controller
- GIVEN SQLite initialization/migrations succeeded
- WHEN `GET /api/health` is called
- THEN it returns a successful response containing at least an `ok`/ready status and application version or equivalent identity

#### Scenario: Database initialization failed
- GIVEN the required database cannot initialize
- WHEN controller startup occurs
- THEN the controller fails clearly or health does not claim ready; it MUST NOT report a false healthy state

---

### Requirement: Shared responsive control UI

The system SHALL provide one responsive React UI codebase used by Electron and suitable for later private phone-browser access.

#### Scenario: Desktop rendering
- GIVEN controller and UI are running
- WHEN Electron opens
- THEN Electron displays the shared UI and repository data comes from the controller API

#### Scenario: Browser rendering
- GIVEN the UI is opened directly in a browser during development
- WHEN the controller is reachable
- THEN the same repository views operate without Electron-specific persistence logic

#### Scenario: Narrow viewport
- GIVEN a phone-like narrow viewport
- WHEN the dashboard, repository form, or repository detail is viewed
- THEN core content and primary actions remain usable without mandatory horizontal scrolling for the main workflow

#### Scenario: No separate mobile codebase
- GIVEN Change 001 structure
- WHEN responsive behavior is inspected
- THEN phone-like rendering reuses the same UI application rather than a native/separate mobile application

---

### Requirement: Durable repository registry

The controller SHALL persist configured repositories in SQLite.

Each repository SHALL include at least:

- stable opaque repository ID;
- display name;
- GitHub remote identity/URL;
- local working-directory path;
- execution environment (`windows` or `wsl`);
- WSL distribution when applicable;
- executor CLI identifier/config string;
- executor model/configuration string;
- exact dedicated ChatGPT Sol conversation URL;
- maximum iteration ceiling, default 20;
- maximum wall-clock runtime ceiling, default 480 minutes;
- created/updated timestamps.

V1 SHALL NOT persist a configurable branch field. Runtime Git operations are fixed to `main`.

#### Scenario: Create Windows repository
- GIVEN a valid Windows repository configuration
- WHEN it is created through the controller
- THEN it is assigned a stable ID, persisted, and returned through repository APIs

#### Scenario: Create WSL repository
- GIVEN a valid WSL repository configuration including distro and Linux working path
- WHEN it is created
- THEN WSL-specific fields are persisted without converting the canonical path into a Windows path

#### Scenario: Restart preserves configuration
- GIVEN one or more repositories were registered
- WHEN the controller is stopped and restarted using the same data directory
- THEN all persisted repository configurations are restored with stable IDs and values

#### Scenario: Multiple repositories remain independent
- GIVEN Nightwatch, TabDock, and SuperHabits-like records exist
- WHEN repository list/detail operations occur
- THEN each record is represented independently and the model does not impose a single-project global configuration

---

### Requirement: Repository configuration validation is runtime-safe and environment-aware

The controller SHALL validate repository create/update inputs before persistence.

#### Scenario: WSL distribution required
- GIVEN `environment = wsl`
- WHEN no WSL distribution is provided
- THEN creation/update is rejected with a structured validation error and no invalid row is written

#### Scenario: Windows does not require WSL distribution
- GIVEN `environment = windows`
- WHEN a valid Windows configuration omits WSL distribution
- THEN it is accepted

#### Scenario: Required strings are empty
- GIVEN required repository fields contain only whitespace or empty values
- WHEN the payload is submitted
- THEN it is rejected with a structured client validation error

#### Scenario: Invalid ceilings
- GIVEN `maxIterations <= 0` or `maxRuntimeMinutes <= 0`
- WHEN the payload is submitted
- THEN it is rejected

#### Scenario: Defaults are applied
- GIVEN optional ceiling values are omitted from a create request where the API contract allows omission
- WHEN the repository is created
- THEN max iterations defaults to 20 and max runtime defaults to 480 minutes

#### Scenario: Configurable branch is not accepted in V1
- GIVEN a create/update payload contains a `branch` field
- WHEN strict V1 request validation is applied
- THEN the field is rejected or ignored according to the chosen strict-schema implementation, and no mutable branch value is persisted

#### Scenario: Invalid Sol URL
- GIVEN a Sol conversation URL does not match a supported ChatGPT conversation URL form
- WHEN the payload is submitted
- THEN the controller rejects it with a useful validation error

#### Scenario: Update cannot corrupt identity
- GIVEN an existing repository
- WHEN a patch/update payload is applied
- THEN immutable identity fields are not accidentally replaced and the resulting complete configuration is revalidated before persistence

---

### Requirement: Repository configuration does not store secrets

Repository persistence SHALL NOT require or store credentials such as API keys, passwords, GitHub tokens, ChatGPT cookies, or Playwright profile data.

#### Scenario: Repository record is inspected
- GIVEN a persisted repository
- WHEN its API/database representation is inspected
- THEN it contains configuration metadata only and no authentication secret fields are part of the schema

---

### Requirement: SQLite has deterministic migrations

The controller SHALL initialize SQLite through an ordered migration mechanism suitable for future schema growth.

#### Scenario: Fresh database
- GIVEN an empty new data directory
- WHEN the controller starts
- THEN the database and migration metadata are created and all pending migrations run successfully

#### Scenario: Restart is idempotent
- GIVEN the current migrations already ran
- WHEN the controller restarts
- THEN previously applied migrations are not re-applied destructively

#### Scenario: Persistence reopen
- GIVEN repository records exist
- WHEN the database is closed and reopened by a restarted controller
- THEN the records remain readable

#### Scenario: Migration failure
- GIVEN a migration fails
- WHEN startup occurs
- THEN the failed migration is not silently recorded as applied and controller readiness is not falsely reported

#### Scenario: Test database isolation
- GIVEN automated storage/API tests run
- WHEN databases are created
- THEN tests use temporary/overridden data paths and do not modify the user's normal Orca runtime database

---

### Requirement: Local database is not repository source state

The Orca runtime database SHALL be stored in a machine-local application data location or explicit development/test override rather than inside the Git repository as committed project state.

#### Scenario: Git status after normal controller use
- GIVEN repositories were configured locally
- WHEN Git status is inspected
- THEN the runtime SQLite database is not an intended tracked repository file

---

### Requirement: Repository CRUD API

The controller SHALL expose repository CRUD endpoints through the localhost API.

The API SHALL support equivalent operations to:

```text
GET    /api/repositories
POST   /api/repositories
GET    /api/repositories/:id
PATCH  /api/repositories/:id
DELETE /api/repositories/:id
```

#### Scenario: Empty list
- GIVEN no repositories exist
- WHEN the repository list endpoint is called
- THEN it returns a successful empty collection

#### Scenario: Create and read
- GIVEN a valid create payload
- WHEN a repository is created and then fetched by ID
- THEN the persisted values are returned consistently

#### Scenario: Update
- GIVEN an existing repository
- WHEN a valid patch is submitted
- THEN the repository is updated, `updatedAt` advances, and subsequent reads return the new configuration

#### Scenario: Delete
- GIVEN an existing repository
- WHEN delete is requested
- THEN the record is removed and subsequent lookup returns not found

#### Scenario: Unknown repository
- GIVEN an ID that does not exist
- WHEN a detail/update/delete operation requires the record
- THEN the controller returns a consistent not-found response rather than an unhandled exception

---

### Requirement: Controller errors use a stable envelope

API failures SHALL return a stable machine-readable error code plus a human-readable message.

#### Scenario: Validation error
- GIVEN invalid repository input
- WHEN the request fails
- THEN the client receives a structured error indicating invalid configuration and useful field/context details when safe

#### Scenario: Internal failure
- GIVEN an unexpected persistence/internal error
- WHEN the request fails
- THEN the response does not expose raw internal stack traces as the normal client payload

---

### Requirement: Real-time repository mutation events

The controller SHALL expose a real-time event channel suitable for keeping desktop/future phone clients synchronized.

At minimum, successful create/update/delete operations SHALL publish repository mutation events.

#### Scenario: Repository created
- GIVEN a UI event client is connected
- WHEN a repository is successfully created
- THEN a `repository.created` or equivalent event is emitted after successful persistence

#### Scenario: Repository updated
- GIVEN a UI event client is connected
- WHEN a repository is successfully updated
- THEN a repository update event includes enough identity information to refetch/update the correct repository

#### Scenario: Client reconnects
- GIVEN a UI missed events while disconnected
- WHEN it reconnects
- THEN it can recover authoritative repository state by refetching the API; Change 001 does not require replaying a complete historical event log

---

### Requirement: Repository dashboard foundation

The UI SHALL list multiple configured repositories independently and expose their persisted configuration/status foundation.

#### Scenario: Multiple repositories registered
- GIVEN several repositories exist
- WHEN the dashboard opens
- THEN all are represented independently with stable navigation/identity

#### Scenario: Empty state
- GIVEN no repositories exist
- WHEN the dashboard opens
- THEN a useful empty state explains how to add the first repository

#### Scenario: Controller disconnected
- GIVEN repository data cannot currently be fetched because the controller is offline
- WHEN the dashboard is displayed
- THEN the UI shows connection failure/retry state rather than pretending there are zero repositories

#### Scenario: No fake autonomous status
- GIVEN Change 001 has not implemented runtime orchestration
- WHEN a repository is displayed
- THEN the UI does not falsely claim an executor/Sol autonomous run is active; configuration-only status is clearly represented

---

### Requirement: Repository add/edit flow supports Windows and WSL

The UI SHALL provide an add/edit flow for all required repository configuration fields.

The UI SHALL NOT expose a branch selector in V1; `main` is automatic.

#### Scenario: User selects WSL
- GIVEN the form is in create/edit mode
- WHEN environment is changed to WSL
- THEN WSL distribution becomes required/visible and the working path is treated/labeled as a Linux path

#### Scenario: User selects Windows
- GIVEN the form is configured for WSL
- WHEN environment is changed to Windows
- THEN WSL-only validation no longer blocks submission and hidden stale WSL values are not accidentally persisted as required semantics

#### Scenario: Server rejects configuration
- GIVEN a request reaches the controller but fails authoritative validation
- WHEN the UI receives the error
- THEN the form retains recoverable user input and presents useful error feedback

---

### Requirement: Repository detail foundation

The UI SHALL provide a repository detail view that displays current persisted configuration and leaves clear extension space for later run state/timeline/controls without implementing those features early.

#### Scenario: View repository
- GIVEN an existing repository
- WHEN its detail route/view opens
- THEN the persisted environment, path, executor/model, Sol URL, and ceilings can be inspected; V1 may show `main` only as a fixed runtime note, not editable configuration

#### Scenario: Future controls are not functional placeholders
- GIVEN autonomous run behavior is not implemented
- WHEN detail UI is inspected
- THEN later runtime controls are absent or clearly disabled/non-functional rather than wired to fake behavior

---

### Requirement: Electron is a shell, not persistence owner

Electron SHALL host the shared UI while keeping repository persistence/orchestration ownership in the standalone controller.

#### Scenario: Development mode
- GIVEN the Vite development server is running
- WHEN Electron launches
- THEN it loads the shared development UI

#### Scenario: Built/local mode
- GIVEN the UI has been built
- WHEN the desktop shell runs in a production-like local mode
- THEN it can load the shared built UI using the documented approach

#### Scenario: Renderer security baseline
- GIVEN the Electron BrowserWindow is configured
- WHEN renderer settings are inspected
- THEN broad Node integration is not enabled solely to access controller/storage functionality that belongs behind the API

#### Scenario: No direct DB access
- GIVEN Electron UI code executes
- WHEN repository persistence occurs
- THEN no renderer/Electron UI component opens SQLite directly

---

### Requirement: Development workflow is reproducible

The workspace SHALL expose documented commands for installation, development, type checking, testing, linting, and building.

#### Scenario: Fresh checkout setup
- GIVEN a fresh supported Windows checkout
- WHEN the README setup steps are followed
- THEN the developer can install dependencies and start the Change 001 stack without undocumented manual steps

#### Scenario: Combined development startup
- GIVEN dependencies are installed
- WHEN the documented root development command runs
- THEN controller, UI, and Electron can be started in a practical coordinated workflow without requiring the developer to manually manage three unrelated terminals

#### Scenario: Full verification
- GIVEN implementation is complete
- WHEN root typecheck/test/build verification commands run
- THEN the workspace verifies as documented or any remaining intentional limitation is explicitly captured in durable state before the change is considered complete

---

### Requirement: Cross-platform repository hygiene is preserved

The implementation SHALL preserve the repository's seeded `.gitattributes`, `.editorconfig`, and `.gitignore` baselines so Windows/WSL development does not create avoidable line-ending churn or accidentally commit local runtime/auth artifacts.

#### Scenario: Runtime artifacts are generated
- GIVEN local SQLite, logs, browser profiles, Playwright auth/output, dependencies, or environment-secret files exist
- WHEN Git status is inspected
- THEN those machine-local/generated files are not unintentionally tracked by the seeded ignore rules

#### Scenario: Managed-repository protocol remains committable
- GIVEN future managed repositories use `.orca/` coordination artifacts
- WHEN ignore policy is inspected
- THEN `.orca/` is not globally ignored by Orca-Strator's baseline policy

---

### Requirement: Change 001 remains within foundation scope

The implementation SHALL NOT introduce functioning autonomous watcher/executor/Playwright behavior as part of this change.

#### Scenario: Completion review
- GIVEN Change 001 is proposed as complete
- WHEN the codebase is reviewed
- THEN repository polling, dispatch execution, coding-agent process launch, ChatGPT browser automation, and full run-state orchestration remain unimplemented except for minimal non-functional contracts/placeholders genuinely required by the foundation

---

### Requirement: Development handoff remains durable

Change completion SHALL update the repository's development waypoint and OpenSpec/roadmap state so a fresh agent or reviewer can determine what was completed and what follows.

#### Scenario: End of Change 001
- GIVEN all required implementation and verification is complete
- WHEN the development session checkpoints the change
- THEN `tasks.md`, `.agent/state.json`, and roadmap/OpenSpec status reflect the completed foundation and identify the review/Change 002 next action
