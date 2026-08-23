# Change 024 tasks

## 1. Narrow control-target resolution

- [x] 1.1 `RunStore.getLatestStalledRun(repositoryId)`: latest
  `status = 'SOL_STALLED'` run by `started_at DESC`; `getActiveRun()`
  untouched.
- [x] 1.2 `onControlDetected`: resolve active run first; only when null,
  resolve the latest stalled run and require exact `control.runId` match;
  active path otherwise byte-for-byte unchanged.

## 2. Strict validation preserved + stalled allowlist

- [x] 2.1 Refactor `validateSolControl` to validate against the resolved
  target run (repositoryId, runId, iteration, non-null relatedDispatchId,
  detected/consumed/rejected idempotency, strategy/executor ownership guards
  all intact).
- [x] 2.2 Stalled target: GOAL_COMPLETE / BLOCKED / NEEDS_HUMAN allowed;
  PAUSED explicitly rejected (`SOL_STALLED_PAUSE_UNSUPPORTED`) with no
  executor pause/resume invocation possible on the stalled path.

## 3. No-resurrection application

- [x] 3.1 Stalled closure: no Sol wake submission, no executor/strategy
  start/resume, no scheduler ownership, no wall-clock re-arm, direct
  SOL_STALLED → terminal transition (no intermediate active state), race-guarded
  re-read before mutation.
- [x] 3.2 finishedAt per convention (GOAL_COMPLETE stamps decision time;
  BLOCKED/NEEDS_HUMAN keep stall-time value); stale drainReason cleared.

## 4. Adjacent lifecycle hygiene

- [x] 4.1 `LoopService.releaseTerminalTimers(repositoryId)` releasing busy +
  wall-clock timers; invoked at every SOL_STALLED entry point (wake-failure /
  busy-exhausted paths in LoopService, app.ts stalled handler).
- [x] 4.2 Durable audit event `loop.control_applied` for the stalled closure
  carrying controlId/runId/decision/targetWasStalled.

## 5. Focused regression coverage

- [x] 5.1 New `sol-stalled-control-closure.test.ts` (10 tests): matching
  GOAL_COMPLETE closes latest stalled run + consumes control; BLOCKED /
  NEEDS_HUMAN work; PAUSED rejected and run stays SOL_STALLED; newer active
  run prevents old stalled closure; non-latest stalled reference rejected;
  wrong iteration rejected; wrong relatedDispatchId rejected; duplicate
  delivery idempotent; closure publishes durable audit event; no wake
  submitted / executor launched during closure;
  `releaseTerminalTimers` hygiene; `getActiveRun()` still never returns
  SOL_STALLED.
- [x] 5.2 All existing normal active-run control tests remain unchanged and
  green (`loop-drain-correlation.test.ts` untouched, passing in the same run).

## 6. Gates + durable state

- [x] 6.1 Full checkpoint gates executed on this tree: `npm test` fast tier
  59 test files passed; `npm run typecheck`, `npm run build`, `npm run lint`
  exit 0; real tier `npm run test:real` exit 0 (14 test files passed / 1
  skipped — the known EXPECTED_EXTERNAL_UNQUALIFIED OpenCode-URL case);
  `npx openspec validate --all --strict` 24 passed / 0 failed (re-checked
  after the 022/009 archives); `git diff --check` clean.
- [x] 6.2 Documentation reconciliation: REAL-DOGFOOD-QUALIFICATION Phase-10
  defect marked fixed with evidence; README + ROADMAP stale qualification
  claims reconciled (ChatGPT wake / Kimi / Codex REAL-QUALIFIED 2026-08-23);
  Tailscale + authorized OpenCode left honestly UNQUALIFIED;
  docs/RUNTIME-MODEL.md `SOL_STALLED` section documents the closure boundary.
- [x] 6.3 OpenSpec bookkeeping: Change 022 task 4.2 corrected against Git
  evidence (commit `deac592` on pushed main) and change archived as
  `2026-08-23-022-executor-headless-invocation-fixes`; Change 009 annotated
  truthfully (ChatGPT-wake half qualified by later dogfood; Tailscale half
  remains UNQUALIFIED, tracked in `.agent/state.json` blockers) and archived
  as `2026-08-23-009-v1-runtime-integration-hardening` with canonical spec
  `runtime-integration-hardening`.
- [x] 6.4 Fold/archive Change 024 into canonical specs after verification;
  update `.agent/state.json`; commit/push coherent checkpoint to main.
