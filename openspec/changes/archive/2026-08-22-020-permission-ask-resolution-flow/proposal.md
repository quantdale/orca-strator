# Change 020: Permission ask-resolution end-to-end flow

## Why

Change 018 made `ASK` permission outcomes durable, resolvable decisions and
made an actionable decision move its run to `ATTENTION_REQUIRED`. But the
flow dead-ends there: resolving a decision only rewrites a database row.
Nothing is published to the event stream, the campaign stays parked in
`ATTENTION_REQUIRED` with no transition out, and the UI can display decision
badges but offers no way to actually resolve them from phone/desktop.

## Scope

- emit a structured `permission.resolved` event on every successful
  resolution (outcome, decision id, repository, run, iteration);
- when the resolved decision was the last unresolved actionable decision of a
  run that is parked in `ATTENTION_REQUIRED`, transition that run out of
  attention and re-drive it toward Sol review through the existing recovery
  path (Sol stays authoritative for what happens next);
- never contradict an active actor: resolutions landing while the run is
  executing/reviewing/draining record evidence only;
- add explicit resolve controls (ALLOW / ALLOW_ONCE / DENY) for unresolved
  actionable decisions in the responsive UI's operational-intelligence panel,
  with truthful 404/409 error surfacing and post-resolution refresh;
- focused tests for route semantics, transition guards, and UI control
  behavior as available.

## Explicit non-goals

- no change to which actions evaluate to ASK or to preset/policy semantics;
- no automatic resolution, timeout policy, or delegation to Sol;
- no new wake-message fields (the existing wake shape carries the re-drive);
- no scraping of ChatGPT output and no second truth store.

## Exit evidence

Focused unit/component tests pass alongside existing tiers; typecheck/build/
lint pass where tooling is available; strict OpenSpec validation passes.
