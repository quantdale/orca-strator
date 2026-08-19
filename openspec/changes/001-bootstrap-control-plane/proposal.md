# Change 001: Bootstrap Control Plane

## Status

**Ready for implementation**

Roadmap milestone: **1 — Bootstrap control plane**

## Why

Orca-Strator currently has a locked V1 architecture and durable development process but no runnable application foundation.

Later milestones depend on several boundaries being correct from the start:

- autonomous work must continue independently of whether an Electron window is open;
- the same repository data/status must be consumable by desktop and phone UIs;
- Windows and WSL repository targets must share one configuration model without conflating their path/process semantics;
- multiple repositories must be represented independently from day one;
- future watcher/executor/Playwright subsystems need a stable controller/service/storage boundary rather than being added directly into UI components;
- local runtime state must have a migration-safe persistent home before long-running automation is introduced.

If these foundations are wrong, later autonomous behavior will become tightly coupled, hard to recover, and expensive to refactor. Change 001 therefore builds the smallest real control plane and deliberately stops before autonomous execution.

## Goals

Build a runnable Windows-first Orca-Strator skeleton that provides:

1. a TypeScript workspace with clear package/application boundaries;
2. a standalone local controller process that owns persistence and API state;
3. SQLite-backed durable repository configuration;
4. runtime-safe repository configuration validation for Windows and WSL targets;
5. a localhost HTTP API and real-time event channel;
6. a single responsive React UI used by Electron and later phone access;
7. an Electron Windows shell that does not become the orchestration owner;
8. a repository dashboard/add-edit/detail foundation supporting multiple independent repositories;
9. repeatable build/typecheck/test/development commands;
10. enough automated verification that later milestones can safely extend these contracts.

## Non-goals

Change 001 MUST NOT implement partial versions of later automation just because seams exist for them.

Out of scope:

- Git/GitHub remote polling;
- `.orca/dispatch/*` handling;
- executor process launching;
- Kimi/Codex/Claude adapters;
- Playwright or ChatGPT login/wake automation;
- autonomous run state progression;
- runtime Pause/Stop/Emergency Kill execution behavior;
- Tailscale Serve configuration;
- phone notifications;
- Windows service installation/production auto-start;
- multi-session/multi-branch execution inside one repository;
- dynamic model selection/routing;
- public internet exposure.

Placeholders/types may anticipate known future states only when doing so materially avoids a near-immediate breaking contract. Do not build fake functionality.

## Product assumptions carried into this change

These are already locked and should shape the foundation:

- main application: Windows-only V1;
- executor targets later: native Windows/PowerShell or WSL;
- one repository = one Orca session in V1;
- one configured Sol conversation per repository;
- one active executor max per repository;
- different repositories may run concurrently with no global executor cap;
- user owns executor CLI/model selection;
- default integration branch is `main`, configurable per repository;
- controller owns runtime truth, not Electron;
- GitHub/Git will later carry durable cross-agent handoffs;
- SQLite carries local orchestration state;
- phone UI later reuses the same responsive frontend.

## User-visible outcome

After Change 001, the user should be able to launch Orca-Strator and:

1. see whether the local controller is reachable;
2. view a list of configured repositories;
3. add a repository configuration;
4. choose Windows or WSL execution environment;
5. enter the relevant local path and WSL distribution/path when applicable;
6. configure GitHub remote, branch, executor CLI/model string, dedicated Sol conversation URL, and safety ceilings;
7. edit/delete/view repository configuration;
8. restart the controller and see the same records restored;
9. close/reopen Electron without losing controller-owned data;
10. use the core UI at a narrow phone-sized viewport.

No Start/Autonomous Run button should pretend to work yet unless it is clearly disabled/marked as a future milestone.

## Architectural outcome

Expected dependency direction:

```text
packages/shared
   ^        ^
   |        |
controller  ui
              ^
              |
           desktop
```

More precisely:

