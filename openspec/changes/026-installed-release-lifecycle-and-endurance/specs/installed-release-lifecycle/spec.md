# Delta: installed-release-lifecycle

## ADDED Requirements

### Requirement: Exact-build controller compatibility contract

A packaged desktop SHALL treat a running Orca controller as reusable only when
the controller's immutable build identity (product semantic version AND build
identity such as Git commit SHA) exactly matches the desktop's own build.
ControllerIdentity SHALL carry product version, controller protocol version,
build identity, packaged/development mode, and the maximum database schema
version known by the binary. Wall-clock timestamps SHALL NOT be used as build
identity. A packaged desktop encountering a different installed build SHALL
deterministically refuse silent reuse and enter the replacement or pending
flow. Development mode MAY retain looser protocol-only reuse.

#### Scenario: Exact build is reused without spawning

- **GIVEN** a live controller whose version and buildId exactly match the desktop
- **WHEN** the desktop probes `/api/system/identity`
- **THEN** the verdict is EXACT_MATCH, no new controller is spawned, and the existing PID is kept

#### Scenario: Different installed build is detected rather than mixed

- **GIVEN** a live controller from a different version or commit than the packaged desktop
- **WHEN** the desktop probes it in packaged mode
- **THEN** reuse is refused with an explicit skew/restart-required outcome instead of connecting

#### Scenario: Protocol mismatch is rejected

- **GIVEN** a controller reporting a different protocol number
- **WHEN** probed by any desktop
- **THEN** the outcome is PROTOCOL_INCOMPATIBLE and no reuse, replacement request, or spawn against the same data directory occurs

#### Scenario: Foreign HTTP listener remains untouched

- **GIVEN** a non-Orca HTTP service occupies the configured port
- **WHEN** the desktop starts
- **THEN** Orca reports a port conflict and never sends lifecycle control requests to that listener

#### Scenario: Second desktop cannot convert a mismatch into a duplicate

- **GIVEN** a mismatched controller owning the data directory and two desktops launching concurrently
- **WHEN** both evaluate compatibility and attempt resolution
- **THEN** at most one controller owns the data directory and neither desktop ends up connected to two controllers simultaneously

### Requirement: Authenticated graceful controller replacement

The controller SHALL expose a graceful shutdown/lifecycle capability usable
only by trusted same-user desktop main-process operations: requests SHALL
require a per-start random control token that is never served over HTTP,
SHOULD be loopback-only, and MUST be verified before any shutdown action.
Renderer JavaScript SHALL NOT receive process-control authority, arbitrary web
pages SHALL NOT be able to terminate Orca, no unauthenticated generic shutdown
endpoint SHALL exist, and no process SHALL be killed merely because runtime
lock metadata mentions its PID. The lifecycle capability SHALL report truthful
quiescence: idle, active campaigns present (with safe per-repository
summaries), draining/shutting down, or shutdown refused.

#### Scenario: Idle controller is replaced safely on upgrade

- **GIVEN** an idle mismatched controller with valid control token metadata
- **WHEN** a newer packaged desktop performs replacement
- **THEN** it requests graceful shutdown, observes real process exit plus lock release, spawns its bundled build, and verifies exact identity before loading normal UI

#### Scenario: Active campaigns block termination truthfully

- **GIVEN** a mismatched controller with active campaigns
- **WHEN** replacement is attempted without drain consent
- **THEN** shutdown is refused, the desktop surfaces a restart-pending state explaining background work continues under the previous controller, no second controller is started against the same data directory, and retry succeeds once idle

#### Scenario: Unauthenticated shutdown is impossible

- **WHEN** any caller invokes the shutdown endpoint without the current control token
- **THEN** the request is rejected and the controller keeps running

### Requirement: Database downgrade refusal

Before normal services start, the controller SHALL compare the maximum schema
version recorded in the database with the maximum known to the binary. When
the database is newer, startup SHALL fail closed with a typed
DATABASE_TOO_NEW diagnostic: no migrations, watchers, browser automation, or
executors may run; the database must not be mutated, deleted, or reset; exact
known/current schema numbers SHALL be logged; and the desktop SHALL surface a
recovery-oriented terminal state.

#### Scenario: Older database forward-migrates normally

- **GIVEN** a database whose recorded schema is older than the binary knows
- **WHEN** the controller starts
- **THEN** missing migrations apply transactionally and services start

#### Scenario: Newer-than-binary database refuses repeatedly and non-destructively

- **GIVEN** a database one or many schema versions newer than the binary knows
- **WHEN** the controller starts — and again after any number of failed attempts
- **THEN** startup exits with the typed refusal each time, logs both schema numbers, and the database bytes/schema remain unchanged

### Requirement: Pre-migration recovery snapshot

When a persistent database has pending migrations, the controller SHALL create
a transactionally consistent snapshot using a SQLite-supported online backup
mechanism before applying them. The snapshot SHALL live under an external
writable Orca backup directory with metadata (application version, source and
target schema versions, createdAt, SHA-256), SHALL pass integrity verification
after creation, SHALL use bounded retention, and SHALL never reside under
application resources nor include browser cookies, repository contents, or
logs. If snapshot creation fails, migration SHALL NOT proceed.

#### Scenario: Snapshot precedes schema-changing migration

