# Tasks: Control Plane Review Hardening

Complete this corrective change before Milestone 2. Do not implement watcher/executor/Playwright runtime.

## 0. Recovery and reproduce review findings

- [ ] 0.1 Read `AGENTS.md`, `.agent/state.json`, Change 001/001a artifacts, and relevant focused contracts.
- [ ] 0.2 Inspect current `main`, working tree, remote state, and preserve any local work.
- [ ] 0.3 Reproduce/inspect the current root `npm run dev` behavior and confirm whether controller runtime + Vite + Electron actually start.
- [ ] 0.4 Remove generated `dist/`/cache outputs, reinstall as needed, and test fresh-checkout root typecheck/test/build behavior before choosing a workspace-resolution fix.
- [ ] 0.5 Compare every committed package/tool line against `docs/TECH-BASELINE.md`; record any proposed deviation before implementing it.

## 1. Align the technology baseline

- [ ] 1.1 Update package manifests/lockfile to the locked supported React/Vite/Tailwind/Vitest/Electron lines.
- [ ] 1.2 Align Node engine/minimum expectation and Node type definitions with the Node 24 baseline.
- [ ] 1.3 Update related plugins/testing packages to versions compatible with the selected baseline.
- [ ] 1.4 If an approved baseline line genuinely cannot work, commit evidence + `TECH-BASELINE`/decision amendment instead of silent downgrade.
- [ ] 1.5 Run install/typecheck/tests/build after dependency migration and fix compatibility regressions.

## 2. Make workspace dependency resolution fresh-checkout safe

- [ ] 2.1 Remove dependence on stale untracked `@orca/shared/dist` output for root verification.
- [ ] 2.2 Choose the simplest dependency-aware approach (project references, source mapping, or automatic prerequisite build) and document it.
- [ ] 2.3 Ensure root `npm run typecheck` works from a clean generated-output state.
- [ ] 2.4 Ensure root `npm test` works from a clean generated-output state.
- [ ] 2.5 Ensure root `npm run build` produces packages in deterministic dependency order.
- [ ] 2.6 Ensure focused workspace commands remain understandable and do not require undocumented manual shared builds.

## 3. Fix the one-command development stack

- [ ] 3.1 Make controller development command run a real controller process, not only `tsc --watch`.
- [ ] 3.2 Ensure shared code changes are rebuilt/resolved during development.
- [ ] 3.3 Make root `npm run dev` start controller runtime, Vite, and Electron.
- [ ] 3.4 Pass/set the Vite development URL for Electron automatically.
- [ ] 3.5 Add readiness/start ordering so Electron does not depend on an undocumented race.
- [ ] 3.6 Make dev-stack termination clean up managed child processes on Windows.
- [ ] 3.7 Keep controller separately runnable for headless testing/development.

### Verification 3

- [ ] 3.V1 On Windows, `npm run dev` results in reachable controller health, Vite UI, and a launched Electron window.
- [ ] 3.V2 Electron CRUD uses the controller API.
- [ ] 3.V3 Closing Electron does not terminate controller ownership unintentionally during the supervised dev scenario unless the entire dev stack is stopped.

## 4. Make migrations atomic

- [ ] 4.1 Refactor migration runner so each migration body + metadata insertion is one transaction/atomic unit.
- [ ] 4.2 Roll back on migration-body failure.
- [ ] 4.3 Roll back if metadata insertion fails.
- [ ] 4.4 Preserve ordered/idempotent successful migration behavior.
- [ ] 4.5 Add deterministic injected failing-migration tests proving no partial schema/data and no applied metadata row remain.

## 5. Fix event/WebSocket lifecycle

- [ ] 5.1 Define explicit event-client ownership (app-shell singleton owner or safe reference-count model).
- [ ] 5.2 Re-enable reconnect intent on a legitimate later `connect()` after prior intentional disconnect.
- [ ] 5.3 Ensure error/close paths schedule exactly one reconnect when desired.
- [ ] 5.4 Ensure stale socket callbacks cannot clobber a replacement socket.
- [ ] 5.5 Verify React StrictMode setup-cleanup-setup does not permanently disable reconnect.
- [ ] 5.6 Verify reconnect causes authoritative repository refetch.
- [ ] 5.7 Add deterministic fake-WebSocket tests for open/close/error/reconnect/disconnect/remount behavior.

## 6. Replace hash-only routing with real deep-link routing

- [ ] 6.1 Implement pathname/history routes for list, add, detail, and edit screens.
- [ ] 6.2 Remove dependence on `window.location.hash` for core navigation.
- [ ] 6.3 Preserve browser back/forward behavior.
- [ ] 6.4 Ensure `/repositories/:id` direct load/reload resolves the correct detail screen after data fetch.
- [ ] 6.5 Ensure `/repositories/:id/edit` direct load/reload resolves the edit screen.
- [ ] 6.6 Keep controller SPA fallback and `/api/*` reservation behavior intact.
- [ ] 6.7 Add integration/component tests that boot the app at real pathnames, not only server fallback tests.

## 7. Tighten repository input validation

- [ ] 7.1 Restrict Sol URL validation to explicitly supported dedicated ChatGPT conversation URL forms.
- [ ] 7.2 Add negative tests for `/pricing`, `/settings`, arbitrary single-segment ChatGPT paths, wrong hosts, and generic homepage URLs.
- [ ] 7.3 Preserve positive tests for the exact normal conversation URL form used by Orca.
- [ ] 7.4 Validate controller port/config values before runtime startup; add invalid-port tests.
- [ ] 7.5 Replace unknown `/api/*` `REPOSITORY_NOT_FOUND` response with a route-appropriate error identity and update tests/contracts if needed.

## 8. Re-establish honest acceptance evidence

- [ ] 8.1 Add a clean-generated-output verification path and record the exact commands used.
- [ ] 8.2 Run root typecheck/test/lint/build from that state.
- [ ] 8.3 Run standalone controller health/CRUD smoke.
- [ ] 8.4 Run actual Windows `npm run dev` smoke with controller + Vite + Electron.
- [ ] 8.5 Run production-like controller-served built SPA smoke without Vite.
- [ ] 8.6 Directly reload a repository detail/edit pathname and verify the actual React screen.
- [ ] 8.7 Verify repository persistence across controller restart.
- [ ] 8.8 Verify narrow phone-like viewport remains usable after routing/dependency changes.
- [ ] 8.9 Reconcile Change 001 checkboxes if any previously checked acceptance item was not actually exercised.

## 9. Documentation and review handoff

- [ ] 9.1 Update README current status and actual install/dev/verify commands.
- [ ] 9.2 Update any focused contract changed by implementation evidence.
- [ ] 9.3 Keep Milestone 1 active until second review accepts it.
- [ ] 9.4 Update `.agent/state.json` throughout work with concise truthful checkpoints.
- [ ] 9.5 Commit/push all intended fixes to `main`.
- [ ] 9.6 Set state to `READY_FOR_REVIEW` and request second deep Sol review.
- [ ] 9.7 Do **not** create/start Milestone 2 automatically.

## Final exit gate

Change 001a is ready for second review only when all High findings are fixed, clean-checkout/dev/Electron/deep-link/migration/reconnect behavior is genuinely exercised, and no later autonomy subsystem has leaked into the milestone.