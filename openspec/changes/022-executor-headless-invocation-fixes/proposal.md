# Change 022: Executor headless invocation fixes

## Why

The real external qualification campaign (2026-08-22) attempted the first real
Codex CLI smoke using Orca's production invocation shape. Two concrete
production defects were exposed on this machine with codex-cli 0.148.0:

1. **Read-only sandbox**: `buildCodexInvocation` spawns
   `codex exec -m <model> --json "<prompt>"` with no sandbox flag. Codex
   0.148.0 defaults to a read-only workspace, so the executor cannot create or
   modify any file ("writing is blocked by read-only sandbox"). A real
   executor turn would exit without doing the work (and codex exits 0 even
   when it could not act, so only Orca's exit-0-without-manifest guard
   prevents a false success).
2. **Open stdin hang**: `WindowsPowerShellAdapter.spawn` and `WslAdapter.spawn`
   use Node's default `stdio: 'pipe'` and never close the child's stdin.
   `codex exec` reads stdin until EOF before executing ("Reading additional
   input from stdin...") and blocks forever on the never-closed pipe. This was
   reproduced empirically: an Orca-shaped spawn stayed alive >75s producing no
   events, while the same command with closed stdin completed normally.

Kimi Code 0.34.0 (`kimi -m <model> -p "<prompt>"`) was verified working as-is
under both conditions, including git commit/push; its profile is pinned by
tests but not changed.

## Scope

- add `-s danger-full-access` to the Codex profile argument array
  (`workspace-write` was also tested and rejected: codex's Windows sandbox
  helper is missing in 0.148.0, leaving patch/shell tools unavailable, which
  breaks git operations);
- spawn executor children with stdin ignored
  (`stdio: ['ignore', 'pipe', 'pipe']`) in the Windows and WSL adapters;
- focused fast-tier tests pinning both behaviors;
- no protocol, loop, browser, or scheduler changes.

## Impact

- Executor turns for Codex become actually functional headless; Kimi unchanged.
- Ignoring stdin is strictly safer for all executors: no production executor
  consumes interactive input, and a child can no longer wedge the loop by
  waiting on a pipe nobody closes.

## Verification intent

- Focused unit tests: codex args contain the sandbox flag; adapter-spawned
  children have no readable stdin writer.
- Real evidence (recorded in docs/REAL-DOGFOOD-QUALIFICATION.md): direct
  smokes proving each CLI writes/commits/pushes under the fixed invocation.
