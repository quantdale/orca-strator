# Orca-Strator Development Protocol

This document defines how Orca-Strator itself is developed across short or long AI coding sessions. It is intentionally durable: a completely fresh coding-agent session should be able to recover the current roadmap position without relying on prior chat history.

## 1. Core development model

Development proceeds as a sequence of focused OpenSpec changes.

```text
high-level product roadmap
        |
        v
active OpenSpec change
        |
        v
small coherent implementation slice
        |
        v
verify -> checkpoint -> commit -> push
        |
        +----> next slice
        |
        +----> change complete -> archive/fold spec -> next OpenSpec
```

The repository itself is the source of development continuity.

The minimum durable recovery set is:

1. `AGENTS.md` — invariant operating rules for coding agents;
2. `.agent/state.json` — concise current waypoint;
3. `docs/ROADMAP.md` — ordered milestone plan;
4. the active `openspec/changes/<id>/` artifacts;
5. Git history and the current working tree.

No single chat/session is authoritative.

## 2. `/go` contract

`/go` means: **recover this repository from durable state and continue the active roadmap work autonomously.**

A `/go` session MUST NOT begin by asking the user what to work on when the repository already answers that question.

### Startup sequence

Perform these steps in order:

1. Read `AGENTS.md`.
2. Inspect Git before modifying files:
   - current branch;
   - `git status`;
   - local commits not on remote;
   - remote `main`/configured integration branch;
   - current HEAD.
3. Preserve existing work. Never assume a dirty tree is disposable.
4. Fetch remote state.
5. Reconcile ordinary divergence when safe. Do not force-push by default.
6. Read `.agent/state.json`.
7. Read `docs/ROADMAP.md`.
8. Read the active OpenSpec artifacts in this order:
   - `proposal.md`;
   - all delta `spec.md` files;
   - `design.md`;
   - `tasks.md`.
9. Inspect implementation files relevant to the next unchecked task.
10. Run a cheap baseline check when useful to distinguish pre-existing failures from failures introduced by the session.
11. Continue from the smallest coherent unfinished slice.

### Arguments

`/go <instruction>` does not replace durable state. Arguments narrow or prioritize the current work unless they explicitly change scope.

Examples:

```text
/go
/go focus on the controller API tasks first
/go continue but do not touch the desktop package today
```

If an argument conflicts with the active OpenSpec or locked architecture, the agent should update the durable artifact only when the user's instruction clearly changes the decision; otherwise preserve the existing contract.

## 3. Working-tree recovery

Dirty work is expected and may come from:

- a previously interrupted agent session;
- a manually paused coding session;
- the user making local edits;
- an interrupted rebase/build/refactor;
- generated-but-not-yet-committed files.

The default policy is **recover, inspect, preserve, reconcile**.

Do not automatically:

- `git reset --hard`;
- delete untracked files merely to make status clean;
- overwrite local work with remote copies;
- stash and forget existing work;
- force-push rewritten history.

The coding agent should determine what the local changes represent, integrate useful work into the current implementation, resolve ordinary conflicts, and leave intended work committed/pushed when practical.

If safe reconciliation is impossible, record the exact blocker and evidence in `.agent/state.json` and stop.

## 4. Implementation slice rule

A session should prefer a **coherent slice**, not an arbitrary token/time-sized slice.

A coherent slice should usually:

- advance one or a small cluster of related task checkboxes;
- leave interfaces internally consistent;
- avoid knowingly leaving trivial syntax/type/build breakage that can be fixed immediately;
- include relevant tests when the slice introduces testable behavior;
- remain small enough that a fresh agent can understand what changed from Git/OpenSpec state.

Do not try to complete an entire milestone in one giant unreviewable change when several safe checkpoints are available.

## 5. Verification policy

Verification is evidence, not ceremony.

For each slice:

1. run the narrowest tests/checks that directly exercise the change;
2. run broader workspace checks at meaningful checkpoints;
3. distinguish pre-existing failures from newly introduced failures when possible;
4. never claim a command passed if it was not run or its result is unknown;
5. record persistent failures/blockers in durable state.

A failing test does not automatically mean the session must loop forever. If the implementation has reached the best safe state and the remaining failure requires architectural review or a stronger model, checkpoint and report it truthfully.

