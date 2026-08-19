# Orca-Strator V1 Implementation Blueprint

Status: **normative implementation guidance for V1**

This document turns the product architecture into concrete package/module boundaries. It is intentionally detailed so fresh `/go` sessions do not repeatedly redesign the application structure.

If implementation evidence requires a material deviation, update this document and the active OpenSpec design in the same checkpoint.

## 1. Repository layout target

```text
orca-strator/
├── apps/
│   ├── controller/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── app.ts
│   │   │   ├── config/
│   │   │   │   └── load-config.ts
│   │   │   ├── db/
│   │   │   │   ├── database.ts
│   │   │   │   ├── migrate.ts
│   │   │   │   └── migrations/
│   │   │   ├── repositories/
│   │   │   │   ├── repository-store.ts
│   │   │   │   ├── repository-service.ts
│   │   │   │   └── repository-mapper.ts
│   │   │   ├── http/
│   │   │   │   ├── server.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── static-ui.ts
│   │   │   │   └── routes/
│   │   │   │       ├── health.ts
│   │   │   │       └── repositories.ts
│   │   │   ├── events/
│   │   │   │   ├── event-bus.ts
│   │   │   │   └── websocket.ts
│   │   │   └── logging/
│   │   │       └── logger.ts
│   │   └── test/
│   ├── ui/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── app/
│   │   │   │   ├── App.tsx
│   │   │   │   └── router.tsx
│   │   │   ├── api/
│   │   │   │   ├── client.ts
│   │   │   │   └── events.ts
│   │   │   ├── features/
│   │   │   │   └── repositories/
│   │   │   │       ├── RepositoryList.tsx
│   │   │   │       ├── RepositoryCard.tsx
│   │   │   │       ├── RepositoryForm.tsx
│   │   │   │       ├── RepositoryDetail.tsx
│   │   │   │       └── repository-form.ts
│   │   │   ├── components/
│   │   │   └── styles/
│   │   └── test/
│   └── desktop/
│       ├── src/
│       │   ├── main.ts
│       │   ├── window.ts
│       │   └── config.ts
│       └── assets/
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── index.ts
│       │   ├── repository.ts
│       │   ├── api.ts
│       │   ├── events.ts
│       │   ├── errors.ts
│       │   └── validation.ts
│       └── test/
├── schemas/
│   └── protocol/
├── .agent/
├── .agents/
├── docs/
├── openspec/
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── .editorconfig
├── .gitattributes
└── .gitignore
```

This is a target, not a mandate to create empty placeholder files. Create modules when their responsibility becomes real.

## 2. Dependency direction

Dependency flow SHALL remain:

```text
packages/shared
      ^
      |
apps/controller     apps/ui
                         ^
                         |
                    apps/desktop
```

Rules:

1. `packages/shared` imports from no app package.
2. `apps/controller` may import shared contracts but never UI/Desktop source modules.
3. `apps/ui` may import shared contracts but never controller implementation modules.
4. `apps/desktop` hosts/loads the UI but must not become the persistence/orchestration owner.
5. UI-to-controller communication occurs through HTTP/WebSocket contracts, not direct imports.
6. The built UI may be **served by** the controller without becoming **owned by** controller domain code.

## 3. Controller boot sequence

Controller startup should be deterministic:

```text
process start
  -> load environment/config
  -> resolve data directory
  -> initialize logger
  -> open SQLite
  -> run migrations
  -> initialize stores/services
  -> create event bus
  -> register API routes
  -> register WebSocket endpoint
  -> register built-UI static/SPA serving when configured
  -> listen on loopback
  -> emit startup-ready log
```

If database migration or listener startup fails, the controller must fail clearly rather than advertise a false healthy state.

## 4. Controller ownership boundary

The controller owns:

- persisted repository configuration;
- runtime data directory;
- API validation and domain services;
- SQLite migrations;
- real-time event publication;
- one loopback web listener;
- later watcher/executor/browser managers;
- later run state machines and recovery.

The controller may **serve compiled UI assets** as transport/infrastructure. This does not move React/UI state or presentation logic into the controller.

The controller does not own:

- React rendering/state;
- Electron window lifecycle;
- browser UI navigation state.

## 5. Shared same-origin web contract

The built/runtime topology is intentionally one origin:

```text
http://127.0.0.1:47100/
  /                 React SPA
  /assets/*          built static assets
  /api/*             REST
  /api/events        WebSocket
```

