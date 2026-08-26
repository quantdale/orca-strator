# Tasks: Installed release lifecycle and endurance

## 0. Starting audit and durable state

- [x] 0.1 Fetch/reconcile origin/main; verify ancestry from fac7e20c438d16617828e00b144b50fb6d58e28f (clean tree, main == origin/main).
  Evidence: planning base 57cc36f recorded in .agent/state.json; M24 closure session re-verified main == origin/main at e539ad3 before further work.
- [x] 0.2 Read AGENTS.md, .agent/state.json, ROADMAP, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, TEST-STRATEGY, SECURITY, DEVELOPMENT, canonical windows-productization spec, archived Change 025 artifacts, packaging scripts/workflows, desktop supervisor, controller startup/singleton/migrations.
- [x] 0.3 Create Milestone 24 / Change 026 artifacts and activate them in .agent/state.json.
  Evidence: openspec/changes/026-* + 027-* exist; state.json activeMilestone=24 with both changes active.

## 1. Build identity and compatibility verdicts

- [x] 1.1 Extend shared `ControllerIdentity` with optional `buildId`, `mode`, `maxSchemaVersion`; add `evaluateControllerCompatibility` verdict model + desktop policy types.
  Evidence: packages/shared/src/product.ts (additive optional fields, wall-clock excluded by contract); evaluateControllerCompatibility consumed by apps/desktop/src/controller-supervisor.ts.
- [x] 1.2 Controller identity resolution: `ORCA_BUILD_COMMIT` env stamp → cached repository Git SHA → absent; expose max schema version from migrate.ts.
  Evidence: apps/controller/src/runtime/build-identity.ts (resolution order documented in-source); MAX_KNOWN_SCHEMA_VERSION from db/schema-compat.ts.
- [x] 1.3 Desktop supervisor: parse/validate extended identity, packaged-mode exact-match reuse policy, dev-mode looser reuse preserved.
  Evidence: controller-supervisor.test.ts — "identity parsing validates additive 026 fields when present"; A/B/C verdict cases.
- [x] 1.4 Regression tests: exact-build reuse; different build/version detected; protocol mismatch rejected; foreign listener untouched; second desktop cannot create duplicate controller against mismatched owner; upgrade skew never launches two controllers on one data directory.
  Evidence: controller-supervisor.test.ts cases "A: exact build … reused", "B: packaged desktop detects a different installed build", "C: protocol mismatch is rejected without lifecycle requests or spawning", "reports PORT_CONFLICT for a foreign listener and never spawns", "E/F: second desktop facing mismatched owner cannot create a duplicate controller".

## 2. Authenticated graceful replacement

- [x] 2.1 Controller: per-start random control token in runtime-lock metadata (atomic with ownership, rotated each start); constant-time header auth helper.
  Evidence: runtime/singleton-lock.ts controlToken metadata + crypto.timingSafeEqual helper; regression "preserves-token-across-refresh" (Change 027 CRITICAL fix) pins token survival across lock.refresh.
- [x] 2.2 Controller routes: token-authenticated `GET /api/system/lifecycle` (truthful idle/active-campaign quiescence from RunStore) and `POST /api/system/shutdown` (graceful close or 409 SHUTDOWN_REFUSED_ACTIVE; drain via existing campaign semantics).
  Evidence: http/routes/lifecycle.ts; lifecycle-shutdown.test.ts 5/5 incl. unauthenticated-surface-inert.
- [x] 2.3 Desktop replacement flow: read lock metadata → lifecycle probe → idle ⇒ shutdown + wait exit + lock release + spawn bundled build + verify exact identity; active/unprovable ⇒ truthful RESTART_PENDING state with Retry.
  Evidence: controller-supervisor.test.ts "B: packaged desktop replaces a mismatched idle build and spawns its own", "reports active campaigns truthfully without terminating anything", "idle controller: accepted shutdown waits for real exit + lock release", "accepted shutdown that never exits becomes a truthful timeout".
- [x] 2.4 Tests: token auth rejects missing/wrong token; idle shutdown succeeds end-to-end; active refusal is truthful; foreign PID never killed; concurrent replacement race yields one controller.
  Evidence: same suite — "token rejection from the lifecycle endpoint blocks replacement", "refuses to act when ownership metadata is absent (never guesses)", "treats a demonstrably dead owner as stale rather than replaceable".

