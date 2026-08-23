# Windows Productization Specification

## Purpose

Turn the orchestration runtime into a self-contained, installable Windows product while preserving the controller as the independent orchestration owner and Git/GitHub as durable cross-agent truth.

## Requirements

### Requirement: Self-contained Windows package

Orca-Strator SHALL provide a Windows distribution that can launch the desktop application without requiring the user to manually start Node, npm, Vite, or the controller. The distribution SHALL include the compiled Electron shell, compiled controller and shared runtime, built React UI, and required production dependencies, while excluding machine-local runtime state, credentials, logs, browser profiles, repository worktrees, and `.env` secrets.

#### Scenario: Normal packaged launch requires no development supervisor

- **GIVEN** a Windows machine with the packaged Orca artifact and no manually started controller
- **WHEN** the user launches the packaged desktop application
- **THEN** Orca can reach a ready controller and built UI without invoking `scripts/dev.js`, npm, or a system Node installation

#### Scenario: Runtime data is not embedded in the package

- **WHEN** the Windows package is inspected
- **THEN** it contains no SQLite runtime DB, ChatGPT cookies/profile data, executor credentials, repository checkouts, or generated Orca logs

### Requirement: Desktop-supervised independent controller

The desktop SHALL probe the configured loopback Orca controller before attempting to spawn one. A compatible running controller SHALL be reused. If no controller exists, the packaged desktop SHALL start a self-contained controller process and wait for readiness. Closing the Electron window SHALL NOT terminate that controller merely because the UI closed.

#### Scenario: Existing compatible controller is reused

- **GIVEN** a compatible Orca controller already owns the canonical data directory and loopback endpoint
- **WHEN** the desktop starts
- **THEN** it connects to the existing controller and does not create another controller process

#### Scenario: Missing controller is started automatically

- **GIVEN** no controller is listening and no live controller owns the canonical data directory
- **WHEN** packaged desktop startup proceeds
- **THEN** the desktop starts the packaged controller, waits for health readiness, and loads the normal Orca UI

#### Scenario: Desktop close preserves autonomous runtime

- **GIVEN** a controller is running independently of the desktop window
- **WHEN** the user closes the Electron UI
- **THEN** the controller remains alive and controller-owned runs/watchers are not stopped by the window close

#### Scenario: Relaunch reconnects without duplicate spawn

- **GIVEN** the desktop was closed while the controller continued running
- **WHEN** the packaged desktop is launched again
- **THEN** it reuses the existing controller and does not create a second controller

### Requirement: Controller singleton and foreign-process safety

The controller SHALL enforce singleton ownership for the canonical Orca data directory using an atomic runtime ownership mechanism in addition to the OS port bind. Stale ownership MAY be reclaimed only after liveness validation. Orca SHALL NOT automatically terminate an unknown or foreign process merely because it occupies the configured port.

#### Scenario: Concurrent desktop launches produce one controller

- **GIVEN** two desktop processes start concurrently while no controller is running
- **WHEN** both attempt to ensure controller availability
- **THEN** at most one controller obtains ownership and the other desktop reuses it or receives a deterministic in-progress diagnostic

#### Scenario: Stale ownership is recoverable

- **GIVEN** controller lock metadata references a process that is demonstrably no longer alive
- **WHEN** a new controller starts
- **THEN** the stale ownership can be reclaimed safely and startup continues

#### Scenario: Foreign port conflict is diagnosed, not killed

- **GIVEN** a non-Orca process listens on the configured controller port
- **WHEN** desktop/controller startup probes that endpoint
- **THEN** Orca reports an actionable port-conflict state and does not terminate the foreign process

#### Scenario: Incompatible Orca controller is not silently mixed

- **GIVEN** the loopback endpoint belongs to an Orca controller whose build/protocol identity is incompatible with the desktop
- **WHEN** the desktop probes it
- **THEN** startup reports an incompatible-controller state rather than silently using or replacing it

### Requirement: Explicit packaged resource and writable-data boundaries