The shared UI source uses **relative URLs** only for normal API/event access.

### Development

```text
Vite dev origin
  /api/*       -> proxy to http://127.0.0.1:47100
  /api/events  -> WebSocket proxy to controller
```

The same UI client code therefore runs unchanged.

### Electron built/local mode

Prefer loading the controller-served local UI URL rather than inventing a `file://` + separate CORS/API-host path. This gives the desktop build the same runtime origin model later used remotely.

If packaging eventually requires another trusted local delivery mechanism, it must preserve relative API/event semantics and avoid duplicating the client.

### Phone later

Tailscale Serve reverse-proxies `127.0.0.1:47100`. The phone loads the Tailscale HTTPS URL and relative `/api`/WebSocket traffic remains same-origin through the proxy.

Change 001 implements the single-origin local web seam. Milestone 7 configures/qualifies Tailscale itself.

## 6. Static UI serving rules

The controller's built-UI serving layer should remain tiny and isolated.

Requirements:

- only serve the known UI build directory;
- never expose `%LOCALAPPDATA%\Orca-Strator`, DB, logs, runtime, or browser-profile directories;
- `/api/*` and `/api/events` always take precedence over SPA fallback;
- known static assets resolve normally;
- non-API client routes such as `/repositories/<id>` fall back to the SPA shell;
- no directory listing;
- no general filesystem-serving endpoint;
- avoid wildcard CORS because normal runtime is same-origin.

## 7. Shared contract design

Keep shared contracts runtime-safe and small.

Preferred pattern:

```ts
export type ExecutionEnvironment = "windows" | "wsl";

export interface RepositoryRecord { ... }
export interface CreateRepositoryInput { ... }
export interface UpdateRepositoryInput { ... }
```

Runtime validation MUST exist at process/API boundaries. It may use a small schema library if selected during implementation; avoid generating a second parallel model hierarchy.

One contract should not have three subtly different names/shapes in SQL, controller, and UI unless the distinction is intentional.

V1 repository contracts MUST NOT include a mutable/configurable branch field. `main` is a runtime invariant.

## 8. Controller configuration

Initial configuration inputs:

```text
ORCA_HOST             default 127.0.0.1
ORCA_PORT             default 47100
ORCA_DATA_DIR         optional absolute override
ORCA_LOG_LEVEL        optional; sane local default
ORCA_UI_DIST_DIR      optional explicit built-UI path when needed
NODE_ENV              normal development/test/production meaning
```

Runtime files must not be stored inside the Git checkout by default.

Recommended Windows production data root:

```text
%LOCALAPPDATA%\Orca-Strator\
```

Suggested contents later:

```text
Orca-Strator/
├── orca-strator.sqlite
├── logs/
├── browser-profile/
└── runtime/
```

Built UI assets are application/package assets, not user runtime data.

Tests always override the data directory.

## 9. Repository domain object

The persisted repository record is configuration, not active-run state.

It contains:

- identity;
- GitHub remote;
- local execution location;
- Windows/WSL environment selection;
- executor CLI/model strings selected by user;
- Sol conversation URL;
- safety defaults;
- timestamps.

It does **not** contain a V1 branch field. All runtime Git operations use `main`.

Do not add rapidly changing runtime fields such as `currentIteration`, PID, run goal, or `SOL_REVIEWING` to the Change 001 repositories table.

## 10. API layering

Request path:

```text
HTTP route
 -> parse/validate request
 -> repository service
 -> repository store
 -> SQLite
```

Response path:

```text
SQLite row
 -> mapper
 -> domain/shared record
 -> HTTP response
```

Routes remain thin. SQL belongs in storage modules, not handlers.

## 11. Event model

Change 001 events are ephemeral synchronization hints.

```text
successful service mutation
   -> persistence succeeds
   -> publish event
   -> WebSocket clients receive hint
   -> clients may update/refetch
```

Never emit a successful mutation event before persistence succeeds.

Do not build event sourcing, durable queues, replay logs, or cross-machine brokers in Change 001.

## 12. UI data flow

Preferred UI flow:

```text
React page
  -> typed relative API client
  -> /api/* on current origin
  -> controller

controller WebSocket event
  -> current-origin /api/events
  -> invalidate/refetch relevant repository data
```