## 6. OpenSpec lifecycle

### Before implementation

Significant work should have:

```text
openspec/changes/<change-id>/
├── proposal.md
├── design.md
├── tasks.md
└── specs/
    └── <capability>/
        └── spec.md
```

The proposal explains why and scope.

The delta spec defines externally meaningful requirements and scenarios.

The design records implementation boundaries and tradeoffs.

The task list is the executable development checklist.

### During implementation

- Check tasks only when their acceptance intent is satisfied.
- If implementation reveals that a design/spec assumption is wrong, update the artifact before or alongside the implementation.
- Do not silently implement behavior that materially contradicts the active spec.
- Add newly discovered required work to `tasks.md` when it belongs to the active change.
- Keep deferred/future ideas out of the current change unless they are required for correctness.

### Completion

A change is complete only when:

1. all required tasks are complete or explicitly resolved;
2. relevant verification has been run;
3. the implementation matches the final delta spec;
4. the repository is at a useful committed/pushed checkpoint;
5. the delta spec has been folded/archived into canonical `openspec/specs/` behavior as appropriate;
6. `.agent/state.json` advances to the next change/milestone or a terminal development state.

## 7. Durable waypoint contract

`.agent/state.json` is intentionally short. It is a pointer and checkpoint, not a log.

It should answer:

- What are we building overall?
- Which milestone is active?
- Which OpenSpec change is active?
- What was most recently completed?
- What should the next fresh session do?
- Are there blockers or known verification failures?
- What branch/policies must be preserved?

Detailed reasoning belongs in OpenSpec/design docs or Git commits, not in the state file.

### Waypoint update timing

Update `.agent/state.json`:

- after a meaningful coherent implementation checkpoint;
- before intentionally ending a development session;
- when a blocker changes the next action;
- when an OpenSpec change completes;
- when the active milestone/change changes.

Do not rewrite the waypoint after every tiny file edit.

## 8. Commit and push policy

`main` is the integration branch unless the user changes this later.

At each meaningful checkpoint:

1. inspect `git diff`/status;
2. ensure intended generated files are included and secrets are not;
3. update task checkboxes and waypoint when appropriate;
4. run relevant verification;
5. commit with a descriptive message;
6. fetch/rebase if remote moved;
7. resolve ordinary conflicts;
8. push to `main`.

Prefer several coherent commits over one enormous session dump, but avoid micro-committing every trivial edit.

## 9. Review checkpoints

The user may periodically ask ChatGPT/Sol to review the GitHub repository after significant implementation.

When preparing for such a review, leave the repository so an external reviewer can determine:

- what OpenSpec change is active;
- which tasks are complete;
- which verification passed/failed;
- what changed since the previous waypoint;
- what remains;
- whether there are unresolved blockers.

The reviewer may update architecture/OpenSpec/state before the next `/go` session.

A coding agent should treat those committed artifact changes as the new durable contract after pulling `main`.

## 10. Session exit protocol

Before voluntarily ending a session:

1. finish the current smallest safe operation;
2. inspect the working tree;
3. run relevant verification for the completed slice;
4. update `tasks.md` accurately;
5. update `.agent/state.json` with a fresh checkpoint and next action;
6. commit intended work;
7. fetch/rebase remote changes if necessary;
8. push to `main`;
9. leave any unavoidable local-only state explicitly documented as a blocker/recovery item.

A session should not disappear leaving a fresh agent unable to tell whether half-written local changes are intentional.

## 11. Blocked protocol

When genuinely blocked, do not thrash indefinitely.

Record in `.agent/state.json`:

- concise blocker code/category;
- human-readable summary;
- relevant command/test/error evidence;
- what was attempted when useful;
- safest next action.

Commit/push safe useful work before stopping whenever possible.

## 12. Simplicity rule

Detailed documentation does not justify complicated implementation.

For V1:

- prefer explicit code over framework-heavy abstraction;
- introduce an interface only when two real implementations/boundaries need it or a future seam is already unavoidable;
- avoid premature plugin systems;
- avoid distributed infrastructure when one local controller suffices;
- keep repository-level concurrency independent but serialize work within one repository;
- build the current OpenSpec change, not the future product all at once.