Packaged binaries/static resources SHALL be treated as immutable. Writable runtime state SHALL live outside packaged resources in the configured Orca data directory or explicitly isolated test directories. Production path resolution SHALL NOT depend on repository `cwd`.

#### Scenario: SQLite and logs stay outside packaged resources

- **WHEN** a packaged controller initializes
- **THEN** its SQLite DB, logs, lock metadata, browser profile, and generated state are created under writable external locations and not under the install directory, asar, or `process.resourcesPath`

#### Scenario: Built UI resolves from packaged resources

- **GIVEN** a packaged controller launched from an arbitrary working directory
- **WHEN** it serves the Orca root page
- **THEN** the built UI is resolved from the explicit packaged resource contract rather than repository-relative `cwd`

### Requirement: Truthful desktop startup state machine

The desktop SHALL distinguish checking, starting, waiting, connected, port-conflict, incompatible-controller, and terminal startup-failure states. Retries SHALL be bounded/capped and SHALL NOT spin indefinitely at high frequency. Failure UI SHALL offer a safe Retry action and concise diagnostics.

#### Scenario: Repeated startup failure becomes actionable

- **GIVEN** the controller cannot become ready after the configured bounded retry policy
- **WHEN** retry exhaustion occurs
- **THEN** the desktop remains responsive, displays `STARTUP_FAILED` or a more specific diagnostic, and allows the user to retry without requiring an application crash

### Requirement: System readiness doctor

The controller SHALL expose a safe readiness model that composes existing capability probes and classifies checks as `READY`, `ACTION_REQUIRED`, `OPTIONAL`, or `UNKNOWN`. The UI SHALL distinguish core blockers from optional capabilities.

#### Scenario: Optional external capability does not block core readiness

- **GIVEN** Tailscale is not installed or no authorized OpenCode qualification URL exists
- **WHEN** neither capability is required by the current configuration
- **THEN** the doctor reports the condition as optional/unqualified without declaring the core Orca runtime unusable

#### Scenario: Repository-specific WSL dependency is conditional

- **GIVEN** no configured repository uses WSL
- **WHEN** the doctor evaluates system readiness
- **THEN** absence of a WSL distribution does not become a core blocker

### Requirement: Packaged runtime diagnostics and data preservation

A packaged controller SHALL persist bounded startup/runtime diagnostics under the writable Orca data directory. Install/upgrade operations SHALL preserve user data and SHALL NOT silently reset incompatible databases or delete browser profiles/run history.

#### Scenario: Packaged startup failure leaves durable diagnostics

- **WHEN** packaged controller startup fails before the UI can connect
- **THEN** useful redacted diagnostics remain available in the external log location without relying on a visible terminal

#### Scenario: Upgrade preserves durable state

- **GIVEN** existing repository configuration, DB history, permission decisions, and dedicated browser profile
- **WHEN** the application binaries are upgraded or reinstalled
- **THEN** those external data assets remain intact and normal DB migrations govern schema evolution

### Requirement: Real Windows package qualification

Package qualification SHALL require execution of the built Windows artifact, not only TypeScript/unit builds. The smoke qualification SHALL use isolated writable state and SHALL prove controller autostart, UI/API readiness, expected build identity, data placement, controller survival after desktop close, reconnect-without-duplicate on relaunch, persistence across relaunch, and controlled teardown.

#### Scenario: Packaged artifact completes the release smoke

- **GIVEN** a newly built unpacked or installed Windows artifact and isolated `ORCA_DATA_DIR`
- **WHEN** the release smoke harness runs
- **THEN** all required packaged-runtime checks pass and artifact name/version/architecture/SHA-256/signing status are recorded

#### Scenario: Build-only CI is not mislabeled runtime-qualified

- **GIVEN** hosted CI successfully builds a Windows package but does not execute the complete packaged runtime smoke
- **WHEN** qualification status is reported
- **THEN** the artifact is labeled package-built rather than package-runtime-qualified
