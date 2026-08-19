---
name: go
description: Recover Orca-Strator from durable repository state and continue the active OpenSpec roadmap work autonomously.
type: prompt
whenToUse: When the user types /go or asks to continue working on Orca-Strator.
disableModelInvocation: true
---

Continue development of Orca-Strator from its durable repository state. Do not rely on prior conversation context.

## Phase 1 — Recover reality before editing

1. Read `AGENTS.md` fully.
2. Read `docs/DEVELOPMENT.md` when this is a fresh session or when recovery/exit behavior is uncertain.
3. Inspect Git before modifying files:
   - current branch;
   - `git status`;
   - current HEAD;
   - remote `main` HEAD after fetch;
   - local commits not on remote;
   - whether merge/rebase/cherry-pick/revert state is already active.
4. Preserve all existing local work. Do not reset/discard/stash-and-forget a dirty tree merely to simplify startup.
5. Fetch `origin` and reconcile ordinary divergence safely. Never force-push by default.
6. Read `.agent/state.json` and ensure it remains compatible with `.agent/state.schema.json`.
7. Read `docs/ROADMAP.md`.
8. Read the active OpenSpec change referenced by `.agent/state.json` in artifact order:
   - `proposal.md`;
   - every delta `spec.md`;
   - `design.md`;
   - `tasks.md`.
9. Inspect implementation files and recent commits relevant to the first incomplete task.
10. When practical, run a cheap baseline check before broad edits so pre-existing failures are distinguishable from new regressions.

## Phase 2 — Select the next coherent slice

Determine the smallest coherent implementation slice that advances the active OpenSpec change.

- Prefer the first incomplete task whose prerequisites are satisfied.
- Do not redo completed work unless evidence shows it is incomplete or incorrect.
- If `$ARGUMENTS` narrows/prioritizes work, follow it when compatible with the durable contract.
- Do not silently expand scope into later roadmap milestones.
- Do not ask the user what to do next unless durable artifacts are genuinely contradictory or a material decision cannot be inferred safely.

Before coding, be able to state internally:

- which OpenSpec requirement/task this slice satisfies;
- which packages/files are expected to change;
- what verification will prove the slice useful.

## Phase 3 — Implement

1. Implement the selected slice with the simplest architecture consistent with `docs/ARCHITECTURE.md`.
2. Preserve controller/UI/process boundaries already locked by the architecture.
3. Keep the repository runnable/type-consistent whenever practical.
4. Add or update focused tests for behavior introduced by the slice.
5. If implementation reveals a material spec/design error, update the relevant OpenSpec artifact instead of silently deviating.
6. If additional required work is discovered inside the active change, add a clear task rather than hiding it in prose.

## Phase 4 — Verify

1. Run the narrowest relevant checks first.
2. Run broader typecheck/test/build checks at meaningful checkpoints.
3. Never report a check as passing unless it actually ran successfully.
4. Record persistent/pre-existing failures accurately instead of looping indefinitely merely to make all output green.
5. Fix regressions introduced by the current slice when feasible before checkpointing.

## Phase 5 — Durable checkpoint

After a coherent slice:

1. Update `tasks.md` checkboxes only for acceptance intent that is genuinely complete.
2. Update `.agent/state.json` with:
   - accurate development status;
   - concise checkpoint summary;
   - last completed task/verification when useful;
   - precise next action;
   - structured blockers if any.
3. Keep the waypoint concise; detailed reasoning stays in OpenSpec/Git/tests.
4. Inspect the final diff/status for accidental files or secrets.
5. Commit intended work with a descriptive message.
6. Fetch/rebase if remote `main` moved and resolve ordinary conflicts safely.
7. Push to `main`.

## Phase 6 — Continue or stop

Continue to the next coherent slice when the session remains productive and safe.

Stop cleanly when:

- the active OpenSpec change is complete;
- the session is genuinely blocked;
- the user asked to limit the session;
- continuing would require a material product/architecture decision not resolved by durable state.

Before stopping voluntarily, follow the exit protocol in `docs/DEVELOPMENT.md`. Do not leave knowingly useful completed work only in the local checkout.

If blocked, preserve safe work, capture concise evidence, update the waypoint, commit/push where possible, and stop rather than thrashing.

## Change completion

When all Change requirements/tasks are satisfied:

1. run the defined completion verification;
2. ensure the final delta spec matches implemented behavior;
3. fold/archive the completed delta into canonical `openspec/specs/` as appropriate;
4. update `docs/ROADMAP.md` status;
5. advance `.agent/state.json` to the next OpenSpec change or review waypoint;
6. commit and push the completed checkpoint.

Keep V1 simple. Do not implement deferred multi-session-per-repository, dynamic model routing, public control-plane exposure, or other future features unless a current requirement truly depends on a small compatibility seam.

$ARGUMENTS
