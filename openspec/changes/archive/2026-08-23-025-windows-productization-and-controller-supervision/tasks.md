# Tasks: Windows productization and release qualification

## 0. Durable-state repair and audit

- [x] 0.1 Reconcile `.agent/state.json` with Git truth: Milestone 22 / Change 024 is complete, completedMilestones includes 22, and Change 025 becomes active.
- [x] 0.2 Inspect root/package workspaces, Electron lifecycle, controller startup/shutdown/config, UI system settings, logging, docs, and existing test harnesses before choosing packaging details.
- [x] 0.3 Record the selected packaged controller launch strategy and why it preserves controller independence without requiring system Node. (implementation-notes.md)

## 1. Windows package pipeline

- [x] 1.1 Add a mature Electron Windows packaging tool/configuration (`electron-builder` 26.15.3; `apps/desktop/electron-builder.yml`).
- [x] 1.2 Add deterministic root/package scripts for unpacked Windows package and installer/distribution builds (`package:win`, `package:win:installer`).
- [x] 1.3 Bundle compiled desktop, controller, shared runtime, built React UI, required production dependencies, and required static assets (`scripts/package/prepare-controller-runtime.mjs` stages an exact-lockfile production closure incl. `@orca/shared`).
- [x] 1.4 Exclude DBs, browser profiles/cookies, repository worktrees, logs, local `.env`, executor credentials, and generated runtime state.
- [x] 1.5 Produce deterministic artifact names containing version and architecture; record signed/unsigned truth (`Orca-Strator-0.1.0-x64-setup.exe`, UNSIGNED).
- [x] 1.6 Prefer a per-user installer that does not require administrator elevation (NSIS oneClick=false perMachine=false).

## 2. Controller identity and singleton ownership

- [x] 2.1 Controller build/version/protocol identity exposed through `/api/system/identity` (and version in `/api/health`).
- [x] 2.2 Data-directory-scoped controller singleton lock with atomic acquisition (`runtime/singleton-lock.ts`, O_EXCL create).
- [x] 2.3 Existing lock PID liveness validated before reuse/reclaim; only demonstrably stale ownership reclaimed.
- [x] 2.4 Graceful shutdown releases owned runtime-lock metadata (index.ts SIGINT/SIGTERM + listen failure paths).
- [x] 2.5 Foreign port listeners detected without killing them; structured PORT_CONFLICT diagnostic (desktop supervisor state + controller exit code 11 on EADDRINUSE).
- [x] 2.6 Incompatible Orca controller build/protocol identity reported as INCOMPATIBLE_CONTROLLER without mixing or terminating.
- [x] 2.7 Concurrent desktop startups produce at most one controller (lock race + desktop re-probe after exit-code 10).

## 3. Packaged desktop controller supervision

