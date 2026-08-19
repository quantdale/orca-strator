# Design: Bootstrap Control Plane

## 1. Summary

Change 001 creates Orca-Strator's first runnable application boundary without implementing autonomous orchestration.

The implementation is a small TypeScript workspace where:

- standalone Node.js controller owns persistence and HTTP/WebSocket state;
- `packages/shared` owns runtime-safe serializable contracts;
- React/Vite supplies one responsive UI;
- controller serves the built SPA in production-like mode so UI + REST + WebSocket share one origin;
- Vite proxies those same relative routes in development;
- Electron is only the Windows shell/client around that UI;
- SQLite is controller-only persistence;
- later watcher/executor/Playwright systems attach to controller services, not renderer state.

The overriding goal is **simple durable boundaries**, not framework completeness.

For detailed normative shapes, use focused documents via `docs/INDEX.md`. This design records the Change 001 composition and tradeoffs; it should not duplicate every API/data/UI field already governed elsewhere.

## 2. Locked design choices carried into Change 001

1. Windows-only application; Windows and WSL repository targets.
2. Multiple repository records supported independently.
3. V1 Git integration fixed to `main`; no branch config field.
4. Static repository configuration does not contain run goal/current actor/iteration/PID.
5. Controller owns data/runtime truth; Electron does not.
6. Built UI and controller API/event endpoint share one loopback origin.
7. Shared UI uses relative `/api` paths; no production hard-coded localhost API host.
8. Tailscale is not implemented yet; Change 001 only creates the same-origin seam it will later proxy.
9. No watcher/executor/Playwright/run-state pseudo-implementation in this change.
10. Seeded hygiene/security files remain intact.

## 3. Workspace topology

```text
orca-strator/
├── apps/
│   ├── controller/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts
│   │       ├── config/
│   │       ├── db/
│   │       ├── repositories/
│   │       ├── http/
│   │       ├── events/
│   │       └── logging/
│   ├── ui/
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app/
│   │       ├── api/
│   │       ├── features/repositories/
│   │       ├── components/
│   │       └── styles/
│   └── desktop/
│       └── src/
├── packages/
│   └── shared/
│       └── src/
├── schemas/protocol/       # future protocol schemas; runtime use comes later
├── docs/
├── openspec/
└── root tooling
```

Do not create empty placeholder modules just to satisfy this shape.

## 4. Dependency direction

Allowed:

```text
controller -> shared
ui         -> shared
desktop    -> UI delivery contract
```

Forbidden:

```text
shared -> app package
ui -> controller internals
renderer -> SQLite
renderer -> arbitrary process/filesystem primitives
controller -> Electron renderer/window state
```

Serving compiled UI assets from controller does not make controller owner of React/UI state.

## 5. Technology baseline

Use `docs/TECH-BASELINE.md` as authority. Current baseline is Node 24 LTS, npm workspaces, strict TypeScript, Fastify 5, `node:sqlite` behind storage boundary, React 19.2, Vite 8.1, Tailwind 4.3, selective shadcn/ui, Vitest 4.1+, and Electron 43 stable-line baseline.

Patch versions belong in `package-lock.json`.

Avoid Turborepo/Nx, ORM, DI container, Redux, plugin system, or other architecture layers absent concrete need.

## 6. Controller topology

Startup sequence:

```text
load config
 -> resolve data dir
 -> logger
 -> SQLite open
 -> migrations
 -> stores/services/event bus
 -> API + WebSocket
 -> optional built-SPA serving
 -> loopback listen
 -> ready
```

Readiness is false until required persistence startup succeeds.

Suggested defaults:

```text
ORCA_HOST = 127.0.0.1
ORCA_PORT = 47100
production data root = %LOCALAPPDATA%\Orca-Strator\
```

Support `ORCA_DATA_DIR` for tests/development. Tests never touch user's normal DB.

## 7. One-origin web delivery

This is a foundation decision, not a Milestone-7 implementation.

### Built/local mode

```text
http://127.0.0.1:47100/
├── /                 React SPA
├── /assets/*          static assets
├── /api/*             REST
└── /api/events        WebSocket
```

Controller serves only known UI build assets. SPA fallback handles client routes but MUST NOT shadow `/api` or static asset failures.

### Development mode

Vite runs separately and proxies:

```text
/api/*       -> controller
/api/events  -> controller WebSocket
```

React source uses the same relative routes in both modes.

### Future phone mode

Tailscale Serve will proxy the one controller web origin. Phone gets a Tailscale HTTPS page origin and the same relative `/api`/WebSocket client continues working. No second client and no wildcard CORS needed.

