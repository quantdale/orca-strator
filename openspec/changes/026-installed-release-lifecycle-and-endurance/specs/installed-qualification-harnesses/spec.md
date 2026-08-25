# Delta: installed-qualification-harnesses

## ADDED Requirements

### Requirement: Installer lifecycle acceptance harness

A repeatable harness SHALL qualify the real NSIS installer lifecycle in an
isolated environment (disposable runner, Windows Sandbox/VM, or another
explicitly isolated test environment) using per-test install locations,
isolated `ORCA_DATA_DIR`, isolated ports, and fixture repositories only. It
SHALL prove at minimum: silent install succeeds with the executable at the
expected destination; the installed application launches without system Node;
the controller starts and UI/API become reachable; build identity matches the
installed artifact; durable data stays external to the install tree; closing
the desktop leaves the controller alive and reopening reuses it; a seeded
upgrade over an older test installation detects version skew rather than
silently mixing, replaces the old controller only through the safe quiescence
contract, preserves database/config/history and the browser-profile directory,
and reports the candidate exact build identity with correct migration/backup
behavior; uninstall does not silently destroy Orca data nor leave an
uncontrolled active controller from removed binaries; active-campaign
uninstall behavior is safe and explicit; reinstall can rediscover preserved
data where supported. The user's real browser profile SHALL NOT be used.

#### Scenario: Clean install on an ephemeral runner qualifies install/close-reopen

- **GIVEN** a built installer on a disposable Windows runner with isolated data dir and port
- **WHEN** the harness performs silent install, launch, close, and relaunch checks
- **THEN** all install and close/reopen assertions pass and evidence is recorded as artifacts

#### Scenario: Upgrade over seeded state follows the replacement contract

- **GIVEN** fixture durable state under an older synthetic-version installation
- **WHEN** a newer synthetic-version installer is applied in the isolated environment
- **THEN** skew is detected, replacement occurs only via graceful quiescence, durable data and the browser profile survive, and the upgraded controller reports the candidate exact build identity

#### Scenario: Uninstall preserves user data truthfully

- **WHEN** the product is uninstalled in the isolated environment
- **THEN** external durable data remains, no controller from removed binaries keeps running uncontrolled, and reinstall finds preserved data

### Requirement: Install/uninstall controller safety policy

Installer and uninstaller operations SHALL follow an explicit safety policy
for a live controller whose binaries belong to the installation being replaced
or removed: refuse while campaigns are active (with a user-visible path to
quiesce), stop only when confirmed idle AND ownership identity matches, and
abort when safe shutdown cannot be proven. Product-name-wildcard task kills,
foreign-PID termination, and removing resources from under an active
controller are forbidden.

#### Scenario: Active campaign aborts upgrade safely

- **GIVEN** a live controller with an active campaign during upgrade/uninstall
- **WHEN** the installer safety check runs
- **THEN** the operation aborts with actionable guidance and no process is killed

### Requirement: Packaged crash and restart recovery qualification

Packaged-level qualification SHALL cover: abrupt controller kill leaving a
stale runtime lock, desktop reopen reclaiming it only after liveness proof with
startup reconciliation and persisted-state survival without duplicate actors;
desktop crash while the controller continues; simultaneous desktop relaunches
yielding one controller; controller crash during startup; restart after an
incomplete migration snapshot where safely simulatable; and package start from
an arbitrary working directory.

#### Scenario: Stale lock reclaimed after hard kill

- **GIVEN** the controller was forcibly terminated leaving its lock behind
- **WHEN** the packaged desktop relaunches
- **THEN** the lock is reclaimed only after liveness proof, reconciliation runs once, persisted state survives, and no duplicate executor/Sol actor exists

### Requirement: Endurance soak harness with measured thresholds

A repeatable endurance harness SHALL exercise repeated desktop
launch/close/relaunch cycles, controller reuse and restart recovery, API
read/write churn, multiple repository records, watcher activity against
fixture Git remotes, readiness probes, database reopen cycles, and singleton
races against the packaged runtime using isolated temp data and fixture
repositories only. It SHALL track PID continuity/replacement, working-set
memory, handle counts where reliably exposed, child-process counts, SQLite
integrity, log-directory size, leftovers, package-resource immutability, and
failed requests, with leak/regression thresholds derived from a measured
warmup baseline. A short CI-safe mode and a longer local qualification mode
SHALL exist; PACKAGED_ENDURANCE_QUALIFIED SHALL be claimed only after the
longer mode actually executed successfully with recorded duration, cycle
counts, peak/final memory/handles, log growth, failures, and final integrity.

#### Scenario: Short endurance mode is CI-safe

- **GIVEN** the packaged unpacked artifact and isolated temp state
- **WHEN** short-mode endurance runs on an ephemeral runner
- **THEN** bounded cycles complete within CI budget with integrity and threshold checks recorded

### Requirement: Multi-repository packaged stress isolation

A deterministic stress scenario SHALL prove several repositories can remain
active concurrently against the packaged runtime without cross-contamination:
independent watcher progression, per-repository executor ownership records, no
accidental global serialization of unrelated repository control paths, no
cross-routed run/dispatch state, one repository's failure not corrupting
siblings, and desktop close/reopen during activity not disturbing controller
work — using fixture/local Git and deterministic seams, never real model
inference.

#### Scenario: Sibling failure containment

- **GIVEN** multiple registered fixture repositories with progressing watchers
- **WHEN** one repository's local path is made invalid mid-run
- **THEN** only that repository reports failure state and sibling repositories continue progressing independently

### Requirement: Post-scenario database integrity qualification

After install/upgrade/crash/endurance scenarios, the harness SHALL execute
SQLite integrity checks, validate migration history and expected record
counts, verify foreign-key integrity where enabled, confirm rejected downgrades
caused no schema mutation, and verify backup snapshots actually open.

#### Scenario: Integrity gate closes each scenario

- **WHEN** any lifecycle scenario completes
- **THEN** `PRAGMA integrity_check` returns ok, migration history matches expectations, and any created snapshot opens read-only

## Implementation Notes

- Qualification tiers remain honest: PACKAGE_BUILT <
  PACKAGE_RUNTIME_QUALIFIED < INSTALLER_LIFECYCLE_QUALIFIED; a green unit
  test is not installer qualification; short soak is not long-soak
  qualification.
