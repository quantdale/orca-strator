# Change 022 design

## Context

The defects were found by burning real inference through the real CLIs using
Orca's exact production invocation shapes (evidence archived in
`docs/REAL-DOGFOOD-QUALIFICATION.md`):

- `codex exec -m gpt-5.6-luna --json "create file ..."` → turn completed with
  "Could not create the file because the current workspace is read-only";
  stderr: "writing is blocked by read-only sandbox; rejected by user approval
  settings".
- The same command under a Node spawn mimicking
  `WindowsPowerShellAdapter.spawn` (default stdio pipes, never-closed stdin)
  → no output for >75s, stderr stuck at "Reading additional input from
  stdin..."; with closed stdin the same command completes in seconds.
- `codex exec -s workspace-write ...` on Windows 0.148.0: patch and shell
  helpers unavailable ("Windows sandbox helper is missing"); the model could
  only write files by improvising through an unrelated MCP tool, so git
  operations would fail. `-s danger-full-access` gives a fully working pwsh
  shell: file create + commit + push verified against a real remote.
- Kimi 0.34.0 with an open stdin pipe exits normally; no change needed.

## Goals

1. Codex executor turns can actually write, commit, and push headless.
2. No executor child can hang waiting on stdin that will never be closed.
3. Pin both behaviors in the fast tier so regressions surface immediately.

## Decisions

- **`-s danger-full-access`** rather than `workspace-write`: the narrower
  permission step was tested first, but codex's Windows sandbox helper is
  absent in CLI 0.148.0, leaving its patch/shell tools unusable — the
  executor must at least run `git`. Orca already treats executors as trusted
  local actors supervised by process-tree kill, watchdogs, preflight, and
  postflight; the sandbox adds availability risk without a security boundary
  Orca relies on.
- **`stdio: ['ignore', 'pipe', 'pipe']`** in both native adapters rather than
  per-profile workarounds: the hazard is structural (nobody ever closes the
  pipe), applies to every current and future profile, and stdout/stderr
  capture must keep working for logs.
- Keep argument order `exec -s <mode> -m <model> --json <prompt>`; flags
  before the positional prompt, matching the verified manual invocation.

## Non-goals

- No change to Kimi/OpenCode/generic/test profiles or their args.
- No WSL-specific behavior beyond inheriting the same stdio fix.
- No new retry/watchdog policy: the existing launch/contact machinery already
  bounds process lifecycle once stdin cannot wedge the child.
