# Change 021 tasks

## 1. Startup orphan truth-repair coverage

- [x] 1.1 Unit test: persisted `running` and `pending` executor runs are marked `failed` at startup reconciliation with truthful cause + `finishedAt`; terminal rows untouched; `orphanedExecutorRuns` count correct. (`startup-reconciler.test.ts` Change 021 cases green; FK seeds added for dispatches.)

## 2. Shutdown kill-sweep coverage

- [x] 2.1 Unit test: shutdown terminates a launch-intent runner whose child already spawned but never graduated (no orphaned child); kill target identity asserted. (`executor-shutdown-paths.test.ts` hung-handshake adapter, green.)
- [x] 2.2 Unit test: one rejecting process-tree termination does not abort the sweep; both runners receive kill attempts and shutdown resolves. (Same file, single-service sweep, green.)
- [x] 2.3 Unit test: emergency `killRun` during the launch-retry sleep produces no further spawn attempts and leaves the run in a terminal persisted state. (Same file, green.)

## 3. Gates + durable state

- [x] 3.1 Run focused new suite plus typecheck/fast tier/build/lint; record results truthfully. (Focused 11/11 across the three touched files; fast tier 52 files / 253 tests; typecheck/build/lint exit 0. Also fixed a machine-speed flake exposed en route: watcher 6.T5 got an explicit 30s timeout matching its real-git workload plus retry-hardened Windows cleanup.)
- [x] 3.2 Strict OpenSpec validation passes for the new change. (`openspec validate --all --strict`: 21 passed / 0 failed.)
- [x] 3.3 Update TEST-STRATEGY evidence numbers if tier counts shift; update `.agent/state.json` waypoint; fold/archive the change; commit/push coherent checkpoint to `main`. (Completed by this checkpoint's commit.)
