# Tasks: Fresh-clone integrity and production resilience hardening

## 1. P0 forensic Git/source-truth repair

- [x] 1.1 Inspect working tree, ignored files, index, and pushed tree together; identify every production source present locally but missing from Git (`git status --short --ignored`, `git ls-files`, `git check-ignore -v`).
- [x] 1.2 Recover suppressed runtime sources into Git: `build-identity.ts`, `paths.ts`, `singleton-lock.ts`, `readiness-service.ts`, leaf dependency `db/schema-compat.ts`, additive `packages/shared/src/product.ts` identity fields.
- [x] 1.3 Anchor `.gitignore` local-data rules (`logs/`, `runtime/`, `browser-profile/`, `.orca-local/`) to repository root; keep build-output patterns unchanged.
- [x] 1.4 Add `scripts/ci/check-source-integrity.mjs` regression guard (fails on missing / ignored / untracked import targets from tracked TS source).
- [x] 1.5 Wire the integrity guard into ordinary gates (pretest) and Windows CI.
- [x] 1.6 Audit remaining broad ignore patterns (`dist/`, `build/`, `out/`, etc.) for unintended suppression anywhere in the monorepo (guard provides systematic protection; record verdict).
  Verdict: repo-wide ignored-file expansion found only legitimate build/package output (`*/dist`, `node_modules`, `apps/desktop/{release,resources,build}`) plus one machine-local zip. `apps/desktop/build/` is electron-builder buildResources (packaging INPUT), re-scoped to per-file tracking (installer.nsh + controller-safety.ps1); the second ignored-input trap — controller-safety.ps1 existing ONLY in ignored resources/ with no tracked provenance and no staging copy — was closed by giving it a tracked source in apps/desktop/build/ plus a required-copy step in prepare-controller-runtime.mjs and an extraResources shipping entry. `dist/`/`build/`/`out/` stay unanchored because every workspace legitimately emits them; systematic protection is provided by the resolution-based guard rather than pattern review.
- [x] 1.7 P0 gate: prove from an origin-only clean worktree (no ignored rescues) that affected workspaces resolve modules and pass focused Change-025 suites + typecheck/build.
  Evidence: detached clean worktree at origin/main 3684ea0, fresh `npm ci` (578 packages), source-integrity OK (196 files / 646 imports), FULL fast tier via repo scripts: 68 files / 394 tests green, typecheck all workspaces exit 0. Two environment-dependency defects found by this gate were fixed on main before the passing run (runtime-paths stale-UI-dist dependency; lifecycle boot budgets).

## 2. Runtime log bound

- [x] 2.1 Packaged controller logging enforces the size bound during the running process (checked appender), preserving redaction and useful diagnostics.
  Evidence: apps/controller/src/runtime/log-bounded.ts (synchronous fd lifecycle so Windows renames never race an open handle; startup rotation retained; transient rotation refusal drops one line instead of growing past the bound). index.ts delegates.
- [x] 2.2 Focused tests for rotation-during-run behavior.
  Evidence: runtime-log-bound.test.ts 5/5 (mid-run rotation, multi-rotation churn bound, startup oversized log, console override resilience, default-bound policy pin).

## 3. Blast-radius and failure-injection audit

- [x] 3.1 Trace controller bootstrap/config/identity/singleton/listen/shutdown, SQLite init/migration/reconciliation, watcher->dispatch->coordinator->strategy->postflight->Sol closure, executor serialization/kills/logs, browser ownership/wake/auth, scheduler leases/permissions under restart and failure injection; fix every reproducible Critical/High defect with regression evidence.
  Critical/High defects found and fixed:
  1. CRITICAL singleton-lock.readMetadata dropped controlToken on re-serialization, so lock.refresh({endpoint}) after bind rewrote the runtime lock WITHOUT the authenticated-lifecycle token — Change 026 desktop replacement/NSIS safety flows would have been permanently stuck at RESTART_PENDING / fail-closed in production. Unit suites missed it because none exercised refresh-after-acquire; the upgrade-preservation harness caught it end-to-end. Regression test added (singleton-lock suite, preserves-token-across-refresh) and fix verified through the full packaged harness.
  2. HIGH environment-dependency defects surfaced by the origin-only clean worktree gate: runtime-paths suite inherited stale apps/ui/dist from dev machines (would fail on fresh CI runners); boot-heavy lifecycle tests lacked explicit budgets vs vitest defaults under full-suite contention (observed 7.4s once). Both fixed with truthful preconditions/explicit budgets.

