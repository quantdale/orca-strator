# Delta for Control Plane Foundation

## Purpose

Establish the runnable Windows control plane that later autonomous repository orchestration features can extend without coupling runtime truth to Electron or duplicating desktop/mobile state/network paths.

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

#### Scenario: UI cannot bypass controller boundary
- GIVEN the UI is built
- WHEN repository data is read or changed
- THEN the UI uses controller API/contracts and does not directly import controller storage/SQLite implementation

#### Scenario: Root verification commands are available
- GIVEN dependencies are installed
- WHEN documented root build/typecheck/test commands run
- THEN each workspace participates without undocumented package-by-package steps

---

### Requirement: Background controller owns persisted/runtime control-plane state

The system SHALL run repository persistence and controller API state in a standalone Node.js/TypeScript controller process architecturally separate from Electron window/renderer lifecycle.

#### Scenario: Controller runs without Electron
- GIVEN a supported Windows development environment
- WHEN controller starts without Electron
- THEN health and repository API operations are available normally

#### Scenario: Desktop UI closes
- GIVEN controller is running and repository configuration exists
- WHEN Electron window is closed
- THEN controller-owned configuration remains persisted and accessible

#### Scenario: Desktop UI reopens
- GIVEN controller remained running
- WHEN Electron opens again
- THEN UI reconnects and displays persisted repositories without recreating them

#### Scenario: Controller unavailable
- GIVEN shared UI is open
- WHEN controller cannot be reached
- THEN UI presents disconnected/error state instead of crashing or silently using direct database access

---

### Requirement: Controller binds locally in Change 001

The controller SHALL bind to a loopback interface by default and SHALL NOT expose a public internet listener in Change 001.

#### Scenario: Normal startup
- GIVEN default configuration
- WHEN controller starts
- THEN it listens on `127.0.0.1` or documented equivalent loopback using documented port

#### Scenario: Public networking not prematurely implemented
- GIVEN Change 001 is complete
- WHEN networking is inspected
- THEN Tailscale/public binding is not required and no public listener is enabled by default

---

### Requirement: Controller health represents readiness

The controller SHALL expose a health endpoint that succeeds only after required startup initialization, including persistence initialization, completes.

#### Scenario: Healthy controller
- GIVEN SQLite initialization/migrations succeeded
- WHEN `GET /api/health` is called
- THEN it returns successful ready status and service/version identity

#### Scenario: Database initialization failed
- GIVEN required DB cannot initialize
- WHEN controller startup occurs
- THEN controller fails clearly or health does not claim ready

---

### Requirement: Shared UI uses one same-origin runtime contract

The system SHALL provide one responsive React UI codebase used by Electron and suitable for later private phone-browser access without a second API client.

The built/runtime contract SHALL expose the SPA, REST API, and WebSocket under one Orca web origin.

#### Scenario: Built local runtime
- GIVEN the UI build and controller are available
- WHEN built-mode Orca starts
- THEN the controller can serve the SPA from `/`, REST from `/api/*`, and WebSocket from `/api/events` on one loopback origin

#### Scenario: Development runtime
- GIVEN Vite and controller are running on separate development ports
- WHEN UI requests `/api/*` or `/api/events`
- THEN Vite proxies those relative routes to the controller so UI source does not need a separate API-host implementation

#### Scenario: Phone-compatible client networking
- GIVEN the shared UI is loaded from a non-localhost HTTPS origin
- WHEN it calls REST or opens the event WebSocket
- THEN requests use that page origin (`/api/*`, `wss://same-origin/api/events`) rather than hard-coded laptop localhost

#### Scenario: No wildcard CORS dependency
- GIVEN normal built/runtime topology
- WHEN UI and API communicate
- THEN same-origin routing works without requiring wildcard CORS

#### Scenario: SPA deep-link refresh
- GIVEN user navigates directly to a client route such as `/repositories/<id>`
- WHEN built controller receives a non-API, non-static-asset route
- THEN it serves SPA shell rather than a 404