- [x] 3.1 Desktop `ensureController`: probe → reuse/spawn/wait/reuse-on-relaunch (`controller-supervisor.ts`).
- [x] 3.2 Self-contained packaged runtime launch (ELECTRON_RUN_AS_NODE against staged controller entry; no system Node).
- [x] 3.3 Closing the Electron window does not terminate the controller (detached spawn, unref'd; proven by smoke 10.7).
- [x] 3.4 `ORCA_UI_DEV_URL` / `scripts/dev.js` development semantics preserved; production spawning never engages in dev mode (packaged flag gate).
- [x] 3.5 Bounded capped retry/backoff (45s budget, exponential poll cap 2s) rather than infinite high-frequency retries.
- [x] 3.6 Startup states CHECKING/STARTING/WAITING/CONNECTED/PORT_CONFLICT/INCOMPATIBLE/STARTUP_FAILED rendered in the window.
- [x] 3.7 Safe Retry action via isolated preload bridge (`orca-desktop.retryStartup`) plus concise diagnostics.

## 4. Production resource/data path contract

- [x] 4.1 Explicit development-vs-packaged resolution (`runtime/paths.ts`).
- [x] 4.2 Production UI serving independent of process cwd (module-relative resolution; smoke ran from arbitrary cwd).
- [x] 4.3 SQLite, runtime locks, logs, browser profile, generated state external to packaged resources (smoke 10.6a-d).
- [x] 4.4 No runtime write targets `process.resourcesPath`, asar, installer resources, or install dir (smoke 10.10b byte-size snapshot identical).
- [x] 4.5 Default user-local data-directory behavior and `ORCA_DATA_DIR` test override preserved.

## 5. Background-lifetime UX

- [x] 5.1 Closing the desktop window leaves background orchestration running; README documents this lifecycle.
- [x] 5.2 Smallest reliable reopen/background UX chosen: single-instance focus restore + relaunch reuse; tray deliberately omitted (would not materially improve the existing architecture).
- [x] 5.3 No destructive full-controller Quit UI added; lifecycle documented instead.

## 6. System readiness / doctor

- [x] 6.1 Controller-level readiness model READY / ACTION_REQUIRED / OPTIONAL / UNKNOWN at `/api/system/readiness`.
- [x] 6.2 Includes identity/version, writable data dir, DB init, Git version, Chrome availability, ChatGPT auth readiness, repository-path validity.
- [x] 6.3 WSL conditional on WSL-configured repositories.
- [x] 6.4 Tailscale/OpenCode optional unless configured; external-unqualified truth preserved.
- [x] 6.5 Settings "System Readiness" section with refresh, blocking-vs-optional distinction, remediation text.
- [x] 6.6 No auto-install, sign-in, elevation approval, or executor-auth mutation anywhere in the doctor path.

## 7. Packaged logging and diagnostics

- [x] 7.1 Packaged controller stdout/stderr/startup diagnostics persist under `<dataDir>/logs/controller.log` (bounded console redirect installed when ORCA_PACKAGED=1).
- [x] 7.2 Bounded growth: 5 MiB rotate-to-prev policy; existing LogRotator retained for executor logs.
- [x] 7.3 Secrets/cookies/tokens stay redacted (no new secret-bearing sinks; existing redaction untouched).
- [x] 7.4 Desktop STARTUP_FAILED diagnostics point to the Orca data-dir logs.

## 8. Upgrade/data preservation

- [x] 8.1 Upgrade contract documented (README); NSIS `deleteAppDataOnUninstall: false`; data lives outside install tree so upgrade preserves it (proven by close/reopen persistence in smoke).
- [x] 8.2 DB migrations remain controller-owned; incompatible builds fail diagnostically (identity protocol mismatch → INCOMPATIBLE_CONTROLLER), never reset.
- [x] 8.3 Installer/package operations never delete the external Orca data directory.

## 9. Focused tests

- [x] 9.1 `singleton-lock.test.ts`: happy path + concurrent acquisition race (exactly one owner).
- [x] 9.2 Stale-lock recovery and live-lock refusal (+ corrupt-lock reclaim, guarded foreign release).
- [x] 9.3 `controller-supervisor.test.ts`: foreign-port collision without kill/spawn.
- [x] 9.4 Compatible-controller reuse and incompatible-controller refusal.
- [x] 9.5 `runtime-paths.test.ts`: dev/packaged resolution independent of cwd; overrides.
- [x] 9.6 Desktop startup states/backoff/budget exhaustion + structured exit-code mapping.
- [x] 9.7 Background survival covered end-to-end by real packaged smoke 10.7 (unit tier has no Electron window).
- [x] 9.8 `system-readiness.test.ts` classification incl. optional Tailscale/OpenCode and conditional WSL.
- [x] 9.9 Logging retention/redaction: bounded rotation implemented; redaction invariants unchanged (existing suites).

## 10. Real Windows packaged-runtime smoke

- [x] 10.1 Built the real unpacked artifact before the smoke (`npm run package:win`, electron-builder win-unpacked).
- [x] 10.2 Isolated temp `ORCA_DATA_DIR` + isolated port 47191.
- [x] 10.3 Packaged desktop started with no manually prestarted controller.
- [x] 10.4 Controller became healthy and served the built React UI/API.
- [x] 10.5 Build identity matched expected version (0.1.0, protocol 1).
- [x] 10.6 DB/log/runtime files created only in the isolated external writable dir.
- [x] 10.7 Desktop root-pid-only kill proved controller remains alive.
- [x] 10.8 Relaunch reconnected to the same controller pid without duplicate spawn.
- [x] 10.9 Persisted API-created repository survived close/reopen.
- [x] 10.10 Teardown killed only the isolated controller; package-resource snapshot byte-identical.
- [x] 10.11 Recorded artifact filename, bytes, SHA-256, version, arch, UNSIGNED status, verdict PACKAGE_RUNTIME_QUALIFIED (release/package-smoke-report.json + ROADMAP Milestone 23 evidence).

Artifact evidence (2026-08-23, this tree):

- `apps/desktop/release/win-unpacked/Orca-Strator.exe` — 235,533,824 bytes — SHA256 6234D8A6E0F8C3ED07F5396E8F0672F4B9597B23CD4627C6438FAB6EB6CF7D2E
- `apps/desktop/release/Orca-Strator-0.1.0-x64-setup.exe` — 95,923,193 bytes — SHA256 72B3BEF9E1F0AB9BF9DF1858D4D2710DDDC1AF3C31CBE95A416E5C9A2D7DC63A
- Verdict: **PACKAGE_RUNTIME_QUALIFIED** (unpacked artifact, all 13 checks). Installer is PACKAGE_BUILT (per-user NSIS built successfully); silent-install execution was deliberately not run to avoid mutating the host machine outside the repository.

## 11. CI / release engineering

- [x] 11.1 `.github/workflows/windows-ci.yml`: npm ci, fast tests, typecheck, build, lint, strict OpenSpec, diff check on windows-latest.
- [x] 11.2 `.github/workflows/windows-package.yml` (tag v* + manual): builds unpacked + installer, uploads artifacts.
- [x] 11.3 Failure logs uploaded as artifacts.
- [x] 11.4 CI artifacts labeled PACKAGE_BUILT; PACKAGE_RUNTIME_QUALIFIED reserved for the executed local smoke.
- [x] 11.5 No signing credentials required; artifacts labeled UNSIGNED.

## 12. Security audit

- [x] 12.1 Controller loopback-only default unchanged (127.0.0.1); packaging introduces no 0.0.0.0 bind (smoke hit loopback only; config default intact).
- [x] 12.2 Electron contextIsolation, nodeIntegration=false, sandbox=true preserved; external links via OS shell.
- [x] 12.3 Preload bridge exposes only informational flags + retry invoke; no shell command construction from UI input.
- [x] 12.4 Package contains no runtime secrets (staging excludes .env/profiles/logs; prepare script copies dist+deps only); no supervisor path can kill unrelated processes (root-pid-only kills; foreign listeners never signalled — tested).
- [x] 12.5 Regression tests for concrete invariants: never-spawn/never-kill assertions (supervisor suite), lock foreign-release guard (singleton suite), package-resource immutability (smoke 10.10b).

## 13. Documentation and durable state

- [x] 13.1 README updated: development vs packaged setup, build/install/run, first launch, ChatGPT setup, executor prerequisites, data/log paths, background behavior, unsigned status.
- [x] 13.2 ARCHITECTURE updated: packaged desktop/controller topology + singleton supervision.
- [x] 13.3 DEVELOPMENT, SECURITY, TEST-STRATEGY, ROADMAP updated with package build/smoke/release truth.
- [x] 13.4 Change-024 dogfood evidence intact.
- [x] 13.5 `.agent/state.json` updated at checkpoints; never left pointing at completed Change 024.

## 14. Final qualification and closeout

- [x] 14.1 Focused suites used while iterating; no broad baseline at session start.
- [x] 14.2 Final gates: `npm test` (63 files / 351 tests green), `npm run test:real` (exit 0; 14 files passed / 1 EXPECTED_EXTERNAL_UNQUALIFIED skip; 65 tests / 66), `npm run typecheck` (exit 0), `npm run build` (exit 0 via package:win full build on final sources), `npm run lint` (exit 0), `npx openspec validate --all --strict` (24 passed / 0 failed), `git diff --check` (clean).
- [x] 14.3 Actual Windows package commands + real packaged-runtime smoke run on the implementing tree.
- [x] 14.4 Record all real evidence; no historical result substitutes for Change 025 qualification.
- [x] 14.5 Fold into canonical specs (`openspec/specs/windows-productization/`) and archive after implementation + evidence complete.
- [x] 14.6 Mark Milestone 23 with exact achieved status, preserve Tailscale/OpenCode blockers, advance waypoint, commit/push, leave main == origin/main clean.
