# Design: Repository Watcher and Transactional Dispatch

## 1. Summary

Change 002 implements the remote Git watcher and transactional dispatch subsystem in `@orca/controller` and `@orca/shared`.

Key components:
1. **Git Client / Remote Inspector (`git-client.ts`)**: Low-overhead `git ls-remote` for `refs/heads/main` and commit inspection (`git diff-tree`, `git show`).
2. **Dispatch Protocol Validator (`dispatch-validator.ts`)**: Validates `.orca/dispatch/<id>.json` against JSON schema and path safety rules.
3. **Commit Isolation Checker (`commit-inspector.ts`)**: Validates that dispatch commits contain only `A .orca/dispatch/<id>.json`.
4. **Dispatch Store & SQLite Migrations (`dispatch-store.ts`, migration `002_create_dispatches`)**: Persists observed dispatches, statuses (`DETECTED`, `CONSUMED`, `REJECTED`), and last-seen remote SHAs.
5. **Repository Watcher Manager (`watcher-service.ts`)**: Manages per-repository watcher loops, polling intervals, error backoff, and event emission.
6. **API & Event Integration**: Exposes watcher state on REST endpoints and publishes WebSocket mutation/watcher events.

## 2. SQLite Schema Additions

Migration `002_create_dispatches`:
```sql
CREATE TABLE IF NOT EXISTS dispatches (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  commit_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  change_path TEXT NOT NULL,
  goal TEXT NOT NULL,
  instructions_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('detected', 'consumed', 'rejected')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watcher_state (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  last_observed_sha TEXT,
  last_polled_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
```

## 3. Remote Polling Protocol

1. Watcher periodically executes `git ls-remote <remoteUrl> refs/heads/main` (or queries local cache/clone).
2. If remote HEAD SHA equals `last_observed_sha`, polling concludes with no-op.
3. If remote HEAD SHA has changed:
   a. Fetch remote `main`.
   b. Inspect commits between previous SHA and new SHA (or the HEAD commit).
   c. If a commit touches `.orca/dispatch/`, verify commit isolation:
      - Must only add one `.orca/dispatch/<dispatchId>.json`.
      - Must not modify existing files or add unrelated source/spec files.
   d. If valid, parse JSON, validate schema and path safety.
   e. Check whether `dispatchId` already exists in SQLite:
      - If exists, ignore idempotently.
      - If new, insert into `dispatches` as `detected` and emit `watcher.dispatch_detected`.
   f. Update `watcher_state.last_observed_sha`.
4. If commit is mixed or invalid:
   - Insert into `dispatches` as `rejected` with rejection reason.
   - Emit `watcher.dispatch_rejected`.
   - Update `watcher_state.last_observed_sha`.

## 4. Multi-Repository Concurrency

Each registered repository has its own watcher instance managed by `WatcherService`.
- Lifecycle starts when controller starts (for active repositories).
- Paused or stopped per repository without affecting other repositories.
- Fast, non-blocking asynchronous polling using Node.js child processes (`git` commands) with bounded timeouts.
