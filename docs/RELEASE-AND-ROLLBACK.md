# Release and rollback runbook

Status: **normative operator procedure (Change 026 §17)**

This runbook covers the six operator situations that can follow a failed or
regretted Orca-Strator install/upgrade on Windows. It is grounded in the
mechanisms this repository actually ships: typed `DATABASE_TOO_NEW` refusal
(exit 12), verified pre-migration snapshots, user state backup/restore CLIs,
the authenticated controller lifecycle endpoints, the fail-closed NSIS
safety helper, and tag-gated release provenance.

**Standing rule — old binary on new schema is unsupported.** Once a release
has migrated the durable SQLite state forward, downgrading the *binary* alone
is refused by design (`DATABASE_TOO_NEW`). Rollback therefore always pairs one
of: (a) binary-only rollback while no schema migration ran, (b) restore of a
pre-migration snapshot or user backup bundle, or (c) forward-fix. There is no
supported path that makes an older binary open a newer schema.

## Situation 1 — Install failed or partially applied

Symptoms: installer error, app missing after "successful" install, leftover
per-user entries.

1. Re-run the **same or newer** installer; NSIS per-user installs are
   idempotent and the fail-closed safety helper aborts rather than mutating
   when it cannot prove ownership/idle state.
2. If the uninstaller itself is broken, reinstall the same version first (this
   restores a working uninstaller), then proceed to Situation 2.
3. Durable state under `%LOCALAPPDATA%` (data directory) is never touched by
   install/uninstall; no data recovery is implicated here.

## Situation 2 — Bad upgrade with campaigns idle and NO schema migration

Symptoms: new build starts, misbehaves, but you know (from
`release-manifest.json` `maxDbSchemaVersion`, unchanged between versions) that
no migration has run.

1. Quit the desktop; stop the controller through the authenticated lifecycle
   path (desktop Retry/replace flow or `POST /api/system/shutdown` with the
   per-start control token from runtime-lock metadata). Never kill PIDs.
2. Uninstall the new build; install the previous known-good installer.
3. Start and verify `/api/system/identity` reports the expected previous
   version/buildId.

## Situation 3 — Bad upgrade AND schema already migrated

Symptoms: data directory contains pre-migration snapshots under
`<dataDir>/backups/pre-migration/` created during the upgrade.

The previous binary will now refuse to start (`DATABASE_TOO_NEW`) — expected.

Preferred: stay forward. Only roll back deliberately:

1. Stop the new controller via the authenticated lifecycle contract.
2. Restore the newest **verified pre-migration snapshot** as the data
   directory's SQLite image (controller stopped; copy aside the current image
   first as its own recovery copy).
3. Uninstall the new build; install the previous installer; start and verify.

Snapshots carry metadata (application version, source/target schema,
createdAt, SHA-256) so the operator can match snapshot → release exactly.
Snapshot failure blocks migration closed, so an existing upgrade either has
its snapshot or never migrated.

## Situation 4 — Database lost/corrupt after any upgrade

1. Ensure quiescence: no live controller holds the runtime lock (restore
   refuses otherwise, truthfully).
2. Create a recovery copy of the current damaged state, then use the restore
   CLI:
   `npm run restore -- --bundle <backup.zip> --data-dir <dir>` (bundle from
   `npm run backup`; manifest + checksums + entry allowlist are validated
   before any mutation).
3. Start the matching-or-newer binary only; verify repositories/run history
   and `/api/system/readiness`.

## Situation 5 — One side unhealthy after upgrade (desktop ↔ controller skew)

Symptoms: desktop startup page shows `INCOMPATIBLE_CONTROLLER`,
`DATABASE_TOO_NEW`, `RESTART_PENDING`, or `PORT_CONFLICT`.

- `RESTART_PENDING`: active campaigns are still running under the previous
  controller — wait for idle, then Retry; do not force-kill anything.
- `PORT_CONFLICT`: a foreign listener owns the port; Orca never sends control
  requests to it and never kills it. Free the port yourself or reconfigure
  `ORCA_PORT` before launching.
- `DATABASE_TOO_NEW`: install the matching newer release (or perform
  Situation 3); repeated refused startups are non-destructive by test.
- Desktop dead but controller healthy: relaunching reuses the exact-match
  controller without spawning a duplicate (single-instance + lock ownership).

## Situation 6 — A published Release itself must be withdrawn

1. Never move or delete the version tag; provenance (tag == version ==
   commit SHA, `SHA256SUMS.txt`, `release-manifest.json`) must stay auditable.
2. Publish a corrected patch release through the normal tag pipeline; mark the
   bad release as a pre-release / add a release note warning, or delete only
   the *assets* of the bad release if policy requires removal.
3. Operators who installed the bad build follow Situations 1–5 as applicable;
   auto-update remains deferred while releases are UNSIGNED, so distribution
   is always manual and auditable.

## Evidence anchors

- Downgrade refusal + exit 12: `apps/controller/src/db/schema-compat.ts`,
  `schema-downgrade-guard.test.ts`.
- Pre-migration snapshots: `apps/controller/src/db/migration-backup.ts`,
  `migration-backup.test.ts`.
- Backup/restore bundles: `scripts/backup/*.mjs`, `state-backup.test.ts`,
  `roundtrip-check.mjs`.
- Authenticated replacement/lifecycle:
  `apps/controller/src/http/routes/lifecycle.ts`,
  `lifecycle-shutdown.test.ts`, `controller-supervisor.test.ts`.
- Tag/provenance integrity: `scripts/release/verify-tag.mjs`,
  `generate-release-manifest.mjs`, `tests/release/*`.
