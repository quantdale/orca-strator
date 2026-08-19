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
    = max 1 active Sol turn for that repository
```

Different repositories are independent and may run simultaneously with no global executor cap.

A repository executes through either:

- native Windows/PowerShell; or
- a configured WSL distribution and Linux working directory.

The user chooses executor and model. Sol does not dynamically change them in V1.

V1 Git orchestration is intentionally simple: **every managed repository uses `main`**. There is no per-repository branch configuration until future multi-session/branch work is explicitly designed.

## Intended autonomous loop

```text
high-level goal
      |
      v
Browser ChatGPT Sol
architect/reviewer
      |
planning/spec/code commits to main
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
implement/test/reconcile main
      |
commit + isolated result manifest + push
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

Git/GitHub is durable cross-agent truth. Local SQLite stores machine-local orchestration/runtime state.

## Application architecture

V1 stack baseline:

- **Runtime/tooling:** Node.js 24 LTS + npm workspaces + TypeScript
- **controller HTTP:** Fastify 5
- **local database:** Node `node:sqlite` behind a small storage boundary
- **Windows desktop shell:** Electron stable 43-line baseline
- **shared UI:** React 19.2 + Vite 8.1
- **styling/components:** Tailwind CSS 4.3 + selective shadcn/ui
- **tests:** Vitest 4.1+ plus focused React/controller/storage tests
- **background controller:** standalone Node.js/TypeScript process
- **controller web boundary:** loopback SPA + REST + WebSocket on one origin
- **Sol browser automation later:** Playwright
- **repository/executor integration later:** Git + PowerShell/`wsl.exe` + configured coding-agent CLIs
- **private phone access later:** Tailscale Serve reverse-proxying the same loopback Orca origin

Electron is not the orchestration owner. The controller remains runtime source of truth when desktop window closes.

### Same-origin web seam

Change 001 establishes this runtime shape:

```text
http://127.0.0.1:47100/
├── /                 shared built React UI
├── /api/*             controller REST
└── /api/events        controller WebSocket
```

The UI uses relative `/api` routes. In development, Vite proxies them to controller. Later, a phone loads a private Tailscale HTTPS URL that reverse-proxies this single loopback origin, so the same client keeps working without pointing phone-local `localhost` at the laptop or requiring a second mobile networking layer.

## Current development status

**Milestone 1 — Bootstrap control plane** is complete and folded (`openspec/specs/control-plane-foundation/`).

**Milestone 2 — Repository watcher and transactional dispatch** is complete and folded (`openspec/specs/repository-watch-dispatch/`).

**Milestone 3 — Headless executor runtime** is complete and folded (`openspec/specs/headless-executor-runtime/`).

**Milestone 4 — Playwright Sol bridge** is complete and folded (`openspec/specs/playwright-sol-bridge/`).

**Milestone 5 — Autonomous loop and multi-repository concurrency** is complete and folded (`openspec/specs/autonomous-loop-engine/`).

**Milestone 6 — Runtime ceilings, recovery, and hardening** is complete and folded (`openspec/specs/runtime-recovery-hardening/`).

**Milestone 7 — Private phone access and notifications** is complete and folded (`openspec/specs/remote-phone-experience/`).

**Milestone 8 — End-to-end autonomy qualification** is *implemented* and folded (`openspec/specs/end-to-end-autonomy-qualification/`). Its real end-to-end qualification is **in progress** under Change 009 (see below).

All nine V1 milestones are **implemented in code**. V1 is currently **NOT YET QUALIFIED** for real end-to-end autonomy: the earlier "complete/qualified/verified" status relied on simulation tests that manually invoked internal transition methods and used fake executors/mock browsers. A runtime-integration hardening campaign (`openspec/changes/009-v1-runtime-integration-hardening/`) is underway.

Honest status (this machine):

- **MACHINE-QUALIFIED** — real autonomous pipeline on Windows and via real `wsl.exe` (Change 009 `Q.WIN.1` / `Q.WIN.WSL.1`); honest Tailscale detection; secret-redacted event stream; startup rehydration.
- **SIMULATION-TESTED** — B/D/F/G/H/I/J/K/L/N implementations covered by mock/fake tests; not yet proven against real external dependencies here.
- **UNQUALIFIED** — real Kimi/Codex CLI execution, Chromium/ChatGPT wake, and Tailscale phone-route (external dependencies absent on this machine; explicitly not claimed as done).

