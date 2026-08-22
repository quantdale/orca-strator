# Executor headless invocation

## ADDED Requirements

### Requirement: Codex executor invocation grants a writable sandbox

The Codex executor profile SHALL invoke the CLI with an explicit sandbox mode
that permits repository writes and shell execution, so a headless executor
turn can create files and run Git commands instead of completing without
acting.

#### Scenario: Codex args include the sandbox flag before the prompt

- **WHEN** an executor invocation is built for the `codex` profile
- **THEN** the argument array SHALL contain `exec`, the configured sandbox
  flag sequence (`-s danger-full-access`), `-m` followed by the user-configured
  model, `--json`, and finally the prompt as the positional argument
- **AND** no other profile's argument array SHALL be modified

### Requirement: Executor children receive no readable stdin

Windows and WSL executor adapters SHALL spawn executor child processes with
stdin ignored, so a child that reads stdin until EOF cannot block forever on a
pipe the controller never closes.

#### Scenario: Spawned Windows executor child has no stdin writer

- **WHEN** the Windows adapter spawns any executor command
- **THEN** the child process SHALL expose no stdin writer (stdin ignored)
- **AND** stdout/stderr SHALL remain captured for executor logs

#### Scenario: WSL adapter uses the same stdio policy

- **WHEN** the WSL adapter spawns its command
- **THEN** the spawn options SHALL use the same stdio configuration as the
  Windows adapter (stdin ignored; stdout/stderr piped)
