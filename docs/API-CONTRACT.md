# Orca-Strator V1 Controller API Contract

Status: **normative for Change 001**

The controller API is the sole UI-facing boundary for repository configuration/state in V1. The React UI and Electron shell must not access SQLite directly.

## 1. General rules

- Bind to loopback by default.
- JSON request/response bodies use UTF-8.
- Successful responses use stable JSON shapes.
- Client-visible errors use one machine-readable envelope.
- Raw stack traces, SQL, tokens, cookies, and secrets must not appear in normal API payloads.
- API versioning is not required for Change 001; keep routes under `/api/` so a future versioning seam exists.

## 2. Health

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

## 3. List repositories

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
      "branch": "main",
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

## 4. Get repository

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

## 5. Create repository

### `POST /api/repositories`

Example Windows request:

```json
{
  "displayName": "TabDock",
  "githubRemote": "https://github.com/quantdale/tabdock.git",
  "localPath": "D:\\Projects\\TabDock",
  "branch": "main",
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
branch = main
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

## 6. Update repository

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
- `updatedAt` directly.

Success `200`:

```json
{
  "repository": { "...": "RepositoryRecord" }
}
```

## 7. Delete repository

### `DELETE /api/repositories/:id`

Change 001 success may use either `204 No Content` or a documented `200` envelope; choose one and keep tests/clients consistent. Preferred:

```text
204 No Content
```

Unknown ID -> `404 REPOSITORY_NOT_FOUND`.

Later milestones will add active-run deletion guards.

## 8. Error envelope

All normal JSON errors should use:

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

Do not create dozens of codes before real callers need them.

Recommended status mapping:

```text
400 BAD_REQUEST            malformed request/body/path semantics
422 VALIDATION_ERROR       structurally readable but invalid domain configuration
404 REPOSITORY_NOT_FOUND
500 INTERNAL_ERROR
500 DATABASE_ERROR         if exposing this distinction is useful; otherwise map to INTERNAL_ERROR
```

## 9. Validation examples

Reject:

- empty display name;
- empty remote;
- empty local path;
- WSL environment without WSL distribution;
- non-positive ceilings;
- non-integer ceilings;
- invalid/non-conversation Sol URL;
- empty executor CLI/model.

Do not mutate persistent data when validation fails.

## 10. Event endpoint

Exact route may be:

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

## 11. Event guarantees

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

## 12. UI client behavior

The UI should distinguish:

```text
controller connecting
controller connected
controller disconnected/error
```

An empty repository list is not equivalent to controller unavailable.

On mutation event:

- update local data when safe, or
- invalidate/refetch the affected repository/list.

On WebSocket reconnect:

- refetch authoritative state.

## 13. API tests

Required coverage:

- health after DB ready;
- empty list;
- create Windows;
- create WSL;
- create invalid WSL -> 422;
- get known/unknown;
- patch valid;
- patch invalid merged result leaves old record untouched;
- delete known/unknown;
- error envelope shape;
- no stack trace leakage;
- event after successful mutation;
- no success event after failed mutation;
- reconnect + refetch behavior at client boundary.