- `packages/shared` contains serializable contracts/validation primitives and has no dependency on app packages;
- `apps/controller` depends on shared contracts and owns DB/API services;
- `apps/ui` depends on shared API/domain contracts but never imports controller internals or SQLite;
- `apps/desktop` hosts/loads the UI and avoids owning repository/orchestration state.

Electron renderer code must not directly open SQLite or execute repository processes.

## Persistence outcome

SQLite must initialize automatically and support ordered migrations from the first version.

Change 001 only needs repository configuration persistence, but the migration mechanism must be usable later for runtime/run/event tables.

Runtime database files are machine-local and MUST NOT be committed to Git.

## API outcome

The controller exposes a localhost-only API with:

- health/readiness endpoint;
- repository list/create/read/update/delete operations;
- structured validation/errors;
- real-time repository mutation events.

The UI obtains repository state exclusively through this controller boundary.

## Quality and security constraints

- do not store API keys, ChatGPT cookies, passwords, tokens, or browser profile data in repository records;
- validate external input at controller/API boundaries;
- do not leak raw internal stack traces as normal API payloads;
- keep database migrations deterministic and testable;
- use temporary/isolated database paths in automated tests;
- avoid an ORM/plugin framework unless a concrete need appears;
- avoid hiding critical behavior behind Electron-only IPC when localhost API contracts are the intended shared boundary;
- do not expose the controller beyond localhost in Change 001.

## Implementation strategy

Recommended order:

1. establish workspace/tooling and shared contracts;
2. implement controller configuration + SQLite migration/storage layer;
3. implement repository service and API/event boundary;
4. scaffold React UI against the real API;
5. add repository CRUD flows and responsive status/detail foundation;
6. add Electron shell around the same UI;
7. exercise persistence/restart/integration behavior;
8. complete full build/typecheck/test baseline;
9. update durable development state and prepare deep review before Change 002.

This ordering keeps each layer testable before the next UI/shell layer depends on it.

## Risks to resolve during this change

### SQLite runtime/packaging compatibility

Prefer the smallest SQLite approach that works reliably with the selected supported Node runtime and later Electron packaging. Keep SQL access behind a small storage layer so the implementation can change without changing controller/domain contracts.

### Dev process coordination

Controller, Vite, and Electron must be startable together without making Electron the parent/source-of-truth for persistence. Development convenience scripts may supervise processes, but ownership boundaries must remain clear.

### Windows/WSL path ambiguity

Repository configuration must not assume one path format. WSL repositories require Linux working-directory semantics plus configured distro; Windows repositories require native Windows path semantics.

### Premature runtime-state design

Later autonomous states are already defined in `docs/RUNTIME-MODEL.md`, but Change 001 should only model the minimal status/config fields required for a coherent dashboard. Do not implement the autonomous state machine early.

## Success criteria

Change 001 is complete only when all detailed delta-spec requirements and tasks are satisfied, including these top-level gates:

- clean fresh install/start path documented;
- controller runs independently;
- repository CRUD persists through restart;
- Windows/WSL invariants are validated;
- UI uses controller API rather than direct persistence;
- multiple repository records render independently;
- Electron hosts the same responsive UI;
- narrow viewport is usable;
- controller persistence survives Electron closure/reopen;
- automated tests cover validation/storage/API foundation;
- root typecheck/test/build baseline is repeatable;
- no later-milestone automation was accidentally implemented;
- `.agent/state.json`, OpenSpec tasks, and roadmap are advanced to a clear review waypoint.

## Review handoff

After implementation, perform a deep repository review before Change 002. The review should specifically challenge:

- package/dependency boundaries;
- whether controller truly owns state independently of Electron;
- SQLite migration/storage design;
- API/event contracts;
- Windows/WSL repository configuration semantics;
- responsive UI architecture;
- unnecessary dependencies/abstractions;
- test quality and developer startup reproducibility.

Fix foundational issues before adding repository watchers and process execution.