The finish line is a real assembled-controller test proving the pipeline end-to-end, which is **achieved for the Windows and WSL executor paths**. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full qualification matrix.

## Durable development workflow

Orca-Strator is itself developed through disposable coding-agent sessions. The repository must always contain enough durable state for a fresh agent to recover without prior chat history.

### Normal session

1. Open/clone/pull repository.
2. Start coding agent.
3. Run:

```text
/go
```

4. Agent recovers Git + durable state, reads active OpenSpec, and continues next coherent unfinished slice.
5. It verifies work, updates task checkboxes and `.agent/state.json`, reconciles remote `main`, commits, and pushes.
6. Exit whenever appropriate.
7. A completely fresh later session can run `/go` again.

Fallback for agents without repository-local skill support:

```text
Continue this repository according to AGENTS.md and its durable state.
```

### Canonical recovery order

```text
AGENTS.md
   -> Git working/local/remote main state
   -> .agent/state.json
   -> docs/ROADMAP.md
   -> active OpenSpec proposal/spec/design/tasks
   -> focused normative docs required by task
   -> relevant implementation
```

Dirty local work is preserved/reconciled, not automatically discarded.

### Review workflow

After significant implementation:

1. coding agent checkpoints/commits/pushes;
2. Sol/ChatGPT deeply reviews actual GitHub repository;
3. reviewer updates architecture/OpenSpec/state where needed;
4. fresh coding-agent session starts;
5. `/go` pulls/reconciles durable changes and continues.

The repository—not a mega-prompt—is the detailed work contract.

## Documentation map

Start with [`docs/INDEX.md`](docs/INDEX.md).

### Development continuity

- [`AGENTS.md`](AGENTS.md) — non-negotiable agent/recovery contract
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — `/go`, checkpoint, OpenSpec, Git, blocked, exit procedure
- [`.agent/state.json`](.agent/state.json) — current waypoint
- [`.agent/state.schema.json`](.agent/state.schema.json) — waypoint schema
- [`.agents/skills/go/SKILL.md`](.agents/skills/go/SKILL.md) — repository-local `/go`

### Product/runtime architecture

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked V1 decisions
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system/network architecture
- [`docs/RUNTIME-MODEL.md`](docs/RUNTIME-MODEL.md) — runtime states/concurrency/controls
- [`docs/CROSS-AGENT-PROTOCOL.md`](docs/CROSS-AGENT-PROTOCOL.md) — Git mailbox semantics
- [`schemas/protocol/`](schemas/protocol/) — machine-readable dispatch/result/control schemas
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestone sequence/gates

### Implementation contracts

- [`docs/TECH-BASELINE.md`](docs/TECH-BASELINE.md)
- [`docs/IMPLEMENTATION-BLUEPRINT.md`](docs/IMPLEMENTATION-BLUEPRINT.md)
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)
- [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md)
- [`docs/UI-UX-SPEC.md`](docs/UI-UX-SPEC.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OBSERVABILITY-AND-FAILURES.md`](docs/OBSERVABILITY-AND-FAILURES.md)
- [`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md)

### Active implementation plan

- [`openspec/changes/001-bootstrap-control-plane/`](openspec/changes/001-bootstrap-control-plane/)

## Repository hygiene

The repo intentionally seeds:

- `.gitattributes` for stable Windows/WSL line endings;
- `.editorconfig` for basic editor consistency;
- `.gitignore` protecting local DB/browser/auth/log/secret/build artifacts;
- versioned protocol JSON Schemas.

`.orca/` is intentionally **not** globally ignored because managed repositories later commit Orca coordination artifacts.

## Development principles

1. Keep V1 simple despite detailed specs.
2. One repository is the concurrency unit.
3. Different repositories may run concurrently; one repo is serialized in V1.
4. GitHub is durable inter-agent truth; SQLite is local runtime truth.
5. V1 uses `main` only.
6. Static repository config is separate from active-run state.
7. State transitions/dispatches are explicit and idempotent.
8. User owns executor/model selection.
9. Sol is primarily architect/reviewer but may make code fixes.
10. Playwright is narrow wake transport, not source of truth.
11. Never silently discard dirty repository work or auto-force-push.
12. One persistent browser profile has one browser-process owner at a time, while that process may host multiple repository pages.
13. Desktop and phone share one same-origin UI/API contract.
14. Every meaningful development session leaves a durable waypoint.
15. Significant work uses focused OpenSpec changes/review gates, not giant prompts.
16. Detailed documentation reduces ambiguity; it does not authorize premature complexity.