- **GIVEN** a persistent database with pending migrations
- **WHEN** migrations are applied
- **THEN** a verified consistent snapshot with complete metadata exists beforehand and is openable/integrity-checked afterwards

#### Scenario: Backup failure blocks unprotected migration

- **GIVEN** the backup target is unwritable
- **WHEN** a migration would run
- **THEN** startup fails closed with a typed backup error and the source database remains pre-migration

### Requirement: User state backup and restore

Orca SHALL provide a first-class durable-state backup bundle containing the
SQLite durable state plus product/schema metadata as a manifest with SHA-256
checksums, and SHALL structurally exclude ChatGPT cookie/browser-profile
secrets, executor/provider credentials, repository working directories,
temporary worktrees, runtime locks/PIDs, and logs. Restore SHALL validate the
bundle format, entry allowlist (rejecting path traversal entries), checksums,
and schema compatibility; SHALL require controller quiescence; SHALL preserve
the replaced state as a recovery copy; and SHALL report clear success/failure.

#### Scenario: Backup bundle contains only permitted payload

- **WHEN** a state backup is created
- **THEN** the bundle contains exactly the manifest and the checksummed SQLite image, and no cookies, credentials, repositories, locks, or logs

#### Scenario: Corrupt or tampered bundle is rejected before any mutation

- **GIVEN** a bundle with a bad checksum or traversal entry
- **WHEN** restore is invoked while quiescent
- **THEN** restore fails with a typed error and the live database is untouched

#### Scenario: Restore refuses while the controller owns the data

- **GIVEN** a live controller holding the runtime lock for the target data directory
- **WHEN** restore is invoked
- **THEN** it refuses with a truthful quiescence error and preserves all files

### Requirement: Single-source release versioning

One canonical product version SHALL exist (root package.json). Secondary
package manifests and lockfiles SHALL either derive from it during build or be
maintained only via one atomic validated command, and ordinary builds/tests
SHALL check coherence so drift fails fast. Release preparation SHALL abort on
invalid input without writing a partially updated tree. Tests SHALL cover
mismatch detection.

#### Scenario: Version drift fails the gate

- **GIVEN** a workspace manifest edited away from the canonical version
- **WHEN** the coherence check runs
- **AND** when release preparation receives invalid input
- **THEN** the check exits non-zero listing the drift, and preparation leaves the tree unchanged

### Requirement: Release provenance manifest

Every Windows distribution SHALL ship a machine-readable provenance manifest
containing product name, semantic version, Git commit SHA, protocol version,
maximum DB schema version, architecture, Electron and Node runtime versions,
signing status derived from actual signing results, artifact filenames with
byte sizes and SHA-256 hashes, qualification tier, source repository, and CI
run identity when available — with no secrets or machine-local paths — plus a
standard checksums file. The packaged application identity SHALL correlate
with the exact release manifest.

#### Scenario: Manifest matches shipped binary identity

- **GIVEN** a produced installer and unpacked distribution
- **WHEN** the manifest is generated and the installed app reports `/api/system/identity`
- **THEN** version and build identity match the manifest, hashes match the artifacts, and unsigned builds say UNSIGNED

### Requirement: Tag and source integrity for releases

Tag-triggered Windows release builds SHALL verify that a `vX.Y.Z` tag exactly
matches the canonical product version, reject dirty/incoherent package
metadata, verify the lockfile, record the Git SHA, and build all artifacts from
that SHA. A tag/version mismatch SHALL fail the workflow; release jobs SHALL
NOT rewrite version metadata silently.

#### Scenario: Mismatched tag cannot produce a release

- **GIVEN** tag v1.2.3 against canonical version 1.2.4
- **WHEN** the release pipeline runs
- **THEN** it fails at the integrity gate before building artifacts

### Requirement: GitHub release pipeline with least privilege

On a valid version tag the pipeline SHALL run required gates, build the
installer, generate checksums/provenance/SBOM, create the corresponding GitHub
Release, and attach the installer, checksums, manifest, SBOM if implemented,
and compact qualification evidence — without publishing generated runtime
state or user data. Publication permission SHALL be scoped to the publish job
only; ordinary push/PR workflows SHALL NOT be able to publish Releases.

#### Scenario: Release scripting verifiable without manufacturing a production tag

- **WHEN** release scripts run in dry-run/fixture mode locally or via manual dispatch on an ephemeral runner
- **THEN** manifests/checksums/release draft behavior can be exercised without creating a public version tag

### Requirement: Optional code-signing seam with derived truth

Windows artifacts MAY be code-signed through standard electron-builder
credential configuration, disabled cleanly when credentials are absent. No
certificate material SHALL be committed; reported signing status SHALL derive
from actual signature verification of the produced binaries; unsigned
pipelines SHALL work end-to-end; a configured signing failure SHALL prevent
publication rather than mislabel artifacts. Automatic update installation
SHALL remain deferred while releases are unsigned.

#### Scenario: Unsigned truth preserved

- **GIVEN** no signing credentials in the environment
- **WHEN** packaging completes
- **THEN** every artifact and manifest records UNSIGNED and the pipeline succeeds

## Implementation Notes

- Identity additions are additive optional JSON fields; protocol stays 1.
- The lifecycle token lives in runtime-lock metadata written atomically with
  ownership acquisition; it is released with ownership and rotated each start.
