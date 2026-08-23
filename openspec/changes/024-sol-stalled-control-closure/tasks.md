# Tasks: SOL_STALLED Git-truthful control closure (Change 024)

## 1. Control-target resolution

- [ ] 1.1 Add a control-only target resolver in `LoopService`: normal active run first; otherwise latest exact-matching `SOL_STALLED` run when no active campaign exists.
- [ ] 1.2 Keep `RunStore.getActiveRun()` unchanged so `SOL_STALLED` remains outside ordinary actor ownership.
- [ ] 1.3 Ensure a newer active campaign always wins and causes a late older stalled-run control to fail normal run correlation.

## 2. Decision and correlation safety

- [ ] 2.1 Permit `GOAL_COMPLETE`, `BLOCKED`, and `NEEDS_HUMAN` terminal reconciliation from `SOL_STALLED`.
- [ ] 2.2 Explicitly reject `PAUSED` for a stalled target; do not invoke executor pause/resume paths.
- [ ] 2.3 Reuse strict repository / run / iteration / optional related-dispatch validation and existing consumed/rejected idempotency.
- [ ] 2.4 Applying a stalled terminal control must not submit a new Sol wake, start an executor/strategy, or acquire scheduler ownership.

## 3. Regression coverage

- [ ] 3.1 Add focused coverage proving a matching `GOAL_COMPLETE` control closes the latest `SOL_STALLED` run and is consumed.
- [ ] 3.2 Cover at least one additional allowed terminal decision (`BLOCKED` or `NEEDS_HUMAN`).
- [ ] 3.3 Cover `PAUSED` rejection while the run remains `SOL_STALLED`.
- [ ] 3.4 Cover a newer active campaign protecting the older stalled run from late control mutation.
- [ ] 3.5 Cover wrong iteration and/or wrong `relatedDispatchId` on a stalled target.
- [ ] 3.6 Keep the existing active-run valid/stale/wrong-run/wrong-dispatch/duplicate control tests green.

## 4. Durable documentation and cleanup

- [ ] 4.1 Update `docs/RUNTIME-MODEL.md` / relevant canonical control semantics so `SOL_STALLED` is terminal/problem state but remains eligible for strictly correlated terminal Git reconciliation only.
- [ ] 4.2 Update `docs/REAL-DOGFOOD-QUALIFICATION.md` to mark the Phase-10 closure finding as addressed after implementation evidence exists.
- [ ] 4.3 Reconcile stale README/ROADMAP qualification wording that still says real ChatGPT/Kimi/Codex paths are unqualified despite the completed real campaign.
- [ ] 4.4 Reconcile/archive historical completed Change 022 bookkeeping (including stale unchecked task 4.2) without rewriting qualification history.
- [ ] 4.5 Decide whether Change 009 should be archived/folded now that its remaining genuinely external Tailscale condition is separately documented; do not falsely mark Tailscale qualified.

## 5. Verification and checkpoint

- [ ] 5.1 Run the narrow SOL-control regression suite first.
- [ ] 5.2 Run `npm test`, `npm run typecheck`, `npm run build`, `npm run lint`, `npx openspec validate --all --strict`, and `git diff --check` at the meaningful checkpoint.
- [ ] 5.3 Fix any regression introduced by this change; never mark a gate green from historical evidence.
- [ ] 5.4 Fold/archive Change 024 only after executed evidence satisfies the exit gate.
- [ ] 5.5 Update `.agent/state.json`, commit the coherent implementation checkpoint, reconcile remote `main`, and push.

## Planning evidence

- [x] P.1 Real dogfood evidence identifies the exact defect: run `a19f488f` was `SOL_STALLED`, while the later valid `GOAL_COMPLETE` control was durably detected but rejected because no active run existed.
- [x] P.2 Code audit confirms `RunStore.getActiveRun()` excludes `SOL_STALLED` by design and `LoopService.onControlDetected()` currently validates only against that active-run result.
- [x] P.3 Design preserves the exclusion and scopes the exception exclusively to strictly correlated terminal Sol-control handling.

Execution status at Change creation: **PLANNED / IMPLEMENTATION NOT YET VERIFIED**. No test or build pass is claimed by this planning checkpoint.
