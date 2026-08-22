# Change 020 tasks

## 1. Event + backend transition

- [x] 1.1 Add `permission.resolved` to the shared event union.
- [x] 1.2 Inject `publishPermissionResolved` + `loopService` into the resolve route; emit exactly one event per successful resolve with persisted-decision payload.
- [x] 1.3 Implement the attention-park guard in `app.ts`: matching parked run + no sibling unresolved actionable decisions -> existing recovery re-drive; active actors untouched; failures warned, not swallowed silently.

## 2. UI controls

- [x] 2.1 Add `apiClient.resolvePermissionDecision(repositoryId, decisionId, outcome)`.
- [x] 2.2 Render ALLOW / ALLOW_ONCE / DENY controls for unresolved actionable decisions in `OperationalIntelligencePanel`; truthful 404/409 error banner; refresh on success; keep resolved history visible.

## 3. Tests + gates

- [x] 3.1 Route tests: success payload/callback-once; 404/409/422 unchanged and event-free. (`permission-resolution-flow.test.ts` green: focused run + full battery.)
- [x] 3.2 App-wiring test: un-stick only matching parked run; sibling-ask hold; actor-active no-op; recovery rejection tolerated. (Same file, green.)
- [x] 3.3 Component test: controls render/refresh; 409 banner keeps history. (`OperationalIntelligencePanel.test.tsx` green: fixed ambiguous text assertion and unused helper.)
- [x] 3.4 Run focused tests plus typecheck/build/lint/fast tier where tooling is available; record results truthfully. (Focused 15/15, fast tier 248/248 across 51 files, typecheck/build/lint all pass via `node scripts/verify-changes-019-020.mjs` after shell recovery.)
- [x] 3.5 Strict OpenSpec validation passes for the new change. (`openspec validate --all --strict`: 20 passed, 0 failed.)
- [ ] 3.6 Update `.agent/state.json`, API-CONTRACT §17, and commit/push coherent checkpoint.
