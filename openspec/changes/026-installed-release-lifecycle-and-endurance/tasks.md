# Tasks: Installed release lifecycle and endurance

## 0. Starting audit and durable state

- [ ] 0.1 Fetch/reconcile origin/main; verify ancestry from fac7e20c438d16617828e00b144b50fb6d58e28f (clean tree, main == origin/main).
- [ ] 0.2 Read AGENTS.md, .agent/state.json, ROADMAP, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, TEST-STRATEGY, SECURITY, DEVELOPMENT, canonical windows-productization spec, archived Change 025 artifacts, packaging scripts/workflows, desktop supervisor, controller startup/singleton/migrations.
- [ ] 0.3 Create Milestone 24 / Change 026 artifacts and activate them in .agent/state.json.

## 1. Build identity and compatibility verdicts

- [ ] 1.1 Extend shared `ControllerIdentity` with optional `buildId`, `mode`, `maxSchemaVersion`; add `evaluateControllerCompatibility` verdict model + desktop policy types.
- [ ] 1.2 Controller identity resolution: `ORCA_BUILD_COMMIT` env stamp → cached repository Git SHA → absent; expose max schema version from migrate.ts.
- [ ] 1.3 Desktop supervisor: parse/validate extended identity, packaged-mode exact-match reuse policy, dev-mode looser reuse preserved.
- [ ] 1.4 Regression tests: exact-build reuse; different build/version detected; protocol mismatch rejected; foreign listener untouched; second desktop cannot create duplicate controller against mismatched owner; upgrade skew never launches two controllers on one data directory.

## 2. Authenticated graceful replacement

- [ ] 2.1 Controller: per-start random control token in runtime-lock metadata (atomic with ownership, rotated each start); constant-time header auth helper.
- [ ] 2.2 Controller routes: token-authenticated `GET /api/system/lifecycle` (truthful idle/active-campaign quiescence from RunStore) and `POST /api/system/shutdown` (graceful close or 409 SHUTDOWN_REFUSED_ACTIVE; drain via existing campaign semantics).
- [ ] 2.3 Desktop replacement flow: read lock metadata → lifecycle probe → idle ⇒ shutdown + wait exit + lock release + spawn bundled build + verify exact identity; active/unprovable ⇒ truthful RESTART_PENDING state with Retry.
- [ ] 2.4 Tests: token auth rejects missing/wrong token; idle shutdown succeeds end-to-end; active refusal is truthful; foreign PID never killed; concurrent replacement race yields one controller.

## 3. Database downgrade guard

- [ ] 3.1 `MAX_KNOWN_SCHEMA_VERSION`, typed `DatabaseTooNewError`, preflight before pragmas/migrations/services in initDatabase.
- [ ] 3.2 index.ts maps refusal to exit code 12 with exact schema numbers logged; desktop maps exit 12 to DATABASE_TOO_NEW terminal recovery state.
- [ ] 3.3 Tests: empty DB passes; current DB passes; old→current forward migration; one-version-newer refusal; much-newer refusal; failed migration stays transactional; repeated refused startups are non-destructive (bytes/schema unchanged).

## 4. Pre-migration snapshots

- [ ] 4.1 VACUUM INTO snapshot under `<dataDir>/backups/pre-migration/` with sidecar metadata (applicationVersion, source/target schema, createdAt, sha256) when pending migrations exist on a persistent DB.
- [ ] 4.2 Post-create verification (reopen readonly quick_check) + bounded retention (newest N=5).
- [ ] 4.3 Fail closed: backup failure aborts migration with typed error; tests for success, integrity verification, retention bound, failure blocking migration.

## 5. User state backup / restore

- [ ] 5.1 Bundle format + creator (manifest + checksummed SQLite image only) with structural exclusions.
- [ ] 5.2 Restorer: manifest/checksum/schema validation, entry allowlist traversal rejection, quiescence requirement via runtime lock check, recovery copy of replaced state, post-restore open verify.
- [ ] 5.3 CLI seams `scripts/backup/state-backup.mjs` / `state-restore.mjs` + npm scripts; Settings Create Backup bridge in desktop main (narrow, no renderer process authority).
- [ ] 5.4 Tests: bundle contents exactly permitted payload; corrupt/tampered rejection; traversal rejection; restore-refusal while lock live; successful quiescent restore round-trip.

## 6. Single-source versioning

- [ ] 6.1 `scripts/release/set-version.mjs` atomic validated multi-manifest+lockfile update; `scripts/release/version-check.mjs` coherence gate.
- [ ] 6.2 npm scripts `release:prepare`, `version:check`; wire coherence into ordinary build/test gates (pretest + CI).
- [ ] 6.3 Tests for mismatch detection and invalid-input abort-without-write; product version remains 0.1.0.

