# OpenCode adapter

## Requirement: OpenCode remains optional and feature-detected

The controller MUST run when no OpenCode binary, server, endpoint, provider,
or credential is present. OpenCode-specific behavior MUST be isolated in the
OpenCode adapter/profile and MUST NOT be required by generic CLI, Kimi, Codex,
or deterministic test execution.

### Scenario: OpenCode is absent

- **WHEN** a repository uses Kimi, Codex, generic CLI, or a deterministic test
  profile and no OpenCode installation exists
- **THEN** its existing platform adapter, result validation, Git postflight,
  controls, and recovery behavior remain unchanged

### Scenario: OpenCode is explicitly selected

- **WHEN** the configured executor CLI resolves to the OpenCode profile
- **THEN** only that execution uses `OpenCodeAdapter`, preserving the configured
  CLI/model and the existing Windows/WSL runner boundary

## Requirement: Manual probe does not spend inference

The OpenCode capability probe MUST perform only bounded health and route
discovery requests. It MUST NOT create a session, submit a prompt, start a
server, or contact a model/provider. Probe output MUST persist sanitized
endpoint, API generation, server version, route readiness, experimental status,
probe level, and classified errors through the existing capability snapshot.

### Scenario: Settings opens

- **WHEN** a user opens executor settings
- **THEN** no OpenCode network request or inference request occurs

### Scenario: User tests OpenCode

- **WHEN** the user explicitly invokes a STATIC or NON_INFERENCE executor probe
- **THEN** the controller records health/route readiness and leaves auth/model
  readiness UNKNOWN unless a separate authorized provider operation supplies
  evidence

## Requirement: API generation and optional features are detected

The adapter MUST recognize legacy, `/api` V2, hybrid, and unknown route sets
from the observed OpenAPI document. It MUST report optional readiness
independently for server health, sessions, session history, prompt submission,
structured events, permission API, native cancellation, model/provider
visibility, subagents, and structured usage. Unsupported or unobserved features
MUST remain UNKNOWN or UNSUPPORTED rather than being inferred from the brand.

### Scenario: Hybrid API is observed

- **WHEN** health succeeds and the OpenAPI document contains both legacy and
  `/api` session/event routes
- **THEN** the snapshot records `HYBRID`, marks the adapter experimental, and
  exposes only route-backed capabilities

### Scenario: API document is unavailable

- **WHEN** health responds but the document is missing, malformed, or has no
  supported session route
- **THEN** health remains READY, feature readiness remains UNKNOWN/UNSUPPORTED,
  and the probe records a classified experimental API issue

## Requirement: Native calls are explicit and guarded

Native session, prompt, wait, cancellation, permission, durable message, and
SSE operations MUST require an observed compatible route and MUST surface
classified API-drift errors when route or response contracts do not match. They
MUST NOT silently retry with a different model/provider or claim that a native
session result is a durable Orca result.

### Scenario: Prompt route is absent

- **WHEN** a caller requests a native prompt but the last probe did not observe
  a prompt route
- **THEN** the adapter returns an explicit unsupported error without making a
  speculative request

### Scenario: Structured usage is present

- **WHEN** durable assistant message data contains numeric input/output,
  reasoning/cache token, latency, or exact cost fields
- **THEN** the adapter exposes those fields through the existing usage capture
  seam, preserving unknown fields as null and exact cost only when supplied

## Requirement: Durable Orca truth remains authoritative

OpenCode output, events, permissions, and sessions MUST remain observability or
executor capability data. Campaign completion MUST still require the existing
structured result, Git postflight, and Sol outer-loop review. OpenCode event
streams MUST NOT replace SQLite orchestration truth or Git cross-agent truth.

### Scenario: Native session completes

- **WHEN** an OpenCode native session reports completion
- **THEN** Orca still waits for the normal structured result/Git postflight and
  Sol review before advancing or declaring a campaign terminal state

## Requirement: Experimental qualification is truthful

Deterministic fixtures MUST cover healthy V1/V2/hybrid discovery, missing or
malformed routes, unsupported operations, timeout/error classification, SSE,
permission reply, usage extraction, and absent-server behavior. Real OpenCode
binary/server/provider qualification MUST remain explicitly UNQUALIFIED when
the external dependency is unavailable.

### Scenario: External server is unavailable

- **WHEN** the real qualification environment lacks an OpenCode server or
  credentials
- **THEN** the real tier records an UNQUALIFIED/skip reason and does not label
  the adapter machine-qualified
