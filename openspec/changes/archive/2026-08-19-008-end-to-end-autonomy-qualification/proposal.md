# Change 008: End-to-End Autonomy Qualification

## Status

**Ready for implementation**

Roadmap milestone: **8 — End-to-end autonomy qualification**

## Why

All individual subsystems and integration milestones (1 through 7) are implemented and verified. Milestone 8 executes the comprehensive end-to-end qualification suite proving the full system behavior across all execution environments (Windows native and WSL), multi-repository concurrency, crash and restart survival, operational controls, and phone access.

## Goals

1. Comprehensive end-to-end integration test suite exercising the entire matrix:
   - Multi-repo concurrent autonomous loops with Windows and WSL adapters.
   - Transactional dispatch commits, duplicate dispatch protection, and mixed commit rejection.
   - Sol wake submissions with multi-page browser isolation and busy backpressure.
   - Crash, restart, and recovery workflows (`RECOVERY_REQUIRED` -> `retry`/`complete`/`stop`).
   - Operational controls (Pause, Resume, Stop, Drain).
   - Phone same-origin Tailscale guidance and notification dispatch.
2. Full repository build, lint, typecheck, and test matrix across `@orca/shared`, `@orca/controller`, `@orca/ui`, and `@orca/desktop`.
3. Complete V1 Roadmap qualification and transition to finalized V1 milestone state.
