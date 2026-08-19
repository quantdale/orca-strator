# Delta for Control Plane Foundation

## Purpose

Establish the runnable Windows control plane that later autonomous repository orchestration features can build on.

## ADDED Requirements

### Requirement: Background controller owns runtime state

The system SHALL run orchestration state and repository persistence in a controller process that is architecturally separate from the Electron desktop window.

#### Scenario: Desktop UI closes
- GIVEN the controller is running
- WHEN the Electron window is closed or restarted
- THEN controller-owned repository configuration and persisted state remain available independently of the renderer lifecycle

### Requirement: Shared responsive control UI

The system SHALL provide one responsive React UI that can be rendered inside Electron and can later be served to a phone browser without maintaining a separate mobile application.

#### Scenario: Desktop rendering
- GIVEN the controller and UI are running
- WHEN the Electron shell opens
- THEN it displays the shared control UI and can read repository state through the controller API

#### Scenario: Narrow viewport
- GIVEN the shared UI is loaded in a narrow browser viewport
- WHEN repository status is viewed
- THEN core repository information and controls remain usable without requiring a separate mobile codebase

### Requirement: Local controller API boundary

The controller SHALL expose a localhost HTTP API and real-time event channel for UI clients.

#### Scenario: Repository state changes
- GIVEN a UI client is connected
- WHEN persisted repository state changes through the controller
- THEN the client can receive or refresh the updated state without direct database access

### Requirement: Durable repository registry

The controller SHALL persist configured repositories in SQLite.

Each repository configuration SHALL support at least:

- stable repository identifier;
- display name;
- GitHub remote identity or URL;
- local working-directory path;
- watched branch with `main` as the default;
- execution environment (`windows` or `wsl`);
- WSL distribution when applicable;
- configured executor CLI;
- configured executor model/configuration string;
- dedicated ChatGPT Sol conversation URL;
- maximum iteration ceiling;
- maximum wall-clock runtime ceiling.

#### Scenario: Restart preserves configuration
- GIVEN a repository was registered
- WHEN the controller process is restarted
- THEN the repository configuration is loaded from SQLite without requiring the user to re-enter it

### Requirement: Windows and WSL repository targets

The repository model SHALL distinguish native Windows execution from WSL execution without requiring two different application installations.

#### Scenario: Native repository
- GIVEN a repository is configured with environment `windows`
- THEN its working directory is stored as a Windows path and future process execution can target native Windows/PowerShell

#### Scenario: WSL repository
- GIVEN a repository is configured with environment `wsl`
- THEN a WSL distribution and Linux working directory can be stored for future execution through `wsl.exe`

### Requirement: Repository dashboard foundation

The UI SHALL allow the user to list repositories and inspect their persisted configuration/status foundation.

#### Scenario: Multiple repositories registered
- GIVEN several repositories are configured
- WHEN the dashboard opens
- THEN each repository is shown independently and no global single-project assumption is made

### Requirement: Development verification baseline

The workspace SHALL expose repeatable commands for development, build, type checking, and automated tests.

#### Scenario: Fresh checkout verification
- GIVEN a fresh supported Windows development checkout with dependencies installed
- WHEN the documented verification commands run
- THEN the control-plane foundation can be typechecked, tested, and built without relying on undocumented manual steps