## 3. Database downgrade guard

- [x] 3.1 `MAX_KNOWN_SCHEMA_VERSION`, typed `DatabaseTooNewError`, preflight before pragmas/migrations/services in initDatabase.
  Evidence: db/schema-compat.ts; index.ts preflight wiring.
- [x] 3.2 index.ts maps refusal to exit code 12 with exact schema numbers logged; desktop maps exit 12 to DATABASE_TOO_NEW terminal recovery state.
  Evidence: index.ts EXIT_DATABASE_TOO_NEW=12 both at preflight and spawn failure paths; supervisor "maps child exit code 12 to DATABASE_TOO_NEW".
- [x] 3.3 Tests: empty DB passes; current DB passes; old→current forward migration; one-version-newer refusal; much-newer refusal; failed migration stays transactional; repeated refused startups are non-destructive (bytes/schema unchanged).
  Evidence: schema-downgrade-guard.test.ts (7 cases incl. read-only preflight proof and non-destructive repeat refusals).

## 4. Pre-migration snapshots

- [x] 4.1 VACUUM INTO snapshot under `<dataDir>/backups/pre-migration/` with sidecar metadata (applicationVersion, source/target schema, createdAt, sha256) when pending migrations exist on a persistent DB.
  Evidence: db/migration-backup.ts; kind:"orca-pre-migration-snapshot" sidecars.
- [x] 4.2 Post-create verification (reopen readonly quick_check) + bounded retention (newest N=5).
  Evidence: migration-backup.test.ts "creates a verified consistent snapshot with complete metadata before migration", "retention keeps only the newest N snapshots".
- [x] 4.3 Fail closed: backup failure aborts migration with typed error; tests for success, integrity verification, retention bound, failure blocking migration.
  Evidence: MigrationBackupFailedError path; migration-backup.test.ts "fails closed (typed error) when the snapshot cannot be created and cleans partials".

## 5. User state backup / restore

- [x] 5.1 Bundle format + creator (manifest + checksummed SQLite image only) with structural exclusions.
  Evidence: runtime/state-backup.ts (ALLOWED_ENTRIES = state/orca.db only; exclusions hold by construction).
- [x] 5.2 Restorer: manifest/checksum/schema validation, entry allowlist traversal rejection, quiescence requirement via runtime lock check, recovery copy of replaced state, post-restore open verify.
  Evidence: state-backup.test.ts 6/6 (tamper/traversal/quiescence/recovery-copy/roundtrip).