#### Scenario: API route precedence
- GIVEN a request targets `/api/*`
- WHEN built SPA fallback is active
- THEN API/WebSocket handling takes precedence and API failures are not replaced with SPA HTML

#### Scenario: Static serving isolation
- GIVEN controller serves built UI assets
- WHEN arbitrary filesystem/runtime paths are requested
- THEN DB, logs, browser profile, and Orca data directory are not exposed as static content

---

### Requirement: Shared responsive control UI

The system SHALL provide one responsive React UI codebase used by Electron and suitable for later private phone-browser access.

#### Scenario: Desktop rendering
- GIVEN controller and UI are running
- WHEN Electron opens
- THEN Electron displays shared UI and repository data comes from controller API

#### Scenario: Browser rendering
- GIVEN UI is opened directly in browser during development or built mode
- WHEN controller is reachable through configured same-origin/proxy seam
- THEN repository views operate without Electron-specific persistence logic

#### Scenario: Narrow viewport
- GIVEN phone-like narrow viewport
- WHEN dashboard, repository form, or detail is viewed
- THEN core content/actions remain usable without mandatory horizontal scrolling

#### Scenario: No separate mobile codebase
- GIVEN Change 001 structure
- WHEN responsive behavior is inspected
- THEN phone-like rendering reuses same UI application

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
- GIVEN valid Windows configuration
- WHEN created through controller
- THEN stable ID is assigned, persisted, and returned

#### Scenario: Create WSL repository
- GIVEN valid WSL config including distro/Linux path
- WHEN created
- THEN WSL fields persist without converting canonical path into Windows path

#### Scenario: Restart preserves configuration
- GIVEN repositories registered
- WHEN controller restarts using same data directory
- THEN configurations restore with stable IDs/values

#### Scenario: Multiple repositories remain independent
- GIVEN several records exist
- WHEN list/detail operations occur
- THEN each record is represented independently with no single-project global config

---

### Requirement: Repository configuration validation is runtime-safe and environment-aware

The controller SHALL validate create/update inputs before persistence.

#### Scenario: WSL distribution required
- GIVEN `environment = wsl`
- WHEN no WSL distribution is provided
- THEN mutation is rejected and invalid row is not written

#### Scenario: Windows does not require WSL distribution
- GIVEN `environment = windows`
- WHEN valid Windows config omits WSL distro
- THEN it is accepted

#### Scenario: Required strings empty
- GIVEN required fields empty/whitespace
- WHEN payload submitted
- THEN it is rejected with structured validation error

#### Scenario: Invalid ceilings
- GIVEN max iteration/runtime <= 0 or non-integer
- WHEN submitted
- THEN rejected

#### Scenario: Defaults applied
- GIVEN optional ceiling values omitted
- WHEN created
- THEN defaults 20 and 480 minutes apply

#### Scenario: Configurable branch not accepted in V1
- GIVEN payload contains `branch`
- WHEN strict V1 request validation applies
- THEN field is rejected or ignored according to documented strict-schema strategy and no mutable branch is persisted

#### Scenario: Invalid Sol URL
- GIVEN URL does not match supported ChatGPT conversation form
- WHEN submitted
- THEN controller rejects with useful validation error

#### Scenario: Update cannot corrupt identity
- GIVEN existing repository
- WHEN patch applied
- THEN immutable identity fields are not replaced and complete resulting config is revalidated

---

### Requirement: Repository configuration does not store secrets

Repository persistence SHALL NOT require/store API keys, passwords, GitHub tokens, ChatGPT cookies, or Playwright profile data.

#### Scenario: Repository record inspected
- GIVEN persisted repository
- WHEN API/database representation inspected
- THEN it contains configuration metadata only and no authentication-secret fields

---

### Requirement: SQLite has deterministic migrations

The controller SHALL initialize SQLite through ordered migrations suitable for future schema growth.

