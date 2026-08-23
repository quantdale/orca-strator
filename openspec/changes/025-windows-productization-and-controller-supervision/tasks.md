# Tasks: Windows productization and release qualification

## 0. Durable-state repair and audit

- [ ] 0.1 Reconcile `.agent/state.json` with Git truth: Milestone 22 / Change 024 is complete, completedMilestones includes 22, and Change 025 becomes active.
- [ ] 0.2 Inspect root/package workspaces, Electron lifecycle, controller startup/shutdown/config, UI system settings, logging, docs, and existing test harnesses before choosing packaging details.
- [ ] 0.3 Record the selected packaged controller launch strategy and why it preserves controller independence without requiring system Node.

## 1. Windows package pipeline

- [ ] 1.1 Add a mature Electron Windows packaging tool/configuration (prefer `electron-builder` unless repository evidence supports another tool).
- [ ] 1.2 Add deterministic root/package scripts for unpacked Windows package and installer/distribution builds.
- [ ] 1.3 Bundle compiled desktop, controller, shared runtime, built React UI, required production dependencies, and required static assets.
- [ ] 1.4 Exclude DBs, browser profiles/cookies, repository worktrees, logs, local `.env`, executor credentials, and generated runtime state.
- [ ] 1.5 Produce deterministic artifact names containing version and architecture; record signed/unsigned truth.
- [ ] 1.6 Prefer a per-user installer that does not require administrator elevation.

## 2. Controller identity and singleton ownership

- [ ] 2.1 Add controller build/version/protocol identity exposed through a safe loopback endpoint.
- [ ] 2.2 Add a data-directory-scoped controller singleton/ownership lock with atomic acquisition.
- [ ] 2.3 Validate existing lock PID/process liveness before reuse/reclaim; reclaim only demonstrably stale ownership.
- [ ] 2.4 Ensure graceful shutdown releases owned runtime-lock metadata.
- [ ] 2.5 Detect foreign port listeners without killing them; surface a structured `PORT_CONFLICT`-equivalent diagnostic.
- [ ] 2.6 Detect incompatible Orca controller build/protocol identity without silently mixing binaries or terminating the other process.
- [ ] 2.7 Protect concurrent desktop startups so at most one controller is created.

## 3. Packaged desktop controller supervision

- [ ] 3.1 Implement desktop `ensureController` startup flow: probe compatible controller first, spawn only when absent, await readiness, reuse on relaunch.
- [ ] 3.2 Launch the controller with a self-contained packaged runtime; ordinary users must not need a system Node installation.
- [ ] 3.3 Ensure closing the Electron window does not terminate the controller merely because the UI closed.
- [ ] 3.4 Preserve `ORCA_UI_DEV_URL` / `scripts/dev.js` development semantics and prevent accidental duplicate production spawning in dev mode.
- [ ] 3.5 Implement bounded capped retry/backoff rather than infinite high-frequency retries.
- [ ] 3.6 Add actionable startup states for checking, starting, waiting, connected, port conflict, incompatible controller, and startup failed.
- [ ] 3.7 Add safe Retry behavior and concise diagnostics to the desktop startup surface.

## 4. Production resource/data path contract

- [ ] 4.1 Introduce explicit development-vs-packaged resource resolution for controller/UI assets.
- [ ] 4.2 Ensure production UI serving works when process `cwd` is unrelated to the repository/install tree.
- [ ] 4.3 Ensure SQLite, runtime locks, logs, browser profile, and generated state are external to packaged resources.
- [ ] 4.4 Verify no runtime write targets `process.resourcesPath`, asar, installer resources, or Program Files/install directory.
- [ ] 4.5 Preserve existing default user-local Orca data-directory behavior and `ORCA_DATA_DIR` test override.

## 5. Background-lifetime UX

- [ ] 5.1 Make it clear that closing the desktop window does not stop the background controller/autonomous work.
- [ ] 5.2 Implement the smallest reliable reopen/background UX (tray only if it materially improves the existing architecture; avoid unnecessary complexity).
- [ ] 5.3 If a full-controller Quit action is added, distinguish it from window close and guard active campaigns with explicit confirmation/refusal; otherwise document the lifecycle and omit unsafe destructive UI.

## 6. System readiness / doctor

- [ ] 6.1 Add a controller-level readiness model using `READY`, `ACTION_REQUIRED`, `OPTIONAL`, and `UNKNOWN` (or equivalent stable statuses).
- [ ] 6.2 Include safe controller build/version, writable data dir, DB initialization, Git executable/version, Chrome availability/version, ChatGPT auth readiness, configured executor availability, and repository-path validity.
- [ ] 6.3 Make WSL checks conditional on WSL-configured repositories.
- [ ] 6.4 Keep Tailscale and OpenCode optional unless explicitly required by configured capability; preserve their current external-unqualified truth.
- [ ] 6.5 Add a Settings `System Readiness`/`Doctor` section with refresh, blocking-vs-optional distinction, and remediation text.
- [ ] 6.6 Do not auto-install credentials, sign into ChatGPT, approve elevation, or mutate executor authentication.

## 7. Packaged logging and diagnostics

