# Orca-Strator Agent Contract

This file is the durable operating contract for every coding agent working on Orca-Strator. It is intentionally repository-local so a fresh session can continue correctly without prior chat history.

Read `docs/DEVELOPMENT.md` for the detailed development procedure. This file contains the non-negotiable rules and recovery order.

## Mission

Build Orca-Strator into a Windows-first autonomous development orchestrator that can run multiple independent repository sessions concurrently while keeping each repository single-executor in V1.

The product should remain simple: one local controller, one responsive UI, one configured Sol conversation and one active executor per repository, with repository-level concurrency across many repositories.

## Normative reference map

Do not read every document on every tiny task. Use this map to load the contract relevant to the work being performed.

### Always read on fresh `/go`

- `AGENTS.md` — invariant agent rules;
- `.agent/state.json` — current waypoint;
- `docs/ROADMAP.md` — current milestone/exit gate;
- active OpenSpec proposal/spec/design/tasks.

### Development/recovery procedure

- `docs/DEVELOPMENT.md` — Git recovery, coherent slices, verification, waypoint updates, review handoff, session exit.

### Locked product/runtime decisions

- `docs/DECISIONS.md` — concise ledger of locked V1 choices; do not casually reopen them;
- `docs/ARCHITECTURE.md` — system-level architecture;
- `docs/RUNTIME-MODEL.md` — state machine, concurrency, Pause/Stop/drain/recovery semantics;
- `docs/CROSS-AGENT-PROTOCOL.md` — `.orca` dispatch/result/control Git protocol.

### Implementation contracts

- `docs/TECH-BASELINE.md` — selected supported technology lines;
- `docs/IMPLEMENTATION-BLUEPRINT.md` — target modules/package dependency boundaries;
- `docs/DATA-MODEL.md` — SQLite/config persistence contract;
- `docs/API-CONTRACT.md` — controller REST/WebSocket contract;
- `docs/UI-UX-SPEC.md` — desktop/phone UI behavior and controls;
- `docs/SECURITY.md` — security/trust boundaries;
- `docs/OBSERVABILITY-AND-FAILURES.md` — error taxonomy/logging/retry semantics;
- `docs/TEST-STRATEGY.md` — verification layers and milestone qualification.

The active OpenSpec remains the scope authority. These focused docs provide stable cross-milestone contracts and should not be used as an excuse to implement future milestones early.

## Canonical recovery order

At the start of every fresh session, and whenever the user says `/go` or asks to continue:

1. Read this file fully.
2. Inspect Git before editing:
   - current branch;
   - working-tree status;
   - local commits not yet on remote;
   - current remote `main` HEAD;
   - whether a rebase/merge/cherry-pick is already in progress.
3. Preserve and reconcile existing work. Dirty state is context, not trash.
4. Fetch remote `main`; rebase/reconcile ordinary divergence when safe.
5. Read `.agent/state.json` and ensure its shape remains compatible with `.agent/state.schema.json`.
6. Read `docs/ROADMAP.md`.
7. Read the active OpenSpec change named by `.agent/state.json` in this order:
   - `proposal.md`;
   - every delta `spec.md`;
   - `design.md`;
   - `tasks.md`.
8. Read only the focused normative docs required by the next task using the reference map above.
9. Inspect the implementation files needed for the next unchecked task.
10. Continue the smallest coherent unfinished slice. Do not ask the user what to do next when durable state already answers it.

If repository state contradicts itself, resolve the contradiction from the strongest durable evidence available (latest explicit user decision, committed architecture/spec, Git history). Ask the user only when a material product decision truly cannot be inferred safely.

## `/go` behavior

`/go` means: recover the repository from durable state and continue implementation autonomously.

On `/go`:

- preserve and reconcile existing local changes;
- fetch/rebase `main` when needed;
- continue the active OpenSpec change;
- start at the first genuinely incomplete task or coherent prerequisite;
- avoid redoing work that Git/tests already prove complete;
- run relevant verification for the work performed;
- distinguish pre-existing failures from failures introduced by the session when practical;
- update `tasks.md` only when acceptance intent is actually satisfied;
- update `.agent/state.json` at meaningful checkpoints and before session exit;
- commit and push intended work to `main`;
- do not leave knowingly useful completed work only in the local checkout;
- stop cleanly when the active change is complete or genuinely blocked.

`/go <arguments>` may narrow/prioritize the active work but does not silently replace the durable roadmap/spec unless the user's instruction explicitly changes scope.

## Durable waypoint rule

Every development session must leave enough repository state for a completely fresh agent to resume without prior conversation context.

`.agent/state.json` is the concise machine-readable waypoint. It is governed by `.agent/state.schema.json`.

It should contain only:

- current development status;
- overall goal;
- active milestone/change;
- concise checkpoint summary;
- last meaningful task/verification when useful;
- next action;
- actionable blockers;
- fixed development policies.