Do not let every component independently invent fetch/error/retry behavior. Centralize API client and connection state.

The client should derive `ws:`/`wss:` from `window.location` rather than hard-code a host.

## 13. UI navigation baseline

Initial routes may be:

```text
/                      repository dashboard
/repositories/new      add repository
/repositories/:id      repository detail
/repositories/:id/edit edit repository
```

Deep-linkable URL routes are preferred. Built-mode server fallback must allow a refresh of these routes without returning 404.

## 14. Repository form behavior

Required fields:

- display name;
- GitHub remote;
- environment;
- local path;
- WSL distribution when environment = `wsl`;
- executor CLI;
- executor model/config string;
- Sol conversation URL;
- max iterations;
- max runtime minutes.

Behavior:

- Git integration is fixed to `main` and is not a form field;
- limits start as 20 / 480;
- WSL distribution appears only for WSL;
- switching WSL -> Windows must not submit stale invalid WSL-only data;
- server errors must not wipe typed values;
- successful create navigates to or clearly reveals persisted record.

## 15. Electron boundary

Electron V1 is a shell, not a second backend.

Baseline BrowserWindow guidance:

- `contextIsolation: true`;
- avoid broad `nodeIntegration: true` in renderer;
- do not expose arbitrary filesystem/process primitives to web content;
- load only trusted Orca local/dev origins;
- external links should not silently become privileged app content.

Change 001 does not need custom Electron IPC for repository CRUD because HTTP/WebSocket already provide the controller boundary.

In development Electron loads Vite. In built/local mode it should prefer the controller-served Orca origin.

## 16. Development process supervision

The root `npm run dev` should coordinate:

- controller dev process;
- Vite dev server with API/WebSocket proxy;
- Electron dev shell.

Use the smallest reliable process coordination dependency or npm script strategy. Do not invent an internal process supervisor in Change 001.

Controller must remain runnable separately for tests and headless development.

A production-like local smoke command should be able to build the SPA, run the controller serving it, and exercise the resulting single-origin web endpoint without Electron.

## 17. Cross-platform repository hygiene

Because Orca-Strator itself is developed on Windows and may be inspected/edited from WSL:

- `.gitattributes` normalizes normal text files to LF in Git;
- Windows `.bat`/`.cmd` scripts remain CRLF;
- `.editorconfig` provides UTF-8/LF/two-space editor baseline;
- `.gitignore` excludes local databases, browser-profile/auth state, logs, environment secrets, dependencies, and generated outputs;
- `.orca/` is **not** globally ignored because managed repositories intentionally commit Orca coordination artifacts.

Implementation must preserve these files rather than replacing them with narrower scaffold defaults.

## 18. Test boundaries

Tests align with responsibility:

```text
packages/shared  -> validation/default/contract tests
controller/db     -> migration/store tests
controller/http   -> REST/static-SPA tests
controller/events -> WebSocket tests
ui                -> component/form/API-state/network-route tests
desktop           -> focused launch/integration verification
```

Key network tests include:

- UI uses relative API URLs;
- Vite proxies REST/WebSocket in dev;
- built controller serves SPA and API same-origin;
- SPA deep-link fallback never shadows `/api`;
- `wss:` is derived under HTTPS origin;
- no wildcard CORS is required by normal runtime topology.

## 19. Change 001 definition of done

Change 001 is done only when:

1. a fresh supported Windows checkout installs successfully;
2. root typecheck/test/build/lint commands are documented and run;
3. controller starts independently on loopback;
4. SQLite migrations create a persistent repository registry;
5. repository CRUD works through REST;
6. mutation events work through WebSocket;
7. UI can create/edit/list/delete Windows and WSL records;
8. UI handles disconnected controller distinctly from empty state;
9. narrow phone-like width remains usable;
10. built UI can be served by the controller from the same origin as REST/WebSocket;
11. Vite development proxy lets the same relative API client work in development;
12. Electron displays the same UI and does not own persistence;
13. controller restart preserves data;
14. closing/reopening Electron does not erase data;
15. repository configuration/API/UI expose no configurable branch field;
16. no active-run fields leak into static repository configuration;
17. no watcher/executor/Playwright pseudo-implementation leaks into the milestone;
18. hygiene/security files remain intact;
19. all OpenSpec tasks and durable waypoint are reconciled to reality;
20. repository is pushed to `main` and ready for deep Sol review.
