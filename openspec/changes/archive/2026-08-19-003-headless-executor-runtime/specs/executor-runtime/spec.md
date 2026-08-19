# Delta for Headless Executor Runtime

## Purpose

Supervise user-configured coding agents headlessly in Windows or WSL, capture live execution output, enforce runtime ceilings, validate result manifests, and provide safe operational controls.

## ADDED Requirements

### Requirement: Cross-environment process execution adapter

The runtime SHALL support process execution in both native Windows/PowerShell and WSL distributions based on repository configuration.

#### Scenario: Windows execution
- GIVEN a repository configured with `environment = "windows"`
- WHEN an executor process launches
- THEN commands execute in native Windows working directory with injected environment variables

#### Scenario: WSL execution
- GIVEN a repository configured with `environment = "wsl"` and a valid `wslDistribution`
- WHEN an executor process launches
- THEN commands execute via `wsl.exe -d <distro> --cd <linuxPath>` in the Linux environment

---

### Requirement: Stable bootstrap instruction prompt

The runtime SHALL provide a stable, small bootstrap instruction prompt to the executor without copying large prompts into CLI arguments.

#### Scenario: Bootstrap prompt generation
- GIVEN an active dispatch with `dispatchId`, `changePath`, and `goal`
- WHEN executor starts
- THEN bootstrap instructions identify the dispatch file, instructions to read repository artifacts, implement on `main`, run verification, and publish `.orca/results/<dispatchId>.json`

---

### Requirement: Process supervision, logging, and timeout enforcement

The runtime SHALL supervise the executor process tree, stream live stdout/stderr, write local log files, and enforce runtime ceilings.

#### Scenario: Live output capture
- GIVEN an executing process
- WHEN stdout or stderr lines are emitted
- THEN lines are buffered in memory, appended to a local log file, and broadcast over WebSocket

#### Scenario: Runtime ceiling enforcement
- GIVEN a repository configured with `maxRuntimeMinutes`
- WHEN execution exceeds the ceiling
- THEN the process tree is cleanly terminated and the run is marked timed out

---

### Requirement: Result manifest protocol validation

The system SHALL validate `.orca/results/<dispatchId>.json` against `schemas/protocol/executor-result.schema.json`.

#### Scenario: Valid result manifest
- GIVEN a result manifest containing valid `status` (`COMPLETED`, `BLOCKED`, `NEEDS_HUMAN`, `FAILED`), timestamps, commit SHAs, and verification items
- WHEN validated
- THEN validation succeeds and returns typed `ExecutorResult`

#### Scenario: Invalid result manifest
- GIVEN a result manifest missing required fields or having invalid enum values
- WHEN validated
- THEN validation fails and the result is rejected

---

### Requirement: Operational controls (Pause, Resume, Kill, Stop)

The controller SHALL expose endpoints to pause, resume, stop, and force-kill active executor processes.

#### Scenario: Emergency Kill
- GIVEN an active executor process
- WHEN `POST /api/repositories/:id/executor/kill` is invoked
- THEN the process tree is killed immediately on Windows or WSL

#### Scenario: Graceful Pause
- GIVEN an active executor process
- WHEN `POST /api/repositories/:id/executor/pause` is invoked
- THEN the process is stopped cleanly without fabricating a `FAILED` result manifest
