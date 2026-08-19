# Control Plane Foundation Specification

## Purpose

Establish the runnable Windows control plane that autonomous repository orchestration features extend without coupling runtime truth to Electron or duplicating desktop/mobile state/network paths.

## Requirements

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

### Requirement: Workspace technology baseline matches locked supported lines

The implementation SHALL use the technology lines locked in `docs/TECH-BASELINE.md` and `docs/DECISIONS.md`.

#### Scenario: Package manifest review
- GIVEN Milestone 1 is complete
- WHEN root/workspace manifests and lockfile are compared with the technology baseline
- THEN React 19.2, Vite 8.1, Tailwind 4.3, Vitest 4.1, Electron 43, and Node 24 baseline dependencies are used

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

### Requirement: Controller binds locally in V1 baseline

The controller SHALL bind to a loopback interface by default and SHALL NOT expose an unauthenticated public internet listener.

#### Scenario: Normal startup
- GIVEN default configuration
- WHEN controller starts
- THEN it listens on `127.0.0.1` using configured port (default 47100)

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

#### Scenario: SPA deep-link refresh
- GIVEN user navigates directly to a client route such as `/repositories/<id>` or `/repositories/new`
- WHEN built controller receives a non-API, non-static-asset route
- THEN it serves SPA shell rather than a 404

#### Scenario: API route precedence
- GIVEN a request targets `/api/*`
- WHEN built SPA fallback is active
- THEN API/WebSocket handling takes precedence and unknown API routes return JSON 404 error envelope (`ROUTE_NOT_FOUND`), never SPA HTML

---

### Requirement: Real-time event client reconnects correctly

The UI event client SHALL recover from transient WebSocket disconnect/error conditions and SHALL remain correct across React development lifecycle remounts.

#### Scenario: Transient close
- GIVEN an established WebSocket
- WHEN it closes unexpectedly while reconnect is desired
- THEN the client transitions to disconnected, schedules bounded reconnect, reconnects, and the UI refetches authoritative REST state

#### Scenario: Intentional disconnect then later reconnect
- GIVEN a previous owner intentionally disconnected the client
- WHEN a new owner starts/connects it later
- THEN reconnect intent is re-enabled and future transient failures can still reconnect

---

### Requirement: SPA routes support direct browser reload

The shared React application SHALL use browser pathname/history routing consistent with the controller's SPA fallback contract.

Required route semantics include equivalents of:
- `/`
- `/repositories/new`
- `/repositories/:id`
- `/repositories/:id/edit`

#### Scenario: Direct detail reload
- GIVEN the browser starts directly at `/repositories/<id>`
- WHEN the controller serves the SPA shell and repository data loads
- THEN the React application renders that repository detail screen rather than falling back to the repository list

---

### Requirement: Durable repository registry

The controller SHALL persist configured repositories in SQLite with atomic migrations.

Each repository SHALL include:
- stable opaque repository ID;
- display name;
- GitHub remote identity/URL;
- local working-directory path;
- execution environment (`windows` or `wsl`);
- WSL distribution when applicable;
- executor CLI identifier/config string;
- executor model/configuration string;
- exact dedicated ChatGPT Sol conversation URL (`https://chatgpt.com/c/<id>` or custom GPT conversation);
- maximum iteration ceiling (default 20);
- maximum wall-clock runtime ceiling (default 480 minutes);
- created/updated timestamps.

V1 SHALL NOT persist a configurable branch field. Runtime Git operations are fixed to `main`.

#### Scenario: Migration atomicity
- GIVEN an unapplied migration
- WHEN execution occurs
- THEN the migration body and its `schema_migrations` insertion commit as a single atomic unit; failures roll back completely without partial state or false metadata
