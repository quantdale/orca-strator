# Design: Autonomous Loop Engine

## 1. Summary

Change 005 implements the autonomous loop engine in `@orca/controller` and `@orca/shared`.

Key components:
1. **Loop State Machine Types (`loop-state.ts`)**: State definitions (`IDLE`, `SOL_PENDING`, `SOL_REVIEWING`, `EXECUTOR_PENDING`, `EXECUTING`, `GOAL_COMPLETE`, `BLOCKED`, `NEEDS_HUMAN`, `PAUSED`, `STOPPED`, `DRAINING`, `SOL_STALLED`, `EXECUTOR_UNAVAILABLE`), Run interfaces, and event payloads.
2. **Run Storage & Migrations (`run-store.ts`, migration `005_create_runs`)**: SQLite persistence for autonomous runs (`id`, `repository_id`, `goal`, `status`, `current_iteration`, `max_iterations`, timestamps).
3. **Repository Autonomous Loop Runner (`repository-loop-runner.ts`)**: Per-repository orchestrator listening to watcher events, executor completion events, and triggering Sol wakes.
4. **Loop Orchestrator Service (`loop-service.ts`)**: High-level manager coordinating per-repository loop runners, start/pause/resume/stop commands, and multi-repo concurrency.
5. **REST APIs & WebSocket Events**: Exposes `/api/repositories/:id/runs/*` endpoints and emits `loop.state_changed` WebSocket events.

## 2. SQLite Schema Additions

Migration `005_create_runs`:
```sql
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  current_iteration INTEGER NOT NULL DEFAULT 0,
  max_iterations INTEGER NOT NULL DEFAULT 20,
  last_error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_repo ON runs(repository_id);
```
