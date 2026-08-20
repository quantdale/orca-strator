# Orca-Strator V1 Controller API Contract

Status: **normative for Change 001**

The controller API is the sole UI-facing boundary for repository configuration/state in V1. The React UI and Electron shell must not access SQLite directly.

## 1. General rules

- Controller binds to loopback by default.
- JSON request/response bodies use UTF-8.
- Successful responses use stable JSON shapes.
- Client-visible errors use one machine-readable envelope.
- Raw stack traces, SQL, tokens, cookies, and secrets must not appear in normal API payloads.
- API versioning is not required for Change 001; keep routes under `/api/` so a future versioning seam exists.
- V1 does not expose a configurable branch field; managed repository Git operations target `main`.
- Application code uses **same-origin relative routes** for API/WebSocket access in normal built/runtime mode.

## 2. Client-origin contract

The UI must not hard-code the Windows controller as `http://127.0.0.1:47100` in production application code.

Canonical routes are relative to the page origin:

```text
/api/health
/api/repositories
/api/events
```

Why this matters:

- Electron/local built UI can load from the Orca loopback web origin;
- a phone can load the same UI through Tailscale Serve and relative requests remain on the Tailscale HTTPS origin;
- no separate phone API client is needed;
- V1 does not require permissive cross-origin access for remote control.

### Development mode

Vite may serve the UI on a separate local port. Its dev server should proxy `/api/*` and the WebSocket endpoint to the controller. UI source code still uses relative routes.

### Built/production-like mode

The controller serves the built UI from the same HTTP origin as `/api/*` and `/api/events`.

### WebSocket URL construction

The client derives WebSocket scheme/host from the page origin:

```text
http page  -> ws://<same-host>/api/events
https page -> wss://<same-host>/api/events
```

Do not hard-code `ws://127.0.0.1` in the shared UI.

## 3. Health

### `GET /api/health`

Success `200`:

```json
{
  "status": "ok",
  "service": "orca-controller",
  "version": "0.1.0"
}
```

Semantics:

- `200` means controller startup completed far enough that required persistence is ready.
- Do not return healthy before migrations/database initialization succeeds.

## 4. List repositories

### `GET /api/repositories`

Success `200`:

```json
{
  "repositories": [
    {
      "id": "...",
      "displayName": "Nightwatch",
      "githubRemote": "https://github.com/quantdale/nightwatch.git",
      "localPath": "/home/dale/projects/nightwatch",
      "environment": "wsl",
      "wslDistribution": "Ubuntu-24.04",
      "executorCli": "kimi",
      "executorModel": "deepseek-v4-flash",
      "solConversationUrl": "https://chatgpt.com/c/...",
      "maxIterations": 20,
      "maxRuntimeMinutes": 480,
      "createdAt": "2026-08-19T10:00:00.000Z",
      "updatedAt": "2026-08-19T10:00:00.000Z"
    }
  ]
}
```

An empty registry returns `200` with `repositories: []`.

## 5. Get repository

### `GET /api/repositories/:id`

Success `200`:

```json
{
  "repository": { "...": "RepositoryRecord" }
}
```

Unknown ID:

```text
404 REPOSITORY_NOT_FOUND
```

## 6. Create repository

### `POST /api/repositories`

Example Windows request:

```json
{
  "displayName": "TabDock",
  "githubRemote": "https://github.com/quantdale/tabdock.git",
  "localPath": "D:\\Projects\\TabDock",
  "environment": "windows",
  "executorCli": "codex",
  "executorModel": "gpt-5.6-luna-xhigh",
  "solConversationUrl": "https://chatgpt.com/c/...",
  "maxIterations": 20,
  "maxRuntimeMinutes": 480
}
```

Example WSL request:

```json
{
  "displayName": "Nightwatch",
  "githubRemote": "https://github.com/quantdale/nightwatch.git",
  "localPath": "/home/dale/projects/nightwatch",
  "environment": "wsl",
  "wslDistribution": "Ubuntu-24.04",
  "executorCli": "kimi",
  "executorModel": "deepseek-v4-flash",
  "solConversationUrl": "https://chatgpt.com/c/..."
}
```

Defaults when omitted:

```text
maxIterations = 20
maxRuntimeMinutes = 480
```

Success:

```text
201 Created
```

```json
{
  "repository": { "...": "RepositoryRecord" }
}
```

## 7. Update repository

### `PATCH /api/repositories/:id`

Request is a partial mutable configuration patch.

Example:

```json
{
  "executorModel": "gpt-5.6-luna-max",
  "maxRuntimeMinutes": 600
}
```

The controller MUST:

1. load the current record;
2. merge allowed patch fields;
3. validate the complete resulting configuration;
4. persist atomically;
5. return the updated record.

Clients cannot patch:

- `id`;
- `createdAt`;
- `updatedAt` directly;
- a branch field, because V1 has no branch configuration surface.

Success `200`:

```json
{
  "repository": { "...": "RepositoryRecord" }
}
```

## 8. Delete repository

### `DELETE /api/repositories/:id`

Preferred Change 001 success:

```text
204 No Content
```

Unknown ID -> `404 REPOSITORY_NOT_FOUND`.

Later milestones add active-run deletion guards.

## 9. Error envelope

All normal JSON errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Repository configuration is invalid.",
    "details": [
      {
        "field": "wslDistribution",
        "message": "WSL distribution is required when environment is wsl."
      }
    ]
  }
}
```

`details` may be omitted when unnecessary.

Initial error codes:

```text
VALIDATION_ERROR
REPOSITORY_NOT_FOUND
BAD_REQUEST
INTERNAL_ERROR
DATABASE_ERROR
```

Recommended status mapping:

```text
400 BAD_REQUEST            malformed request/body/path semantics
422 VALIDATION_ERROR       readable but invalid domain configuration
404 REPOSITORY_NOT_FOUND
500 INTERNAL_ERROR
500 DATABASE_ERROR         optional distinction; otherwise INTERNAL_ERROR
```

## 10. Validation examples

Reject:

- empty display name;
- empty remote;
- empty local path;
- WSL environment without WSL distribution;
- non-positive ceilings;
- non-integer ceilings;
- invalid/non-conversation Sol URL;
- empty executor CLI/model;
- unknown extra configuration fields when strict request schemas are used, including a legacy/configurable `branch` field in V1.

Do not mutate persistent data when validation fails.

## 11. Event endpoint

Canonical endpoint:

```text
GET /api/events
```

with WebSocket upgrade.

Change 001 does not require protocol multiplexing or durable event replay.

### Event envelope

```json
{
  "type": "repository.updated",
  "at": "2026-08-19T10:30:00.000Z",
  "repositoryId": "repo-id",
  "data": {
    "repository": { "...": "RepositoryRecord" }
  }
}
```

Initial event types:

```text
repository.created
repository.updated
repository.deleted
```

Delete event may include only repository ID if the full deleted record is not useful.

## 12. Event guarantees

Events are **best-effort live synchronization hints**.

Clients must not assume:

- guaranteed delivery;
- replay after disconnect;
- global ordering across process restarts;
- durable event storage.

On reconnect, the UI refetches authoritative REST state.

Mutation ordering rule:

```text
persist successfully
   THEN
