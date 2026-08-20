# Orca-Strator Documentation Index

This index explains which files are authoritative for which questions. The goal is detailed durable context without requiring every agent to load every document on every task.

## Fast recovery

For a fresh `/go` session, read first:

1. `AGENTS.md`
2. inspect Git/local/remote `main`
3. `.agent/state.json`
4. `docs/ROADMAP.md`
5. active OpenSpec proposal/spec/design/tasks

Then load focused documents only as the current task requires.

## Authority map

| Question | Primary authority |
|---|---|
| What do I do next? | `.agent/state.json` + active `tasks.md` |
| What is in/out of current change? | active OpenSpec proposal/spec/design |
| How should a coding session recover/checkpoint/exit? | `AGENTS.md` + `docs/DEVELOPMENT.md` |
| What product decisions are locked? | `docs/DECISIONS.md` |
| What is overall system architecture/network topology? | `docs/ARCHITECTURE.md` |
| What exact runtime states/transitions mean? | `docs/RUNTIME-MODEL.md` |
| How does Sol/executor Git handoff work semantically? | `docs/CROSS-AGENT-PROTOCOL.md` |
| What structurally validates dispatch/result/control JSON? | `schemas/protocol/*.schema.json` |
| Which technology lines should implementation use? | `docs/TECH-BASELINE.md` |
| Where should modules/packages live and how do they connect? | `docs/IMPLEMENTATION-BLUEPRINT.md` |
| What is SQLite/static repository config model? | `docs/DATA-MODEL.md` |
| What are REST/WebSocket/same-origin client contracts? | `docs/API-CONTRACT.md` |
| What should desktop/phone UI do? | `docs/UI-UX-SPEC.md` |
| What are security/trust boundaries? | `docs/SECURITY.md` |
| How should failures/logs/retries be represented? | `docs/OBSERVABILITY-AND-FAILURES.md` |
| What must be tested/qualified? | `docs/TEST-STRATEGY.md` |
| What is staged implementation order? | `docs/ROADMAP.md` |
| How the historical OpenFlow exploration maps to current main? | `docs/OPENFLOW-EVOLUTION-DELTA.md` |

## Current high-value invariants

Fresh agents should not reopen these unless user explicitly changes them or implementation proves them infeasible:

- Windows-only application; repository executors may run Windows or WSL.
- One V1 session/Sol/executor at a time per repository; different repositories may run concurrently.
- V1 Git integration is `main` only; no repository branch config field.
- Static repository configuration does not contain active run state or run goal.
- Controller owns runtime/persistence; Electron is a client shell.
- Built UI + REST + WebSocket share one Orca origin; UI uses relative `/api` paths.
- Future phone access reverse-proxies that single loopback origin through Tailscale Serve; phone client does not call laptop localhost directly.
- Sol -> executor is isolated Git dispatch marker + local watcher.
- Executor -> Sol is Playwright trusted wake; Git transition is completion signal.
- One persistent browser profile has exclusive browser-process ownership at a time, while one active browser process may host many repository pages.
- Dirty local work is preserved/reconciled; no automatic hard reset/force push.

## Conflict precedence

When documents appear inconsistent, use this order:

1. latest explicit user decision committed into repository;
2. active OpenSpec delta requirement for current scoped behavior;
3. `docs/DECISIONS.md` locked V1 decision;
4. `docs/ARCHITECTURE.md` / `docs/RUNTIME-MODEL.md` / focused normative contract;
5. machine-readable schema for structural validity within its declared version;
6. active OpenSpec design;
7. implementation blueprint/preferences;
8. older comments/examples.

A machine-readable schema cannot override higher-level semantic/product requirements; it validates structure only.

Do not silently choose a lower-authority implementation preference over a higher-authority product requirement.

## Scope rule

Detailed future contracts do not authorize implementing future milestones early.

Examples:

- `docs/CROSS-AGENT-PROTOCOL.md` + `schemas/protocol/` define eventual durable mailbox format;
- Change 001 still must **not** implement watcher/dispatch runtime;
- `docs/UI-UX-SPEC.md` describes future phone/runtime controls, but Change 001 only implements configuration/control-plane foundations and the same-origin networking seam.

The active OpenSpec controls present implementation scope.

## Repository hygiene authority

Root `.gitattributes`, `.editorconfig`, and `.gitignore` are intentional cross-platform/security baselines. Scaffold generators should be reconciled around them rather than silently replacing them.

Notably, `.orca/` is not globally ignored because managed repositories intentionally commit coordination artifacts.

## Documentation maintenance rule

Update docs when:

- user changes a locked decision;
- implementation evidence disproves material assumption;
- protocol/API/data/network shape changes;
- milestone exits and canonical behavior needs folding/archiving.

Do not update every architecture document for trivial refactors that preserve behavior.
