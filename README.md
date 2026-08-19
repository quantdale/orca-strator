# Orca-Strator

Orca-Strator is a Windows-first autonomous development orchestrator for running multiple repository-level AI coding sessions in parallel while using a browser ChatGPT Sol conversation as the high-intelligence architect/reviewer and a user-selected headless coding agent as the executor.

## Core V1 model

For every configured repository:

```text
1 repository
    = 1 Orca autonomous session
    = 1 dedicated ChatGPT Sol conversation
    = 1 configured executor CLI/model
    = max 1 active executor for that repository
```

Different repositories are independent and may run simultaneously with no global executor cap.

A repository can execute through:

- native Windows/PowerShell; or
- a configured WSL distribution and Linux working directory.

The user chooses the executor and model for the run. Sol does not dynamically change that executor/model in V1.

## Intended autonomous loop

```text
high-level goal
      |
      v
Browser ChatGPT Sol
architect/reviewer
      |
planning/spec/code commits
      |
final isolated dispatch commit
      |
      v
local Orca remote-Git watcher
      |
      v
configured headless executor
(Windows or WSL)
      |
implement/test/reconcile Git
      |
commit + result manifest + push
      |
      v
Playwright wakes exact Sol conversation
      |
      v
Sol reviews GitHub
      |
      +----> next OpenSpec + dispatch
      |
      +----> GOAL_COMPLETE / BLOCKED / NEEDS_HUMAN
```

Git/GitHub is the durable cross-agent handoff layer. Local SQLite stores machine-local orchestration/runtime state.

## Application architecture

V1 stack baseline:

- **Runtime/tooling:** Node.js 24 LTS + npm workspaces + TypeScript
- **controller HTTP:** Fastify 5
- **local database:** Node `node:sqlite` behind a small storage boundary
- **Windows desktop shell:** Electron stable 43 line baseline
- **shared UI:** React 19.2 + Vite 8.1
- **styling/components:** Tailwind CSS 4.3 + selective shadcn/ui
- **tests:** Vitest 4.1+ plus focused React/controller/storage tests
- **background controller:** standalone Node.js/TypeScript process
- **controller boundary:** localhost HTTP + WebSocket events
- **Sol browser automation later:** Playwright
- **repository/executor integration later:** Git + PowerShell/`wsl.exe` + configured coding-agent CLIs
- **private phone access later:** same responsive UI through Tailscale Serve

Electron is not the orchestration owner. The controller remains the runtime source of truth so active work does not conceptually depend on a desktop window staying open.

## Current development status

**Milestone 1 — Bootstrap control plane** is ready for implementation.

The active OpenSpec is:

```text
openspec/changes/001-bootstrap-control-plane/
```

It builds only the application/control-plane foundation: workspace, controller, SQLite, repository configuration/API/events, responsive UI, and Electron shell.

It intentionally does **not** yet implement repository watching, executor launching, Playwright, or the autonomous loop.

## Durable development workflow

Orca-Strator is itself designed to be developed through disposable coding-agent sessions.

The repository must always contain enough state for a fresh agent to recover without prior conversation history.

### Normal session

1. Open/clone/pull the repository.
2. Start the coding agent.
3. Run:

```text
/go
```

4. The agent recovers Git + durable state, reads the active OpenSpec, and continues the next coherent unfinished slice.
5. It verifies its work, updates task checkboxes and `.agent/state.json`, commits, rebases/reconciles remote changes when needed, and pushes to `main`.
6. Exit whenever appropriate.
7. A completely fresh later session can run `/go` again and continue.

If the current agent does not support the repository-local `/go` skill, use a short fallback instruction such as:

```text
Continue this repository according to AGENTS.md and its durable state.
```

### What `/go` recovers

The canonical recovery order is:

```text
AGENTS.md
   -> Git working/local/remote state
   -> .agent/state.json
   -> docs/ROADMAP.md
   -> active OpenSpec proposal
   -> delta specs
   -> design
   -> tasks
   -> focused normative docs required by the task
   -> relevant implementation
```

Dirty local work is preserved/reconciled, not automatically discarded.

### Review workflow

After a significant amount of implementation:

1. ensure the coding agent checkpoints/commits/pushes current work;
2. ask Sol/ChatGPT to deeply review the actual GitHub repository;
3. have the reviewer update architecture/OpenSpec/state artifacts when corrections or the next change are required;
4. start a fresh coding-agent session;
5. `/go` pulls/reconciles those durable changes and continues.

This keeps mega-prompts out of the executor workflow. The repository is the detailed work contract.

## Documentation map

Start with [`docs/INDEX.md`](docs/INDEX.md) for the authority map.

### Development continuity

- [`AGENTS.md`](AGENTS.md) — non-negotiable coding-agent contract and recovery rules
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — detailed `/go`, checkpoint, OpenSpec, Git, blocked, and session-exit procedure
- [`.agent/state.json`](.agent/state.json) — current concise machine-readable development waypoint
- [`.agent/state.schema.json`](.agent/state.schema.json) — waypoint schema
- [`.agents/skills/go/SKILL.md`](.agents/skills/go/SKILL.md) — repository-local `/go` recovery skill

### Product/runtime architecture

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked V1 decision ledger
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — locked V1 product architecture
- [`docs/RUNTIME-MODEL.md`](docs/RUNTIME-MODEL.md) — runtime states, actor/concurrency, Pause/Stop/drain/recovery semantics
- [`docs/CROSS-AGENT-PROTOCOL.md`](docs/CROSS-AGENT-PROTOCOL.md) — exact Sol/executor Git mailbox protocol
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — staged milestones with explicit exit/review gates

### Implementation contracts

- [`docs/TECH-BASELINE.md`](docs/TECH-BASELINE.md) — selected supported technology lines
- [`docs/IMPLEMENTATION-BLUEPRINT.md`](docs/IMPLEMENTATION-BLUEPRINT.md) — target workspace/modules/dependency boundaries
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — SQLite repository/config persistence contract
- [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) — controller REST/WebSocket/error/event contract
- [`docs/UI-UX-SPEC.md`](docs/UI-UX-SPEC.md) — desktop and phone UI behavior/control semantics
- [`docs/SECURITY.md`](docs/SECURITY.md) — trust/security boundaries
- [`docs/OBSERVABILITY-AND-FAILURES.md`](docs/OBSERVABILITY-AND-FAILURES.md) — failure taxonomy, logs, retry semantics
- [`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md) — layered verification and milestone qualification

### Active implementation plan

- [`openspec/changes/001-bootstrap-control-plane/`](openspec/changes/001-bootstrap-control-plane/) — current implementation-grade proposal/spec/design/tasks

## Development principles

1. Keep V1 simple despite detailed specs.
2. One repository is the concurrency unit.
3. Different repositories may run concurrently; work within one repository is serialized in V1.
4. GitHub is durable inter-agent truth; SQLite is local runtime truth.
5. State transitions and dispatches must be explicit/idempotent.
6. The user owns executor/model selection.
7. Sol is primarily architect/reviewer but may make code fixes when useful.
8. Playwright is a narrow input/wake transport, not the source of truth.
9. Never silently discard dirty repository work.
10. Never force-push automatically by default.
11. Every meaningful development session leaves a durable waypoint.
12. Significant work goes through focused OpenSpec changes and review gates rather than giant prompts.
13. Detailed documentation reduces ambiguity; it does not authorize premature framework complexity or future-milestone implementation.