publish event
```

Never publish `repository.created` and then discover the insert failed.

## 13. Built UI serving contract

In production-like/built mode the controller serves the SPA shell/static assets from `/` while reserving `/api/*` for API/WebSocket behavior.

Requirements:

- API routes win over SPA fallback;
- static assets are served with normal safe content types/cache behavior;
- client-side deep links such as `/repositories/<id>` resolve to the SPA shell when they are not API/static-asset paths;
- no arbitrary filesystem directory browsing;
- the server must not expose the local data directory/browser profile/logs as static content.

Change 001 only needs a small reliable static-serving arrangement. Do not build a general reverse proxy or web server framework around it.

## 14. CORS/origin policy

The preferred production/phone topology is same-origin and therefore does not require wildcard CORS.

During development, Vite's proxy avoids broad CORS configuration.

If an implementation needs a narrowly scoped development exception, document it and restrict it to known local origins. Do not ship `Access-Control-Allow-Origin: *` as the solution for phone access.

## 15. UI client behavior

The UI distinguishes:

```text
controller connecting
controller connected
controller disconnected/error
```

An empty repository list is not equivalent to controller unavailable.

On mutation event:

- update local data when safe, or
- invalidate/refetch affected repository/list.

On WebSocket reconnect:

- refetch authoritative state.

## 16. API/network tests

Required coverage:

- health after DB ready;
- empty list;
- create Windows;
- create WSL;
- create invalid WSL -> 422;
- get known/unknown;
- patch valid;
- patch invalid merged result leaves old record untouched;
- reject unsupported/legacy branch field if strict schema parsing is used;
- delete known/unknown;
- error envelope shape;
- no stack trace leakage;
- event after successful mutation;
- no success event after failed mutation;
- reconnect + refetch behavior;
- built SPA served by controller;
- deep-link SPA fallback does not shadow `/api`;
- UI source/client uses relative API paths rather than production `localhost` hard-coding;
- same-origin WebSocket URL is correct for HTTP and HTTPS page origins;
- no wildcard CORS required by normal built topology.

## 17. Operational intelligence endpoints

Change 010 adds repository-scoped read/probe/policy endpoints:

```text
GET  /api/repositories/:id/campaigns
GET  /api/repositories/:id/campaigns/:runId
GET  /api/repositories/:id/campaigns/:runId/iterations/:iteration
GET  /api/repositories/:id/campaigns/:runId/timeline
GET  /api/repositories/:id/executor/capabilities
POST /api/repositories/:id/executor/probe
GET  /api/repositories/:id/phase-policy
GET  /api/repositories/:id/permissions
PUT  /api/repositories/:id/permissions
POST /api/repositories/:id/permissions/check
```

Campaign detail returns structured run/iteration/timeline data and references
to dispatches, executor runs, Sol wakes, controls, and the effective policy.
It does not require parsing raw logs. Capability GET returns the latest
persisted snapshot and history; POST accepts `STATIC`, `NON_INFERENCE`, or an
explicitly authorized `INFERENCE` level. Settings and the UI default to
NON_INFERENCE and never spend model quota implicitly.

Permission checks return outcome, rationale, actionable state, and enforcement
type. An `ASK` result creates a durable decision/event for user attention; it is
not an indefinite hidden wait.

## 18. Usage and explicit scheduling endpoints

Change 011 adds:

```text
GET  /api/repositories/:id/usage
GET  /api/repositories/:id/campaigns/:runId/usage
GET  /api/scheduler/policy
PUT  /api/scheduler/policy
GET  /api/scheduler/decisions
POST /api/scheduler/admission
POST /api/scheduler/release
POST /api/scheduler/recover
GET  /api/repositories/:id/role-model-policy
PUT  /api/repositories/:id/role-model-policy
POST /api/repositories/:id/role-model-policy/resolve
```

Usage responses preserve null/unknown fields and expose exact versus estimated
cost separately. Scheduler responses include the policy snapshot and exact
limiting dimension/reason for queued or rejected work. The default policy has
no global/provider/model/repository limit. Role resolution reports
`EXPLICIT_RULE` or `REPOSITORY_DEFAULT`; it never performs hidden routing.

## 19. Typed packet and isolation endpoints

Change 012 adds focused strategy/qualification endpoints:

```text
GET  /api/repositories/:id/campaigns/:runId/packets
POST /api/repositories/:id/campaigns/:runId/packets
POST /api/repositories/:id/campaigns/:runId/packets/:packetId/result
POST /api/repositories/:id/campaigns/:runId/packets/:packetId/worktree
POST /api/repositories/:id/campaigns/:runId/packets/:packetId/worktree/release
GET  /api/repositories/:id/campaigns/:runId/worktrees
POST /api/repositories/:id/campaigns/:runId/worktrees/recover
POST /api/repositories/:id/campaigns/:runId/packets/integrate
GET  /api/repositories/:id/campaigns/:runId/integrations
```

Packet/result bodies are versioned structured envelopes. Worktree allocation
returns branch/path/base SHA provenance; integration returns per-packet
outcomes, integrated commits, blockers, and partial/conflict status. These
endpoints do not enable production swarm or change the default single-agent
loop.
