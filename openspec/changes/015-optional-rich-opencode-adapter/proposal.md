# Change 015: Optional rich OpenCode adapter

## Why

OpenCode now exposes a documented server/session surface, but its current
documentation describes a V1/V2 hybrid and an active migration between API
generations. Orca should be able to inspect and use that surface when a user
explicitly configures it without making OpenCode part of the controller's
runtime dependency graph or pretending that an unstable endpoint is a stable
coordination protocol.

## Scope

- add an executor profile for the documented `opencode run` CLI shape;
- add an optional `OpenCodeAdapter` that preserves the normal child-process
  execution seam and can delegate to Windows or WSL process supervision;
- add an explicit, non-inference OpenCode server probe and a guarded client for
  health, OpenAPI route discovery, sessions, prompts, cancellation,
  permissions, event streaming, and structured usage where the observed route
  set supports them;
- feature-detect V1/V2/hybrid route sets and mark the adapter experimental;
- integrate the adapter with capability readiness, explicit manual probing,
  usage capture, and optional strategy workers without changing Kimi, Codex,
  generic CLI, or deterministic test behavior;
- add deterministic local HTTP tests and truthful external qualification
  labels;
- reconcile canonical architecture, capability, API, data, security, and
  test documentation.

## Explicit non-goals

- no OpenCode package, binary, or server is installed or required by Orca;
- no automatic OpenCode server startup, model selection, provider routing, or
  inference request from a Settings page or capability probe;
- no replacement of the durable Git result contract with OpenCode transcripts;
- no claim that the current hybrid API is stable enough for default production
  orchestration;
- no regression to SINGLE_AGENT, Kimi, Codex, generic CLI, Windows/WSL, or
  Change 009 control/recovery semantics;
- no dependency on an OpenCode-specific permission model for Orca's absolute
  Git safety rules.

## Exit evidence

The change is complete when the adapter and profile are optional and absent-safe,
the manual probe records structured route/readiness evidence without inference,
guarded native calls fail with classified experimental errors instead of
silently falling back, usage is mapped only from structured provider data, and
focused unit/integration/typecheck/build/lint checks pass. A real OpenCode
server/model qualification remains UNQUALIFIED when the external binary,
credentials, or server is unavailable.