## 8. Repository contract

Static repository record includes only:

```text
id
displayName
githubRemote
localPath
environment (windows|wsl)
wslDistribution|null
executorCli
executorModel
solConversationUrl
maxIterations
maxRuntimeMinutes
createdAt
updatedAt
```

No branch field. No run goal/current runtime fields.

Defaults:

```text
maxIterations = 20
maxRuntimeMinutes = 480
```

WSL requires distro and stores Linux path as canonical path. Windows normalizes WSL distro to null.

Controller is authoritative validator. UI may reuse shared schemas for immediate feedback.

## 9. Persistence

Initial SQLite schema contains only migration metadata and `repositories`.

Use direct SQL with ordered migrations and a small store abstraction. No ORM.

Migration invariants:

- monotonically ordered versions;
- each applied once;
- transaction + metadata record atomic where practical;
- failed migration not marked applied;
- reopen idempotent.

Repository SQL details are governed by `docs/DATA-MODEL.md`.

## 10. Controller service/API/event layering

```text
HTTP request
 -> parse/runtime validate
 -> repository service
 -> repository store
 -> SQLite
```

After successful mutation:

```text
persist
 -> publish repository.created|updated|deleted
```

Never publish success before persistence.

API/error/event details are governed by `docs/API-CONTRACT.md`.

## 11. UI behavior

Initial UI includes:

- app shell/navigation;
- controller connectivity state;
- repository dashboard;
- add/edit repository form;
- repository detail foundation;
- delete confirmation;
- responsive layout.

Repository form has no branch field.

Controller offline must be distinct from empty repository list.

Do not fake current executor/Sol states.

Network client uses relative REST paths and derives WebSocket protocol/host from current page origin.

## 12. Electron shell

In development Electron loads trusted Vite UI.

In built/local mode prefer loading controller-served Orca origin. This makes desktop exercise the same delivery path future phone access uses.

Electron baseline:

- `contextIsolation: true`;
- no broad renderer Node integration;
- no SQLite access;
- no repository process launching in Change 001;
- no repository persistence ownership;
- external links remain normal browser content.

No custom IPC is needed for CRUD because HTTP/WebSocket are shared boundary.

## 13. Static serving security

Controller's UI-serving layer MUST:

- serve only configured build output;
- never expose data directory, SQLite, logs, browser profile, environment files, or arbitrary local paths;
- reserve `/api/*` before SPA fallback;
- avoid directory listing;
- avoid wildcard CORS as normal runtime solution.

## 14. Repository hygiene

Preserve existing:

- `.gitattributes` (LF-normalized cross Windows/WSL, CRLF for `.bat`/`.cmd`);
- `.editorconfig`;
- `.gitignore` excluding local DB/browser/auth/log/secrets/build output while not globally ignoring `.orca/`.

Scaffold generators must not silently replace these with weaker defaults.

## 15. Testing

Required test layers for Change 001:

- shared config validation/defaults;
- branch/run-state absence;
- SQLite migrations/CRUD/reopen;
- REST/error/event behavior;
- built-SPA serving and route precedence;
- Vite relative API/WebSocket proxy behavior;
- UI offline/empty/form/narrow behavior;
- Electron launch + controller independence;
- hygiene/static-serving security checks.

Use `docs/TEST-STRATEGY.md` for detailed matrix.

## 16. Deliberate non-goals

Change 001 does not implement:

- Git polling/watcher;
- `.orca` runtime parser despite schemas existing;
- executor process launch;
- Playwright/ChatGPT setup;
- autonomous run state;
- Pause/Stop/Emergency Kill runtime behavior;
- Tailscale Serve config;
- notifications;
- Windows service/auto-start.

## 17. Exit gate

Change 001 reaches `READY_FOR_REVIEW` only when:

1. workspace installs/builds/typechecks/tests/lints;
2. controller independently starts loopback and health means DB ready;
3. Windows + WSL repository CRUD persists through restart;
4. repository config/API/UI are main-only and run-state-free;
5. mutation WebSocket works;
6. shared client uses relative same-origin routes;
7. Vite proxies those routes in dev;
8. controller serves built SPA + REST + WebSocket from one origin;
9. SPA deep-link fallback is correct and does not shadow API;
10. built static server cannot expose Orca runtime data;
11. narrow UI usable;
12. Electron uses same UI/controller boundary and does not own data;
13. seeded hygiene/security files remain intact;
14. no later autonomous subsystem leaked in;
15. tasks/state are accurate, all intended work committed/pushed to `main`;
16. development stops for deep Sol/ChatGPT review before Change 002.
