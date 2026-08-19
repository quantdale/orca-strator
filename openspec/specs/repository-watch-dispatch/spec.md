# Repository Watcher and Transactional Dispatch Specification

## Purpose

Enable Orca to watch configured Git repositories for Sol dispatch commits on `main` and validate transactional dispatch markers deterministically without external webhooks or manual intervention.

## Requirements

### Requirement: Remote Git watcher monitors remote main branch only

The controller SHALL maintain an independent remote watcher for each configured active repository that monitors only `refs/heads/main` or `origin/main`.

#### Scenario: Remote main movement detection
- GIVEN a configured repository with a valid remote URL
- WHEN a new commit is pushed to remote `main`
- THEN the watcher detects the updated remote HEAD SHA

#### Scenario: Non-main branch pushes ignored
- GIVEN a commit is pushed to a feature branch on remote
- WHEN the watcher polls the remote
- THEN the feature branch update does NOT trigger dispatch processing

#### Scenario: Polling efficiency
- GIVEN periodic watching is active
- WHEN checking for remote updates
- THEN lightweight remote HEAD querying (`git ls-remote` or equivalent) is performed before triggering local fetch

---

### Requirement: Transactional dispatch commit validation

The watcher SHALL validate that a dispatch marker appears in an isolated, dedicated final dispatch commit.

#### Scenario: Valid isolated dispatch commit
- GIVEN a commit on `main` that introduces exactly one new file at `.orca/dispatch/<dispatchId>.json` matching the dispatch ID inside the file
- WHEN inspected by the watcher
- THEN the commit is accepted as a valid transactional dispatch

#### Scenario: Mixed commit rejection
- GIVEN a commit on `main` that modifies source code, specs, or other files in the same commit as `.orca/dispatch/<dispatchId>.json`
- WHEN inspected by the watcher
- THEN the dispatch is rejected with a clear structured reason and is not dispatched

#### Scenario: Dispatch file modification rejection
- GIVEN a commit on `main` that modifies an existing `.orca/dispatch/<dispatchId>.json` rather than adding a new one
- WHEN inspected by the watcher
- THEN the modification is rejected as an immutability violation

---

### Requirement: Protocol schema validation for dispatch markers

The system SHALL validate `.orca/dispatch/<dispatchId>.json` content against `schemas/protocol/dispatch.schema.json`.

#### Scenario: Valid dispatch schema
- GIVEN a dispatch JSON payload containing all required fields (`schemaVersion: 1`, `type: "dispatch"`, `runId`, `dispatchId`, `iteration`, `createdAt`, `baseSha`, `changePath`, `goal`, `instructionsVersion`)
- WHEN validated
- THEN validation succeeds and returns typed dispatch metadata

#### Scenario: Invalid dispatch schema
- GIVEN a dispatch JSON payload missing required fields, containing extra properties, or having invalid types
- WHEN validated
- THEN validation fails with descriptive field errors and the dispatch is rejected

#### Scenario: Path traversal prevention
- GIVEN a `changePath` containing `../` or leading slash
- WHEN validated
- THEN validation fails and prevents repository directory escape

---

### Requirement: Dispatch idempotency and persistence

The controller SHALL persist consumed dispatch records and observed remote SHAs in SQLite to prevent duplicate execution across restarts.

#### Scenario: Duplicate dispatch observation
- GIVEN a dispatch ID has already been recorded as consumed or active in SQLite
- WHEN the watcher observes the same commit or dispatch ID again
- THEN it is ignored idempotently without double-launching an executor

#### Scenario: Controller restart recovery
- GIVEN dispatches were previously consumed and recorded
- WHEN the controller restarts
- THEN the historical consumed dispatches remain in SQLite and are not re-executed

---

### Requirement: Watcher observability and event publishing

The controller SHALL publish real-time watcher status events and expose REST status endpoints.

#### Scenario: Watcher status REST endpoint
- GIVEN an active repository
- WHEN `GET /api/repositories/:id/watcher` is requested
- THEN it returns current watcher status (`isWatching`, `lastPolledAt`, `lastObservedSha`, `activeDispatchId`, `lastError`)

#### Scenario: Dispatches REST endpoint
- GIVEN an active repository
- WHEN `GET /api/repositories/:id/dispatches` is requested
- THEN it returns list of historical dispatches for that repository ordered by iteration

#### Scenario: Watcher event emission
- GIVEN a WebSocket client connected to `/api/events`
- WHEN a new dispatch is detected or an invalid commit is rejected
- THEN real-time events (`watcher.dispatch_detected`, `watcher.dispatch_rejected`, `watcher.poll_completed`) are broadcast
