# Orca-Strator Cross-Agent Git Protocol

Status: **V1 protocol baseline for later milestones**

This document defines the Git/GitHub coordination artifacts used by Sol, Orca, and the configured executor. It is intentionally defined before implementation so watcher, executor, and Playwright milestones share one protocol.

Change 001 does not implement this protocol yet.

## 1. Protocol goals

The protocol must be:

- durable in Git;
- readable by Sol and executors without Orca-local SQLite;
- deterministic for the local watcher;
- idempotent;
- auditable after the run;
- small enough that it does not become a second database inside Git;
- safe against premature dispatch while Sol is still writing specs.

## 2. Coordination directory in managed repositories

Managed target repositories use:

```text
.orca/
├── dispatch/
├── results/
└── control/
```

Meaning:

- `dispatch/` — immutable work handoff markers authored by Sol;
- `results/` — immutable executor turn result manifests;
- `control/` — durable Sol terminal/control decisions when no next dispatch is created.

Do not use one constantly rewritten shared state file as the primary protocol.

## 3. Identifier model

Each autonomous run has a `runId`.

Each Sol -> executor handoff has a `dispatchId` unique within the repository.

Each executor result references exactly one dispatch ID.

Suggested IDs:

```text
runId:      2026-08-19T110000Z-7f3a2c
iteration:  7
dispatchId: 2026-08-19T123456Z-i007-a1b2c3
```

The exact generation algorithm may use UUIDs. Human-readable iteration is separate from uniqueness.

Never use only `iteration` as an immutable identity because recovery/retries may need a distinct attempt/handoff identifier.

## 4. Dispatch file

Path:

```text
.orca/dispatch/<dispatchId>.json
```

Baseline shape:

```json
{
  "schemaVersion": 1,
  "type": "dispatch",
  "runId": "run-id",
  "dispatchId": "dispatch-id",
  "iteration": 7,
  "createdAt": "2026-08-19T12:34:56.000Z",
  "branch": "main",
  "baseSha": "abcdef123456...",
  "changePath": "openspec/changes/047-fix-widget-state",
  "goal": "Implement the active OpenSpec change and publish a truthful result.",
  "instructionsVersion": 1
}
```

Required semantics:

- `schemaVersion` recognized;
- `type = dispatch`;
- run/dispatch IDs non-empty;
- iteration positive;
- branch matches configured branch unless explicit recovery mode allows otherwise;
- `changePath` is repository-relative and identifies the work contract;
- `baseSha` records the ordinary repository state Sol intended to dispatch from.

The dispatch should not contain a mega-prompt. Detailed instructions live in repository artifacts.

## 5. Transactional dispatch commit

Sol MUST perform ordinary work first:

```text
proposal/design/spec/tasks/code fixes
 -> commit/push
```

Then create the dispatch marker in a separate final commit.

Valid final dispatch commit:

```text
M/A .orca/dispatch/<new-id>.json
```

and no source/spec/ordinary files.

The exact allowlist may permit a small protocol metadata companion if later needed, but V1 should prefer exactly one new dispatch file.

Watcher rejection reasons include:

- mixed ordinary files;
- marker modified after creation rather than new immutable ID;
- malformed JSON;
- unsupported schema version;
- branch/run mismatch;
- already consumed dispatch;
- executor already active for that repository;
- run paused/stopped/draining/terminal.

## 6. Why `baseSha` exists

`baseSha` makes Sol's intended planning base explicit.

The watcher/executor may observe newer `main` because of concurrent human/Sol activity or reconciliation. The executor must inspect/reconcile rather than blindly reset to `baseSha`.

`baseSha` is evidence/context, not an instruction to discard newer work.

## 7. Executor bootstrap contract

Orca gives the executor a stable small instruction conceptually equivalent to:

```text
Recover this repository safely.
Read AGENTS.md/project instructions if present.
Read the dispatch identified by ORCA_DISPATCH_PATH.
Read the referenced OpenSpec/change artifacts.
Preserve and reconcile existing work and remote main.
Implement the dispatch as far as safely possible.
Run relevant verification.
Commit and push intended work.
Write the required result manifest last and push it.
Exit with truthful status; do not loop forever solely to force green tests.
```

Orca supplies validated identifiers/paths through arguments/environment/config—not by interpolating arbitrary executor-generated prose.

## 8. Executor result file

Path:

```text
.orca/results/<dispatchId>.json
```

Baseline shape:

```json
{
  "schemaVersion": 1,
  "type": "executor-result",
  "runId": "run-id",
  "dispatchId": "dispatch-id",
  "iteration": 7,
  "status": "COMPLETED",
  "startedAt": "2026-08-19T12:40:00.000Z",
  "finishedAt": "2026-08-19T13:10:00.000Z",
  "baseSha": "abcdef...",
  "resultSha": "123456...",
  "executor": {
    "cli": "kimi",
    "model": "deepseek-v4-flash",
    "environment": "wsl"
  },
  "verification": [
    {
      "name": "npm test",
      "status": "PASS",
      "summary": "All relevant tests passed."
    },
    {
      "name": "npm run typecheck",
      "status": "FAIL",
      "summary": "2 pre-existing failures remain in legacy package."
    }
  ],
  "blockers": [],
  "summary": "Implemented the active change and pushed the result."
}
```

Allowed executor result statuses:

```text
COMPLETED
BLOCKED
NEEDS_HUMAN
FAILED
```

