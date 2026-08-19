# Change 001: Bootstrap Control Plane

## Status

**Ready for implementation**

Roadmap milestone: **1 — Bootstrap control plane**

## Why

Orca-Strator currently has a locked V1 architecture and durable development process but no runnable application foundation.

Later milestones depend on several boundaries being correct from the start:

- autonomous work must continue independently of whether an Electron window is open;
- the same repository data/status must be consumable by desktop and phone UIs;
- phone access must not rely on phone-local `localhost` reaching the Windows controller;
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
7. a same-origin built/runtime web seam where controller serves the SPA plus `/api` and WebSocket, while Vite proxies those relative routes in development;
8. an Electron Windows shell that does not become the orchestration owner;
9. a repository dashboard/add-edit/detail foundation supporting multiple independent repositories;
10. repeatable build/typecheck/test/development commands;
11. enough automated verification that later milestones can safely extend these contracts.

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
- Tailscale Serve configuration or lifecycle management;
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
- V1 Git integration is fixed to `main`; there is no branch field in repository configuration;
- controller owns runtime truth, not Electron;
- GitHub/Git will later carry durable cross-agent handoffs;
- SQLite carries local orchestration state;
- phone UI later reuses the same responsive frontend through a Tailscale Serve reverse proxy to the single loopback Orca web endpoint;
- UI application code uses relative same-origin API/WebSocket routes rather than a production hard-coded localhost backend URL.

## User-visible outcome

After Change 001, the user should be able to launch Orca-Strator and:

1. see whether the local controller is reachable;
2. view a list of configured repositories;
3. add a repository configuration;
4. choose Windows or WSL execution environment;
5. enter the relevant local path and WSL distribution/path when applicable;
6. configure GitHub remote, executor CLI/model string, dedicated Sol conversation URL, and safety ceilings;
7. edit/delete/view repository configuration;
8. restart the controller and see the same records restored;
9. close/reopen Electron without losing controller-owned data;
10. use the core UI at a narrow phone-sized viewport;
11. run the built UI directly from the controller's loopback origin with REST/WebSocket on that same origin.

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
- `apps/controller` depends on shared contracts and owns DB/API services plus the small built-SPA transport layer;
- `apps/ui` depends on shared API/domain contracts but never imports controller internals or SQLite;
- `apps/desktop` hosts/loads the UI and avoids owning repository/orchestration state.

Electron renderer code must not directly open SQLite or execute repository processes.

## Same-origin web outcome

Change 001 establishes this built/runtime shape:

```text
http://127.0.0.1:<orca-port>/
  /                 built React SPA
  /api/*             REST
  /api/events        WebSocket
```

Shared UI code calls relative `/api` paths and derives WebSocket scheme/host from the page origin.

In development, Vite proxies those same relative paths to the controller.

This is deliberately established now so Milestone 7 can place Tailscale Serve in front of the same loopback origin without rewriting UI networking or adding wildcard CORS.

Change 001 does **not** configure Tailscale itself.

## Persistence outcome

SQLite initializes automatically and supports ordered migrations from the first version.

Change 001 only needs static repository configuration persistence. Run goals, current actor, iterations, PIDs, and other changing autonomous-run state belong to later runtime tables/milestones.

Runtime database files are machine-local and MUST NOT be committed to Git.

## API outcome

The controller exposes a loopback-only web/API boundary with:

- built SPA/static serving in production-like mode;
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
- avoid hiding critical behavior behind Electron-only IPC when HTTP/WebSocket are the intended shared boundary;
- controller remains loopback-only in Change 001;
- do not use wildcard CORS as a shortcut for future phone access;
- built static serving must never expose the Orca data directory, DB, logs, or browser-profile content;
- preserve `.gitattributes`, `.editorconfig`, and `.gitignore` baselines already seeded in repository.

## Implementation strategy

Recommended order:

1. establish workspace/tooling and shared contracts;
2. implement controller configuration + SQLite migration/storage layer;
3. implement repository service and API/event boundary;
4. scaffold React UI using relative same-origin API/WebSocket paths, with Vite development proxy;
5. add repository CRUD flows and responsive status/detail foundation;
6. serve built SPA from controller and prove deep-link/API routing behavior;
7. add Electron shell around the same UI/origin model;
8. exercise persistence/restart/network/integration behavior;
9. complete full build/typecheck/test baseline;
10. update durable development state and prepare deep review before Change 002.

## Risks to resolve during this change

### SQLite runtime/packaging compatibility

Prefer the smallest SQLite approach that works reliably with selected supported Node runtime and later Electron packaging. Keep SQL behind a small storage layer.

### Dev process coordination

Controller, Vite, and Electron must be startable together without making Electron the persistence owner. Development convenience scripts may supervise processes, but ownership boundaries remain clear.

### Same-origin static/UI routing

SPA history fallback must not shadow `/api/*` or WebSocket endpoints. The controller must serve only known UI build assets, not arbitrary filesystem/runtime data.

### Windows/WSL path ambiguity

Repository configuration must not assume one path format. WSL repositories require Linux working-directory semantics plus configured distro; Windows repositories require native Windows path semantics.

### Premature runtime-state design

Later autonomous states are defined in `docs/RUNTIME-MODEL.md`, but Change 001 only models static repository configuration and minimal UI connection/configuration state. Do not implement autonomous state machine or run-goal persistence early.

## Success criteria

Change 001 is complete only when all detailed delta-spec requirements/tasks are satisfied, including:

- clean fresh install/start path documented;
- controller runs independently;
- repository CRUD persists through restart;
- Windows/WSL invariants validated;
- V1 repository data/API/UI contain no configurable branch field and assume `main`;
- UI uses controller API rather than direct persistence;
- UI source uses relative same-origin REST/WebSocket paths;
- Vite development proxy supports same client code;
- controller serves built SPA and API/WebSocket on one origin;
- SPA deep-link fallback does not shadow API routes;
- multiple repository records render independently;
- Electron hosts same responsive UI;
- narrow viewport usable;
- controller persistence survives Electron closure/reopen;
- automated tests cover validation/storage/API/network foundation;
- root typecheck/test/build baseline repeatable;
- no later-milestone automation accidentally implemented;
- `.agent/state.json`, OpenSpec tasks, and roadmap advanced to clear review waypoint.

## Review handoff

After implementation, perform a deep repository review before Change 002. Review should specifically challenge:

- package/dependency boundaries;
- whether controller truly owns state independently of Electron;
- SQLite migration/storage design;
- API/event contracts;
- same-origin static/API/WebSocket delivery seam;
- Windows/WSL repository semantics;
- whether unnecessary branch/run-state fields leaked into configuration;
- responsive UI architecture;
- unnecessary dependencies/abstractions;
- test quality and developer startup reproducibility.

Fix foundational issues before adding repository watchers and process execution.
