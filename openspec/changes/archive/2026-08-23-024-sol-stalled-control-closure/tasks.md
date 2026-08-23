# Tasks: SOL_STALLED Git-truthful control closure (Change 024)

## 1. Control-target resolution

- [x] 1.1 Add a control-only target resolver in `LoopService`: normal active run first; otherwise latest exact-matching `SOL_STALLED` run when no active campaign exists. *(Implemented as `RunStore.getLatestStalledRun` + active-first fallback in `onControlDetected`; resolver used only by Sol-control handling.)*
- [x] 1.2 Keep `RunStore.getActiveRun()` unchanged so `SOL_STALLED` remains outside ordinary actor ownership. *(Query untouched; pinned by regression test asserting it never returns a stalled run.)*
- [x] 1.3 Ensure a newer active campaign always wins and causes a late older stalled-run control to fail normal run correlation. *(Proven by "newer active run prevents old-stalled-run closure" and "non-latest stalled reference rejected" tests.)*

## 2. Decision and correlation safety

- [x] 2.1 Permit `GOAL_COMPLETE`, `BLOCKED`, and `NEEDS_HUMAN` terminal reconciliation from `SOL_STALLED`. *(All three proven closing the run with the control consumed.)*
- [x] 2.2 Explicitly reject `PAUSED` for a stalled target; do not invoke executor pause/resume paths. *(Rejected with `SOL_STALLED_PAUSE_UNSUPPORTED`; test spies that executor pause is never invoked.)*
- [x] 2.3 Reuse strict repository / run / iteration / optional related-dispatch validation and existing consumed/rejected idempotency. *(Validation refactored to take the resolved target; all prior checks intact on both paths.)*
- [x] 2.4 Applying a stalled terminal control must not submit a new Sol wake, start an executor/strategy, or acquire scheduler ownership. *(Tests assert no browser page activity, no fake-executor spawn, direct SOL_STALLED -> terminal transition.)*

## 3. Regression coverage

- [x] 3.1 Add focused coverage proving a matching `GOAL_COMPLETE` control closes the latest `SOL_STALLED` run and is consumed.
- [x] 3.2 Cover at least one additional allowed terminal decision (`BLOCKED` or `NEEDS_HUMAN`). *(Both covered.)*
- [x] 3.3 Cover `PAUSED` rejection while the run remains `SOL_STALLED`.
- [x] 3.4 Cover a newer active campaign protecting the older stalled run from late control mutation.
- [x] 3.5 Cover wrong iteration and/or wrong `relatedDispatchId` on a stalled target. *(Both, separately.)*
- [x] 3.6 Keep the existing active-run valid/stale/wrong-run/wrong-dispatch/duplicate control tests green. *(`loop-drain-correlation.test.ts` untouched and passing in the same run; full fast tier 59 files green.)*

Additional coverage delivered beyond the minimum: duplicate-delivery idempotency after stalled closure, non-latest stalled reference rejection, durable `loop.control_applied` audit event, `releaseTerminalTimers` hygiene.

## 4. Durable documentation and cleanup

- [x] 4.1 Update `docs/RUNTIME-MODEL.md` / relevant canonical control semantics so `SOL_STALLED` is terminal/problem state but remains eligible for strictly correlated terminal Git reconciliation only.
- [x] 4.2 Update `docs/REAL-DOGFOOD-QUALIFICATION.md` to mark the Phase-10 closure finding as addressed after implementation evidence exists.
- [x] 4.3 Reconcile stale README/ROADMAP qualification wording that still says real ChatGPT/Kimi/Codex paths are unqualified despite the completed real campaign. *(Tailscale phone route and authorized OpenCode server remain honestly UNQUALIFIED — not faked.)*
- [x] 4.4 Reconcile/archive historical completed Change 022 bookkeeping (including stale unchecked task 4.2) without rewriting qualification history. *(Task 4.2 corrected from Git evidence: checkpoint commit `deac592` on pushed main; archived as `2026-08-23-022-executor-headless-invocation-fixes`.)*
- [x] 4.5 Decide whether Change 009 should be archived/folded now that its remaining genuinely external Tailscale condition is separately documented; do not falsely mark Tailscale qualified. *(Archived as `2026-08-23-009-v1-runtime-integration-hardening`; P.3/Q.9 left honestly open with pointers to `.agent/state.json` blockers — 70/72 tasks checked by design.)*

## 5. Verification and checkpoint

- [x] 5.1 Run the narrow SOL-control regression suite first. *(New suite + `loop-drain-correlation.test.ts` green before broad gates.)*
- [x] 5.2 Run `npm test`, `npm run typecheck`, `npm run build`, `npm run lint`, `npx openspec validate --all --strict`, and `git diff --check` at the meaningful checkpoint. *(Fast tier 59 files green; typecheck/build/lint exit 0; real tier exit 0 with 14 files passed / 1 known EXPECTED_EXTERNAL_UNQUALIFIED skip; strict OpenSpec validation green post-archives; `git diff --check` clean.)*
- [x] 5.3 Fix any regression introduced by this change; never mark a gate green from historical evidence. *(One test-harness FK-ordering fix during development; no production regressions observed.)*
- [x] 5.4 Fold/archive Change 024 only after executed evidence satisfies the exit gate. *(Folded into canonical `openspec/specs/autonomous-loop-engine/spec.md` — 4 added requirements; archived as `2026-08-23-024-sol-stalled-control-closure`.)*
- [x] 5.5 Update `.agent/state.json`, commit the coherent implementation checkpoint, reconcile remote `main`, and push. *(Waypoint advanced to MILESTONE_22_COMPLETE; remote plan commit `21dafc3` reconciled via rebase.)*

## Planning evidence

- [x] P.1 Real dogfood evidence identifies the exact defect: run `a19f488f` was `SOL_STALLED`, while the later valid `GOAL_COMPLETE` control was durably detected but rejected because no active run existed.
- [x] P.2 Code audit confirms `RunStore.getActiveRun()` excludes `SOL_STALLED` by design and `LoopService.onControlDetected()` currently validates only against that active-run result.
- [x] P.3 Design preserves the exclusion and scopes the exception exclusively to strictly correlated terminal Sol-control handling.

Execution status: **IMPLEMENTED AND VERIFIED (2026-08-23).** The parallel planning checkpoint (`21dafc3`) authored proposal/design/delta; this completed record adopts those artifacts verbatim into the archive, supersedes the parallel delta spec (its scenarios are folded verbatim-equivalent into canonical `openspec/specs/autonomous-loop-engine/spec.md`), and records the executed verification above.
