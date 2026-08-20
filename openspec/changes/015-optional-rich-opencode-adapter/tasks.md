## 1. Contracts and adapter seam

- [x] 1.1 Add OpenCode profile/invocation and optional adapter interfaces while
  preserving existing executor profiles and platform adapters.
- [x] 1.2 Add OpenCode capability-detail and classified-error contracts to the
  existing capability/usage model.

## 2. Optional server client

- [x] 2.1 Implement bounded health/OpenAPI discovery with V1/V2/hybrid route
  detection, URL redaction, and no-inference behavior.
- [x] 2.2 Implement guarded session/prompt/wait/cancel/permission/message/SSE
  operations backed only by observed routes.
- [x] 2.3 Extract structured usage/provider/model data without log scraping or
  fabricated costs.

## 3. Runtime/API integration

- [x] 3.1 Integrate OpenCode selection into ordinary and isolated worker adapter
  selection without changing Kimi/Codex/generic/test behavior.
- [x] 3.2 Integrate manual capability probe/readiness and usage capture while
  keeping OpenCode endpoint/server optional and no automatic inference.

## 4. Verification and documentation

- [x] 4.1 Add deterministic unit and local HTTP integration tests, including
  malformed/timeout/unsupported/error paths and no-probe-side-effect checks.
- [x] 4.2 Add a conditional real OpenCode qualification test that stays
  UNQUALIFIED when the external server/binary/provider is unavailable.
- [x] 4.3 Reconcile canonical specs and architecture/API/data/security/test
  docs; update README, ROADMAP, and `.agent/state.json`.
- [x] 4.4 Run focused tests, full fast tests, applicable real tests, typecheck,
  build, lint, validate the OpenSpec, commit/push, then activate Change 016.
