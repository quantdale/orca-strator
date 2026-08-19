# Design: Bootstrap Control Plane

## 1. Summary

Change 001 creates Orca-Strator's first runnable application boundary without implementing autonomous orchestration yet.

The design uses a TypeScript monorepo where:

- a standalone Node.js controller owns persistence and local API state;
- `packages/shared` owns serializable domain/API contracts and runtime validation;
- one React/Vite SPA renders the desktop and future phone control UI;
- Electron is only the Windows desktop shell around that SPA;
- SQLite is accessed only by the controller/storage layer;
- all future watcher/executor/Playwright components will attach to the controller, not to Electron renderer state.

The overriding design goal is **simple boundaries that survive later autonomy work**, not framework completeness.

## 2. Workspace topology

Use npm workspaces:

```text
orca-strator/
├── apps/
│   ├── controller/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── db/
│   │   │   ├── repositories/
│   │   │   ├── events/
│   │   │   ├── config/
│   │   │   └── main.ts
│   │   └── package.json
│   ├── ui/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── components/
│   │   │   ├── features/repositories/
│   │   │   ├── pages/
│   │   │   └── main.tsx
│   │   └── package.json
│   └── desktop/
│       ├── src/
│       │   └── main.ts
│       └── package.json
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── repository.ts
│       │   ├── api.ts
│       │   ├── events.ts
│       │   └── index.ts
│       └── package.json
├── package.json
├── tsconfig.base.json
└── ...tooling
```

Exact file names may vary when implementation finds a simpler layout, but the ownership direction must remain.

### Dependency rules

Allowed:

```text
controller -> shared
ui         -> shared
desktop    -> ui build/URL contract (not controller internals)
```

Forbidden:

```text
shared -> any app
ui -> controller source/db
renderer -> SQLite
renderer -> executor/process APIs
controller -> Electron renderer state
```

The controller may later be supervised/installed by desktop/Windows service tooling, but supervision is not ownership of runtime/domain state.

## 3. Runtime topology

### Development

```text
npm run dev
  |
  +--> controller  http://127.0.0.1:<port>
  +--> Vite UI     http://127.0.0.1:<vite-port>
  +--> Electron    loads Vite UI
```

A root development command may supervise all three for convenience. If Electron closes, the development supervisor/controller should not be architecturally dependent on renderer state.

### Later packaged topology

Change 001 only needs to preserve this seam:

```text
Windows controller process
       |
       +--> localhost API
       +--> SQLite

Electron BrowserWindow ------> shared built UI ------> controller API
Phone browser (Milestone 7) --> same UI ------------> controller API
```

Do not solve final Windows service installation in Change 001.

## 4. Supported runtime/tooling philosophy

Use a currently supported Node LTS/runtime that satisfies the selected SQLite approach. Pin/document the actual project requirement in `package.json`/README once implementation confirms it.

Prefer:

- npm workspaces rather than an additional monorepo orchestrator;
- TypeScript strict mode;
- one test runner across TypeScript packages where practical;
- one clear lint/format path without redundant tools;
- direct SQL/migrations rather than an ORM for the initial small schema;
- built-in `fetch`/WebSocket APIs and a small typed client rather than a generated API framework.

Do not add Turborepo/Nx, a full ORM, dependency injection container, Redux, or a plugin framework unless concrete implementation evidence justifies it.

## 5. Shared domain contracts

`packages/shared` is the contract package for data crossing process/UI boundaries.

### Repository ID

Use an application-generated stable opaque ID (UUID or equivalent). Do not use display name/path as primary identity.

### Execution environment

```ts
type ExecutionEnvironment = 'windows' | 'wsl';
```

### Repository configuration

Conceptual shape:

```ts
interface RepositoryConfig {
  id: string;
  displayName: string;
  githubRemote: string;
  localPath: string;
  branch: string;
  environment: 'windows' | 'wsl';
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

The actual schema may separate create/update DTOs from persisted/read models.

### Validation invariants

All repositories:

- display name required after trimming;
- GitHub remote required;
- local path required;
- branch required; default `main`;
- executor CLI required;
- executor model/config string required;
- Sol conversation URL required and must be a valid supported ChatGPT conversation URL shape;
- `maxIterations` positive integer; default 20;
- `maxRuntimeMinutes` positive integer; default 480.

Windows:

- `environment = windows`;
- path is stored as the exact user-configured Windows path;
- WSL distribution is null/ignored.

WSL:

- `environment = wsl`;
- WSL distribution required;
- working directory is the Linux path used inside the selected distro;
- do not auto-convert it into `C:\...`/`\\wsl$...` as canonical storage.

Change 001 validates configuration shape; it does not need to prove the path/remote/executor is reachable yet. Connectivity/preflight belongs to later milestones unless a cheap non-invasive validation is useful in UI.

### Secrets rule

Repository config MUST NOT contain:

- API keys;
- OAuth tokens;
- GitHub personal tokens;
- ChatGPT cookies/session storage;
- passwords;
- Playwright profile contents.

## 6. Runtime validation

Use a small runtime validation library (for example Zod) if it keeps controller/UI/shared validation single-sourced. This is preferred over writing duplicate ad-hoc validators.

Requirements:

- TypeScript types derive from or stay mechanically aligned with runtime schemas;
- controller validates every create/update payload;
- invalid payloads never reach SQL-writing code;
- UI may reuse schemas for immediate form feedback, but controller remains authoritative.

Do not build a generalized schema framework.

## 7. Controller configuration

Controller configuration should be explicit and environment-overridable.

Suggested values:

```text
host: 127.0.0.1
port: 47100 (or another documented stable default)
data directory: Windows user-local application data directory
DB file: <data-dir>/orca-strator.sqlite
```

Support an environment override for tests/development, e.g. `ORCA_DATA_DIR`, so automated tests never write into the real user database.

The controller MUST bind to loopback in Change 001.

Do not implement Tailscale/public binding here.

## 8. SQLite design

### Choice

Prefer Node's built-in SQLite support when it is stable/supported in the selected Node runtime and does not create Electron packaging problems. Otherwise choose the smallest well-supported SQLite dependency.

The storage abstraction must remain small enough to swap without changing service/API contracts.

### Database location

Use a machine-local application-data directory, not the Git repository.

Development/tests may override location.

Add DB/runtime paths to `.gitignore` where relevant.

### Migration mechanism

Provide ordered, transactional migrations from version 1.

Minimum behavior:

1. database opens;
2. migration metadata exists;
3. unapplied migrations run in order;
4. each migration is applied once;
5. a failed migration does not silently mark itself successful;
6. controller fails clearly if DB initialization cannot complete.

A simple migrations table is enough; do not add an ORM solely for migrations.

### Initial repositories table

Suggested schema:

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  github_remote TEXT NOT NULL,
  local_path TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  environment TEXT NOT NULL CHECK (environment IN ('windows', 'wsl')),
  wsl_distribution TEXT,
  executor_cli TEXT NOT NULL,
  executor_model TEXT NOT NULL,
  sol_conversation_url TEXT NOT NULL,
  max_iterations INTEGER NOT NULL DEFAULT 20 CHECK (max_iterations > 0),
  max_runtime_minutes INTEGER NOT NULL DEFAULT 480 CHECK (max_runtime_minutes > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Enforce WSL-specific invariants in application validation; optionally add SQL checks if they remain readable.

### Repository storage interface

Keep SQL behind a focused store/repository object with operations roughly:

```text
list()
get(id)
create(config)
update(id, patch)
delete(id)
```

It should return domain objects, not raw driver rows.

## 9. Repository service layer

Add a small service boundary between API handlers and SQL.

Responsibilities:

- apply domain validation/defaults;
- generate IDs/timestamps;
- normalize only values safe to normalize (for example trim display name/branch);
- call storage;
- emit repository mutation events after successful persistence;
- provide not-found/conflict errors with stable codes.

Do not make HTTP handlers contain SQL.

## 10. Controller HTTP API

Fastify is preferred for the small local HTTP server unless implementation finds a materially simpler compatible option.

### Health

```text
GET /api/health
```

Example response:

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

Health should indicate controller readiness after DB initialization, not merely that a TCP port opened.

### Repository endpoints

```text
GET    /api/repositories
POST   /api/repositories
GET    /api/repositories/:id
PATCH  /api/repositories/:id
DELETE /api/repositories/:id
```

Recommended semantics:

- `GET list` returns a stable array/list envelope;
- `POST` validates create payload and returns created repository;
- `GET :id` returns 404 with stable code if absent;
- `PATCH` validates merged/patch semantics without allowing immutable identity fields to be replaced accidentally;
- `DELETE` is explicit and returns success/no-content semantics consistently.

### Error envelope

Use one stable shape, e.g.:

```json
{
  "error": {
    "code": "INVALID_REPOSITORY_CONFIG",
    "message": "WSL distribution is required for WSL repositories",
    "details": {}
  }
}
```

Expected codes should include at least:

- invalid request/config;
- repository not found;
- persistence failure;
- internal error.

Do not send raw stack traces to normal clients.

## 11. Real-time event channel

Provide one WebSocket endpoint/channel.

Change 001 only needs repository/connection events.

Suggested event envelope:

```ts
interface OrcaEvent<T = unknown> {
  type: string;
  at: string;
  repositoryId?: string;
  payload?: T;
}
```

Initial event types can include:

```text
repository.created
repository.updated
repository.deleted
```

Events are UI synchronization hints; the API/database remains authoritative. A reconnecting UI may re-fetch repository state rather than depending on a complete event replay log in Change 001.

## 12. UI architecture

Use React + TypeScript + Vite, Tailwind CSS, and shadcn/ui primitives.

Keep global state small. A lightweight store such as Zustand may be used for UI-only/app shell state when justified; repository server state should be synchronized through a clear API layer rather than copied into many stores.

### UI API layer

Create a focused client module:

```text
getHealth()
listRepositories()
getRepository(id)
createRepository(input)
updateRepository(id, patch)
deleteRepository(id)
subscribeEvents()
```

No component should know SQLite schema details.

### Connection behavior

UI displays controller connectivity/readiness explicitly.

States should distinguish at least:

- connecting;
- connected;
- disconnected/error.

Do not crash the entire UI if controller is temporarily unavailable.

### Dashboard

Show multiple configured repositories independently.

Initial useful fields:

- display name;
- environment (`Windows`/`WSL`);
- branch;
- local path;
- executor CLI/model;
- controller-known placeholder/status (`Configured` is enough in Change 001).

Do not fake autonomous run progress.

### Add/edit repository

Form fields:

- display name;
- GitHub remote;
- local path;
- branch;
- environment selector;
- conditional WSL distribution;
- executor CLI;
- executor model/config string;
- Sol conversation URL;
- max iterations;
- max runtime (minutes/hours UI may convert to minutes).

Validation behavior:

- immediate useful client feedback;
- authoritative server error display;
- switching Windows <-> WSL updates conditional fields without silently retaining invalid hidden state;
- preserve user input on recoverable submission error.

### Repository detail foundation

Provide a detail view that presents configuration cleanly and leaves obvious later seams for run status/timeline/controls without implementing them.

### Responsive behavior

At phone-like width:

- avoid mandatory horizontal scrolling for primary content;
- stack repository cards/details/forms appropriately;
- primary actions remain reachable;
- labels/values remain readable;
- desktop navigation collapses/adjusts rather than disappearing.

Change 001 does not need a native mobile application.

## 13. Electron shell

Electron V1 is Windows-only.

Responsibilities in Change 001:

- create one BrowserWindow;
- load Vite dev URL in development;
- load built UI artifact/URL in production-like mode;
- apply safe basic Electron defaults;
- expose only minimal preload/IPC if actually needed;
- avoid giving renderer broad Node integration merely for convenience.

Electron must not:

- open the SQLite DB;
- persist repository configuration itself;
- launch executors;
- become the only process capable of keeping controller data alive.

### Controller relationship

For Change 001, the controller may be started separately by the root dev workflow. Electron should tolerate the controller being unavailable and let the shared UI show connection state.

Final service/background auto-start belongs to later packaging/hardening work.

## 14. Development scripts

Root commands should be obvious and documented. Suggested contract:

```text
npm install
npm run dev
npm run build
npm run typecheck
npm test
npm run lint
```

Optional focused workspace commands may exist.

`npm run dev` should start the practical developer stack without requiring three manually managed terminals.

Do not require undocumented environment variables for normal local development.

## 15. Testing strategy

### Shared validation tests

Cover:

- valid Windows config;
- valid WSL config;
- missing WSL distribution;
- invalid environment;
- empty required fields;
- invalid/non-positive ceilings;
- default branch/ceiling application;
- create/update schema differences.

### Storage/migration tests

Use isolated temp database/data directories.

Cover:

- fresh migration;
- migration idempotency;
- repository CRUD;
- persistence after close/reopen;
- timestamps/ID stability;
- not-found behavior;
- invalid rows never inserted through service path.

### API tests

Start controller/app in-process or on ephemeral port where practical.

Cover:

- health after DB ready;
- list empty;
- create/get/update/delete;
- validation errors;
- 404;
- structured error envelope;
- mutation event emitted after successful persistence.

### UI tests

Focus on behavior rather than snapshot volume:

- dashboard renders multiple repositories;
- disconnected controller state;
- create/edit validation;
- Windows/WSL conditional fields;
- persisted API data appears after refresh/refetch;
- narrow layout smoke test where practical.

### Integration/manual smoke

Before completing Change 001:

1. run full dev stack;
2. create Windows repo config;
3. create WSL repo config;
4. restart controller;
5. confirm both remain;
6. close/reopen Electron;
7. confirm controller data remains;
8. exercise narrow browser viewport;
9. run root verification commands.

## 16. Logging/error policy

Change 001 only needs basic controller logs.

Log:

- startup host/port/version;
- data directory/DB path in a non-secret-safe form;
- migration success/failure;
- fatal startup errors;
- request errors where useful.

Do not log secrets or full sensitive browser/session data.

Later structured audit/event logging is Milestone 6.

## 17. Security baseline

Even though the controller is local-only:

- bind to loopback;
- validate API input;
- avoid renderer Node integration unless needed;
- keep secrets/browser auth out of SQLite repository records;
- do not commit local DB/browser profiles;
- avoid shelling out with user-controlled strings in Change 001;
- do not introduce CORS/public-bind behavior for phone access early.

## 18. Implementation order

Recommended task sequence:

```text
workspace/tooling
   -> shared schemas
   -> controller config
   -> migrations/storage
   -> repository service
   -> HTTP/events
   -> UI API client
   -> dashboard/form/detail
   -> responsive polish
   -> Electron shell
   -> end-to-end smoke
   -> full verification/checkpoint
```

This sequence minimizes cases where UI scaffolding outruns stable contracts.

## 19. Deliberate extension seams for later milestones

Change 001 may create small service/module seams for future components, but should not implement them.

Expected later controller modules:

```text
watchers/
executors/
browser/
runs/
notifications/
```

Do not add empty architecture factories/plugin registries for them yet. Add directories/interfaces when the corresponding OpenSpec change actually begins.

## 20. Definition of done

The change is done only when:

- all required tasks/spec scenarios are satisfied;
- controller can run independently;
- repository data persists across restart;
- Windows/WSL validation is proven;
- UI/controller boundary is real and tested;
- Electron uses the shared UI without taking persistence ownership;
- narrow layout is usable;
- root build/typecheck/test baseline is repeatable;
- README explains setup/development;
- `.agent/state.json` is advanced to a review/next-change waypoint;
- no future autonomous functionality was implemented prematurely.
