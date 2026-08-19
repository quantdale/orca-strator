# Orca-Strator OpenSpec Conventions

Orca-Strator uses OpenSpec-style change artifacts as the durable contract for significant implementation work.

This document defines the repository-local convention so fresh coding agents and external reviewers follow the same lifecycle.

## Directory model

```text
openspec/
├── README.md
├── specs/
│   └── <capability>/
│       └── spec.md
└── changes/
    └── <NNN-change-name>/
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        └── specs/
            └── <capability>/
                └── spec.md
```

## Canonical versus proposed behavior

### `openspec/specs/`

Contains canonical behavior already accepted/implemented by completed changes.

A fresh agent should treat these specs as current product truth unless an active change explicitly modifies them.

### `openspec/changes/<change>/`

Contains proposed/delta behavior for one focused change.

The active change is identified by `.agent/state.json`.

## Artifact responsibilities

### `proposal.md`

Explains:

- why the change exists;
- goals;
- non-goals;
- product assumptions;
- user-visible outcome;
- major risks;
- top-level success/review criteria.

It should answer **why and what**, not become an implementation transcript.

### Delta `spec.md`

Defines externally meaningful/system-contract behavior using requirements and scenarios.

Use normative language intentionally:

- `SHALL` / `MUST` for required behavior;
- scenarios for concrete acceptance cases;
- avoid implementation detail unless it is itself a required architectural constraint.

A delta spec should be testable/reviewable.

### `design.md`

Defines how the change should be implemented:

- package/component boundaries;
- data ownership;
- APIs/contracts;
- storage/process architecture;
- dependency choices/tradeoffs;
- security/error/recovery considerations;
- testing strategy;
- recommended implementation order.

If implementation proves a design decision wrong, update the design rather than silently diverging.

### `tasks.md`

Executable development checklist.

Tasks should:

- follow dependency order;
- be specific enough for a fresh agent to continue;
- include verification/checkpoint tasks;
- avoid checking work merely because it was attempted;
- include a durable completion/review handoff.

## Change numbering

Use ordered three-digit IDs:

```text
001-bootstrap-control-plane
002-repository-watch-dispatch
003-headless-executor-runtime
...
```

Do not renumber historical changes after implementation starts.

## Change states

The repository does not require a separate state file inside every change in V1. State is derived from:

- `.agent/state.json` active change/status;
- `tasks.md` completion;
- Git history;
- roadmap milestone status.

Typical lifecycle:

```text
PLANNED
  -> READY_TO_IMPLEMENT
  -> IMPLEMENTING
  -> READY_FOR_REVIEW
  -> COMPLETE/FOLDED
```

## Starting a change

Before broad coding:

1. create proposal;
2. create delta spec(s);
3. create design;
4. create tasks;
5. update `.agent/state.json` to point to the change;
6. update roadmap if required;
7. commit/push planning artifacts.

Small obvious fixes do not need an unnecessary OpenSpec change unless they materially alter product behavior/architecture.

## During implementation

Coding agents should:

1. read artifacts in proposal -> delta spec -> design -> tasks order;
2. implement the next coherent unchecked slice;
3. update specs/design if reality invalidates an assumption;
4. update task checkboxes accurately;
5. preserve verification evidence in tests/Git/waypoint;
6. checkpoint and push frequently enough for durable recovery.

Do not use `tasks.md` as a scratchpad transcript.

## Completing a change

Before marking complete:

1. all required tasks are satisfied or explicitly resolved;
2. required verification is run;
3. implementation is reviewed against the final delta spec;
4. foundational regressions introduced by the change are resolved or explicitly blocked;
5. final useful work is committed/pushed;
6. canonical specs are updated/folded from the accepted delta;
7. roadmap milestone/change status advances;
8. `.agent/state.json` points to the next review/change/action.

## Folding delta specs

When a change introduces a new capability with no existing canonical spec:

- create/update `openspec/specs/<capability>/spec.md` with the final accepted behavior.

When a change modifies an existing capability:

- merge the accepted added/modified/removed requirement semantics into the canonical capability spec.

The canonical spec should describe **current behavior**, not the history of how it changed.

Historical reasoning remains discoverable from Git and the completed change artifacts.

## Completed change artifacts

Do not delete completed change directories merely to make the tree smaller. They are useful review/history artifacts unless a later explicit archival convention is adopted.

After folding, the change directory may remain as the immutable historical implementation proposal/design/task record, while `openspec/specs/` represents current truth.

## Review-first milestone boundary

Some roadmap milestones explicitly require a deep Sol/ChatGPT GitHub review before the next change is created/applied.

At those boundaries:

1. finish/checkpoint the active change;
2. set `.agent/state.json` to a review-ready waypoint;
3. stop coding later milestones;
4. reviewer inspects actual GitHub implementation;
5. reviewer fixes planning/architecture or authors the next OpenSpec;
6. next `/go` session resumes from committed durable state.

Change 001 intentionally ends this way before Change 002.

## Scope discipline

OpenSpec detail exists to make execution reliable, not to encourage overengineering.

Every change should remain the smallest focused change that safely advances the roadmap.
