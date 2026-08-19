# Design: Bootstrap Control Plane

## Summary

Build a small TypeScript workspace where a standalone Node controller owns persistence and API state, a single React/Vite SPA provides the control UI, and Electron is only the Windows desktop shell around that UI.

The design intentionally avoids putting orchestration logic inside Electron so later autonomous runs and phone access do not depend on a renderer/window staying open.

## Workspace shape

Use npm workspaces to minimize tooling dependencies:

```text
apps/
  controller/   # standalone Node.js/TypeScript local service
  ui/           # responsive React/Vite SPA
  desktop/      # Electron Windows shell
packages/
  shared/       # schemas/types/contracts shared by controller and UI
```

Top-level scripts coordinate build, typecheck, lint, test, and development startup.

## Runtime topology

```text
Electron BrowserWindow ----\
                           -> localhost controller -> SQLite
Phone browser (later) -----/          |
                                      +-> WebSocket events
```

In development, the UI may run from the Vite dev server while talking to the controller. In packaged/local production mode, the controller can serve the built UI or expose the URL that Electron loads. Keep this boundary simple and explicit.

## Controller

Use a standalone Node.js/TypeScript process.

Responsibilities in Change 001:

- open/migrate the local SQLite database;
- own repository CRUD operations;
- validate repository configuration at API boundaries;
- expose health and repository REST endpoints;
- expose a WebSocket event stream for state changes;
- provide a clean service layer that later watcher/executor/browser subsystems can call.

Do not add watcher, executor, or Playwright behavior yet.

Prefer Node's built-in `node:sqlite` on the selected supported Node runtime to avoid an extra native database dependency. Keep database access behind a small repository/storage interface so it can be swapped if packaging/runtime constraints are discovered.

## Shared contracts

`packages/shared` owns runtime-safe schemas/types for:

- repository IDs;
- execution environment (`windows` | `wsl`);
- repository configuration;
- repository lifecycle/status placeholder values needed by the UI;
- API request/response shapes;
- event envelope shapes.

Use a runtime validation library only if it meaningfully reduces duplicated validation; do not introduce a large schema/ORM stack for Change 001.

## Repository persistence model

Initial table: `repositories`.

Suggested fields:

- `id` TEXT PRIMARY KEY;
- `display_name` TEXT NOT NULL;
- `github_remote` TEXT NOT NULL;
- `local_path` TEXT NOT NULL;
- `branch` TEXT NOT NULL DEFAULT 'main';
- `environment` TEXT NOT NULL CHECK (`windows` or `wsl`);
- `wsl_distribution` TEXT NULL;
- `executor_cli` TEXT NOT NULL;
- `executor_model` TEXT NOT NULL;
- `sol_conversation_url` TEXT NOT NULL;
- `max_iterations` INTEGER NOT NULL DEFAULT 20;
- `max_runtime_minutes` INTEGER NOT NULL DEFAULT 480;
- `created_at` TEXT NOT NULL;
- `updated_at` TEXT NOT NULL.

WSL rows require a distribution; Windows rows must not require one.

Do not persist secrets/API keys in this table.

## Controller API

Start small:

```text
GET    /api/health
GET    /api/repositories
POST   /api/repositories
GET    /api/repositories/:id
PATCH  /api/repositories/:id
DELETE /api/repositories/:id
GET    /api/events   # WebSocket upgrade/event stream, exact route may vary
```

Repository mutation publishes an event such as:

```json
{
  "type": "repository.updated",
  "repositoryId": "...",
  "at": "..."
}
```

The exact transport library may be selected during implementation, but Fastify is the preferred small controller HTTP framework.

## UI

Use React + TypeScript + Vite with Tailwind CSS and shadcn/ui primitives.

Change 001 screens/components:

1. application shell/navigation;
2. repository dashboard/list;
3. add/edit repository form;
4. repository detail/status foundation;
5. controller connection/health indicator;
6. responsive narrow-screen layout.

Do not design the final executor terminal, Playwright diagnostics, or full autonomous timeline yet. Provide clear seams/placeholders, not fake functionality.

## Electron shell

Electron is Windows-only for V1.

Responsibilities:

- open the shared UI in a BrowserWindow;
- provide normal desktop lifecycle behavior;
- avoid owning repository state or orchestration logic;
- point at the correct dev/production UI URL.

The controller must be runnable independently of Electron. Change 001 does not need to solve final Windows-service installation; that belongs to later hardening/packaging work.

## Testing

Use fast automated tests for:

- repository configuration validation;
- Windows vs WSL invariants;
- SQLite migrations/repository CRUD;
- controller API CRUD/health behavior;
- basic UI repository rendering/form behavior where practical.

Also require workspace-level typecheck and build commands.

## Error handling

API errors use structured JSON with a stable machine-readable code and human-readable message. Invalid repository configuration returns a client error; database/internal failures do not leak secrets or raw stack traces to UI clients.

## Deliberate non-goals

Change 001 must not become a partial autonomous executor. In particular, do not implement:

- Git polling;
- dispatch files;
- process launching;
- ChatGPT login;
- Playwright;
- Tailscale;
- notification providers.

The purpose of this milestone is to create a clean place for those systems to land in later OpenSpec changes.
