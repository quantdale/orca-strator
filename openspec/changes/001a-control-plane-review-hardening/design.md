# Design: Control Plane Review Hardening

## 1. Summary

Change 001a corrects foundation defects found during the deep review of Change 001 while preserving the original control-plane architecture:

```text
shared contracts
   ^          ^
   |          |
controller   UI
               ^
               |
            Electron
```

No new autonomy subsystem belongs inside 001a. The objective is to make the existing foundation honest, reproducible, and safe to extend. Once the corrective exit gate is met, the agent folds Milestone 1 and continues into the next focused roadmap OpenSpec rather than stopping for review by default.

## 2. Development-stack design

From a fresh checkout after install, `npm run dev` must launch a usable stack containing:

- running controller HTTP/WebSocket process;
- Vite dev server;
- Electron desktop shell loading the Vite UI;
- any shared-package watch/build prerequisite required by the selected workspace approach.

A TypeScript watch compiler is not a controller runtime.

The supervisor must prepare prerequisites, avoid undocumented startup races, pass the Vite URL to Electron automatically, clean up child process trees on Windows, and keep the controller separately runnable. Do not build a generalized production supervisor here.

## 3. Workspace dependency design

`@orca/shared` must not require stale ignored `dist` output for root verification or development.

Choose the simplest explicit dependency-aware approach: TypeScript project references/build mode, source/path mapping for development/tests, or automatic prerequisite build steps. Developers/agents must not need to remember an undocumented "build shared first" ritual.

The specific clean-output concern should be reproduced directly. This targeted reproduction is required; a broad startup baseline test suite is not.

## 4. Technology baseline reconciliation

The locked baseline remains authoritative unless reproduced implementation evidence proves a specific incompatibility.

Align package manifests/lockfile with `docs/TECH-BASELINE.md` for React, Vite, Tailwind, Vitest, Electron, Node/npm and relevant type/plugin packages. If a baseline line cannot work, reproduce it and amend `docs/TECH-BASELINE.md`/`docs/DECISIONS.md` explicitly before using an alternative.

Do not silently keep older scaffold defaults.

## 5. Migration transaction design

Each unapplied migration body and its `schema_migrations` insertion must be atomic:

```text
BEGIN
  migration.up(db)
  INSERT schema_migrations(...)
COMMIT
```

On error, roll back and rethrow. No migration may be marked applied unless its body succeeded, and ordinary transactional failure must not leave partial schema/data behind.

Add deterministic injected failure tests for both migration-body and metadata-recording failure paths where practical.

## 6. WebSocket lifecycle design

REST remains authoritative; WebSocket events are synchronization hints.

Required lifecycle:

```text
connect
 → connected
 → transient close/error
 → disconnected
 → bounded reconnect
 → connected
 → authoritative refetch
```

Requirements:

- later legitimate `connect()` re-enables reconnect intent after a prior intentional disconnect;
- close/error schedules exactly one reconnect when desired;
- stale socket callbacks cannot clobber a replacement socket;
- React StrictMode setup/cleanup/setup does not permanently disable reconnect;
- singleton ownership is explicit enough that one consumer cleanup does not unexpectedly kill all remaining consumers.

Use deterministic fake-WebSocket tests.

## 7. Routing and deep-link design

Controller-side SPA history fallback already exists. The client must use pathname/history routing that matches it.

Required routes:

```text
/                         repositories list
/repositories/new         add repository
/repositories/:id         repository detail
/repositories/:id/edit    edit repository
```

Hash-only routing does not satisfy the direct-reload contract. Prefer an established lightweight routing library or focused history routing. Tests must prove both server fallback and actual React rendering at direct pathnames.

## 8. Sol conversation URL validation

V1 stores one exact dedicated ChatGPT conversation URL per repository. Prefer strict support for the normal form:

```text
https://chatgpt.com/c/<conversation-id>
```

Only add other forms deliberately. Generic pages such as `/pricing`, `/settings`, `/foo`, or the homepage must be rejected.

## 9. Controller/API cleanup

Fix directly related inconsistencies while hardening:

- validate controller port/config before passing invalid values to runtime APIs;
- unknown `/api/*` should use a route-appropriate not-found identity rather than `REPOSITORY_NOT_FOUND`;
- keep API errors structured and avoid raw stack leakage;
- update contracts/tests if error identity changes.

Do not widen this into a general controller refactor.

## 10. Verification design

Do **not** run a broad baseline suite at the beginning of the goal-mode session.

Use:

1. targeted reproduction of each known review defect;
2. focused tests/checks during implementation;
3. broader root typecheck/test/lint/build at meaningful completion checkpoints;
4. actual smoke evidence for controller, dev stack, Electron, built SPA, direct deep links, and persistence before claiming those acceptance gates.

A checked OpenSpec task must map to evidence actually exercised. Do not infer Electron launch success from a helper-function unit test.

If one check remains blocked but independent safe work exists, record the issue and continue other tasks. The blocker only becomes global when no meaningful safe roadmap work remains.

## 11. Continuous roadmap transition

When all material 001a requirements are satisfied:

1. reconcile Change 001 + 001a against the implemented Milestone 1 behavior;
2. update inaccurate Change 001 task evidence;
3. fold/archive accepted capability behavior into canonical `openspec/specs/`;
4. mark Milestone 1 complete in roadmap/state;
5. create/activate the Milestone 2 watcher/transactional-dispatch OpenSpec if absent;
6. commit/push the transition;
7. **continue implementation immediately**.

An external second Sol review is useful but non-blocking during unattended Kimi goal mode unless the user explicitly requests a review stop.

## 12. Definition of done

001a is done when:

1. clean-output workspace resolution is deterministic;
2. `npm run dev` actually launches controller + UI + Electron on Windows;
3. package versions match the locked baseline or an evidence-backed decision amendment exists;
4. migrations are atomic and failure-tested;
5. event reconnect survives errors and StrictMode lifecycle;
6. pathname deep links render correctly in the actual UI;
7. generic non-conversation ChatGPT URLs are rejected;
8. controller/API cleanup above is complete;
9. acceptance evidence is truthful;
10. no Milestone 2 runtime code was mixed into 001a;
11. Milestone 1 is folded and the next focused roadmap change is activated so continuous development can proceed.
