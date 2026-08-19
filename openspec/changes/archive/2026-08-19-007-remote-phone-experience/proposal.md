# Change 007: Private Phone Access and Notifications

## Status

**Ready for implementation**

Roadmap milestone: **7 — Private phone access and notifications**

## Why

Milestones 1-6 built the complete, autonomous, crash-resilient orchestrator. Milestone 7 provides the mobile monitoring and control experience so users can follow their repositories away from their desk without exposing the controller to the public internet.

## Goals

1. Responsive mobile UI layout for repository overview, active run status, live logs, and operational controls (Start, Pause, Resume, Stop, Recover).
2. Tailscale Serve guidance and status endpoint (`GET /api/system/tailscale`) providing secure reverse-proxy instructions.
3. System notifications for meaningful terminal and problem states (`GOAL_COMPLETE`, `NEEDS_HUMAN`, `BLOCKED`, `SOL_STALLED`, `EXECUTOR_UNAVAILABLE`, `RECOVERY_REQUIRED`) while keeping routine iterations quiet.
4. Relative API and WebSocket connectivity verified across desktop and mobile screen viewports.
5. Integration tests verifying mobile responsive rendering, control dispatch, and notification filtering.
