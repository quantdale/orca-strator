# Design: Optional rich OpenCode adapter

## Context

The current controller already has a capability snapshot, a feature-detected
`ExecutorAdapter` seam, platform process adapters, structured usage telemetry,
and a durable executor/result contract. The adapter must deepen those seams,
not create a second runner or make HTTP session state the source of truth.

The current OpenCode documentation exposes both legacy and `/api` routes while
the project documents an ongoing V1-to-V2 migration. That makes server
discovery useful, but makes hard-coded assumptions about one API generation
unsafe for the default Orca runtime.

## Decisions

### 1. Optional adapter and explicit selection

`resolveProfile` recognizes a configured CLI containing `opencode` and builds
the documented headless invocation `opencode run --model <provider/model>
<prompt>`. `ExecutorService` and the isolated strategy worker select the
optional adapter only for that profile; Kimi, Codex, generic, and test profiles
continue using their existing platform adapters. The user's configured CLI and
model are passed through unchanged.

`OpenCodeAdapter` delegates process spawn/cancel/pause to the existing Windows
or WSL adapter. This keeps the durable result manifest, Git postflight,
watchdog, control, and recovery semantics in the current runner.

### 2. Server discovery is a manual, non-inference probe

The adapter accepts an explicit endpoint from construction or
`ORCA_OPENCODE_SERVER_URL`. The endpoint is never contacted by ordinary UI
rendering or adapter construction. A manual capability probe performs only
GET health and OpenAPI-document requests with a bounded timeout, then records
the observed API generation (`V1`, `V2`, `HYBRID`, or `UNKNOWN`), route
readiness, server version when supplied, and an experimental marker. URLs are
sanitized before persistence. A missing endpoint is an honest UNKNOWN result.

The probe never creates a session, sends a prompt, starts a server, or calls a
provider. V1/V2 route discovery is based on the returned OpenAPI path map, not
on brand-specific assumptions scattered through the orchestration engine.

### 3. Guarded native operations

The optional server client exposes explicit operations for session creation,
prompt submission, wait/status, cancellation, permission reply, durable
message retrieval, and SSE events. Each operation chooses only a route observed
by the last probe and throws a classified `OPENCODE_API_UNSUPPORTED` or
`OPENCODE_API_DRIFT` error when the route is absent or the response shape is
unexpected. It never silently switches to a different model/provider or turns
an HTTP transcript into a result manifest.

Native session resume/history, permissions, cancellation, events, model/provider
visibility, and usage are reported READY only when the route is observed. The
adapter remains explicitly experimental because route presence is not proof of
semantic stability. Structured assistant-message token/cost fields are mapped
to the existing telemetry contract; missing fields remain unknown.

### 4. Capability and usage integration

`CapabilityProbeService` receives the optional adapter and merges its server
probe into the existing capability snapshot. The existing CLI, filesystem, and
Git checks remain authoritative for those dimensions. No INFERENCE probe is
implemented. If OpenCode is absent, all other profiles and the controller
remain fully usable.

The adapter caches only the latest structured usage observation from an
explicit native-session call. The normal `UsageTelemetryService` can consume
that observation without scraping logs. No cost is estimated unless the
provider response supplies an exact numeric cost.

### 5. Qualification boundary

Deterministic HTTP fixtures cover V1, V2, hybrid, missing-route, malformed,
timeout, permission, SSE, and usage paths. No test labels a real OpenCode
binary, server, provider, or credential as machine-qualified unless it actually
runs. The real tier reports a skip/unqualified reason when OpenCode is absent.

## Rejected alternatives

- Installing or bundling OpenCode would violate the optional-backend invariant
  and make the controller brittle to provider release cadence.
- Treating the current `/api` routes as permanently stable would hide the
  documented migration boundary and create silent protocol corruption.
- Parsing CLI prose or UI output for usage/events would fabricate telemetry and
  duplicate the durable Git/result protocol.
- Routing every executor through an OpenCode client would regress the current
  Kimi/Codex/generic path and violate user-owned executor selection.
