# Executor shutdown sweeps

## ADDED Requirements

### Requirement: Startup truth repair for orphaned executor runs

At startup reconciliation, every persisted executor run still marked
`running` or `pending` SHALL be marked `failed` with a truthful cause naming
the controller restart and the previous status, because no live process can
exist behind a freshly started controller. Terminal rows SHALL be left
untouched, and the reconciliation result SHALL count the repaired rows as
`orphanedExecutorRuns`.

#### Scenario: Persisted running row after abnormal exit

- **WHEN** a controller restarts with an executor run persisted as `running`
  from before the restart
- **THEN** startup reconciliation SHALL mark that row `failed`, record the
  cause and a `finishedAt` timestamp, and count it in the result

#### Scenario: Pending row and untouched terminal rows

- **WHEN** startup reconciliation observes one persisted `pending` row and
  one already-terminal (`completed`) row for the same repository
- **THEN** only the `pending` row SHALL be repaired and counted, and the
  terminal row SHALL remain unchanged

### Requirement: Shutdown kill sweep covers launch-intent runners

Controller shutdown SHALL terminate not only active runners but also runners
still registered in the per-repository launch-intent map whose child process
already spawned, so a kill sweep arriving between registration and graduation
cannot orphan the spawned child.

#### Scenario: Kill sweep reaches a spawned-but-ungraduated child

- **WHEN** a runner has registered launch intent, its child process has
  spawned, and graduation into the active map has not happened yet when
  shutdown starts
- **THEN** the sweep SHALL invoke the adapter's process-tree termination on
  that exact child instead of leaving it orphaned

### Requirement: Kill sweep isolation

A single failed kill during the shutdown sweep SHALL NOT abort the sweep:
every targeted runner SHALL receive a kill attempt, the sweep SHALL resolve,
and the failure SHALL be surfaced rather than swallowed silently.

#### Scenario: One broken adapter kill among several

- **WHEN** two repositories have live runners at shutdown and the first
  repository's process-tree termination rejects
- **THEN** the second repository's runner SHALL still receive its kill
  attempt and the shutdown promise SHALL resolve

### Requirement: Emergency kill aborts an in-launch runner without further spawns

An emergency kill of a repository whose runner is inside its launch-retry
window SHALL prevent any later spawn attempt for that runner and SHALL leave
the executor run in a terminal persisted state.

#### Scenario: Kill lands during the retry sleep

- **WHEN** the first launch attempt fails asynchronously and the emergency
  kill arrives while the runner waits to retry
- **THEN** no additional spawn attempt SHALL occur, the start attempt SHALL
  settle with a truthful launch-failure error, and the persisted executor run
  SHALL end in a terminal status
