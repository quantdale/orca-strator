# Design: Installed release lifecycle and endurance

## Context

Change 025 established: packaged Electron shell + detached controller process
(`ELECTRON_RUN_AS_NODE` against staged controller entry), `/api/system/identity`
with `{service, version, protocol, pid}`, data-directory singleton lock
(`runtime-lock.json`, atomic O_EXCL, PID-liveness stale reclaim), desktop
`ensureController` probe→reuse/spawn state machine, and structured exit codes
10 (singleton busy) / 11 (port conflict).

The defect this change closes: `probeController()` returns "compatible" for any
Orca controller whose `protocol === ORCA_PROTOCOL_VERSION`, regardless of
version/build. After an installed upgrade this silently mixes a vA controller
with a vB desktop.

## Goals / Non-Goals

Goals:

- Deterministic packaged-mode compatibility decisions from immutable build
  identity; safe authenticated replacement; truthful quiescence.
- Fail-closed DB downgrade refusal before any service or mutation.
- Verified recovery snapshots and user backup/restore with hard exclusions.
- One canonical product version; provenance-bearing release artifacts; tag
  integrity; optional signing seam with derived truth.
- Repeatable installer/crash/endurance/stress harnesses with honest tiers.

Non-Goals:

- No automatic update installation (deferred until signing policy is ready).
- No destructive down-migrations.
- No cloud accounts, orchestration rewrite, branch-routing changes, UI redesign.
- No browser-auth/cookie backup (explicitly excluded, documented as such).

## Decisions

### D1. ControllerIdentity extension (shared contract)

```ts
interface ControllerIdentity {
  service: "orca-controller";
  version: string;
  protocol: number;
  pid: number;
  buildId?: string;          // Git commit SHA of the exact build (or CI build id)
  mode?: "packaged" | "development";
  maxSchemaVersion?: number; // highest DB schema this binary knows
}
```

New fields are optional so protocol-1 peers from Change 025 remain parseable
(no protocol bump; additive JSON). `buildId` resolution order:
`ORCA_BUILD_COMMIT` env (stamped by the packaging step from generated
`resources/build-info.json`) → repository Git SHA (dev, cached) → absent.
Wall-clock timestamps are never identity.

### D2. Compatibility verdict model (desktop-owned)

`evaluateControllerCompatibility(desktop, probed)` in shared:

| Verdict | Condition |
| --- | --- |
| `EXACT_MATCH` | same version AND equal/both-absent `buildId` |
| `COMPATIBLE_VERSION_SKEW` | Orca controller, same protocol, different version/buildId |
| `PROTOCOL_INCOMPATIBLE` | different protocol |
| `DATABASE_INCOMPATIBLE` | probed `maxSchemaVersion` > desktop-known max |
| foreign/absent | unchanged semantics |

Policy: **packaged** mode requires `EXACT_MATCH` to reuse. Any skew becomes
`RESTART_REQUIRED` (attempt safe replacement). **Development** keeps the looser
protocol-only reuse so `npm run dev` workflows are unaffected.

### D3. Authenticated graceful replacement

- The controller generates a 32-byte random token at startup and records it in
  its runtime-lock metadata (`controlToken`) — written atomically with lock
  acquisition, released with ownership. Same-user readable only by OS
  semantics of the user-profile data dir.
- Loopback-only endpoints require header `x-orca-control-token`
  (constant-time compare):
  - `GET /api/system/lifecycle` → `{state: "idle"|"active-campaigns",
    activeCampaigns:[{repositoryId,runId,loopState}], pid, version}`.
  - `POST /api/system/shutdown` (`{drain?: boolean}`) → `200` then graceful
    close (fastify close → DB close → lock release → exit 0), or `409`
    `SHUTDOWN_REFUSED_ACTIVE` with quiescence payload when campaigns are
    active and drain was not requested. Drain uses existing campaign Stop/drain
    semantics; it never discards work.
- CSRF/web-page safety: the token never appears in any HTTP response; browser
  pages cannot read local files; cross-site POSTs cannot set custom headers
  without a CORS preflight the controller never grants. Renderers get no
  bridge authority (preload unchanged).
