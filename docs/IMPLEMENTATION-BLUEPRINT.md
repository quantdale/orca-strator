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
├── .agent/
├── .agents/
├── docs/
├── openspec/
├── package.json
├── package-lock.json
├── tsconfig.base.json
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
2. `apps/controller` may import shared contracts but never UI/Desktop modules.
3. `apps/ui` may import shared contracts but never controller implementation modules.
4. `apps/desktop` may host/load the UI, but must not become the persistence/orchestration owner.
5. UI-to-controller communication occurs through HTTP/WebSocket contracts, not direct imports.

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
  -> register HTTP routes
  -> register WebSocket endpoint
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
- later watcher/executor/browser managers;
- later run state machines and recovery.

The controller does not own:

- React rendering;
- Electron window lifecycle;
- browser UI navigation state.

## 5. Shared contract design

Keep shared contracts runtime-safe and small.

Preferred pattern:

```ts
export type ExecutionEnvironment = "windows" | "wsl";

export interface RepositoryRecord { ... }
export interface CreateRepositoryInput { ... }
export interface UpdateRepositoryInput { ... }
```

Runtime validation MUST exist at process/API boundaries. It may use a small schema library if selected during implementation; avoid generating a second parallel model hierarchy.

One contract should not have three subtly different names/shapes in SQL, controller, and UI unless the distinction is intentional (for example persisted record versus create input).

## 6. Controller configuration

Initial configuration inputs:

```text
ORCA_HOST             default 127.0.0.1
ORCA_PORT             stable documented default
ORCA_DATA_DIR         optional absolute override
ORCA_LOG_LEVEL        optional; sane local default
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
├── orca.db
├── logs/
├── browser-profile/
└── runtime/
```

Tests must always override the data directory.

## 7. Repository domain object

The persisted repository record is configuration, not active-run state.

It contains:

- identity;
- GitHub remote;
- local execution location;
- Windows/WSL environment selection;
- branch;
- executor CLI/model strings selected by user;
- Sol conversation URL;
- safety defaults;
- timestamps.

Do not add rapidly changing runtime fields such as `currentIteration`, PID, or `SOL_REVIEWING` to the Change 001 repositories table. Later runtime tables own those.

## 8. API layering

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

Routes should remain thin. SQL belongs in storage modules, not handlers.

## 9. Event model

Change 001 events are ephemeral synchronization hints.

```text
successful service mutation
   -> commit persistence
   -> publish event
   -> WebSocket clients receive hint
   -> clients may update/refetch
```

Never emit a successful mutation event before persistence succeeds.

Do not build event sourcing, durable queues, replay logs, or cross-machine brokers in Change 001.

## 10. UI data flow

Preferred UI flow:

```text
React page
  -> typed API client
  -> controller REST
  -> local UI state/cache

controller WebSocket event
  -> invalidate/refetch relevant repository data
```

Do not let every component independently invent fetch/error/retry behavior. Centralize the API client and connection state.

## 11. UI navigation baseline

Initial routes may be:

```text
/                     repository dashboard
/repositories/new     add repository
/repositories/:id     repository detail
/repositories/:id/edit edit repository
```

Exact routing library is implementation-owned, but deep-linkable URL routes are preferred over a single giant conditional component.

## 12. Repository form behavior

Required fields:

- display name;
- GitHub remote;
- branch;
- environment;
- local path;
- WSL distribution when environment = `wsl`;
- executor CLI;
- executor model/config string;
- Sol conversation URL;
- max iterations;
- max runtime minutes.

Behavior:

- branch starts as `main`;
- limits start as 20 / 480;
- WSL distribution appears only for WSL;
- switching WSL -> Windows must not submit stale invalid WSL-only data unless intentionally retained outside the request;
- server errors must not wipe typed values;
- successful create navigates to or clearly reveals the persisted record.

## 13. Electron boundary

Electron V1 is a shell, not a second backend.

Baseline BrowserWindow guidance:

- `contextIsolation: true`;
- avoid broad `nodeIntegration: true` in renderer;
- do not expose arbitrary filesystem/process primitives to web content;
- load only trusted local/dev UI locations;
- external links should not silently become privileged app content.

Change 001 does not need custom Electron IPC for repository CRUD because HTTP/WebSocket already provide the controller boundary.

## 14. Development process supervision

The root `npm run dev` should eventually coordinate:

- controller dev process;
- Vite dev server;
- Electron dev shell.

Use the smallest reliable process coordination dependency or npm script strategy. Do not invent an internal process supervisor in Change 001.

Controller must remain runnable separately for tests and headless development.

## 15. Test boundaries

Tests should align with responsibility:

```text
packages/shared -> validation/default/contract tests
controller/db    -> migration/store tests
controller/http  -> API tests
controller/events-> event tests
ui               -> component/form/API-state tests
desktop          -> focused launch/integration verification
```

Avoid testing implementation details that make refactoring expensive without increasing confidence.

## 16. Change 001 definition of done

Change 001 is done only when:

1. a fresh supported Windows checkout installs successfully;
2. root typecheck/test/build/lint commands are documented and run;
3. controller starts independently on loopback;
4. SQLite migrations create a persistent repository registry;
5. repository CRUD works through REST;
6. mutation events work through the event channel;
7. UI can create/edit/list/delete Windows and WSL records;
8. UI handles disconnected controller distinctly from empty state;
9. narrow phone-like width remains usable;
10. Electron displays the same UI and does not own persistence;
11. controller restart preserves data;
12. closing/reopening Electron does not erase data;
13. no watcher/executor/Playwright pseudo-implementation has leaked into the milestone;
14. all OpenSpec tasks and durable waypoint are reconciled to reality;
15. repository is pushed to `main` and ready for a deep Sol review.
