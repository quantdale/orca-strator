# Change 020 design

## Event + transition seam (app wiring, not the HTTP layer)

The resolve route keeps its validation semantics (422 invalid outcome,
404 unknown/foreign decision, 409 already-resolved) and gains two injected
collaborators: a `publishPermissionResolved` callback and `loopService`.
`app.ts` owns the end-to-end closure so the HTTP layer stays thin:

```ts
const onPermissionResolved = (decision: PermissionDecision) => {
  eventBus.publish({ type: "permission.resolved", ... });
  const run = runStore.getLatestRun(decision.repositoryId);
  if (!run || run.id !== decision.runId || run.status !== "ATTENTION_REQUIRED") return;
  const stillPending = permissionStore
    .listDecisions(decision.repositoryId)
    .some((d) => d.actionable && !d.resolvedAt && d.runId === decision.runId && d.id !== decision.id);
  if (stillPending) return;
  void loopService.recoverRun(decision.repositoryId, "retry")
    .catch((err) => console.warn("[app] permission-resolution recovery failed:", err));
};
```

Rationale for reusing `recoverRun("retry")`: it already accepts
`ATTENTION_REQUIRED` runs, refuses runs an active actor owns (it only accepts
parked problem states), routes postflight-blocked evidence to the
postflight-only retry, and otherwise performs exactly the hierarchy-faithful
re-drive (`SOL_PENDING` + Sol wake with the existing message shape). Wake
failures flow through the existing busy-retry / `SOL_STALLED` /
`ATTENTION_REQUIRED` machinery inside `submitSolWakeForRun`, so a failed
re-drive is observable rather than silently swallowed.

The `run.id === decision.runId` correlation plus the "no other unresolved
actionable decisions for this run" query prevents resolving one ask from
un-sticking a campaign that is attention-parked for a different reason
(e.g., browser auth) or from several asks at once. The double-resolve race
ends in `recoverRun`'s status guard throwing, which is caught and warned —
never a crash.

## UI controls

`OperationalIntelligencePanel` already renders permission decision badges.
The permissions card gains a pending-decisions list: for each decision with
`actionable && !resolvedAt`, three explicit buttons (ALLOW / ALLOW_ONCE /
DENY) call a new `apiClient.resolvePermissionDecision(repositoryId,
decisionId, outcome)`. Outcomes map to the existing endpoint contract; errors
surface through the panel's error banner (`ApiError.code`:
`PERMISSION_DECISION_ALREADY_RESOLVED`, `PERMISSION_DECISION_NOT_FOUND`) and
a successful resolve triggers the panel's normal refresh so badges and run
state reflect reality. Resolved history stays visible as read-only rows.

## Tests

- route-level: successful resolve returns the persisted decision and invokes
  the injected callback once; 404/409/422 semantics unchanged and emit
  nothing (extend existing API tests);
- app-wiring unit test: resolution un-sticks only the matching parked run,
  waits for sibling asks, ignores active actors, and survives recovery
  rejection;
- component test: buttons render per unresolved actionable decision, success
  refreshes, 409 shows truthful banner without deleting history.
