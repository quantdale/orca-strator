# Runtime Recovery, Ceilings, and Hardening Specification

## Purpose

Harden autonomous loop for long-duration operation, crash recovery, runtime ceilings, and log retention.

## Requirements

### Requirement: Wall-clock runtime budget and graceful draining

The controller SHALL track total elapsed runtime per run and transition to `DRAINING` when the ceiling is reached, completing the active actor turn before terminating.

#### Scenario: Wall-clock budget exceeded during execution
- GIVEN a run with `maxRuntimeMinutes = 480`
- WHEN elapsed time exceeds 480 minutes while an executor turn is active
- THEN the engine transitions to `DRAINING` and allows the executor to complete its work and publish result before moving to `GOAL_COMPLETE`

---

### Requirement: Controller crash and restart recovery

The controller SHALL inspect and reconcile pending runs on startup.

#### Scenario: Interrupted executor run
- GIVEN a run in `EXECUTING` when the controller crashed
- WHEN controller restarts and detects no running executor process
- THEN it transitions the run to `RECOVERY_REQUIRED` with diagnostic details

#### Scenario: Safe resumption of pending Sol review
- GIVEN a run in `SOL_REVIEWING` when the controller restarted
- WHEN controller restarts
- THEN it maintains `SOL_REVIEWING` and resumes remote Git polling

---

### Requirement: Manual recovery resolution

The controller SHALL expose an API to resolve `RECOVERY_REQUIRED` states.

#### Scenario: Resolve recovery by retrying turn
- GIVEN a run in `RECOVERY_REQUIRED`
- WHEN user calls `POST /api/repositories/:id/runs/recover` with action `retry`
- THEN state transitions to `SOL_PENDING` and resumes the loop

---

### Requirement: Bounded log retention

The controller SHALL prune executor logs to avoid unbounded disk consumption.

#### Scenario: Log pruning
- GIVEN a repository log directory with more than the maximum retained logs
- WHEN log rotator executes
- THEN the oldest log files are removed to maintain the configured ceiling
