---
name: go
description: Recover Orca-Strator from durable repository state and continuously advance the roadmap autonomously.
type: prompt
whenToUse: When the user types /go or asks to continue working on Orca-Strator.
disableModelInvocation: true
---

Continue development of Orca-Strator from durable repository state. Do not rely on prior conversation context.

## 1. Recover reality

1. Read `AGENTS.md` fully.
2. Read `.agent/state.json`, `docs/ROADMAP.md`, and the active OpenSpec proposal/spec/design/tasks.
3. Inspect Git: branch, status, current/local/remote `main`, local-only commits, and in-progress merge/rebase/cherry-pick/revert state.
4. Preserve all existing local work. Never hard-reset/clean/stash-and-forget merely to simplify startup.
5. Fetch/reconcile ordinary remote-main divergence safely; never force-push by default.
6. Load only focused normative docs required by the first incomplete requirement.
7. Inspect relevant implementation/recent commits.
8. **Skip broad baseline testing at startup.** Do not burn the beginning of the run proving the old baseline. Start implementation; use targeted checks when useful and broader verification at meaningful checkpoints.

## 2. Implement continuously

Select the next coherent incomplete requirement and implement it with the simplest architecture consistent with durable contracts.

- Do not redo completed work unless evidence shows it is wrong.
- Fix review findings/regressions that are part of the active change.
- Add/update focused tests for changed behavior.
- If implementation disproves a spec/design assumption, update the OpenSpec artifact rather than silently deviating.
- Check tasks only when acceptance intent is genuinely satisfied.
- Commit/push coherent checkpoints to `main` during long work.

## 3. Route around blockers

A blocker on one task is not normally a blocker for the entire run.

When a task/test/tool/environment path is blocked:

1. preserve useful work;
2. record concise evidence if material;
3. continue the next independent safe task in the active change or roadmap;
4. revisit the blocker later when new context may help.

Do **not** stop merely because:

- a test remains failing;
- an optional tool is unavailable;
- one subtask is blocked;
- a particular implementation approach failed;
- a review checkpoint was reached;
- the current OpenSpec finished.

Only treat the overall run as blocked when no safe useful roadmap work remains without external credentials/infrastructure, explicit user input, a destructive approval, or a truly unresolved product decision.

## 4. Verification

- Run narrow checks around changed code while implementing.
- Run broader typecheck/test/build/lint at meaningful checkpoints and before folding major changes when useful.
- Never claim checks that did not run.
- Fix introduced regressions where practical, but do not loop indefinitely solely to make all baseline output green before progressing elsewhere.
- Record persistent failures truthfully and continue independent work.

## 5. Durable checkpoints

After coherent progress:

1. update task checkboxes accurately;
2. update `.agent/state.json` with concise status/checkpoint/next action/blockers;
3. inspect diff/status for accidental files/secrets;
4. commit with a descriptive message;
5. fetch/rebase ordinary remote movement safely;
6. push to `main`.

Do this periodically during a long goal-mode run, not only at process exit.

## 6. Change completion means advance, not stop

When the active OpenSpec is complete:

1. run meaningful completion verification;
2. reconcile implementation against the final delta spec;
3. fold/archive the completed change into canonical `openspec/specs/` where appropriate;
4. update roadmap/waypoint;
5. determine the next planned roadmap change;
6. create its proposal/spec/design/tasks when they do not already exist;
7. commit/push the transition;
8. **continue implementing the next change immediately**.

External review checkpoints are advisory/non-blocking unless the user explicitly instructed you to stop for review.

## 7. Goal mode

If this session is running under Kimi `/goal`, treat the goal as completing the Orca-Strator V1 roadmap from durable state, not merely completing the current change.

The goal should remain active while safe useful roadmap work exists. Do not voluntarily declare completion after 001a or any intermediate milestone.

If a session is not already in goal mode, `/go` still follows the same continuous-roadmap semantics for as long as the session remains active.

Keep V1 simple. Do not implement explicitly deferred multi-session-per-repository, dynamic model routing by Sol, public control-plane exposure, or unrelated future architecture unless a current roadmap requirement needs a small compatibility seam.

$ARGUMENTS
