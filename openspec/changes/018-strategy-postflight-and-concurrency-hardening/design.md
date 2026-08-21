# Change 018 design

## Authoritative postflight (W1: coordinator/loop owner)

`LoopService.onStrategyCompleted` consumes the `RemotePublishResult`:
`COMPLETED` + `PUBLISHED` + `remoteVerified` -> consume dispatch, COMPLETED
wake. `COMPLETED` + `BLOCKED`/unverified -> run transitions to a retryable
recovery state (`RECOVERY_REQUIRED` with durable postflight evidence on the
strategy record), dispatch stays unconsumed-as-successful, no COMPLETED wake.
`PARTIAL`/`BLOCKED` outcomes keep their semantic mapping and additionally
record publication status. Pending publications are derivable durably from
strategy records (`COMPLETED` report present, authorizing dispatch not yet
successfully consumed) so the startup reconciler can retry publication only —
never rerunning workers.

## Remote advancement classification (W3: integration-service owner)

`publishToRemote` computes ancestry explicitly:
- `UP_TO_DATE`: remote main already contains local HEAD (remote == local, or
  no remote main yet) — nothing local-only to push;
- `LOCAL_AHEAD`: fast-forward push after validation;
- `REMOTE_AHEAD`: local integrated main is behind remote — rebase/replay
  integrated commits onto advanced remote main inside the integration
  checkout before writing the manifest; conflicts abort to a structured
  blocker;
- `DIVERGED`: reconcile only when safe, else structured blocker.
After any rebase, the actual post-reconciliation HEAD is resolved fresh,
used for the manifest's final SHA, persisted as publication evidence, and
verified on remote main. Original worker commit SHAs remain in result
provenance untouched.

## Strategy-owned DAG staging lineage (W2: engine owner)

One staging lineage per strategy run: internal branch/worktree based at
`strategyBaseSha`. Each completed node is validated then cherry-picked into
the staging lineage under a per-strategy-run integration mutex (promise-chain
serialization in `SwarmExecutionService`). A dependent node's worktree base is
the deterministic staged snapshot = `strategyBaseSha` + accepted transitive
dependency commits (staging HEAD restricted to declared dependencies).
Persistent user main is untouched until the final qualified integration, which
fast-forwards/rebases persistent main from the staging lineage before
postflight publication. Node provenance persists `nodeBaseSha` +
`dependencyInputShas`.

## Awaited controls + async shutdown (W1)

`routeStrategyControl` returns the engine control promise. Campaign pause
awaits engine acceptance plus the strategy record reaching its paused boundary
(bounded) before marking the campaign `PAUSED`; resume/stop/kill propagate
outcomes; no swallowed rejections. `coordinator.shutdown()` becomes a genuine
async lifecycle: close admissions, request termination, await worker/control
settlement within a bounded grace, persist recovery state, settle callbacks,
return; `app.ts` awaits it inside `onClose` so `fastify.close()` + DB close
alone is sufficient (tests drop their custom `settleEngine`).

## Qualification waves

Wave 2 test owners (disjoint files): postflight failure + retry-without-rerun
(+ restart); movement matrix (remote safe/conflicting during SWARM/DAG, local
safe/conflicting, dirty main, stale base); DAG concurrency stress + dependency
isolation falsification (A->C vs unrelated B); shutdown/restart without
caller-side settling. Wave 3: five independent read-only reviewers (git
ancestry/postflight, DAG isolation, control races, shutdown/process
ownership, qualification truthfulness) with triage and parallel fix workers.
