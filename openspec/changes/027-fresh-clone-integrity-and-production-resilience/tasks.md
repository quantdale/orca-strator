# Tasks: Fresh-clone integrity and production resilience hardening

## 1. P0 forensic Git/source-truth repair

- [x] 1.1 Inspect working tree, ignored files, index, and pushed tree together; identify every production source present locally but missing from Git (`git status --short --ignored`, `git ls-files`, `git check-ignore -v`).
- [x] 1.2 Recover suppressed runtime sources into Git: `build-identity.ts`, `paths.ts`, `singleton-lock.ts`, `readiness-service.ts`, leaf dependency `db/schema-compat.ts`, additive `packages/shared/src/product.ts` identity fields.
- [x] 1.3 Anchor `.gitignore` local-data rules (`logs/`, `runtime/`, `browser-profile/`, `.orca-local/`) to repository root; keep build-output patterns unchanged.
- [x] 1.4 Add `scripts/ci/check-source-integrity.mjs` regression guard (fails on missing / ignored / untracked import targets from tracked TS source).
- [ ] 1.5 Wire the integrity guard into ordinary gates (pretest) and Windows CI.
- [ ] 1.6 Audit remaining broad ignore patterns (`dist/`, `build/`, `out/`, etc.) for unintended suppression anywhere in the monorepo (guard provides systematic protection; record verdict).
- [ ] 1.7 P0 gate: prove from an origin-only clean worktree (no ignored rescues) that affected workspaces resolve modules and pass focused Change-025 suites + typecheck/build.

## 2. Runtime log bound

- [ ] 2.1 Packaged controller logging enforces the size bound during the running process (checked appender), preserving redaction and useful diagnostics.
- [ ] 2.2 Focused tests for rotation-during-run behavior.

## 3. Blast-radius and failure-injection audit

- [ ] 3.1 Trace controller bootstrap/config/identity/singleton/listen/shutdown, SQLite init/migration/reconciliation, watcher->dispatch->coordinator->strategy->postflight->Sol closure, executor serialization/kills/logs, browser ownership/wake/auth, scheduler leases/permissions under restart and failure injection; fix every reproducible Critical/High defect with regression evidence.

## 4. Package/upgrade truth

- [ ] 4.1 Clean-origin-only `package:win` build from committed sources; re-run real packaged-runtime smoke on the final tree (PACKAGE_RUNTIME_QUALIFIED must be re-established, not inherited).
- [ ] 4.2 Isolated synthetic-version upgrade/data-preservation exercise proving migration + data survival across versions; installer execution remains external-gated if unauthorized.
- [ ] 4.3 Keep PACKAGE_BUILT vs PACKAGE_RUNTIME_QUALIFIED labeling truthful in workflows/docs.

## 5. Final verification

- [ ] 5.1 Full battery on final committed-source tree: npm test, test:real (classified skips only), typecheck, build, lint, `npx openspec validate --all --strict`, `git diff --check`, integrity guard, package+smoke where environment permits.

## 6. Documentation and durable state

- [ ] 6.1 Correct Change-025 qualification wording wherever it overstates fresh-clone/upgrade proof; update ROADMAP/README/DEVELOPMENT/TEST-STRATEGY/OBSERVABILITY/ARCHITECTURE/SECURITY as contracts actually change.
- [ ] 6.2 Update `.agent/state.json` (activate/close campaign with exact evidence; no stale "roadmap exhausted" waypoint while work remains).
- [ ] 6.3 Fold delta specs into `openspec/specs/`, archive the change, push, confirm main == origin/main with a substantive final report.
