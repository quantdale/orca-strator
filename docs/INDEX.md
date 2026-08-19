# Orca-Strator Documentation Index

This index explains which documents are authoritative for which questions. The goal is detailed durable context without requiring every agent to read every file on every task.

## Fast recovery

For a fresh `/go` session, read first:

1. `AGENTS.md`
2. `.agent/state.json`
3. `docs/ROADMAP.md`
4. active OpenSpec proposal/spec/design/tasks

Then load focused documents only as the current task requires.

## Authority map

| Question | Primary authority |
|---|---|
| What do I do next? | `.agent/state.json` + active `tasks.md` |
| What is in/out of the active change? | active OpenSpec proposal/spec/design |
| How should a coding session recover/checkpoint/exit? | `AGENTS.md` + `docs/DEVELOPMENT.md` |
| What product decisions are already locked? | `docs/DECISIONS.md` |
| What is the overall system architecture? | `docs/ARCHITECTURE.md` |
| What exact runtime states/transitions mean? | `docs/RUNTIME-MODEL.md` |
| How does Sol/executor Git handoff work? | `docs/CROSS-AGENT-PROTOCOL.md` |
| Which technology lines should implementation use? | `docs/TECH-BASELINE.md` |
| Where should modules/packages live? | `docs/IMPLEMENTATION-BLUEPRINT.md` |
| What is the SQLite/config model? | `docs/DATA-MODEL.md` |
| What are controller endpoints/events/errors? | `docs/API-CONTRACT.md` |
| What should desktop/phone UI do? | `docs/UI-UX-SPEC.md` |
| What are the security boundaries? | `docs/SECURITY.md` |
| How should failures/logs/retries be represented? | `docs/OBSERVABILITY-AND-FAILURES.md` |
| What must be tested/qualified? | `docs/TEST-STRATEGY.md` |
| What is the staged implementation order? | `docs/ROADMAP.md` |

## Conflict precedence

When documents appear inconsistent, use this order:

1. latest explicit user decision committed into the repository;
2. active OpenSpec delta requirement for current scoped behavior;
3. `docs/DECISIONS.md` locked V1 decision;
4. `docs/ARCHITECTURE.md` / `docs/RUNTIME-MODEL.md` / focused normative contract;
5. active OpenSpec design;
6. implementation blueprint/preferences;
7. older comments/examples.

Do not silently choose a lower-authority implementation preference over a higher-authority product requirement.

## Scope rule

Detailed future contracts do not authorize implementing future milestones early.

Example:

- `docs/CROSS-AGENT-PROTOCOL.md` defines the eventual dispatch format;
- Change 001 still must **not** implement the watcher/dispatch runtime.

The active OpenSpec controls present implementation scope.

## Documentation maintenance rule

Update docs when:

- user changes a locked decision;
- implementation evidence disproves a material assumption;
- a protocol/API/data shape changes;
- a milestone exits and canonical behavior needs folding/archiving.

Do not update every architecture document for trivial code refactors that preserve behavior.
