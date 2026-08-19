# Autonomous Loop Engine and Multi-Repository Concurrency Specification

## Purpose

Compose watcher, executor, Git results, and Playwright Sol wakes into a per-repository autonomous state machine loop supporting multi-repository concurrency and operational run controls.

## Requirements

### Requirement: Autonomous state machine progression

The engine SHALL manage the state transitions for each active repository according to the canonical state machine.

#### Scenario: Forward progression loop
- GIVEN an active run in `SOL_REVIEWING`
- WHEN a new valid isolated dispatch is detected on remote `main`
- THEN state transitions to `EXECUTOR_PENDING` and launches the headless executor -> `EXECUTING`
- WHEN the executor completes and publishes a result manifest
- THEN state transitions to `SOL_PENDING`, submits a trusted Sol wake, and transitions to `SOL_REVIEWING`

#### Scenario: Single actor exclusivity per repository
- GIVEN an active run
- WHEN executor is running
- THEN Sol browser bridge is never invoked for that repository until executor completes

---

### Requirement: Multi-repository concurrency

The engine SHALL allow multiple configured repositories to execute their autonomous loops independently and simultaneously without a global concurrency cap.

#### Scenario: Independent concurrent repositories
- GIVEN Repository A is in `EXECUTING` and Repository B is in `SOL_REVIEWING`
- WHEN Repository A finishes and transitions to `SOL_PENDING`
- THEN Repository B's state and execution are unaffected

---

### Requirement: Run controls and terminal state handling

The engine SHALL enforce iteration limits, pause, resume, and stop controls.

#### Scenario: Max iterations ceiling
- GIVEN a run configured with `maxIterations = 5`
- WHEN iteration 5 completes
- THEN state transitions to `DRAINING` or `GOAL_COMPLETE` instead of launching another turn

#### Scenario: Pause and Resume
- GIVEN an active run
- WHEN user requests Pause
- THEN current execution is cleanly stopped and state transitions to `PAUSED`
- WHEN user requests Resume
- THEN state resumes from where it was paused
