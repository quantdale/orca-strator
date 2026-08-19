# Design: Bootstrap Control Plane

## 1. Summary

Change 001 creates Orca-Strator's first runnable application boundary without implementing autonomous orchestration yet.

The design uses a TypeScript monorepo where:

- a standalone Node.js controller owns persistence and local API state;
- `packages/shared` owns serializable domain/API contracts and runtime validation;
- one React/Vite SPA renders the desktop and future phone control UI;
- Electron is only the Windows desktop shell around that SPA;
- SQLite is accessed only by the controller/storage layer;
- future watcher/executor/Playwright components attach to the controller, not Electron renderer state.

The overriding design goal is **simple boundaries that survive later autonomy work**, not framework completeness.

This design is subordinate to the active delta spec and the locked decision ledger. Focused normative details live in:

- `docs/TECH-BASELINE.md`;
- `docs/IMPLEMENTATION-BLUEPRINT.md`;
- `docs/DATA-MODEL.md`;
- `docs/API-CONTRACT.md`;
- `docs/UI-UX-SPEC.md`;
- `docs/SECURITY.md`;
- `docs/TEST-STRATEGY.md`.

## 2. Explicit V1 simplifications

Change 001 MUST preserve these simplifications:

1. V1 Git integration is always `main`; repository configuration has no branch field.
2. Repository configuration is static setup data, not active-run state.
3. Run goal/current actor/iteration/PIDs are deferred to later runtime tables.
4. Electron is not a backend.
5. The controller is localhost-only.
6. No watcher, executor process, Playwright browser, Tailscale, or notification implementation exists yet.
7. Multiple repository records are supported, but Change 001 does not run them.

## 3. Workspace topology

Use npm workspaces:

```text
orca-strator/
├── apps/
│   ├── controller/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── app.ts
│   │   │   ├── config/
│   │   │   ├── db/
│   │   │   ├── repositories/
│   │   │   ├── http/
│   │   │   ├── events/
│   │   │   └── logging/
│   │   └── package.json
│   ├── ui/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── app/
│   │   │   ├── api/
│   │   │   ├── features/repositories/
│   │   │   ├── components/
│   │   │   └── styles/
│   │   └── package.json
│   └── desktop/
│       ├── src/
│       │   ├── main.ts
│       │   ├── window.ts
│       │   └── config.ts
│       └── package.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── repository.ts
│       │   ├── api.ts
│       │   ├── events.ts
│       │   ├── errors.ts
│       │   ├── validation.ts
│       │   └── index.ts
│       └── package.json
├── schemas/
│   └── protocol/             # future runtime protocol schemas; not implemented in Change 001
├── .agent/
├── .agents/
├── docs/
├── openspec/
├── package.json
├── tsconfig.base.json
├── .editorconfig
├── .gitattributes
└── .gitignore
```

Exact file names may vary when implementation finds a simpler layout. Do not create empty modules just to match the diagram.

## 4. Dependency rules

Allowed:

```text
controller -> shared
ui         -> shared
desktop    -> UI build/URL contract
```

Forbidden:

```text
shared -> any app
ui -> controller source/db
renderer -> SQLite
renderer -> arbitrary filesystem/process APIs
controller -> Electron renderer/window state
```

The controller may later be supervised by desktop/Windows service tooling, but supervision is not ownership of runtime/domain state.

## 5. Technology baseline

Use the locked baseline in `docs/TECH-BASELINE.md`:

- Node 24 LTS;
- npm workspaces;
- TypeScript strict mode;
- Fastify 5;
- `node:sqlite` behind a small storage abstraction;
- React 19.2;
- Vite 8.1;
- Tailwind CSS 4.3;
- selective shadcn/ui primitives;
- Vitest 4.1+;
- Electron 43 stable-line baseline.

Patch versions belong in `package-lock.json`, not duplicated throughout prose.

If `node:sqlite` creates a concrete runtime/packaging blocker, preserve the storage interface and document the smallest compatible replacement before broad implementation depends on it.

## 6. Runtime topology in Change 001

### Development

```text
root dev command
   |
   +--> controller  http://127.0.0.1:<controller-port>
   +--> Vite UI     http://127.0.0.1:<vite-port>
   +--> Electron    loads trusted Vite UI
```

The practical dev command may supervise all three processes. This is development convenience only; the controller must still be startable independently.

### Later packaged seam

```text
Windows controller process
       |
       +--> localhost REST/WebSocket
       +--> SQLite

Electron BrowserWindow ------> shared built UI ------> controller API
Phone browser (later) --------> same UI ------------> controller API
```

Do not solve Windows service installation or Tailscale exposure in Change 001.

## 7. Shared repository contract

Conceptual persisted record:

```ts
interface RepositoryRecord {
  id: string;
  displayName: string;
  githubRemote: string;
  localPath: string;
  environment: "windows" | "wsl";
  wslDistribution: string | null;
  executorCli: string;
  executorModel: string;
  solConversationUrl: string;
  maxIterations: number;
  maxRuntimeMinutes: number;
  createdAt: string;
  updatedAt: string;
}
```

There is deliberately **no `branch` field**. V1 always uses `main`.

There is deliberately **no run goal/current state field**. Those belong to later run/runtime state.

Create/update DTOs may differ from the read model:

- create omits ID/timestamps and may omit defaulted ceilings;
- patch exposes only mutable configuration fields;
- immutable fields cannot be overwritten by client input;
- merged patch results are fully revalidated before persistence.

## 8. Validation invariants

All repository configs require after trimming/normalization:

- display name;
- GitHub remote;
- local path;
- executor CLI;
- executor model/configuration string;
- exact supported ChatGPT Sol conversation URL;
- positive integer max iterations;
- positive integer max runtime minutes.

Defaults:

```text
maxIterations = 20
maxRuntimeMinutes = 480
```

Environment rules:

### Windows

- `environment = windows`;
- `localPath` is a native Windows path supplied by the user;
- persisted WSL distribution is null.

### WSL

- `environment = wsl`;
- `wslDistribution` is non-empty and required;
- `localPath` is the Linux path inside that distro;
- do not convert the canonical stored path into `C:\...` or `\\wsl$...`.

Change 001 validates configuration shape. It does not make filesystem/network/executor reachability a hard create-time requirement.

## 9. Secret boundary

Repository configuration MUST NOT store:

- API keys;
- OAuth/GitHub tokens;
- ChatGPT cookies/session storage;
- passwords;
- Playwright profile content;
- arbitrary environment-secret blobs.

Browser profile/auth data is machine-local runtime state and is already excluded by repository ignore policy.

## 10. Controller configuration

Suggested controller defaults:

```text
host: 127.0.0.1
port: 47100
production data root: %LOCALAPPDATA%\Orca-Strator\
DB file: <data-root>/orca-strator.sqlite
```

Environment overrides should include at minimum:

```text
ORCA_HOST
ORCA_PORT
ORCA_DATA_DIR
ORCA_LOG_LEVEL
NODE_ENV
```

Tests MUST override the data directory and must never touch the normal user DB.

Change 001 binds loopback only.

## 11. Controller startup sequence

```text
process start
  -> parse config
  -> resolve/create data directory
  -> initialize logging
  -> open SQLite
  -> run ordered migrations
  -> initialize stores/services/event bus
  -> build Fastify app/routes/WebSocket endpoint
  -> listen on loopback
  -> report ready
```

If required migration/startup fails, do not advertise healthy readiness.

## 12. SQLite design

Use direct SQL and a small migration mechanism; do not add an ORM solely for the initial schema.

Minimum migration behavior:

1. migrations have ordered integer versions;
2. each is applied at most once;
3. migration + migration-record insertion are atomic where practical;
4. failed migration is not recorded as applied;
5. reopening a current DB is idempotent.

Initial table is `repositories` only.

Target columns:

```text
id
display_name
github_remote
local_path
environment
wsl_distribution
executor_cli
executor_model
sol_conversation_url
max_iterations
max_runtime_minutes
created_at
updated_at
```

No branch column. No run-state columns.

SQL stays behind a focused store/repository module.

## 13. Repository service boundary

The service layer sits between HTTP and storage.

Responsibilities:

- parse/validate create/patch models;
- apply ceiling defaults;
- generate stable ID/timestamps;
- normalize safe strings;
- map not-found/domain failures to stable errors;
- call storage;
- publish mutation events only after persistence succeeds.

Routes remain thin. SQL does not live in handlers.

## 14. REST contract

Change 001 implements:

```text
GET    /api/health
GET    /api/repositories
POST   /api/repositories
GET    /api/repositories/:id
PATCH  /api/repositories/:id
DELETE /api/repositories/:id
```

Use `docs/API-CONTRACT.md` for exact payload/error semantics.

Important properties:

- health means DB/controller ready;
- invalid config never reaches SQL writes;
- unknown IDs produce stable 404 behavior;
- delete is explicit;
- no raw stack traces in normal API payloads;
- V1 API has no branch configuration field.

## 15. Event contract

Expose one WebSocket/event channel.

Initial event types:

```text
repository.created
repository.updated
repository.deleted
```

Event rule:

```text
persist successfully
  -> publish event
```

Events are synchronization hints, not event sourcing. Reconnecting clients refetch authoritative REST state.

## 16. UI architecture

Use one responsive React application.

Create a focused typed API client for:

