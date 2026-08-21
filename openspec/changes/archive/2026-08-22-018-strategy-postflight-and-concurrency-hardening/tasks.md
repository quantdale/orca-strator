# Change 018 tasks

## 1. Authoritative postflight + control synchronization (W1: coordinator/loop owner)

- [x] 1.1 `onStrategyCompleted` consumes `RemotePublishResult`; COMPLETED requires PUBLISHED+verified for success; blocked publication -> retryable recovery state, no COMPLETED wake, dispatch not consumed as successful.
- [x] 1.2 PARTIAL/BLOCKED outcomes record both strategy semantic status and durable publication status.
- [x] 1.3 Durable pending-publication derivation + postflight-only retry (no worker rerun), including after controller restart.
- [x] 1.4 `routeStrategyControl` awaited/acknowledged; pause awaits paused boundary; resume failure does not mark EXECUTING; stop/kill propagate truthfully; race tests pass.
- [x] 1.5 Campaign/strategy transition ordering + idempotency; no contradictory states.
- [x] 1.6 `coordinator.shutdown()` async lifecycle (admissions closed, workers terminated within bounded grace, recovery persisted, callbacks settled); `app.ts` awaits it in onClose.

## 2. Remote advancement + SHA truth (W3: integration-service owner)

- [x] 2.1 Explicit UP_TO_DATE / LOCAL_AHEAD / REMOTE_AHEAD / DIVERGED classification in `publishToRemote`.
- [x] 2.2 REMOTE_AHEAD safely rebases/replays integrated work before the manifest commit; unsafe divergence -> structured blocker; never force-push/reset.
- [x] 2.3 Post-reconciliation HEAD used for manifest finalCommitSha, persisted evidence, and remote verification; original worker provenance preserved.

## 3. DAG staging lineage + serialized integration (W2: engine owner)

- [x] 3.1 Strategy-owned staging lineage from `strategyBaseSha`; completed nodes integrate there; persistent main untouched until final qualified integration/postflight.
- [x] 3.2 Per-strategy-run integration mutex; simultaneous completions serialize without index-lock failures (stress test).
- [x] 3.3 Dependent node snapshots = base + accepted transitive dependencies only; persist nodeBaseSha + dependencyInputShas; A->C vs unrelated B falsification test.

## 4. Qualification waves

- [x] 4.1 Postflight failure production-loop test: engine COMPLETED + publication BLOCKED -> no COMPLETED wake, dispatch not consumed, durable recovery evidence; then safe retry finishes publication without rerunning workers (incl. restart).
- [x] 4.2 Movement matrix real tests: remote non-conflicting/conflicting during SWARM and DAG; local safe/conflicting; dirty persistent main; stale base; each with truthful blocking/reconciliation and correct dispatch semantics.
- [x] 4.3 DAG concurrency stress test (simultaneous completions) + dependency isolation falsification.
- [x] 4.4 Shutdown/restart tests without caller-side settling: fastify.close + DB close alone; rebuild -> deterministic recovery; no orphan children/DB-closed errors/false COMPLETED.

## 5. Cleanliness + review

- [x] 5.1 No TEMP-DEBUG/temporary probes in production sources; structured logging only.
- [x] 5.2 Real-tier test headers describe historical bugs as FOUND AND FIXED; no contradictory skip instructions.
- [x] 5.3 Independent read-only review wave (git/postflight, DAG isolation, control races, shutdown ownership, qualification truthfulness); confirmed Critical/High findings fixed.

## 6. Final gates + durable state

- [x] 6.1 npm test, npm run test:real, typecheck, build, lint, strict OpenSpec validation, git diff --check all pass.
- [x] 6.2 Reconcile .agent/state.json, README, ROADMAP, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, API-CONTRACT, TEST-STRATEGY, canonical specs truthfully.
- [ ] 6.3 Commit/push coherent checkpoints to main.
