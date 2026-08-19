# Design: Playwright Sol Bridge

## 1. Summary

Change 004 implements the browser ChatGPT Sol wake automation in `@orca/controller` and `@orca/shared`.

Key components:
1. **Profile Lock Manager (`profile-lock.ts`)**: File/PID-based exclusive lock with stale lock detection (checking PID liveness via `process.kill(pid, 0)` on Windows).
2. **Browser Driver Interface (`browser-driver.ts`)**: Interface for launching persistent context, opening pages, typing text, clicking send, and closing tabs.
3. **Playwright Driver Implementation (`playwright-driver.ts`)**: Uses Playwright `chromium.launchPersistentContext` with standard anti-detection flags and persistent user-data directory.
4. **Sol Wake Submitter (`sol-wake-submitter.ts`)**: Formulates the canonical trusted wake message and handles composer selectors, dialog dismissal, and send verification.
5. **Sol Wake Storage & Migrations (`sol-wake-store.ts`, migration `004_create_sol_wakes`)**: SQLite persistence for wake attempts, statuses (`PENDING`, `SUBMITTED`, `FAILED`, `BUSY`), and error logs.
6. **Mock Browser Driver (`mock-browser-driver.ts`)**: Deterministic fake driver for qualification and unit/integration tests without requiring live ChatGPT network access.
7. **REST APIs & WebSocket Events**: Exposes `/api/browser/*` and `/api/repositories/:id/wake` endpoints and emits `browser.*` and `sol.wake_*` events.

## 2. SQLite Schema Additions

Migration `004_create_sol_wakes`:
```sql
CREATE TABLE IF NOT EXISTS sol_wakes (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  conversation_url TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'failed', 'busy')),
  error_message TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sol_wakes_repo ON sol_wakes(repository_id);
CREATE INDEX IF NOT EXISTS idx_sol_wakes_dispatch ON sol_wakes(dispatch_id);
```

## 3. Trusted Wake Message Format

```text
Orca-Strator executor turn completed for {repositoryName}.
Run: {runId}
Iteration: {iteration}
Dispatch: {dispatchId}
Result status: {status}

Review the latest GitHub main state, the active OpenSpec change, and .orca/results/{dispatchId}.json.
Make any review/spec/code corrections that are useful.
Then either:
1. create and push the next focused OpenSpec work and finally an isolated new dispatch marker, or
2. publish a durable terminal/control decision.
Follow the repository's agent/Orca protocol.
```
