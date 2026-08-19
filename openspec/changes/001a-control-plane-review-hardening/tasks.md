# Tasks: Control Plane Review Hardening

Resolve the full Change 001 review finding set, then continue directly into the next roadmap change. Do not stop merely for a second review checkpoint. Do not implement watcher/executor/Playwright runtime *inside 001a*; after 001a is complete/folded, create/activate the next focused roadmap OpenSpec and continue there.

## 0. Recovery and targeted finding reproduction

- [ ] 0.1 Read `AGENTS.md`, `.agent/state.json`, Change 001/001a artifacts, and relevant focused contracts.
- [ ] 0.2 Inspect current `main`, working tree, remote state, and preserve any local work.
- [ ] 0.3 Reproduce/inspect the root `npm run dev` defect directly; confirm whether controller runtime + Vite + Electron actually start.
- [ ] 0.4 Test the specific clean-generated-output workspace-resolution concern (remove generated outputs required for the experiment and exercise the affected command path). **Do not run a broad startup baseline suite.**
- [ ] 0.5 Compare committed package/tool lines against `docs/TECH-BASELINE.md` and resolve the documented drift.

## 1. Align the technology baseline

- [ ] 1.1 Update package manifests/lockfile to the locked supported React/Vite/Tailwind/Vitest/Electron lines.
- [ ] 1.2 Align Node engine/minimum expectation and Node type definitions with Node 24 baseline.
- [ ] 1.3 Update related plugins/testing packages for compatibility.
- [ ] 1.4 If a locked line genuinely cannot work, commit evidence + explicit durable baseline/decision amendment instead of silent downgrade.
- [ ] 1.5 Run focused compatibility checks after dependency migration; use broader gates at a meaningful checkpoint rather than as startup baseline work.

## 2. Make workspace dependency resolution clean-checkout safe

- [ ] 2.1 Remove dependence on stale untracked `@orca/shared/dist` output.
- [ ] 2.2 Choose the simplest dependency-aware approach (project references, source mapping, or automatic prerequisite build) and document it.
- [ ] 2.3 Ensure root `npm run typecheck` works from clean generated-output state.
- [ ] 2.4 Ensure root `npm test` works from clean generated-output state.
- [ ] 2.5 Ensure root `npm run build` produces packages in deterministic dependency order.
- [ ] 2.6 Ensure focused workspace commands do not require undocumented manual shared builds.

## 3. Fix the one-command development stack

- [ ] 3.1 Make controller development command run a real controller process, not only `tsc --watch`.
- [ ] 3.2 Ensure shared changes are rebuilt/resolved during development.
- [ ] 3.3 Make root `npm run dev` start controller runtime, Vite, and Electron.
- [ ] 3.4 Pass/set the Vite development URL for Electron automatically.
- [ ] 3.5 Add readiness/start ordering so Electron does not depend on an undocumented race.
- [ ] 3.6 Make dev-stack termination clean up managed child processes on Windows.
- [ ] 3.7 Keep controller separately runnable for headless testing/development.

### Verification 3

- [ ] 3.V1 On Windows, `npm run dev` yields reachable controller health, Vite UI, and launched Electron window.
- [ ] 3.V2 Electron CRUD uses controller API.
- [ ] 3.V3 Closing Electron does not unintentionally end controller ownership while the supervised dev stack continues.

## 4. Make migrations atomic

- [ ] 4.1 Make each migration body + metadata insertion one transaction/atomic unit.
- [ ] 4.2 Roll back on migration-body failure.
- [ ] 4.3 Roll back if metadata insertion fails.
- [ ] 4.4 Preserve ordered/idempotent successful migration behavior.
- [ ] 4.5 Add deterministic failing-migration tests proving no partial schema/data and no false applied metadata remain.

## 5. Fix event/WebSocket lifecycle

