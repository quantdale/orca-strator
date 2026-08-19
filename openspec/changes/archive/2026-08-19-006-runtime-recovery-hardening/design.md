# Design: Runtime Recovery, Ceilings, and Hardening

## 1. Summary

Change 006 implements crash recovery, wall-clock budget monitoring, recovery resolution APIs, and log retention.

Key components:
1. **Startup Recovery Reconciler (`recovery-reconciler.ts`)**:
   - Runs during controller initialization.
   - Reconciles any active runs from SQLite.
   - Flags orphaned `EXECUTING` runs as `RECOVERY_REQUIRED`.
   - Restarts Git polling for `SOL_REVIEWING` runs.
2. **Runtime Ceiling & Draining Logic (`loop-service.ts`)**:
   - Compares `Date.now() - Date.parse(run.startedAt)` against `maxRuntimeMinutes * 60 * 1000`.
   - Transitions to `DRAINING` when budget is exhausted.
3. **Recovery API (`routes/runs.ts`)**:
   - `POST /api/repositories/:id/runs/recover` (`action: "retry" | "stop" | "complete"`).
4. **Log Retention Manager (`log-rotator.ts`)**:
   - Prunes executor run log files older than configured retention period or exceeding max retained runs per repository.