#### Scenario: Fresh database
- GIVEN empty data directory
- WHEN controller starts
- THEN DB/migration metadata are created and pending migrations run

#### Scenario: Restart idempotent
- GIVEN current migrations ran
- WHEN controller restarts
- THEN migrations are not destructively re-applied

#### Scenario: Persistence reopen
- GIVEN repository records exist
- WHEN DB reopened
- THEN records remain readable

#### Scenario: Migration failure
- GIVEN migration fails
- WHEN startup occurs
- THEN migration is not marked applied and readiness is not falsely reported

#### Scenario: Test DB isolation
- GIVEN storage/API tests
- WHEN DBs created
- THEN temporary/overridden paths are used, not normal user DB

---

### Requirement: Local database is not repository source state

The Orca runtime database SHALL live in machine-local app data or explicit dev/test override, not as intended tracked source state.

#### Scenario: Git status after controller use
- GIVEN repositories configured locally
- WHEN Git status inspected
- THEN runtime SQLite DB is not intended tracked repository file

---

### Requirement: Repository CRUD API

The controller SHALL expose equivalent operations:

```text
GET    /api/repositories
POST   /api/repositories
GET    /api/repositories/:id
PATCH  /api/repositories/:id
DELETE /api/repositories/:id
```

#### Scenario: Empty list
- GIVEN no repositories
- WHEN list called
- THEN successful empty collection returned

#### Scenario: Create/read
- GIVEN valid create payload
- WHEN created then fetched
- THEN persisted values returned consistently

#### Scenario: Update
- GIVEN existing repository
- WHEN valid patch submitted
- THEN updatedAt advances and reads return new config

#### Scenario: Delete
- GIVEN existing repository
- WHEN deleted
- THEN record removed and subsequent lookup not found

#### Scenario: Unknown repository
- GIVEN unknown ID
- WHEN detail/update/delete requires record
- THEN consistent not-found response returned

---

### Requirement: Controller errors use stable envelope

API failures SHALL return stable machine-readable code plus human-readable message.

#### Scenario: Validation error
- GIVEN invalid repository input
- WHEN request fails
- THEN client receives structured invalid-config error and useful safe field details

#### Scenario: Internal failure
- GIVEN unexpected persistence/internal error
- WHEN request fails
- THEN normal response does not expose raw stack trace

---

### Requirement: Real-time repository mutation events

The controller SHALL expose a real-time event channel. Successful create/update/delete operations SHALL publish mutation events.

#### Scenario: Repository created
- GIVEN connected event client
- WHEN create succeeds
- THEN `repository.created` or equivalent is emitted after persistence

#### Scenario: Repository updated
- GIVEN connected event client
- WHEN update succeeds
- THEN event contains enough identity to update/refetch correct record

#### Scenario: Client reconnects
- GIVEN UI missed events
- WHEN reconnects
- THEN it can refetch authoritative API state; full durable replay not required

---

### Requirement: Repository dashboard foundation

The UI SHALL list multiple configured repositories independently and expose persisted configuration/status foundation.

#### Scenario: Multiple repositories registered
- GIVEN several repositories
- WHEN dashboard opens
- THEN all represented independently

#### Scenario: Empty state
- GIVEN none exist
- WHEN dashboard opens
- THEN useful Add Repository empty state appears

#### Scenario: Controller disconnected
- GIVEN data cannot be fetched
- WHEN dashboard shown
- THEN UI shows connection failure/retry, not empty registry

#### Scenario: No fake autonomous status
- GIVEN runtime orchestration not implemented
- WHEN repository shown
- THEN UI does not falsely claim Sol/executor run active

---

### Requirement: Repository add/edit supports Windows and WSL

The UI SHALL provide add/edit flow for required config fields and SHALL NOT expose branch selector in V1.

#### Scenario: User selects WSL
- GIVEN form
- WHEN environment becomes WSL
- THEN distro becomes required/visible and path is labeled Linux path

