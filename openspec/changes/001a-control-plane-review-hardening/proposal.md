# Change 001a: Control Plane Review Hardening

## Status

**Ready for implementation**

Roadmap milestone: **1 — Bootstrap control plane**

This is a corrective review change. It does **not** advance Orca-Strator to Milestone 2.

## Why

The deep review of Change 001 found that the basic architecture is promising, but the milestone was marked `READY_FOR_REVIEW` with several acceptance gates either violated or insufficiently proven. The foundation must be corrected before Git watching, executor spawning, or Playwright are allowed to depend on it.

The most important findings are:

1. **Root development orchestration is not functional as specified.** `npm run dev` launches the controller TypeScript compiler in watch mode and Vite, but does not launch the controller runtime and does not launch Electron. The controller workspace `dev` script itself only runs `tsc --watch`.
2. **Fresh-checkout workspace behavior is not robustly established.** `@orca/shared` exports `dist/*`, generated `dist/` is intentionally untracked, while root tests/typechecks import `@orca/shared`. The required root commands must work from a clean checkout without relying on stale ignored build artifacts.
3. **The implementation materially drifted from the locked technology baseline without documenting or approving the deviation.** The committed packages use older React/Vite/Tailwind/Vitest/Electron lines than `docs/TECH-BASELINE.md` and `docs/DECISIONS.md` specify.
4. **SQLite migration application is not atomic.** Migration body execution and insertion into `schema_migrations` are currently separate operations without an explicit transaction, despite the migration contract requiring failed migrations not to leave ambiguous partially-applied state.
5. **WebSocket reconnect semantics are broken in lifecycle/error paths.** The singleton client permanently disables automatic reconnect after `disconnect()`, and the `onerror` path clears the active socket before close handling can schedule a retry. React StrictMode makes this especially important because effects are intentionally mounted/cleaned up more than once in development.
6. **SPA routing does not satisfy the deep-link contract.** The UI currently uses hash routing, while Change 001 and the static-server acceptance contract require real client routes such as `/repositories/:id` to survive direct browser reload. The server test proves only that `index.html` is returned, not that the React application resolves the pathname to the intended screen.
7. **Sol conversation URL validation is too permissive.** The current regex accepts generic single-segment ChatGPT paths rather than requiring a dedicated conversation URL. Later browser automation must never be routed to an arbitrary ChatGPT page because a weak validator accepted it.
8. **Review evidence was overclaimed.** Several manual/end-to-end task boxes were checked despite tests that only validate small helpers rather than actual Electron/dev-stack/reload behavior. No CI/check status exists for the implementation commit, so the milestone should record exact reproducible verification rather than infer acceptance from the test count.
9. **Documentation/waypoint drift remains.** README still describes Milestone 1 as ready for implementation even though Change 001 implementation exists, and the waypoint suggested advancing directly to a differently named Change 002 before this review was accepted.

## Goals

Bring the Change 001 foundation to a state that is safe to accept by:

1. making fresh-checkout install/typecheck/test/build/lint behavior deterministic;
2. making `npm run dev` launch the practical controller + UI + Electron stack on Windows;
3. aligning dependencies with the locked supported technology baseline, or explicitly revising the baseline only if verified implementation evidence demands it;
4. making migration application atomic and testable under failure;
5. making WebSocket reconnect/refetch behavior correct across StrictMode, errors, disconnect/reconnect, and multiple consumers;
6. implementing real browser-history/deep-link routing consistent with the same-origin static-server seam;
7. tightening Sol conversation URL validation to actual conversation URLs;
8. improving acceptance evidence so checked tasks correspond to behavior genuinely exercised;
9. reconciling README, OpenSpec tasks, roadmap, and durable waypoint after the fixes.

## Non-goals

This corrective change MUST NOT implement:

- remote Git polling/watcher runtime;
- `.orca/dispatch` execution;
- coding-agent process launch;
- Playwright/ChatGPT automation;
- autonomous run state machine;
- Tailscale configuration;
- phone notifications;
- multiple sessions/branches per repository.

Do not use review hardening as an excuse to build Milestone 2 early.

## Acceptance posture

Change 001 remains **not accepted** until Change 001a is implemented and re-reviewed.

The intended sequence is:

```text
Change 001 implementation
        -> deep review
        -> Change 001a corrective hardening
        -> verification
        -> second deep review
        -> accept/fold Milestone 1
        -> only then create Milestone 2 watcher change
```

## Severity summary

### High

- broken one-command development stack;
- fresh-checkout package/build dependency uncertainty;
- non-transactional migration runner;
- WebSocket reconnect lifecycle bug;
- deep-link contract mismatch;
- unsupported/stale dependency-line drift from locked baseline.

### Medium

- overly permissive Sol URL validation;
- inaccurate acceptance-task evidence;
- README/waypoint/status drift;
- API route-not-found semantics and similar small contract inconsistencies discovered while hardening.

## Review exit gate

This change is complete only when a fresh supported Windows checkout can reproduce the documented workflow without pre-existing build artifacts, actual desktop/browser behaviors match the Change 001 contract, all corrective regression tests pass, and the durable state is truthful enough for a second Sol review.