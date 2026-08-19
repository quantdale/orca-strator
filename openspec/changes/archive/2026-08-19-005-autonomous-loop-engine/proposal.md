# Change 005: Autonomous Loop Engine and Multi-Repository Concurrency

## Status

**Ready for implementation**

Roadmap milestone: **5 — Autonomous loop and multi-repository concurrency**

## Why

Milestones 1-4 built all foundational components: control plane, remote Git watcher, headless executor runtime, and Playwright Sol bridge. Milestone 5 composes them into the autonomous leave-and-forget orchestration loop for multiple concurrent repositories.

## Goals

1. Implement the per-repository autonomous state machine loop conforming to `docs/RUNTIME-MODEL.md`:
   `IDLE` -> `SOL_PENDING` -> `SOL_REVIEWING` -> `EXECUTOR_PENDING` -> `EXECUTING` -> `SOL_PENDING` ...
2. Support terminal and control states: `GOAL_COMPLETE`, `BLOCKED`, `NEEDS_HUMAN`, `PAUSED`, `STOPPED`, `DRAINING`, `SOL_STALLED`, `EXECUTOR_UNAVAILABLE`.
3. Add SQLite migration `005_create_runs` and `RunStore` for persisting autonomous runs and state transitions.
4. Orchestrate watcher events, executor exits, and Sol wakes into automated state transitions.
5. Enforce per-repository iteration ceilings and single-actor progression (never Sol and executor simultaneously on the same repo).
6. Enable multi-repository concurrency: multiple repositories executing independent loops simultaneously without a global executor cap.
7. Expose run management REST endpoints (`POST /api/repositories/:id/runs/start`, `POST /api/repositories/:id/runs/pause`, `POST /api/repositories/:id/runs/resume`, `POST /api/repositories/:id/runs/stop`, `GET /api/repositories/:id/runs/active`).
8. Broadcast real-time loop state change events over WebSocket.
9. Verify multi-repo end-to-end loop progression with integration tests.

## Non-goals inside 005

- Desktop UI visual enhancements / review dashboard (belongs to Milestone 6).
- Phone control and Tailscale setup (belongs to Milestone 7).
