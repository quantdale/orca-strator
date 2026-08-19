# Design: Headless Executor Runtime

## 1. Summary

Change 003 implements the headless executor runtime in `@orca/controller` and `@orca/shared`.

Key components:
1. **Result Protocol Validator (`result-validator.ts`)**: Validates `.orca/results/<dispatchId>.json` against JSON Schema `schemas/protocol/executor-result.schema.json`.
2. **Environment Adapters (`adapters/windows-adapter.ts`, `adapters/wsl-adapter.ts`)**: Cross-platform process execution boundary for Windows and WSL.
3. **Bootstrap Prompt Generator (`bootstrap-prompt.ts`)**: Formulates the canonical small bootstrap instructions for headless agents.
4. **Process Supervisor & Runner (`executor-runner.ts`)**: Manages process spawn, tree kill (`taskkill /pid ... /T /F` on Windows), live stdout/stderr capture, buffer storage, and log file persistence in `~/.orca/logs/<repoId>/<runId>.log`.
5. **Executor Storage & Migrations (`executor-store.ts`, migration `003_create_executor_runs`)**: SQLite persistence for executor runs, attempts, statuses (`RUNNING`, `COMPLETED`, `PAUSED`, `FAILED`, `KILLED`, `TIMED_OUT`), exit codes, and timestamps.
6. **Fake Executor Simulator (`fake-executor.ts`)**: Qualification engine that simulates successful completion, verification passes/failures, blocker outputs, timeouts, and pause/kill responses for deterministic testing.
7. **REST APIs & WebSocket Events**: Exposes `/api/repositories/:id/executor/*` endpoints and emits `executor.*` WebSocket events.

## 2. SQLite Schema Additions

Migration `003_create_executor_runs`:
```sql
CREATE TABLE IF NOT EXISTS executor_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'paused', 'failed', 'killed', 'timed_out')),
  exit_code INTEGER,
  log_path TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executor_runs_repo ON executor_runs(repository_id);
CREATE INDEX IF NOT EXISTS idx_executor_runs_dispatch ON executor_runs(dispatch_id);
```

## 3. Execution Flow

1. Controller detects valid dispatch or receives manual start request.
2. Formulates bootstrap prompt and sets environment variables (`ORCA_RUN_ID`, `ORCA_DISPATCH_ID`, `ORCA_DISPATCH_PATH`, `ORCA_CHANGE_PATH`, `ORCA_ITERATION`).
3. Selects `WindowsPowerShellAdapter` or `WslAdapter` based on repository configuration.
4. Spawns executor process with stdout/stderr piped.
5. Captures output in ring buffer and appends to log file.
6. Emits `executor.log` events to connected WebSocket clients.
7. On process exit:
   - If exit code 0 and `.orca/results/<dispatchId>.json` was published: validates result manifest and records `completed`.
   - If non-zero exit code or no manifest: marks `failed` with exit code and error.
8. Operational controls (`pause`, `kill`, `stop`) allow immediate process interruption.
