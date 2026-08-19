# Change 006: Runtime Recovery, Ceilings, and Hardening

## Status

**Ready for implementation**

Roadmap milestone: **6 — Runtime ceilings, recovery, and hardening**

## Why

Milestones 1-5 built the complete autonomous orchestration loop for multiple concurrent repositories. Milestone 6 hardens the engine for long-duration, leave-and-forget execution across hours of operation, process crashes, machine reboots, wall-clock/iteration limits, and recovery workflows.

## Goals

1. Implement wall-clock runtime ceiling enforcement (default 8 hours) with graceful `DRAINING` transition at handoff boundaries.
2. Implement controller crash / reboot recovery:
   - On startup, inspect all non-terminal runs in SQLite.
   - If in `EXECUTING` with no live process, check if result manifest was published to Git; if not, transition to `RECOVERY_REQUIRED` with actionable diagnostic reasons.
   - If in `SOL_REVIEWING`, resume watcher polling seamlessly.
   - If in `SOL_PENDING`, resubmit trusted Sol wake.
3. Support manual recovery resolution endpoint (`POST /api/repositories/:id/runs/recover`) allowing resume or termination.
4. Implement bounded executor log file retention and log rotation.
5. Provide fault-injection test coverage for unexpected controller restart, killed process recovery, duplicate dispatch protection, and stale lock eviction.