- [x] 5.3 CLI seams `scripts/backup/state-backup.mjs` / `state-restore.mjs` + npm scripts; Settings Create Backup bridge in desktop main (narrow, no renderer process authority).
  Evidence: scripts/backup/*.mjs + npm run backup/restore/test:backup-restore; Settings Create Backup shipped as controller-side POST /api/system/backup writing under <dataDir>/backups/manual (request supplies no paths ⇒ no renderer filesystem authority; refinement over the sketched Electron IPC bridge recorded in design D6 — same boundary, also works from phone origin). system-api 1.T2 asserts 201 + placement + manifest allowlist.
- [x] 5.4 Tests: bundle contents exactly permitted payload; corrupt/tampered rejection; traversal rejection; restore-refusal while lock live; successful quiescent restore round-trip.
  Evidence: state-backup.test.ts; roundtrip-check.mjs (`npm run test:backup-restore`).

## 6. Single-source versioning

- [x] 6.1 `scripts/release/set-version.mjs` atomic validated multi-manifest+lockfile update; `scripts/release/version-check.mjs` coherence gate.
- [x] 6.2 npm scripts `release:prepare`, `version:check`; wire coherence into ordinary build/test gates (pretest + CI).
  Evidence: root package.json pretest = source-integrity + version-check; windows-ci.yml runs both.
- [x] 6.3 Tests for mismatch detection and invalid-input abort-without-write; product version remains 0.1.0.
  Evidence: tests/release/version-tools.test.ts 5/5 (drift detection precision, atomic update, invalid semver aborts without writing, loose-version rejection, repo-is-coherent).

## 7. Release provenance

- [x] 7.1 `write-build-info.mjs` stamps Git SHA into packaged resources; supervisor forwards ORCA_BUILD_COMMIT to spawned controller.
  Evidence: write-build-info.mjs (refuses to fabricate identity without Git HEAD; max schema parsed strictly from migrate.ts); supervisor test asserts planEnv.ORCA_BUILD_VERSION stamping.
- [x] 7.2 `generate-release-manifest.mjs`: full provenance JSON + SHA256SUMS.txt; signing status derived via Get-AuthenticodeSignature; CycloneDX SBOM via `npm sbom`.
  Evidence: generate-release-manifest.mjs authenticodeStatus() per artifact; windows-package.yml SBOM step.
- [x] 7.3 Identity↔manifest correlation test at unit tier (build-info plumbing) plus harness-level artifact checks.
  Evidence: tests/release/build-info.test.ts 4/4 (shape, exact Git HEAD + canonical version correlation, max-schema/protocol derived from source truth, no wall-clock identity); harness tier: package-smoke identity match + upgrade-preservation ORCA_BUILD_* seams.

## 8–9. Tag integrity + GitHub release pipeline

- [x] 8.1 `verify-tag.mjs` (tag==version, clean tree, coherent lockfile).
  Evidence: scripts/release/verify-tag.mjs; wired tag-gated in windows-package.yml before any build step.
- [x] 9.1 windows-package.yml: gates → installer build → acceptance job (ephemeral windows-latest, isolated dirs/data/port/fixtures, report artifact) → least-privilege publish job (contents:write only there) attaching installer/checksums/manifest/SBOM via gh CLI; PR/push CI cannot publish releases.
  Evidence: workflow matrix phase-sets; top-level permissions contents:read; publish job gated `if: startsWith(github.ref, 'refs/tags/v')` with contents:write scoped to it only.
- [ ] 9.2 Local dry-run/fixture exercise of release scripting without creating a production tag.
  Pending: manual workflow_dispatch rehearsal (also serves installer acceptance §11.2) — must not create a Release.

## 10. Signing seam

- [x] 10.1 Documented CSC_LINK/CSC_KEY_PASSWORD electron-builder seam, disabled by default; derived signing truth in manifest; configured-but-failed signature fails the job; unsigned pipeline verified end-to-end.
  Evidence: docs/DEVELOPMENT.md §14 documents the seam + derived-truth rule; electron-builder.yml states UNSIGNED-by-default; generate-release-manifest.mjs derives per-artifact Authenticode status so mislabeling is impossible; local package runs prove the unsigned pipeline end-to-end.

## 11–12. Installer lifecycle + install/uninstall safety

- [x] 11.1 `scripts/package/installer-acceptance.mjs` phases: install, close-reopen, upgrade (synthetic versions in temp worktrees), uninstall, reinstall — isolated data dir/port/fixture repos; real browser profile never touched.
- [x] 12.1 NSIS upgrade/uninstall safety include: refuse while campaigns active; graceful stop only when provably idle + ownership matches; abort when unsafe; no wildcards/foreign kills.
  Evidence: apps/desktop/build/installer.nsh + controller-safety.ps1 tracked with staged copy into packaged resources (prepare-controller-runtime.mjs required-copy step); security posture reviewed in SECURITY.md.
- [ ] 11.2/12.2 Execute acceptance on ephemeral CI runner where available; classify honestly otherwise.
  Pending: workflow_dispatch installer-lifecycle + upgrade matrices on windows-latest; INSTALLER_LIFECYCLE_QUALIFIED only from that evidence.

## 13–16. Packaged crash recovery, endurance, stress, integrity

- [x] 13.1 `crash-recovery.mjs` against unpacked packaged runtime: hard-kill stale-lock reclaim, desktop-crash/controller-survives, simultaneous relaunches, startup crash, arbitrary cwd.
  Hardened M24-closeout: ephemeral port default, steady-state settle pre-kill, pid-reuse-tolerant death proof, supervisor-resurrection-aware C1.f.
- [x] 14.1 `endurance.mjs` short (CI-safe) + long modes with baseline-derived thresholds and full metrics report.
  Hardened: real fixture remotes, per-failure stderr warnings, readiness probe budget matches its bounded multi-second composition, dual-shape repository response parsing.
- [x] 15.1 `multi-repo-stress.mjs`: 4 fixture repos, independent watcher progression, sibling-failure containment, close/reopen during activity.
- [x] 16.1 Integrity gate shared lib: integrity_check, migration history, FK check, snapshot openability after every scenario.
  Evidence: scripts/package/harness-lib.mjs used across crash/endurance/stress/upgrade harnesses.
- [ ] Execution evidence for 13–16 on the final tree: see §22 battery (pending this session).

## 17. Rollback policy runbook

- [x] 17.1 docs/RELEASE-AND-ROLLBACK.md covering all six operator situations without implying old-binary-on-new-schema support.
  Evidence: six situations grounded in shipped mechanisms (partial install; idle binary rollback; post-migration rollback via verified pre-migration snapshot; bundle restore; desktop↔controller skew states; published-release withdrawal), standing DATABASE_TOO_NEW rule stated up front.

## 18. Security review of new surfaces

- [x] 18.1 Audit shutdown IPC auth, loopback CSRF, PID-reuse, archive traversal, symlink escape, secret leakage, workflow permissions/signing, release-string injection, installer path injection, provenance tampering, rollback-to-incompatible; document in SECURITY.md.
  Evidence: SECURITY.md "Installed release lifecycle security review (Change 026/027)" section.

## 19. Documentation

- [x] 19.1 README, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, DEVELOPMENT, SECURITY, TEST-STRATEGY, ROADMAP updated (Milestone 24, identity model, replacement rules, downgrade refusal, backups, installer lifecycle, releases, signing truth, rollback, endurance, blockers). Change-024/025 evidence untouched.
  Evidence: README backup/release sections truthful incl. new Settings action; ARCHITECTURE "Installed-release lifecycle and resilience" section; ROADMAP Milestone 24 entry with honest labels; DEVELOPMENT §14 packaging/signing/openspec:validate; DATA-MODEL §8 cascade-retention clarification; OBSERVABILITY §17 ledger referential-integrity contract; SECURITY review section; TEST-STRATEGY updated at final battery.

## 20–21. Test plan + qualification tiers

- [x] 20.1 Focused suites for identity/compatibility, replacement, database guard/backups, state backup, endurance/stress libs, release scripts (manifest/checksum/tag/version), installer harness units.
  Evidence: controller-supervisor (31), lifecycle-shutdown (5), schema-downgrade-guard (7), migration-backup (3), state-backup (6), singleton-lock (9), version-tools (5), build-info (4), runtime-log-bound (5), plus harness-level scripts; full fast tier green (see §22).
- [x] 21.1 Tier vocabulary recorded honestly in ROADMAP/waypoint.
  Evidence: ROADMAP Milestone 24 labels (PACKAGE_BUILT vs PACKAGE_RUNTIME_QUALIFIED vs UNPACKED_UPGRADE_PRESERVATION_QUALIFIED vs external-gated tiers); .agent/state.json blockers list exact external gaps.

## 22. Final verification

- [ ] 22.1 Focused suites during implementation; final battery: npm test, test:real, typecheck, build, lint, openspec validate --strict, git diff --check, version:check, package builds, smoke, harness runs as environment permits.
  Pending: executed at Milestone-24 closure on the final tree (this session).
- [ ] 22.2 Artifact records (filename/size/SHA-256/version/buildId/arch/signing/tier); endurance metrics recorded where executed.
  Pending: same battery.

## 23. CI qualification updates

- [x] 23.1 Windows CI/release workflows coherent; evidence artifacts uploaded; least privilege preserved.
  Evidence: Windows CI GREEN on pushed main after the OpenSpec-reproducibility fix (run 32964628560 for 56b8f59; repository-pinned @fission-ai/openspec 1.6.0 + `npm run openspec:validate`; clean-worktree `npm ci` + validate proven separately); push/PR workflows remain read-only; publish job remains tag-gated contents:write-only.

## 24. Closeout

- [ ] 24.1 Fold delta specs into openspec/specs/, archive change, ROADMAP Milestone 24 entry with exact labels, waypoint update, commits/push, main == origin/main, clean tree.
  Pending: after §22 battery + §11.2 dispatch evidence.