## 4. Package/upgrade truth

- [x] 4.1 Clean-origin-only `package:win` build from committed sources; re-run real packaged-runtime smoke on the final tree (PACKAGE_RUNTIME_QUALIFIED must be re-established, not inherited).
  Evidence: package:win from committed sources stamps build-info (version=0.1.0 commit=b18c8f80380d maxSchema=23); smoke verdict PACKAGE_RUNTIME_QUALIFIED re-run on the final tree after the token-preservation fix (all checks incl. teardown-only-test-controller). Two harness-truth defects fixed en route: teardown ordering must quiesce the still-open relaunch desktop BEFORE killing the controller (its supervisor legitimately resurrects it), cleanup is failure-tolerant, and the smoke port is ephemeral by default so a crashed run can no longer poison later ones.
- [x] 4.2 Isolated synthetic-version upgrade/data-preservation exercise proving migration + data survival across versions; installer execution remains external-gated if unauthorized.
  Evidence: scripts/package/upgrade-preservation.mjs (`npm run test:upgrade:unpacked`) verdict UNPACKED_UPGRADE_PRESERVATION_QUALIFIED — 10/10 checks: generation A (real artifact) seeds durable state via packaged API; generation B (production ORCA_BUILD_VERSION/ORCA_BUILD_COMMIT stamping seams emulating a newer release) starts on the SAME data dir without DATABASE_TOO_NEW refusal, reports skewed identity, preserves repository rows, keeps integrity/FK clean (23 migrations), carries controlToken in lock metadata, and shuts down gracefully via the authenticated contract. NSIS installer lifecycle stays with the ephemeral-CI release job (INSTALLER_EXECUTION_SANCTIONED_ENV_ONLY blocker unchanged).
- [x] 4.3 Keep PACKAGE_BUILT vs PACKAGE_RUNTIME_QUALIFIED labeling truthful in workflows/docs.
  Evidence: windows-package.yml stamps CI artifacts --qualification-tier PACKAGE_BUILT; DEVELOPMENT §14 states hosted results are "labeled PACKAGE_BUILT, never runtime-qualified"; ROADMAP Milestone 24 records PACKAGE_RUNTIME_QUALIFIED / UNPACKED_UPGRADE_PRESERVATION_QUALIFIED only from local executed evidence while installer lifecycle + endurance remain CI-gated/pending; .agent/state.json carries the INSTALLER_EXECUTION_SANCTIONED_ENV_ONLY boundary.

## 5. Final verification

- [x] 5.1 Full battery on final committed-source tree: npm test, test:real (classified skips only), typecheck, build, lint, `npx openspec validate --all --strict`, `git diff --check`, integrity guard, package+smoke where environment permits.
  Evidence (host L, 2026-08-28): fast 473 (470 pass, 3 host-skips); **`npm run test:real` 15 files, 60 passed / 6 classified skips, 400.8s — the first complete run of this tier**, and the run that exposed four Critical defects now repaired (FINAL-PROJECT-COMPLETION-REPORT §2A); typecheck/build/lint clean; `openspec validate --all --strict` 30/30; `git diff --check` 0; source-integrity 210/735; version:check OK. The six real-tier skips are classified: five need `wsl.exe` with a node-capable distro, one needs an authorized `ORCA_OPENCODE_QUALIFY_URL`. `package+smoke` is Windows-only and stays at its host-W verdict — "where environment permits" is satisfied honestly, not waived.

## 6. Documentation and durable state

- [x] 6.1 Correct Change-025 qualification wording wherever it overstates fresh-clone/upgrade proof; update ROADMAP/README/DEVELOPMENT/TEST-STRATEGY/OBSERVABILITY/ARCHITECTURE/SECURITY as contracts actually change.
  Evidence: qualification tiers audited again on 2026-08-28; no document claims runtime qualification from a build-only artifact. TEST-STRATEGY now records that the real-process tier is a required gate rather than an optional one, which is the wording that actually needed correcting.
- [x] 6.2 Update `.agent/state.json` (activate/close campaign with exact evidence; no stale "roadmap exhausted" waypoint while work remains).
- [ ] 6.3 Fold delta specs into `openspec/specs/`, archive the change, push, with a substantive final report.
  **Deliberately still open.** The report exists and the battery is green, but archiving asserts complete acceptance and two items are genuinely outstanding: the Tailscale phone route (`TAILSCALE_PHONE_ROUTE_EXTERNAL_UNQUALIFIED`) and the sanctioned installer lifecycle shared with Change 026. This change stays active until they are obtained.