## 7. Release provenance

- [ ] 7.1 `write-build-info.mjs` stamps Git SHA into packaged resources; supervisor forwards ORCA_BUILD_COMMIT to spawned controller.
- [ ] 7.2 `generate-release-manifest.mjs`: full provenance JSON + SHA256SUMS.txt; signing status derived via Get-AuthenticodeSignature; CycloneDX SBOM via `npm sbom`.
- [ ] 7.3 Identity↔manifest correlation test at unit tier (build-info plumbing) plus harness-level artifact checks.

## 8–9. Tag integrity + GitHub release pipeline

- [ ] 8.1 `verify-tag.mjs` (tag==version, clean tree, coherent lockfile).
- [ ] 9.1 windows-package.yml: gates → installer build → acceptance job (ephemeral windows-latest, isolated dirs/data/port/fixtures, report artifact) → least-privilege publish job (contents:write only there) attaching installer/checksums/manifest/SBOM via gh CLI; PR/push CI cannot publish releases.
- [ ] 9.2 Local dry-run/fixture exercise of release scripting without creating a production tag.

## 10. Signing seam

- [ ] 10.1 Documented CSC_LINK/CSC_KEY_PASSWORD electron-builder seam, disabled by default; derived signing truth in manifest; configured-but-failed signature fails the job; unsigned pipeline verified end-to-end.

## 11–12. Installer lifecycle + install/uninstall safety

- [ ] 11.1 `scripts/package/installer-acceptance.mjs` phases: install, close-reopen, upgrade (synthetic versions in temp worktrees), uninstall, reinstall — isolated data dir/port/fixture repos; real browser profile never touched.
- [ ] 12.1 NSIS upgrade/uninstall safety include: refuse while campaigns active; graceful stop only when provably idle + ownership matches; abort when unsafe; no wildcards/foreign kills.
- [ ] 11.2/12.2 Execute acceptance on ephemeral CI runner where available; classify honestly otherwise.

## 13–16. Packaged crash recovery, endurance, stress, integrity

- [ ] 13.1 `crash-recovery.mjs` against unpacked packaged runtime: hard-kill stale-lock reclaim, desktop-crash/controller-survives, simultaneous relaunches, startup crash, arbitrary cwd.
- [ ] 14.1 `endurance.mjs` short (CI-safe) + long modes with baseline-derived thresholds and full metrics report.
- [ ] 15.1 `multi-repo-stress.mjs`: 4 fixture repos, independent watcher progression, sibling-failure containment, close/reopen during activity.
- [ ] 16.1 Integrity gate shared lib: integrity_check, migration history, FK check, snapshot openability after every scenario.

## 17. Rollback policy runbook

- [ ] 17.1 docs/RELEASE-AND-ROLLBACK.md covering all six operator situations without implying old-binary-on-new-schema support.

## 18. Security review of new surfaces

- [ ] 18.1 Audit shutdown IPC auth, loopback CSRF, PID-reuse, archive traversal, symlink escape, secret leakage, workflow permissions/signing, release-string injection, installer path injection, provenance tampering, rollback-to-incompatible; document in SECURITY.md.

## 19. Documentation

- [ ] 19.1 README, ARCHITECTURE, RUNTIME-MODEL, DATA-MODEL, DEVELOPMENT, SECURITY, TEST-STRATEGY, ROADMAP updated (Milestone 24, identity model, replacement rules, downgrade refusal, backups, installer lifecycle, releases, signing truth, rollback, endurance, blockers). Change-024/025 evidence untouched.

## 20–21. Test plan + qualification tiers

- [ ] 20.1 Focused suites for identity/compatibility, replacement, database guard/backups, state backup, endurance/stress libs, release scripts (manifest/checksum/tag/version), installer harness units.
- [ ] 21.1 Tier vocabulary recorded honestly in ROADMAP/waypoint.

## 22. Final verification

- [ ] 22.1 Focused suites during implementation; final battery: npm test, test:real, typecheck, build, lint, openspec validate --strict, git diff --check, version:check, package builds, smoke, harness runs as environment permits.
- [ ] 22.2 Artifact records (filename/size/SHA-256/version/buildId/arch/signing/tier); endurance metrics recorded where executed.

## 23. CI qualification updates

- [ ] 23.1 Windows CI/release workflows coherent; evidence artifacts uploaded; least privilege preserved.

## 24. Closeout

- [ ] 24.1 Fold delta specs into openspec/specs/, archive change, ROADMAP Milestone 24 entry with exact labels, waypoint update, commits/push, main == origin/main, clean tree.
