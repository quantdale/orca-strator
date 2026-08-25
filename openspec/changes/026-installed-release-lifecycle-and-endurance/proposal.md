# Proposal: Installed release lifecycle and endurance

## Why

Change 025 delivered a Windows product that launches and is
PACKAGE_RUNTIME_QUALIFIED, but it deliberately left two hazards open:

1. **Mixed-version controller reuse.** A packaged desktop treats any live
   controller with a matching `protocol` as reusable. After an installed
   upgrade (vA controller still alive + vB desktop launched), vB silently
   reuses the vA controller because only the protocol number is compared.
   Build identity (`identity.version`) is parsed but never used for reuse
   decisions.
2. **No safe replacement path.** There is no controller-owned way for a new
   desktop release to replace an old controller; the only options are silent
   reuse or refusing to start.

Additionally, an installed daily-driver product needs: DB downgrade refusal,
pre-migration recovery snapshots, user backup/recovery, single-source release
versioning, provenance-bearing release artifacts, a real installer acceptance
harness, packaged crash/endurance qualification, and an honest rollback story.
None of these exist today.

This change turns Orca-Strator from "a package that launches" into "a Windows
application whose upgrades and long-running installed operation are safe".

## What Changes

- **Build/controller compatibility contract**: `ControllerIdentity` gains
  immutable build identity (`buildId` Git SHA, `mode` packaged|development,
  `maxSchemaVersion`). The desktop evaluates an explicit verdict model
  (`EXACT_MATCH`, `COMPATIBLE_VERSION_SKEW`, `RESTART_REQUIRED`,
  `PROTOCOL_INCOMPATIBLE`, `DATABASE_INCOMPATIBLE`). Packaged desktops no
  longer silently reuse a different build.
- **Authenticated graceful controller replacement**: the controller publishes
  a random control token into its runtime-lock metadata and exposes token-
  authenticated loopback-only lifecycle endpoints (`GET /api/system/lifecycle`,
  `POST /api/system/shutdown`) that report truthful quiescence
  (idle / active-campaigns / refused). The desktop replaces a mismatched
  controller only via this contract: request shutdown when idle, wait for real
  process exit + lock release, then spawn its bundled build. Active campaigns
  produce a truthful `RESTART_PENDING` state instead of termination. Renderers
  and web pages receive no process-control authority.
- **DB forward-compatibility guard**: a strict preflight refuses startup
  (typed `DATABASE_TOO_NEW`, structured exit code 12) when the on-disk schema
  is newer than the binary knows, before migrations/watchers/browser/executors
  run and without mutating the database.
- **Pre-migration safety snapshots**: before applying pending migrations in a
  persistent data directory, create a verified consistent snapshot (SQLite
  `VACUUM INTO`) with metadata + SHA-256 under `<dataDir>/backups/`, bounded
  retention; backup failure fails the migration closed.
- **User state backup/recovery**: dependency-free backup bundle format
  (manifest + checksummed payload) covering durable SQLite state and product/
  schema metadata only — explicitly excluding cookies/profiles, credentials,
  repositories, worktrees, locks, and logs — with a validated restore path
  that requires controller quiescence and preserves prior state as a recovery
  copy; deterministic CLI seams.
- **Single-source versioning**: root `package.json` becomes the canonical
  product version; `npm run version:check` asserts coherence across all
  manifests + lockfile; `npm run release:prepare -- <semver>` updates them in
  one atomic validated pass; build gates check coherence.
- **Release provenance**: machine-readable `release-manifest.json`
  (version, Git SHA, protocol, max DB schema, arch, Electron/Node versions,
  truthful signing status derived from actual Authenticode result, artifact
  hashes/sizes), standard `SHA256SUMS.txt`, npm-generated CycloneDX SBOM.
- **Tag/release pipeline integrity**: tag/version mismatch fails the release;
  GitHub Releases publication with least-privilege `contents:write`; optional
  code-signing seam that stays cleanly disabled and truthfully UNSIGNED
  without credentials; no auto-updater while releases are unsigned.
- **Installed-lifecycle qualification harnesses**: repeatable NSIS install /
  close-reopen / upgrade / uninstall / reinstall acceptance (isolated dirs,
  isolated data dir/port, fixture repos, synthetic versions in temporary
  worktrees), packaged crash-recovery, endurance/soak (short CI-safe + long
  local modes), multi-repository stress, and SQLite integrity checks — with
  honest qualification-tier vocabulary.

## Capabilities

### New: `installed-release-lifecycle`

Covers build identity/compatibility verdicts, authenticated replacement and
quiescence, downgrade refusal, pre-migration snapshots, state backup/restore,
versioning coherence, provenance manifests, tag integrity, signing truth, and
rollback policy.

### New: `installed-qualification-harnesses`

Covers installer lifecycle acceptance, install/uninstall controller safety,
packaged crash recovery, endurance/soak, multi-repo stress, and DB integrity
qualification with explicit qualification tiers.

## Impact

- Code: `packages/shared` (identity/product contracts), `apps/desktop`
  (supervisor replacement flow, states), `apps/controller` (identity,
  lifecycle routes, schema guard, snapshots, backup module), packaging/release
  scripts, GitHub workflows, docs.
- No changes to V1 orchestration semantics; watchers/executors/Sol loops are
  consumers of the new guards, not redesign targets.
- Honest external blockers preserved: code signing certificate absent,
  Tailscale elevation, authorized OpenCode URL. Installer execution on this
  host remains gated to isolated/sanctioned environments; local execution is
  not performed unless explicitly authorized.
