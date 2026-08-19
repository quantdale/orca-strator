# Change 001a: Control Plane Review Hardening

## Status

**Ready for implementation**

Roadmap milestone: **1 — Bootstrap control plane**

This is a corrective review change. It repairs Milestone 1 before later runtime systems depend on it. The corrective scope itself does not contain watcher/executor/Playwright runtime, but **completion of 001a is not a session stop**: after folding Milestone 1, the coding agent should create/activate the next roadmap OpenSpec and continue development.

## Why

The deep review of Change 001 found a promising architecture with several foundation defects and overclaimed acceptance evidence:

1. root `npm run dev` did not actually launch controller runtime + Vite + Electron;
2. fresh-checkout workspace behavior could depend on ignored `@orca/shared/dist` output;
3. committed React/Vite/Tailwind/Vitest/Electron lines drifted from the locked technology baseline without a durable decision;
4. SQLite migration body + migration metadata recording were not atomic;
5. WebSocket reconnect semantics were broken in disconnect/error/React StrictMode lifecycle paths;
6. hash routing did not satisfy the documented pathname/deep-link reload contract;
7. Sol conversation URL validation accepted generic ChatGPT paths;
8. several acceptance/manual-E2E boxes were stronger than the evidence actually exercised;
9. documentation/waypoint status drift remained.

These issues should be resolved before Milestone 2 code depends on the foundation.

## Goals

1. make clean-output install/typecheck/test/build/lint behavior deterministic;
2. make `npm run dev` launch the practical Windows controller + UI + Electron stack;
3. align dependencies with the locked technology baseline or explicitly amend it only with reproduced evidence;
4. make migrations atomic and failure-tested;
5. make WebSocket reconnect/refetch behavior correct across StrictMode/errors/disconnect/reconnect;
6. implement real browser-history/deep-link routing consistent with the same-origin server seam;
7. tighten Sol conversation URL validation to actual supported conversation URLs;
8. make checked acceptance evidence truthful/reproducible;
9. reconcile README/OpenSpec/roadmap/waypoint;
10. then fold Milestone 1 and **continue into the next roadmap OpenSpec automatically**.

## Non-goals inside 001a

Do not implement the following *inside this corrective change*:

- remote Git watcher/dispatch execution;
- coding-agent process launch;
- Playwright/ChatGPT automation;
- autonomous run state machine;
- Tailscale/phone notifications;
- multiple sessions/branches per repository.

Those remain later milestones. Once 001a is complete/folded, moving into Milestone 2 is expected and should happen in its own focused OpenSpec without stopping the coding session.

## Continuous acceptance posture

The sequence is now:

```text
Change 001 implementation
        → deep review
        → Change 001a corrective hardening
        → meaningful verification
        → accept/fold Milestone 1
        → create/activate Milestone 2 OpenSpec
        → continue implementation
```

A second external Sol review is useful but **non-blocking by default** during unattended goal mode. The repository must remain reviewable at all times through committed/pushed checkpoints.

## Verification posture

Do not begin with a broad baseline suite. Reproduce the specific review findings directly, implement fixes, use focused checks while working, and run broader root gates at meaningful completion checkpoints.

Failing tests or one blocked subtask are not global stop conditions. Record them and continue independent safe work whenever possible.

## Severity summary

### High

- broken one-command development stack;
- clean-checkout package/build dependency uncertainty;
- non-transactional migrations;
- WebSocket reconnect lifecycle bug;
- deep-link contract mismatch;
- unsupported dependency-line drift.

### Medium

- permissive Sol URL validation;
- inaccurate acceptance evidence;
- README/waypoint/status drift;
- nearby API/config contract inconsistencies discovered while hardening.

## Exit gate

001a is complete when the material review findings are fixed or explicitly superseded by durable evidence-backed decisions, the foundation has truthful verification evidence, and Milestone 1 can be folded without known High defects. Completion advances into Milestone 2 rather than ending the development run.