These describe the executor turn only. They are not authoritative high-level run terminal decisions.

## 9. Verification item semantics

Each verification item should distinguish:

```text
PASS
FAIL
NOT_RUN
```

Optional metadata later:

- command;
- exit code;
- whether failure appears pre-existing;
- log artifact reference.

Keep the Git manifest concise; raw multi-megabyte logs do not belong in the JSON file.

## 10. Result publication order

The executor should:

1. perform implementation/reconciliation;
2. run verification;
3. commit/push implementation work as necessary;
4. determine final current remote-compatible result SHA;
5. create result manifest;
6. commit/push result manifest;
7. exit.

The result manifest is the durable signal that the executor turn has concluded enough for Sol review.

If result-manifest push itself fails, Orca must not falsely wake Sol as though a complete result exists.

## 11. Result commit isolation

V1 should prefer a final result-manifest commit containing only:

```text
.orca/results/<dispatchId>.json
```

This gives the watcher/controller an unambiguous executor-finished boundary.

Implementation commits may precede it.

## 12. Sol wake trigger

Orca observes a valid new result manifest for the active dispatch.

If run controls permit continuation:

```text
valid result
 -> SOL_PENDING
 -> Playwright wake
```

Exception examples:

- user paused executor and intentionally interrupted it -> do not manufacture a normal result/wake;
- run entered draining before handoff -> record result but do not wake Sol;
- graceful Stop -> record current actor completion, suppress next actor.

## 13. Trusted Sol wake message

The wake is generated by Orca, not by copying executor prose.

Conceptual message:

```text
Orca-Strator executor turn completed for <repository>.
Run: <runId>
Iteration: <iteration>
Dispatch: <dispatchId>
Result status: <validated status>

Review the latest GitHub repository state, the active OpenSpec change, and .orca/results/<dispatchId>.json.
Make any review/spec/code corrections that are useful.
Then either:
1. create and push the next focused OpenSpec work and finally an isolated new dispatch marker, or
2. publish a durable terminal/control decision.
Follow the repository's agent/Orca protocol.
```

Only validated identifiers/status values are interpolated.

## 14. Sol terminal/control decision

When Sol does not create another dispatch, it writes an immutable control marker.

Suggested path:

```text
.orca/control/<controlId>.json
```

Baseline shape:

```json
{
  "schemaVersion": 1,
  "type": "sol-control",
  "runId": "run-id",
  "controlId": "control-id",
  "iteration": 7,
  "createdAt": "2026-08-19T13:20:00.000Z",
  "decision": "GOAL_COMPLETE",
  "relatedDispatchId": "dispatch-id",
  "summary": "The high-level goal is satisfied and verified."
}
```

Allowed baseline Sol decisions:

```text
GOAL_COMPLETE
BLOCKED
NEEDS_HUMAN
PAUSED
```

Runtime/user `STOPPED`, `DRAINING`, `SOL_STALLED`, `EXECUTOR_UNAVAILABLE`, and `RECOVERY_REQUIRED` are primarily Orca-local operational states, not necessarily Sol-authored control decisions.

## 15. Control commit

Sol control marker should also be final/isolated when practical so completion detection is unambiguous.

A control marker must never coexist with a new dispatch for the same run/iteration in a way that creates two contradictory next actions.

If contradictory durable actions appear, Orca enters invariant/error handling rather than arbitrarily choosing one.

## 16. Immutability

Dispatch/result/control files are append-only by ID.

Do not rewrite historical files to change the story.

Correction pattern:

```text
bad/obsolete durable record remains
 -> create new unique corrected record
 -> reference/describe supersession if needed
```

Git history itself also preserves provenance, but append-only file semantics simplify watcher/idempotency logic.

## 17. Local SQLite linkage

Orca records locally:

- run ID;
- active dispatch ID;
- dispatch commit SHA;
- whether consumed;
- executor process/attempt info;
- result commit SHA;
- Sol wake attempts;
- last terminal/control marker seen.

Git protocol is cross-agent truth. SQLite is runtime bookkeeping.

## 18. Pause semantics with protocol

If user pauses during executor execution:

- terminate/interupt executor;
- preserve checkout;
- do not require a normal executor result manifest;
- do not wake Sol;
- local SQLite marks paused/interrupted work.

Resume continues the same active dispatch with explicit recovery instructions.

Do not create a fake `FAILED` manifest merely because the user pressed Pause.

## 19. Stop/drain semantics with protocol

If executor finishes while run is draining/stopping:

- allow/preserve its result manifest;
- do not trigger Sol.

If Sol finishes while draining/stopping:

- record the resulting dispatch/control artifact;
- do not start the next executor;
- a pending dispatch remains durable for an explicit later Resume if semantically valid.

## 20. Protocol security and robustness

- validate JSON before acting;
- reject unknown major/schema versions;
- repository-relative paths must not escape repository root;
- never execute a shell command directly from arbitrary protocol JSON;
- executor CLI/model are user configuration, not Sol-controlled dispatch fields;
- watcher treats Git content as input requiring validation;
- duplicate IDs are idempotent, not repeated work triggers.

## 21. Future versioning

Each artifact has `schemaVersion`.

V1 uses integer `1`.

If a breaking protocol change is needed later:

- add parser support explicitly;
- migrate/handle old historical artifacts safely;
- never reinterpret an old v1 file silently as a new incompatible shape.
