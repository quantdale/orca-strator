# production-resilience-hardening Change Delta

## ADDED Requirements

### Requirement: Packaged controller logging is bounded while running

The packaged controller's active log file MUST be bounded during a single
long-running process lifetime, not only evaluated at startup. Rotation or
truncation MUST preserve truthful redacted diagnostics and MUST NOT lose the
active file identity assumed by operators.

#### Scenario: Long-running growth is bounded

- **WHEN** the controller keeps writing past the configured size bound while running
- **THEN** the active log is rotated/truncated according to policy and total on-disk log bytes remain bounded

## ADDED Requirements

### Requirement: Upgrade preserves durable user state

An upgrade exercise MUST prove that durable SQLite-backed user state survives a
synthetic-version upgrade performed from isolated artifacts (temporary
worktree builds), including migration forward application and post-upgrade
integrity verification. Installer execution on non-sanctioned machines remains
explicitly out of scope and honestly unlabeled.

#### Scenario: Synthetic upgrade across versions

- **WHEN** an older synthetic build's data directory is opened by a newer isolated build
- **THEN** pending migrations apply, pre-existing repositories/config remain readable, and integrity checks pass

### Requirement: Critical/High blast-radius findings close with regression evidence

Every reproducible Critical/High defect surfaced by the whole-system
blast-radius/failure-injection audit MUST be fixed with a regression test or
explicitly recorded as external-blocked; none may be silently dropped.

#### Scenario: Token-stripping lock rewrite regression

- **WHEN** an owning controller refreshes its runtime-lock metadata after binding (e.g. to record the listen endpoint)
- **THEN** the persisted metadata still contains the same per-start control token the owner presents, and authenticated graceful shutdown remains possible for replacement flows
