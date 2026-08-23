# Design: Windows productization and controller supervision

## Context

The current production topology already has the correct ownership boundary: the Node controller owns SQLite, Git watchers, executors, browser automation, timers, and recovery; Electron is a shell that loads the controller-served UI. Development orchestration is currently supplied by `scripts/dev.js`, while the Electron shell only retries `http://127.0.0.1:47100` until a controller appears. Packaging must preserve the controller as an independent process rather than converting Electron into the runtime owner.

## Design principles

1. **Controller independence is non-negotiable.** Electron may ensure that a controller exists, but closing a window must not implicitly kill controller-owned campaigns.
2. **Reuse before spawn.** Desktop startup first probes a loopback Orca identity/health endpoint. A compatible live controller is reused; only absence permits a spawn attempt.
3. **Singleton by data directory, not just port.** The controller owns a machine-local runtime lock associated with the canonical Orca data directory. Port binding remains a final OS guard, not the sole ownership primitive.
4. **Never kill an unknown process.** A foreign listener or incompatible Orca instance is diagnosed; desktop does not terminate it automatically.
5. **Packaged resources are immutable.** SQLite, browser profiles, logs, PID/lock metadata, repository worktrees, and generated state stay under external user-writable paths.
6. **Development and packaged modes remain distinct.** `ORCA_UI_DEV_URL` and `scripts/dev.js` keep existing development behavior and must not accidentally engage production spawning.
7. **Qualification is artifact-based.** A successful TypeScript build is not package qualification. The unpacked/installed artifact must actually execute in a Windows smoke test.

## Proposed process topology

```text
User launches Orca-Strator.exe
        |
        v
Electron desktop shell
        |
        +--> probe loopback /api/health + controller identity
        |       |
        |       +--> compatible Orca controller -> reuse
        |       +--> foreign/incompatible listener -> actionable failure
        |       +--> no listener -> attempt controller ownership/spawn
        |
        +--> packaged controller process (separate process)
                 |
                 +--> singleton/data-dir lock
                 +--> SQLite + migrations
                 +--> Git watchers/executors/browser automation
                 +--> serves built SPA + REST + WebSocket on loopback

Closing Electron window does not terminate the controller.
Reopening Electron repeats probe/reuse.
```

## Packaged controller launch

Prefer a bundled launch mechanism that does not depend on system Node. Candidate implementation: execute the packaged Electron runtime in Node mode (`ELECTRON_RUN_AS_NODE=1`) against the compiled controller entrypoint/resource bundle, or an equivalently self-contained Node runtime if the selected packager makes that safer. The executor must inspect Electron 43 packaging semantics and choose the simplest tested mechanism.

The controller child MUST be detached/independent enough that closing Electron does not signal ordinary shutdown to it. Test harness teardown may stop only the isolated test controller explicitly.

## Controller identity and ownership

Add a controller build identity containing at least application version and a build/protocol compatibility marker. Expose it through a safe loopback system/health endpoint.

Introduce a runtime lock under the Orca data directory. Lock metadata may contain PID, start time/build identity, and bound endpoint but no secrets. On startup:

1. atomically acquire lock when possible;
2. if lock exists, verify PID liveness and controller identity;
3. reclaim only a demonstrably stale lock;
4. never signal/kill a live foreign process;
5. once lock is owned, bind loopback and start the service;
6. release owned lock during graceful controller shutdown.

Desktop performs the same compatibility probe before spawning, reducing races; the controller lock remains authoritative against concurrent desktop launches.

## Startup state machine

Desktop startup should have explicit states rather than infinite generic retries:

- `CHECKING_CONTROLLER`
- `STARTING_CONTROLLER`
- `WAITING_FOR_READY`
- `CONNECTED`
- `PORT_CONFLICT`
- `INCOMPATIBLE_CONTROLLER`
- `STARTUP_FAILED`

Retries use capped backoff and eventually present diagnostics plus Retry. Development mode may retain direct dev-server behavior.

## Resource and data paths

Create explicit path resolution for development vs packaged execution. At minimum distinguish:

- immutable packaged controller/UI resources;
- user-writable `dataDir`;
- SQLite path;
- controller log directory;
- browser profile directory;
- temporary package-smoke data.

No runtime write may target `process.resourcesPath`, an asar archive, or the install directory. `process.cwd()` may remain a development fallback only when explicitly classified as such.

## Windows packaging

Use a mature Electron packaging tool compatible with the workspace; `electron-builder` is preferred unless implementation evidence favors another option. Build an unpacked artifact for automated smoke and a per-user installer (prefer NSIS). Package only compiled application/runtime dependencies and required static assets.

Artifacts should include version and architecture in deterministic names. Code signing is optional and must be labeled `UNSIGNED` when no certificate is supplied.

## System readiness / doctor

Compose existing browser/Tailscale/provisioning/repository/executor capability probes into one controller-level readiness model. Checks are classified as `READY`, `ACTION_REQUIRED`, `OPTIONAL`, or `UNKNOWN` and include safe remediation text.

Core readiness should cover writable data dir, DB/migrations, Git, Chrome, ChatGPT auth readiness, configured executor availability, and configured repository paths. WSL is required only for WSL-configured repositories. Tailscale and OpenCode remain optional unless their corresponding capability is configured/selected.

## Logging

When launched from a packaged desktop there may be no terminal. Redirect or configure controller startup/runtime diagnostics into a bounded log directory under `dataDir`. Reuse existing rotation primitives where practical. Desktop startup errors should point to a safe log location without exposing credentials or raw browser data.

## Upgrade contract

Install/upgrade operations never delete `dataDir`. Existing migrations remain the only supported DB evolution path. Browser profiles, run history, repository configuration, permission history, and operational state persist independently of the installed binaries. Incompatibility fails diagnostically rather than resetting the DB.

## Verification strategy

Focused tests cover lock ownership, stale recovery, concurrent spawn races, foreign port collision, version mismatch, packaged-path resolution, startup state transitions, and readiness classification.

A Windows packaged-runtime smoke harness launches the actual unpacked/package artifact with isolated `ORCA_DATA_DIR` and port, proves automatic controller start and UI/API readiness, verifies build identity and external data placement, closes Electron while confirming controller survival, relaunches and confirms controller reuse/persisted state, then explicitly tears down only the test controller.

Full project gates run only after focused implementation stabilizes. Package qualification is recorded separately from CI package construction and code signing.