```text
getHealth
listRepositories
getRepository
createRepository
updateRepository
deleteRepository
subscribeEvents
```

No component imports SQLite/controller internals.

Controller connectivity must distinguish:

```text
connecting
connected
error/disconnected
```

Empty repository list is not the same as controller unavailable.

## 17. Repository UI behavior

Dashboard initially shows real configuration only:

- display name;
- Windows/WSL environment and distro;
- local path;
- executor CLI/model;
- configuration/connectivity placeholder status.

Do not fake autonomous runtime progress.

Add/Edit fields:

- display name;
- GitHub remote;
- environment;
- local path;
- conditional WSL distribution;
- executor CLI;
- executor model/config string;
- Sol conversation URL;
- max iterations;
- max runtime.

Do not render a branch input. If helpful, detail/start UI may later state `Git: main` as a fixed invariant.

At narrow widths (~360–430px), primary forms/cards/details must remain usable without mandatory horizontal scrolling.

## 18. Electron shell

Electron V1 responsibilities:

- create the BrowserWindow;
- load trusted Vite URL in dev;
- load built shared UI in production-like local mode;
- use `contextIsolation: true`;
- avoid broad renderer Node integration;
- tolerate controller-unavailable state.

Electron MUST NOT:

- open the SQLite DB;
- own repository configuration;
- launch executors in Change 001;
- become the only process that can preserve controller state.

No custom IPC is required for repository CRUD because REST/WebSocket is the intended shared boundary.

## 19. Repository hygiene

The repository already contains:

- `.gitattributes` for LF normalization across Windows/WSL with CRLF for `.bat`/`.cmd`;
- `.editorconfig` for basic editor consistency;
- `.gitignore` for dependencies/build output/local DB/browser/auth/log/secret artifacts.

Change 001 should verify/extend these if implementation generates additional local artifacts; it should not overwrite them with weaker defaults.

`.orca/` must not be globally ignored because future managed repositories intentionally commit cross-agent coordination files.

## 20. Testing design

### Shared contracts

Test:

- valid Windows config;
- valid WSL config;
- missing distro;
- empty required strings;
- invalid ceilings;
- defaults;
- invalid Sol conversation URL;
- immutable patch behavior;
- absence/rejection of configurable branch field.

### SQLite/storage

Use isolated temporary data roots.

Test:

- fresh migration;
- idempotent reopen;
- CRUD;
- multiple records;
- timestamps/identity stability;
- failed/invalid mutation does not corrupt existing data;
- restart persistence;
- schema has no unnecessary branch/run-state columns.

### API/events

Test:

- health readiness;
- CRUD and 404s;
- structured validation errors;
- no raw stack leakage;
- mutation event after successful persistence;
- no false success event after failed persistence;
- reconnect/refetch behavior.

### UI

Test behavior, not snapshot volume:

- multiple repository rendering;
- empty vs disconnected state;
- Windows/WSL form behavior;
- server validation without losing useful input;
- create/edit/delete through API client;
- no branch form control;
- narrow viewport smoke.

### Electron/integration

Verify on Windows:

- Electron launches shared UI;
- UI CRUD reaches controller;
- controller can run independently;
- Electron close/reopen does not erase data.

## 21. Development commands

Root command contract should converge on:

```text
npm install
npm run dev
npm run build
npm run typecheck
npm test
npm run lint
```

Focused workspace commands may exist, but normal local development must not rely on undocumented multi-terminal choreography.

## 22. Change 001 non-goals enforced by structure

Do not implement:

- remote Git polling;
- dispatch processing;
- protocol parser/runtime despite schemas already existing;
- process launch adapters;
- Playwright/ChatGPT setup;
- run state machine;
- pause/stop behavior;
- Tailscale;
- notifications;
- Windows service packaging.

The protocol schemas are durable design artifacts only in this milestone.

## 23. Completion gate

Change 001 is ready for deep review only when:

1. fresh install succeeds on supported Windows development setup;
2. root typecheck/test/build/lint commands are real and documented;
3. controller starts independently on loopback;
4. SQLite migration + repository CRUD are tested;
5. Windows and WSL repository configuration work;
6. repository config/data/API/UI contain no mutable branch field and assume `main`;
7. no run-state data leaked into the static repository table;
8. WebSocket mutation events work;
9. responsive browser UI exercises real controller CRUD;
10. Electron hosts the same UI without persistence ownership;
11. controller data survives restart and Electron closure;
12. seeded hygiene/security files are preserved;
13. no later autonomous subsystem was prematurely implemented;
14. `tasks.md` and `.agent/state.json` accurately reflect verification and completion;
15. everything intended is committed/pushed to `main` for a deep Sol/ChatGPT review before Change 002.