#### Scenario: User selects Windows
- GIVEN form previously WSL
- WHEN environment becomes Windows
- THEN WSL validation no longer blocks and stale hidden WSL semantics are not persisted incorrectly

#### Scenario: Server rejects configuration
- GIVEN authoritative validation failure
- WHEN UI receives error
- THEN recoverable user input remains and useful feedback is shown

---

### Requirement: Repository detail foundation

The UI SHALL provide repository detail view displaying persisted configuration and extension space for later run state/timeline/controls.

#### Scenario: View repository
- GIVEN existing repository
- WHEN detail opens
- THEN environment, path, executor/model, Sol URL, and ceilings can be inspected; `main` may appear only as fixed runtime note

#### Scenario: Future controls not fake
- GIVEN runtime behavior not implemented
- WHEN detail inspected
- THEN later controls are absent or clearly disabled/non-functional

---

### Requirement: Electron is a shell, not persistence owner

Electron SHALL host shared UI while persistence/orchestration ownership remains controller.

#### Scenario: Development mode
- GIVEN Vite running
- WHEN Electron launches
- THEN it loads shared dev UI

#### Scenario: Built/local mode
- GIVEN built UI and controller
- WHEN desktop shell runs production-like local mode
- THEN it can load controller-served Orca origin and use same-origin REST/WebSocket

#### Scenario: Renderer security baseline
- GIVEN BrowserWindow config
- WHEN inspected
- THEN broad Node integration is not enabled solely for controller/storage access

#### Scenario: No direct DB access
- GIVEN Electron UI executes
- WHEN repository persistence occurs
- THEN no renderer/UI component opens SQLite directly

---

### Requirement: Development workflow is reproducible

The workspace SHALL expose documented commands for install, development, typecheck, test, lint, and build.

#### Scenario: Fresh checkout setup
- GIVEN fresh supported Windows checkout
- WHEN README steps followed
- THEN developer can install/start stack without undocumented manual steps

#### Scenario: Combined development startup
- GIVEN dependencies installed
- WHEN documented root dev command runs
- THEN controller, Vite, Electron start in practical coordinated workflow and Vite proxies relative API/event routes

#### Scenario: Production-like local web smoke
- GIVEN UI is built
- WHEN controller starts in built mode
- THEN browser can load SPA and API/WebSocket from one loopback origin without Vite

#### Scenario: Full verification
- GIVEN implementation complete
- WHEN root verification commands run
- THEN workspace verifies or intentional limitations are durably recorded before completion

---

### Requirement: Cross-platform repository hygiene is preserved

The implementation SHALL preserve `.gitattributes`, `.editorconfig`, and `.gitignore` baselines.

#### Scenario: Runtime artifacts generated
- GIVEN local SQLite/logs/browser profiles/Playwright output/dependencies/secrets
- WHEN Git status inspected
- THEN those generated/machine-local files are not unintentionally tracked

#### Scenario: Managed protocol remains committable
- GIVEN future managed repos use `.orca/`
- WHEN ignore policy inspected
- THEN `.orca/` is not globally ignored

---

### Requirement: Change 001 remains within foundation scope

The implementation SHALL NOT introduce functioning autonomous watcher/executor/Playwright/Tailscale behavior.

#### Scenario: Completion review
- GIVEN Change 001 proposed complete
- WHEN code reviewed
- THEN remote polling, dispatch execution, coding-agent launch, ChatGPT automation, Tailscale configuration, and run-state orchestration remain unimplemented except non-functional contracts/seams required by foundation

---

### Requirement: Development handoff remains durable

Change completion SHALL update development waypoint/OpenSpec/roadmap so fresh agent/reviewer can determine completed and next work.

#### Scenario: End of Change 001
- GIVEN implementation/verification complete
- WHEN checkpointed
- THEN `tasks.md`, `.agent/state.json`, and roadmap/OpenSpec status reflect completed foundation and review/Change 002 next action
