# Change 018: Strategy postflight and concurrency hardening

## Why

Independent review of Change 017 found internal hardening gaps in the newly
composed strategy loop. These are internal correctness issues, not external
dependencies:

- `LoopService.onStrategyCompleted` ignores the `RemotePublishResult`, so a
  strategy engine `COMPLETED` can masquerade as a successful iteration even
  when remote publication failed or was never verified.
- `IntegrationService.publishToRemote` mishandles `localHead is ancestor of
  remoteHead` (local behind remote) and keeps treating pre-rebase SHAs as the
  final durable commit.
- DAG staging cherry-picks each completed node into persistent user `main`
  merely to prepare downstream nodes.
- Independent DAG workers can execute concurrent cherry-picks against the same
  integration checkout.
- Campaign controls are fire-and-forget; campaign state and strategy state can
  contradict each other through async races.
- Graceful shutdown sends async controls without awaiting them, so SQLite can
  close while workers are still settling.

This change fixes those gaps without adding any feature scope.

## Scope

- make required remote publication success (`PUBLISHED` + verified)
  authoritative for outer-loop iteration success; failed publication becomes a
  structured retryable postflight/recovery state with durable provenance;
- classify remote-main advancement (`UP_TO_DATE` / `LOCAL_AHEAD` /
  `REMOTE_AHEAD` / `DIVERGED`) and reconcile safely; represent post-rebase
  SHAs truthfully in publication evidence and result manifests;
- replace persistent-main DAG staging with one strategy-owned integration
  lineage derived from `strategyBaseSha`; persistent main is only mutated by
  the final qualified integration/postflight;
- serialize strategy integration ownership (one integration operation at a
  time per strategy run; workers stay parallel);
- restrict every DAG node to `strategyBaseSha` + accepted transitive
  dependency commits only;
- qualify the local/remote movement matrix (safe/conflicting/dirty) with real
  deterministic Git tests;
- make campaign controls awaited/acknowledged operations with race coverage;
  campaign and strategy states must never contradict;
- make graceful shutdown genuinely asynchronous: stop admissions, terminate
  workers within a bounded grace, persist recovery state, settle callbacks,
  then return — so `fastify.close()` + DB close alone is sufficient;
- enable postflight retry (including after controller restart) without
  rerunning successful model workers;
- clean temporary debug artifacts and stale qualification comments.

## Explicit non-goals

- no new execution strategies, UI concepts, routing, providers, or product scope;
- no change to Change 017 architecture (coordinator ownership, durable
  dispatch selection, normalized results);
- no force-push, no `reset --hard`, no loss of user work.

## Exit evidence

Production-loop negative tests prove a failed remote publication can never
produce a COMPLETED Sol wake; movement/concurrency/isolation/shutdown
qualifications pass; postflight retry completes without rerunning workers;
all final gates pass; docs/state reconciled truthfully.
