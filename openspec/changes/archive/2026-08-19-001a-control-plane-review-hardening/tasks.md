# Tasks: Control Plane Review Hardening

Resolve the full Change 001 review finding set, then continue directly into the next roadmap change. Do not stop merely for a second review checkpoint. Do not implement watcher/executor/Playwright runtime *inside 001a*; after 001a is complete/folded, create/activate the next focused roadmap OpenSpec and continue there.

## 0. Recovery and targeted finding reproduction

- [x] 0.1 Read `AGENTS.md`, `.agent/state.json`, Change 001/001a artifacts, and relevant focused contracts.
- [x] 0.2 Inspect current `main`, working tree, remote state, and preserve any local work.
- [x] 0.3 Reproduce/inspect the root `npm run dev` defect directly; confirm whether controller runtime + Vite + Electron actually start.
- [x] 0.4 Test the specific clean-generated-output workspace-resolution concern (remove generated outputs required for the experiment and exercise the affected command path). **Do not run a broad startup baseline suite.**
- [x] 0.5 Compare committed package/tool lines against `docs/TECH-BASELINE.md` and resolve the documented drift.

## 1. Align the technology baseline

- [x] 1.1 Update package manifests/lockfile to the locked supported React/Vite/Tailwind/Vitest/Electron lines.
- [x] 1.2 Align Node engine/minimum expectation and Node type definitions with Node 24 baseline.
- [x] 1.3 Update related plugins/testing packages for compatibility.
- [x] 1.4 If a locked line genuinely cannot work, commit evidence + explicit durable baseline/decision amendment instead of silent downgrade.
- [x] 1.5 Run focused compatibility checks after dependency migration; use broader gates at a meaningful checkpoint rather than as startup baseline work.

## 2. Make workspace dependency resolution clean-checkout safe

- [x] 2.1 Remove dependence on stale untracked `@orca/shared/dist` output.
- [x] 2.2 Choose the simplest dependency-aware approach (project references, source mapping, or automatic prerequisite build) and document it.
- [x] 2.3 Ensure root `npm run typecheck` works from clean generated-output state.
- [x] 2.4 Ensure root `npm test` works from clean generated-output state.
- [x] 2.5 Ensure root `npm run build` produces packages in deterministic dependency order.
- [x] 2.6 Ensure focused workspace commands do not require undocumented manual shared builds.

## 3. Fix the one-command development stack

- [x] 3.1 Make controller development command run a real controller process, not only `tsc --watch`.
- [x] 3.2 Ensure shared changes are rebuilt/resolved during development.
- [x] 3.3 Make root `npm run dev` start controller runtime, Vite, and Electron.
- [x] 3.4 Pass/set the Vite development URL for Electron automatically.
- [x] 3.5 Add readiness/start ordering so Electron does not depend on an undocumented race.
- [x] 3.6 Make dev-stack termination clean up managed child processes on Windows.
- [x] 3.7 Keep controller separately runnable for headless testing/development.

### Verification 3

- [x] 3.V1 On Windows, `npm run dev` yields reachable controller health, Vite UI, and launched Electron window.
- [x] 3.V2 Electron CRUD uses controller API.
- [x] 3.V3 Closing Electron does not unintentionally end controller ownership while the supervised dev stack continues.

## 4. Make migrations atomic

- [x] 4.1 Make each migration body + metadata insertion one transaction/atomic unit.
- [x] 4.2 Roll back on migration-body failure.
- [x] 4.3 Roll back if metadata insertion fails.
- [x] 4.4 Preserve ordered/idempotent successful migration behavior.
- [x] 4.5 Add deterministic failing-migration tests proving no partial schema/data and no false applied metadata remain.

## 5. Fix event/WebSocket lifecycle

