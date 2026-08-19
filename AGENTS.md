# Orca-Strator Agent Contract

This file is the durable operating contract for every coding agent working on Orca-Strator. It is repository-local so a fresh session can continue correctly without prior chat history.

Read `docs/DEVELOPMENT.md` for the detailed procedure. This file contains the non-negotiable recovery, implementation, continuity, and Git rules.

## Mission

Build Orca-Strator into a Windows-first autonomous development orchestrator that can run multiple independent repository sessions concurrently while keeping each repository single-executor in V1.

Development of Orca-Strator itself is intended to be **continuous and leave-and-forget**. When running under Kimi Code goal mode, completion of one corrective change or milestone is not a reason to stop. Fold/archive completed OpenSpec work, create or activate the next roadmap change, and continue implementation until the V1 roadmap goal is complete or no safe useful work remains without a true external dependency.

## Normative reference map

### Always read on a fresh continuation

- `AGENTS.md` — invariant agent rules;
- `.agent/state.json` — current waypoint;
- `docs/ROADMAP.md` — milestone order and exit gates;
- the active OpenSpec proposal/spec/design/tasks.

### Focused references

- `docs/DEVELOPMENT.md` — recovery, continuous goal-mode development, checkpointing, Git, blocker routing, exit behavior;
- `docs/DECISIONS.md` — locked V1 decisions;
- `docs/ARCHITECTURE.md` — system architecture;
- `docs/RUNTIME-MODEL.md` — runtime state machine and control semantics;
- `docs/CROSS-AGENT-PROTOCOL.md` — `.orca` Git handoff protocol;
- `docs/TECH-BASELINE.md` — supported technology baseline;
- `docs/IMPLEMENTATION-BLUEPRINT.md` — module/package boundaries;
- `docs/DATA-MODEL.md` — SQLite/config persistence;
- `docs/API-CONTRACT.md` — REST/WebSocket contract;
- `docs/UI-UX-SPEC.md` — desktop/phone UI behavior;
- `docs/SECURITY.md` — trust/security boundaries;
- `docs/OBSERVABILITY-AND-FAILURES.md` — errors/logging/retries;
- `docs/TEST-STRATEGY.md` — verification strategy;
- `docs/GOAL-MODE.md` — canonical Kimi goal-mode objective and continuation semantics.

The active OpenSpec is scope authority for the current change, but completing it should normally advance to the next roadmap work rather than end the coding session.

## Canonical recovery order

At the start of every fresh session, `/go`, `/goal`, or continuation request:

1. Read this file.
2. Inspect Git before editing: current branch, working tree, local-only commits, remote `main`, and any merge/rebase/cherry-pick/revert state.
3. Preserve and reconcile existing work. Dirty state is context, not trash.
4. Fetch remote `main`; rebase/reconcile ordinary divergence safely.
5. Read `.agent/state.json` and validate its shape against `.agent/state.schema.json`.
6. Read `docs/ROADMAP.md`.
7. Read the active OpenSpec in artifact order: proposal, all delta specs, design, tasks.
8. Load only focused normative docs needed for the next work.
9. Inspect implementation and recent commits relevant to the next incomplete requirement.
10. Start implementation directly. **Do not spend the beginning of the session running a broad baseline test suite merely to establish a baseline.** Run targeted checks when they become useful and broader verification at meaningful checkpoints.

Do not ask the user what to do next when durable state already answers it.

## Continuous `/go` and goal-mode behavior

`/go` means recover durable state and continue implementation. When the user starts Kimi `/goal` mode, the goal is the **roadmap outcome**, not merely the current change.

During continuous work:

- continue the active OpenSpec from the first genuinely incomplete requirement;
- do not redo completed work unless evidence shows it is wrong;
- skip broad startup baseline testing;
- use focused tests/checks while implementing and broader gates at meaningful checkpoints;
- fix regressions and review findings as part of the current work;
- checkpoint, commit, and push coherent progress to `main`;
- when the current OpenSpec is complete, fold/archive it as appropriate, update roadmap/state, create or activate the next focused OpenSpec, and **continue working**;
- review checkpoints are durable quality markers, not automatic stop instructions unless the user explicitly requests a review stop;
- do not mark the overall goal blocked merely because one test, tool, subtask, environment path, or implementation approach is blocked;
- record local blockers and continue independent safe work elsewhere in the current change or roadmap;
- only declare the overall development goal blocked when no safe useful roadmap work can continue without external human input, credentials, unavailable infrastructure, or a genuinely unresolved product decision.