OpenSpec artifacts, architecture docs, tests, and Git history contain detailed intent/evidence. Do not turn the waypoint into a transcript or chain-of-thought dump.

## Session exit protocol

Before voluntarily ending a coding session:

1. finish the smallest safe operation currently in progress;
2. inspect the full working tree;
3. run relevant verification for the completed slice;
4. update OpenSpec task checkboxes accurately;
5. update `.agent/state.json` with a current checkpoint and next action;
6. commit intended work with a descriptive commit message;
7. fetch/rebase if remote `main` moved;
8. resolve ordinary conflicts where safe;
9. push to `main`;
10. leave unavoidable local-only/recovery state explicitly documented.

Do not disappear leaving an ambiguous half-written tree if a safe checkpoint can be created.

## OpenSpec workflow

OpenSpec is the planning contract for significant changes.

- Canonical/current behavior belongs under `openspec/specs/` after a completed change is folded/archived.
- Proposed behavior belongs under `openspec/changes/<change>/`.
- Significant implementation work should have a proposal, delta specs, design, and task list before broad coding.
- Keep each change focused enough to review and complete independently.
- When implementation proves a spec/design assumption wrong, update the artifact instead of silently deviating.
- Add newly discovered required tasks to the active change when they are truly in scope.
- Do not pull future roadmap work into the current change merely because it is interesting.
- A task checkbox is evidence of completed intent, not merely that code was attempted.

## Git policy

- `main` is the working integration branch for Orca-Strator development.
- Commit and push completed intended work directly to `main` unless the user explicitly changes this policy later.
- Never automatically force-push.
- Dirty worktrees are not grounds to discard or refuse work. Inspect and reconcile them.
- Do not use `git reset --hard` as a convenience cleanup strategy.
- If remote `main` moved, fetch/rebase and resolve ordinary conflicts rather than abandoning useful work.
- Do not overwrite user/local changes without understanding them.
- Keep secrets, tokens, browser profile data, SQLite runtime databases, and machine-local credentials out of Git.

## Scope discipline

- The main application is Windows-only in V1.
- Repository executors may run in native Windows/PowerShell or WSL.
- One repository equals one Orca autonomous session, one configured Sol conversation, and at most one active executor in V1.
- Different repositories may execute concurrently with no global executor cap.
- Executor/model selection is user-owned configuration. Sol must not dynamically switch it.
- Future multiple sessions/executors/branches inside one repository are out of V1 scope.
- Preserve small compatibility seams only when they cost little; do not build the future concurrency system early.

## Runtime architecture invariants

These decisions are locked unless the user explicitly changes them:

- Electron is the Windows desktop shell, not the orchestration owner.
- A separate Node.js/TypeScript controller owns runtime state and remains useful if the desktop window closes.
- React/Vite provides one responsive UI for Electron and phone browser access.
- SQLite is local runtime/orchestration persistence.
- GitHub/Git repository state is durable cross-agent truth.
- Sol -> executor V1 transport uses a local remote-Git watcher plus an isolated final dispatch marker commit.
- Executor -> Sol V1 transport uses Playwright to submit a trusted wake message to the repository's exact Sol conversation.
- Playwright output scraping is not the coordination protocol.
- Chromium is launched on demand; one browser may host one page per concurrently active repository.
- Phone access uses a private path such as Tailscale Serve; do not expose the controller publicly by default.

## Quality expectations

- Keep implementation simple and explicit.
- Prefer deterministic state machines and structured state over prompt-dependent behavior.
- Prefer TypeScript contracts that can be validated at runtime at external boundaries.
- Keep controller/business logic testable without Electron or a real browser.
- Keep Windows/WSL process launching behind explicit adapters when implementation reaches that milestone.
- Do not claim verification that was not actually run.
- Tests may legitimately fail; report evidence truthfully rather than looping forever merely to make everything green.
- Fix obvious regressions introduced by the current slice before checkpointing when feasible.
- Avoid unnecessary frameworks, ORMs, distributed components, plugin systems, and abstraction layers in V1.

## Blocked behavior

If genuinely blocked:

1. preserve safe useful work;
2. capture concise evidence (command/test/error, not giant logs unless needed);
3. record a structured blocker in `.agent/state.json`;
4. set a specific `nextAction`;
5. commit/push safe work when possible;
6. stop cleanly rather than thrashing indefinitely.

## Review handoff

The user may periodically ask an external Sol/ChatGPT review of the GitHub repository.

Before a major review checkpoint, make sure committed state makes these discoverable:

- active OpenSpec change;
- completed/incomplete tasks;
- relevant verification results;
- known failures/blockers;
- current waypoint and next action.

After the reviewer commits updated OpenSpec/architecture/state artifacts, pull/rebase them and treat those durable artifacts as the new contract.
