# Design: Typed Work Packets & Parallel-Writer Isolation

## 1. Packet and result contracts

`WorkPacket` and `WorkPacketResult` are versioned shared contracts. They carry
goal, requirements, allowed/read paths, explicit dependencies, executor/model
policy, permission policy, verification expectations, budget, Git/worktree
provenance, changed files, risks, artifacts, and usage references. They do not
carry giant prior-agent transcripts. Structured files/manifests plus Git remain
the handoff truth.

Worker states include `QUEUED`, `STARTING`, `RUNNING`, `WAITING_PERMISSION`,
`RETRYING`, `COMPLETED`, `FAILED`, `BLOCKED`, `SKIPPED_DEPENDENCY`, and
`CANCELLED`. Results preserve independent sibling outcomes.

## 2. Persisted worktree lifecycle

`WorktreeIsolationService` allocates a deterministic path under Orca's local
data directory and a deterministic `orca/internal/...` branch from the current
repository `main` commit. It uses direct argv Git invocation. Windows uses host
Git; WSL uses `wsl.exe --cd` and Linux paths. The persistent repository checkout
is never used by two writers.

Allocation records packet/run/base SHA, branch/worktree path, environment,
owner, timestamps, and status. Recovery discovers persisted active worktrees
and marks missing/ambiguous ones stale. Release removes only clean worktrees
without `--force`; dirty or unmerged work remains on disk/branch with a
`CLEANUP_REQUIRED`/recoverable status so user/worker changes are preserved.

## 3. Integration protocol

`IntegrationService` validates packet dependencies and result correlation,
rejects cycles/missing dependencies, and orders independent completed results
deterministically. It detects changed-path overlap before integration and uses
safe Git cherry-pick operations against the repository's main checkout only
after proving it is clean. A conflict aborts the in-progress cherry-pick and
returns a structured `INTEGRATION_CONFLICT`; already integrated independent
siblings remain successful. No force-push or discard operation is available.

The final report contains integrated packet IDs, per-packet outcomes, commit
references, verification summary, blockers, and a partial-success status. A
green worker branch is never treated as a completed iteration; Sol receives the
structured report through the normal outer loop in a later strategy change.

## 4. APIs and persistence

Packet/result/worktree/integration rows are local orchestration truth and keep
Git references for durable provenance. REST APIs expose creation/read/result,
worktree lifecycle, and explicit integration calls for qualification and future
strategies. Existing campaign/Sol/executor routes remain unchanged.

## 5. Verification

Test schemas, path/branch determinism, dependency/partial-failure semantics,
restart and orphan recovery, dirty-work preservation, conflict abort, no
shared-checkout allocation, real local Git worktree add/commit/integration,
Windows, and conditional WSL. A skipped WSL environment is reported
UNQUALIFIED and never called machine-qualified.