- PID-reuse safety: the desktop never kills from lock contents. It reads the
  token + endpoint, asks THAT listener to shut down, and confirms exit via
  liveness probes + lock-file disappearance. A recycled PID that is not our
  controller cannot answer with the correct token; mismatch ⇒ refuse.
- Replacement sequence (packaged desktop, verdict ≠ EXACT_MATCH): read lock →
  lifecycle status → if `idle`: POST shutdown → wait bounded for exit+lock
  release → spawn bundled build → re-probe until EXACT_MATCH. If
  `active-campaigns` or no provable-safe path (missing/unreadable token from a
  pre-026 controller): surface truthful `RESTART_PENDING` ("background work
  continues under the previous controller") with Retry. Concurrent desktops:
  both follow the same contract; the singleton lock arbitrates the spawn race
  exactly as today (exit-code-10 re-probe).
- UX distinction preserved: window close = desktop only; campaign Stop =
  existing controls; Emergency Kill = existing; full shutdown only via the new
  authenticated contract (no generic unauthenticated endpoint exists).

### D4. Schema compatibility preflight

`migrate.ts` exports `MAX_KNOWN_SCHEMA_VERSION` and
`preflightSchemaCompatibility(db, maxKnown)` which reads
`max(schema_migrations.version)` and throws typed `DatabaseTooNewError
{currentSchema, maxKnownSchema}` when current > maxKnown. `initDatabase` calls
it immediately after open — BEFORE WAL/foreign-key pragmas, migrations, or any
service construction. `index.ts` maps the error to exit code **12** after
logging exact numbers. Desktop maps child exit code 12 to terminal state
`DATABASE_TOO_NEW` with recovery messaging (install matching/newer release or
restore a verified pre-upgrade backup). Empty DB (no table) passes; old DBs
forward-migrate normally.

### D5. Pre-migration snapshots

When `dbPath !== ":memory:"`, the DB file already exists, and pending
migration count > 0: run `VACUUM INTO '<backupDir>/pre-migration/<from>-to-<to>-<ts>.db'`
(online, consistent, dependency-free). Then verify by reopening the snapshot
read-only (`PRAGMA quick_check`) and hashing SHA-256; write sidecar
`<name>.meta.json` `{applicationVersion, sourceSchemaVersion,
targetSchemaVersion, createdAt, sha256}`. Retention keeps the newest N=5
(configurable). Snapshot failure throws `MigrationBackupFailedError` ⇒ startup
fails closed before any migration runs. Backups live only under the writable
Orca backup directory — never under app resources — and contain just the
SQLite image (no cookies/logs/repos).

### D6. State backup bundle format

Directory-based bundle (dependency-free, traversal-controlled by construction):

```
orca-backup-<appVersion>-<UTCts>/
  manifest.json   # {formatVersion:1, kind:"orca-state-backup", applicationVersion,
                  #  sourceSchemaVersion, createdAt, files:[{path:"state/orca.db", sha256, bytes}]}
  state/orca.db   # consistent VACUUM INTO image of the durable DB
```

Restore (`restoreStateBackup`): validate format/kind/version, allowlist entry
names (`^state/orca\.db$`; reject absolute paths, `..`, `\`), verify size +
SHA-256, open read-only `PRAGMA integrity_check` + schema ≤ binary max,
require the runtime lock to be absent/dead (controller quiescent) else refuse,
move live DB (+ `-wal`/`-shm`) into `pre-restore-<ts>/` recovery copy, copy
the snapshot in, reopen + verify. Exclusions are structural: the bundle writer
only ever emits the DB + manifest; cookies/profiles, executor credentials,
repository/worktree directories, locks/PIDs, and logs can never be included.
CLI seams: `scripts/backup/state-backup.mjs` / `state-restore.mjs` over built
controller modules (`npm run backup -- --data-dir … --out …`,
`npm run restore -- --bundle … --data-dir …`). Settings UI ships a minimal
Create Backup action implemented as a controller-side `POST
/api/system/backup` that writes the bundle under `<dataDir>/backups/manual/`
(the request supplies no paths, so the renderer gains no filesystem
authority; implementation refinement over the originally sketched Electron
main-process bridge — same authority boundary, and the action also works
from a browser/phone origin through the single loopback web surface). Full
in-app restore
is intentionally offline-CLI to guarantee quiescence honestly.

### D7. Versioning

Canonical source: root `package.json`. `scripts/release/set-version.mjs
<x.y.z>` validates strict semver, snapshots all targets in memory, aborts on
any invalid input BEFORE writing, then updates root + `apps/desktop`,
`apps/controller`, `packages/shared`, `apps/ui` manifests and every matching
`package-lock.json` entry atomically. `scripts/release/version-check.mjs`
fails on any drift. Wired via `pretest` and CI/release gates so ordinary
builds cannot pass with incoherent metadata. Product version stays 0.1.0 for
this change (no gratuitous bump); installer-upgrade fixtures synthesize
versions inside temporary worktree copies only.

### D8. Provenance manifest + checksums + SBOM

`scripts/release/generate-release-manifest.mjs` emits
`release-manifest.json`: productName, semver, gitSha, protocolVersion,
maxDbSchemaVersion, architecture, electronVersion, nodeVersion, signingStatus
(**derived** post-build from Authenticode via PowerShell
`Get-AuthenticodeSignature`; anything other than a valid signature ⇒
`UNSIGNED`), artifacts `[{filename, bytes, sha256}]`, qualificationTier,
sourceRepository, ci workflow/run ids when present. Also emits standard
`SHA256SUMS.txt` and CycloneDX SBOM via `npm sbom --sbom-format cyclonedx`.
No secrets or machine-local paths are serialized. The controller packages the
same gitSha (`build-info.json` → `ORCA_BUILD_COMMIT`) so `/api/system/identity`
correlates 1:1 with the manifest.

### D9. Tag integrity + release pipeline

`scripts/release/verify-tag.mjs <tag>`: tag must be `vX.Y.Z` exactly equal to
canonical version, tree clean, lockfile coherent — otherwise non-zero exit.
`windows-package.yml` gains: verify-tag gate on tags, release gates (version
check, fast tests, typecheck, lint), installer acceptance job on the ephemeral
windows-latest runner (silent install into per-job temp dirs, isolated data
dir/port, fixture repos; report uploaded as artifact), then a least-privilege
publish job (`permissions: contents: write` on that job only) that creates the
GitHub Release with gh CLI and attaches installer + checksums + manifest +
SBOM. Ordinary push/PR CI can never publish releases. Signing seam: standard
electron-builder env credentials (`CSC_LINK`, `CSC_KEY_PASSWORD`) documented;
absent credentials keep everything cleanly UNSIGNED; a configured-but-failed
signature fails the job rather than publishing mislabeled artifacts.

### D10. Qualification tiers (vocabulary)

`RELEASE_PIPELINE_QUALIFIED`, `INSTALLER_LIFECYCLE_QUALIFIED`,
`PACKAGED_CRASH_RECOVERY_QUALIFIED`, `PACKAGED_ENDURANCE_QUALIFIED`
(short-mode evidence alone never earns this),
`BACKUP_RESTORE_QUALIFIED`, plus persistent honest negatives
(`CODE_SIGNING_UNQUALIFIED`, `TAILSCALE_PHONE_ROUTE_UNQUALIFIED`,
`OPENCODE_EXTERNAL_UNQUALIFIED`, and `INSTALLER_EXECUTION_UNQUALIFIED`
wherever actual installer execution has not been evidenced).

## Risks / Trade-offs

- Optional identity fields mean a vA (025) controller reports no `buildId`;
  packaged vB treats absence-with-version-mismatch as skew (restart path) and
  absence-with-same-version as exact match (upgrade-in-place rebuild case) —
  deterministic either way.
- `VACUUM INTO` needs free disk ≈ DB size; retention bounds accumulation and
  the guard fails closed rather than migrating unprotected.
- Directory bundles instead of ZIP avoid introducing an archive dependency and
  eliminate zip-slip classes structurally; trade-off is a folder instead of a
  single file, mitigated by the manifest being machine-checkable.
- Installer NSIS customization is kept minimal and fail-safe: when safe
  shutdown cannot be proven, upgrade/uninstall aborts with guidance instead of
  killing processes.

## Migration Plan

No schema migrations required by this change (`MAX_KNOWN_SCHEMA_VERSION`
stays 23 unless implementation proves one necessary). All new behavior is
additive; protocol stays 1.

## Open Questions

None blocking. Installer-execution authorization remains an external input
governing only the qualification tier label, not the implementation.
