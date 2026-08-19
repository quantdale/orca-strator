# Orca-Strator Agent Contract

This file is the durable operating contract for any coding agent working on Orca-Strator.

## Mission

Build Orca-Strator into a Windows-first autonomous development orchestrator that can run multiple independent repository sessions concurrently while keeping each repository single-executor in V1.

## Canonical recovery order

At the start of every fresh session, and whenever the user says `/go` or asks to continue:

1. Inspect the working tree and remote `main` without discarding existing work.
2. Read `.agent/state.json`.
3. Read `docs/ROADMAP.md`.
4. Read the active OpenSpec change named by `.agent/state.json` in this order:
   - `proposal.md`
   - delta `spec.md` files
   - `design.md`
   - `tasks.md`
5. Read `docs/ARCHITECTURE.md` only when architectural context is needed.
6. Continue the next incomplete task. Do not ask the user what to do next when the durable state already answers it.

## `/go` behavior

`/go` means: recover the repository from durable state and continue implementation autonomously.

On `/go`:

- preserve and reconcile existing local changes;
- fetch/rebase `main` when needed;
- continue the active OpenSpec change;
- prefer the smallest next coherent implementation slice;
- run the relevant verification for the work performed;
- update `tasks.md` as tasks are completed;
- update `.agent/state.json` with the new durable waypoint before ending the session;
- commit and push intended work to `main`;
- do not leave knowingly useful completed work only in the local checkout.

If blocked, record the blocker and evidence in `.agent/state.json`, commit/push any safe useful work, and stop cleanly.

## Durable waypoint rule

Every development session must leave enough repository state for a completely fresh agent to resume without prior conversation context.

`.agent/state.json` is the concise machine-readable waypoint. OpenSpec artifacts and the roadmap contain the detailed intent and plan. Do not turn `state.json` into a transcript.

## OpenSpec workflow

OpenSpec is the planning contract for significant changes.

- Current behavior belongs under `openspec/specs/` after a completed change is archived.
- Proposed behavior belongs under `openspec/changes/<change>/`.
- Significant implementation work should have a proposal, delta specs, design, and task list before broad coding.
- Keep each change focused enough to review and complete independently.
- When implementation teaches us that a spec/design is wrong, update the artifact instead of silently deviating from it.

## Git policy

- `main` is the working integration branch for this project.
- Commit and push completed intended work directly to `main` unless the user explicitly changes this policy later.
- Do not automatically force-push.
- Dirty worktrees are not grounds to discard or refuse work. Inspect and reconcile them.
- If remote `main` moved, fetch/rebase and resolve ordinary conflicts rather than abandoning useful work.

## Scope discipline

- V1 is Windows-only as an application, but repository executors may run in native Windows/PowerShell or WSL.
- One repository equals one Orca session, one configured Sol conversation, and at most one active executor in V1.
- Different repositories may execute concurrently with no global executor cap.
- Executor/model selection is user-owned configuration; Sol must not dynamically switch it.
- Avoid solving future multi-branch/multi-executor-per-repository support in V1 unless the current design needs a small compatibility seam.

## Quality expectations

- Keep the implementation simple and explicit.
- Prefer deterministic state machines and structured state over prompt-dependent behavior.
- Treat GitHub as durable cross-agent truth and local SQLite as local runtime/orchestration state.
- Keep browser automation input-only: Playwright wakes the configured Sol conversation but does not scrape Sol output as a protocol.
- Tests may legitimately fail; report evidence truthfully rather than looping forever merely to make everything green.