- [ ] 5.1 Define explicit event-client ownership (app-shell singleton owner or safe reference-count model).
- [ ] 5.2 Re-enable reconnect intent on legitimate later `connect()` after intentional disconnect.
- [ ] 5.3 Ensure error/close paths schedule exactly one reconnect when desired.
- [ ] 5.4 Ensure stale socket callbacks cannot clobber replacement socket.
- [ ] 5.5 Verify React StrictMode setup-cleanup-setup does not permanently disable reconnect.
- [ ] 5.6 Verify reconnect triggers authoritative repository refetch.
- [ ] 5.7 Add deterministic fake-WebSocket tests for open/close/error/reconnect/disconnect/remount.

## 6. Replace hash-only routing with real deep-link routing

- [ ] 6.1 Implement pathname/history routes for list, add, detail, and edit.
- [ ] 6.2 Remove dependence on `window.location.hash` for core navigation.
- [ ] 6.3 Preserve browser back/forward behavior.
- [ ] 6.4 Ensure `/repositories/:id` direct load/reload resolves correct detail after data fetch.
- [ ] 6.5 Ensure `/repositories/:id/edit` direct load/reload resolves edit screen.
- [ ] 6.6 Keep controller SPA fallback and `/api/*` reservation intact.
- [ ] 6.7 Add tests that boot the actual app at real pathnames, not only server fallback tests.

## 7. Tighten repository input/controller validation

- [ ] 7.1 Restrict Sol URL validation to supported dedicated ChatGPT conversation URL forms.
- [ ] 7.2 Add negative tests for `/pricing`, `/settings`, generic/arbitrary ChatGPT paths, wrong hosts, homepage URLs.
- [ ] 7.3 Preserve positive tests for the exact normal conversation URL form used by Orca.
- [ ] 7.4 Validate controller port/config values before runtime startup; add invalid-port tests.
- [ ] 7.5 Replace unknown `/api/*` `REPOSITORY_NOT_FOUND` response with route-appropriate error identity and update contracts/tests.

## 8. Re-establish truthful acceptance evidence

- [ ] 8.1 Exercise the specific clean-generated-output command path required to prove workspace resolution.
- [ ] 8.2 At a meaningful completion checkpoint, run root typecheck/test/lint/build and record exact results.
- [ ] 8.3 Run standalone controller health/CRUD smoke.
- [ ] 8.4 Run actual Windows `npm run dev` smoke with controller + Vite + Electron.
- [ ] 8.5 Run production-like controller-served built SPA smoke without Vite.
- [ ] 8.6 Directly reload repository detail/edit pathnames and verify actual React screens.
- [ ] 8.7 Verify repository persistence across controller restart.
- [ ] 8.8 Verify narrow phone-like viewport remains usable after routing/dependency changes.
- [ ] 8.9 Reconcile any Change 001 checkbox whose acceptance claim was inaccurate.

## 9. Documentation, fold, and continuous advance

- [ ] 9.1 Update README actual install/dev/verify commands and current status.
- [ ] 9.2 Update focused contracts changed by implementation evidence.
- [ ] 9.3 Keep Milestone 1 active until the corrective exit gate is genuinely satisfied.
- [ ] 9.4 Keep `.agent/state.json` truthful throughout work.
- [ ] 9.5 Commit/push all intended fixes to `main`.
- [ ] 9.6 Fold/archive Change 001 + 001a into canonical `openspec/specs/` as appropriate once requirements are satisfied.
- [ ] 9.7 Mark Milestone 1 complete and update roadmap/waypoint.
- [ ] 9.8 Create/activate the next focused OpenSpec for Milestone 2 (`repository watcher and transactional dispatch`) if absent.
- [ ] 9.9 Commit/push the transition.
- [ ] 9.10 **Continue implementing the next roadmap change immediately; do not stop solely for an external review.**

## Blocker rule

If any individual 001a item is blocked, record concise evidence and continue every independent safe item. Revisit blockers later. Do not mark the overall goal blocked or end the development run while useful safe roadmap work remains.

## Final exit gate

001a is complete when all material review findings are resolved or explicitly superseded by a durable evidence-based decision, the control-plane foundation has truthful verification evidence, and Milestone 1 can be folded without carrying known High foundation defects forward. Completion advances into Milestone 2 rather than ending the coding session.