## Durable waypoint rule

Every meaningful development session must leave enough committed state for a completely fresh agent to resume.

`.agent/state.json` stays concise. It should contain current status, overall goal, active milestone/change, checkpoint summary, next action, blockers, and fixed policies. Detailed reasoning belongs in OpenSpec, docs, tests, and Git history.

During a long goal-mode run, update the waypoint at meaningful checkpoints and whenever the active change/milestone changes. Do not wait until process exit.

## OpenSpec workflow

Significant implementation work uses focused OpenSpec changes.

- Proposed behavior lives under `openspec/changes/<change>/`.
- Canonical accepted behavior belongs under `openspec/specs/` after fold/archive.
- A meaningful change should have proposal, delta specs, design, and tasks before broad implementation.
- Check tasks only when acceptance intent is genuinely satisfied.
- If implementation disproves a spec/design assumption, update the artifact instead of silently deviating.
- Add newly discovered in-scope tasks explicitly.
- Keep each change reviewable, but **do not stop solely because a change becomes complete**.
- On completion: verify meaningfully, fold/archive, update roadmap/state, create/activate the next roadmap OpenSpec, commit/push, and continue.

## Git policy

- `main` is the working integration branch.
- Commit/push intended work directly to `main` unless the user explicitly changes policy.
- Never automatically force-push.
- Dirty worktrees are not grounds to discard/refuse work.
- Do not use `git reset --hard` or destructive cleanups as convenience recovery.
- Reconcile ordinary remote-main divergence and preserve useful local/user work.
- Keep secrets, tokens, browser profile data, SQLite runtime databases, and machine-local credentials out of Git.

## Scope discipline

- Windows-only main application in V1; executors may run Windows/PowerShell or WSL.
- One repository = one Orca autonomous session, one configured Sol conversation, max one active executor in V1.
- Different repositories may execute concurrently with no global executor cap.
- Executor/model selection is user-owned; Sol does not dynamically switch it.
- Multiple sessions/executors/branches inside one repository remain deferred.
- Preserve simple future seams only when cheap; do not over-engineer.

## Runtime architecture invariants

- Electron is the Windows shell, not orchestration owner.
- Standalone Node/TypeScript controller owns runtime state.
- React/Vite provides one responsive desktop/phone UI.
- SQLite is local runtime/orchestration persistence.
- Git/GitHub is durable cross-agent truth.
- Sol -> executor uses local remote-Git watcher + isolated final dispatch commit.
- Executor -> Sol uses Playwright trusted wake submission to the exact configured conversation.
- Browser output scraping is not the coordination protocol.
- Chromium is on-demand and may host one page per concurrently active repository.
- Phone access remains private via Tailscale Serve rather than public exposure.

## Verification policy

Verification is evidence, not a ritual and not a reason to halt productive implementation.

- **Skip broad baseline testing at session startup.**
- Run the narrowest useful checks while changing code.
- Run broader typecheck/test/build/lint at meaningful checkpoints, before folding a major change, or when changes make them useful.
- Never claim a check passed unless it actually ran successfully.
- When a check fails, determine whether it blocks the current work. Fix it when practical; otherwise record it and continue independent implementation.
- Do not loop forever solely to force every test green before making progress elsewhere.
- Do not knowingly hide regressions introduced by the current work.

## Blocker routing

A blocker is normally **local to a task**, not global to the development goal.

When one task is blocked:

1. preserve safe useful work;
2. record concise evidence in the active task/waypoint when material;
3. identify the next independent task/change that can proceed safely;
4. continue implementation;
5. revisit the blocker when later work provides new information.

Only stop/mark the goal blocked when all meaningful safe work is exhausted or continuing requires unavailable credentials, inaccessible infrastructure, explicit user input, a destructive action that requires approval, or an unresolved product decision that cannot be inferred from durable state.

## Review checkpoints

External Sol/ChatGPT reviews remain useful and the repository should always be reviewable, but review checkpoints are **non-blocking by default during continuous goal mode**.

If the user explicitly asks for a review stop, checkpoint and wait. Otherwise, after completing and verifying a change, continue into the next roadmap change while keeping commits, OpenSpec artifacts, waypoint state, and verification evidence reviewable at any time.

## Voluntary session exit

If the process/user actually ends the session, finish the smallest safe operation, inspect status, update tasks/waypoint, commit/push intended work, and leave any unavoidable local-only recovery state clearly documented.

Do not voluntarily end merely because a change, milestone repair, or ordinary blocker was reached when safe roadmap work remains.