- [x] 5.1 Define explicit event-client ownership (app-shell singleton owner or safe reference-count model).
- [x] 5.2 Re-enable reconnect intent on legitimate later `connect()` after intentional disconnect.
- [x] 5.3 Ensure error/close paths schedule exactly one reconnect when desired.
- [x] 5.4 Ensure stale socket callbacks cannot clobber replacement socket.
- [x] 5.5 Verify React StrictMode setup-cleanup-setup does not permanently disable reconnect.
- [x] 5.6 Verify reconnect triggers authoritative repository refetch.
- [x] 5.7 Add deterministic fake-WebSocket tests for open/close/error/reconnect/disconnect/remount.

## 6. Replace hash-only routing with real deep-link routing

- [x] 6.1 Implement pathname/history routes for list, add, detail, and edit.
- [x] 6.2 Remove dependence on `window.location.hash` for core navigation.
- [x] 6.3 Preserve browser back/forward behavior.
- [x] 6.4 Ensure `/repositories/:id` direct load/reload resolves correct detail after data fetch.
- [x] 6.5 Ensure `/repositories/:id/edit` direct load/reload resolves edit screen.
- [x] 6.6 Keep controller SPA fallback and `/api/*` reservation intact.
- [x] 6.7 Add tests that boot the actual app at real pathnames, not only server fallback tests.

## 7. Tighten repository input/controller validation

- [x] 7.1 Restrict Sol URL validation to supported dedicated ChatGPT conversation URL forms.
- [x] 7.2 Add negative tests for `/pricing`, `/settings`, generic/arbitrary ChatGPT paths, wrong hosts, homepage URLs.
- [x] 7.3 Preserve positive tests for the exact normal conversation URL form used by Orca.
- [x] 7.4 Validate controller port/config values before runtime startup; add invalid-port tests.
- [x] 7.5 Replace unknown `/api/*` `REPOSITORY_NOT_FOUND` response with route-appropriate error identity and update contracts/tests.

## 8. Re-establish truthful acceptance evidence

- [x] 8.1 Exercise the specific clean-generated-output command path required to prove workspace resolution.
- [x] 8.2 At a meaningful completion checkpoint, run root typecheck/test/lint/build and record exact results.
- [x] 8.3 Run standalone controller health/CRUD smoke.
- [x] 8.4 Run actual Windows `npm run dev` smoke with controller + Vite + Electron.
- [x] 8.5 Run production-like controller-served built SPA smoke without Vite.
- [x] 8.6 Directly reload repository detail/edit pathnames and verify actual React screens.
- [x] 8.7 Verify repository persistence across controller restart.
- [x] 8.8 Verify narrow phone-like viewport remains usable after routing/dependency changes.
- [x] 8.9 Reconcile any Change 001 checkbox whose acceptance claim was inaccurate.

## 9. Documentation, fold, and continuous advance

- [x] 9.1 Update README actual install/dev/verify commands and current status.
- [x] 9.2 Update focused contracts changed by implementation evidence.
- [x] 9.3 Keep Milestone 1 active until the corrective exit gate is genuinely satisfied.
- [x] 9.4 Keep `.agent/state.json` truthful throughout work.
- [x] 9.5 Commit/push all intended fixes to `main`.
- [x] 9.6 Fold/archive Change 001 + 001a into canonical `openspec/specs/` as appropriate once requirements are satisfied.
- [x] 9.7 Mark Milestone 1 complete and update roadmap/waypoint.
- [x] 9.8 Create/activate the next focused OpenSpec for Milestone 2 (`repository watcher and transactional dispatch`) if absent.
- [x] 9.9 Commit/push the transition.
- [x] 9.10 **Continue implementing the next roadmap change immediately; do not stop solely for an external review.**

## Blocker rule

If any individual 001a item is blocked, record concise evidence and continue every independent safe item. Revisit blockers later. Do not mark the overall goal blocked or end the development run while useful safe roadmap work remains.

## Final exit gate

001a is complete when all material review findings are resolved or explicitly superseded by a durable evidence-based decision, the control-plane foundation has truthful verification evidence, and Milestone 1 can be folded without carrying known High foundation defects forward. Completion advances into Milestone 2 rather than ending the coding session.