- [ ] 7.1 Ensure packaged controller stdout/stderr/startup diagnostics persist under a bounded external log directory.
- [ ] 7.2 Reuse/extend existing log-rotation primitives where appropriate and prevent unbounded growth.
- [ ] 7.3 Keep secrets/cookies/tokens/redacted values out of diagnostics.
- [ ] 7.4 Point desktop startup failures to a safe diagnostic/log location when useful.

## 8. Upgrade/data preservation

- [ ] 8.1 Document and test that package upgrade/reinstall preserves DB, repositories, run history, permissions, browser profile/auth, and other intended user data.
- [ ] 8.2 Ensure DB migrations remain controller-owned and incompatible schema/build conditions fail safely rather than resetting state.
- [ ] 8.3 Ensure installer/package operations never silently delete the external Orca data directory.

## 9. Focused tests

- [ ] 9.1 Controller singleton happy-path and concurrent-start race.
- [ ] 9.2 Stale-lock recovery and live-lock refusal.
- [ ] 9.3 Foreign-port collision without kill.
- [ ] 9.4 Compatible-controller reuse and incompatible-controller refusal.
- [ ] 9.5 Packaged/development resource path resolution independent of `cwd`.
- [ ] 9.6 Desktop startup state/backoff/retry behavior.
- [ ] 9.7 Background controller survival after Electron window close.
- [ ] 9.8 Doctor classification including optional Tailscale/OpenCode and conditional WSL.
- [ ] 9.9 Logging/retention and secret-redaction invariants where feasible.

## 10. Real Windows packaged-runtime smoke

- [ ] 10.1 Build the real unpacked/package artifact before the smoke; do not use TS dev entrypoints as a substitute.
- [ ] 10.2 Run with isolated temporary `ORCA_DATA_DIR` and isolated port where practical.
- [ ] 10.3 Prove packaged desktop starts with no manually prestarted controller.
- [ ] 10.4 Prove packaged controller becomes healthy and serves the built React UI/API.
- [ ] 10.5 Prove controller reports expected build/version identity.
- [ ] 10.6 Prove DB/log/runtime files are created only in the isolated external writable directory.
- [ ] 10.7 Close Electron and prove the controller remains alive.
- [ ] 10.8 Relaunch Electron and prove it reconnects to the same controller without a duplicate spawn.
- [ ] 10.9 Prove persisted test state survives close/reopen.
- [ ] 10.10 Explicitly tear down only the isolated test controller and verify no runtime writes occurred inside package resources.
- [ ] 10.11 Record artifact filename, byte size, SHA-256, version, architecture, signing status, and exact smoke verdict.

## 11. CI / release engineering

- [ ] 11.1 Add Windows CI for `npm ci`, fast tests, typecheck, build, lint, strict OpenSpec, and diff check.
- [ ] 11.2 Add Windows packaging workflow (manual and/or tag/branch trigger) that builds the package and uploads installer/unpacked artifacts.
- [ ] 11.3 Preserve useful logs/artifacts on packaging failure.
- [ ] 11.4 Distinguish CI `PACKAGE_BUILT` from real local `PACKAGE_RUNTIME_QUALIFIED` when hosted CI cannot execute the full desktop smoke.
- [ ] 11.5 Do not require unavailable signing credentials; label unsigned artifacts truthfully.

## 12. Security audit

- [ ] 12.1 Verify controller remains loopback-only by default and packaging does not introduce a `0.0.0.0` bind.
- [ ] 12.2 Preserve Electron `contextIsolation`, disabled `nodeIntegration`, sandbox protections, and external-link OS handling.
- [ ] 12.3 Add no dangerous preload bridge or shell command construction from untrusted UI input.
- [ ] 12.4 Ensure no package resource contains runtime secrets and no supervisor path can kill unrelated processes.
- [ ] 12.5 Add regression tests for concrete security invariants discovered during implementation.

## 13. Documentation and durable state

- [ ] 13.1 Update README with development vs packaged setup, Windows build/install/run, first launch, ChatGPT setup, executor prerequisites, data/log paths, controller background behavior, and unsigned status.
- [ ] 13.2 Update ARCHITECTURE for packaged desktop/controller process topology and singleton supervision.
- [ ] 13.3 Update DEVELOPMENT, SECURITY, TEST-STRATEGY, and ROADMAP with package build/smoke/release truth.
- [ ] 13.4 Keep Change-024 real-dogfood evidence intact.
- [ ] 13.5 Update `.agent/state.json` at major checkpoints and never leave it pointing to completed Change 024.

## 14. Final qualification and closeout

- [ ] 14.1 Run focused suites while iterating; do not waste the start of the session on a broad historical baseline.
- [ ] 14.2 Final gates: `npm test`, `npm run test:real`, `npm run typecheck`, `npm run build`, `npm run lint`, `npx openspec validate --all --strict`, and `git diff --check`.
- [ ] 14.3 Run the actual Windows package commands and real packaged-runtime smoke on the final implementing tree.
- [ ] 14.4 Record all real evidence; no historical result substitutes for Change 025 qualification.
- [ ] 14.5 Fold Change 025 into canonical specs and archive only after implementation + evidence are complete.
- [ ] 14.6 Mark Milestone 23 with the exact achieved status, preserve Tailscale/OpenCode external blockers, advance `.agent/state.json`, commit/push all intended work to `main`, and leave `main == origin/main` with a clean worktree.
