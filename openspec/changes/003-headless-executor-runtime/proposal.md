# Change 003: Headless Executor Runtime

## Status

**Ready for implementation**

Roadmap milestone: **3 — Headless executor runtime**

## Why

Milestone 2 delivered the remote Git watcher and transactional dispatch detection. To execute the work specified in a dispatch, Orca needs a headless executor runtime that can supervise user-configured coding agent CLIs in native Windows/PowerShell or WSL, capture live stdout/stderr logs, validate executor result manifests, and provide safe operational controls (Pause, Resume, Kill, Stop).

## Goals

1. Define TypeScript types and Zod schemas for `ExecutorResult` in `@orca/shared` matching `schemas/protocol/executor-result.schema.json`.
2. Implement native `WindowsPowerShellAdapter` and `WslAdapter` for executing coding-agent CLIs with environment variables (`ORCA_RUN_ID`, `ORCA_DISPATCH_ID`, `ORCA_DISPATCH_PATH`, etc.).
3. Formulate the stable small bootstrap instruction prompt for headless executors.
4. Implement `ExecutorRunner` with process-tree supervision, live stdout/stderr buffering/file logging, and timeout ceilings.
5. Add SQLite migration `003_create_executor_runs` and `ExecutorStore` for run attempt history and state persistence.
6. Implement `ResultInspector` to validate `.orca/results/<dispatchId>.json` published by executors.
7. Implement run controls: `pause()`, `resume()`, `kill()`, and graceful `stop()`.
8. Expose executor status, log streaming, and control endpoints over REST and WebSocket.
9. Build a deterministic `FakeExecutor` for automated qualification and unit/integration tests without third-party CLI dependencies.
10. Verify clean-output builds, typechecks, and tests across all workspaces.

## Non-goals inside 003

- Sol Playwright browser wake bridge (belongs to Milestone 4).
- High-level multi-repository autonomous state machine loop (belongs to Milestone 5).
- Phone control or Tailscale setup (belongs to Milestone 7).
