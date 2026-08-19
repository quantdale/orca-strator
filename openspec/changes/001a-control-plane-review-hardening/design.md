# Design: Control Plane Review Hardening

## 1. Summary

Change 001a corrects foundation defects found during the mandatory deep review of Change 001. It preserves the original control-plane architecture:

```text
shared contracts
   ^          ^
   |          |
controller   UI
               ^
               |
            Electron
```

No new runtime subsystem is introduced. The objective is to make the existing foundation honest, reproducible, and safe to extend.

## 2. Development-stack design

### Required developer experience

From a fresh checkout after install, one documented command:

```text
npm run dev
```

must launch a usable development stack that includes:

- a running controller HTTP/WebSocket process;
- the Vite development server;
- the Electron desktop shell loading the Vite UI;
- any required shared-package watch/build process.

A TypeScript compiler watch process by itself is not the controller runtime.

### Process supervision

The implementation may use a small dependency or a focused repository script, but it must:

1. build/prepare prerequisites before dependent processes start;
2. ensure controller readiness before Electron is expected to use it;
3. pass the Vite development URL to Electron automatically;
4. terminate child process trees reliably when the dev stack exits;
5. work on Windows, not only POSIX shells;
6. keep `npm run dev:controller`, `npm run dev:ui`, and `npm run dev:desktop` useful independently where practical.

Do not build a generalized production supervisor in this change.

## 3. Workspace dependency design

### Problem

`@orca/shared` currently exposes generated `dist` files, but those files are ignored and absent from a fresh checkout. Root verification commands must not accidentally depend on stale build output.

### Requirement

Choose one simple, explicit approach that makes dependency ordering deterministic. Acceptable approaches include:

- TypeScript project references/build mode plus dependency-aware root scripts;
- source/path mapping for development and tests with normal built-package exports for runtime;
- a small prerequisite build step that is automatically performed by root verification/dev scripts.

The implementation must not require the developer to remember "build shared first" as an undocumented manual step.

### Clean-checkout proof

Verification must delete generated workspace output before testing the documented sequence. A passing run after previous builds is not enough.

## 4. Technology baseline reconciliation

The locked baseline remains authoritative unless implementation evidence proves a specific incompatibility.

The corrective change should align package manifests/lockfile to the supported lines documented in `docs/TECH-BASELINE.md`, including the selected React, Vite, Tailwind, Vitest, Electron, Node/npm, and Node type-definition lines.

If any baseline line cannot be used:

1. reproduce the incompatibility;
2. record evidence;
3. update `docs/TECH-BASELINE.md` and `docs/DECISIONS.md` before committing an alternative.

Do not silently downgrade because a coding model scaffolded from older defaults.

## 5. Migration transaction design

Each unapplied migration must be atomic with its migration metadata record.

Conceptual sequence:

```text
BEGIN
  migration.up(db)
  INSERT schema_migrations(...)
COMMIT
```

On error:

```text
ROLLBACK
throw
```

Requirements:

- no migration is marked applied unless its full body succeeded;
- no partial body should remain after an ordinary transactional failure;
- failed startup must not claim health/readiness;
- tests must inject a deliberately failing migration and prove rollback + no metadata row.

Refactor `runMigrations` to accept/test migration definitions if that is the smallest way to exercise failure deterministically.

## 6. WebSocket lifecycle design

The event channel remains a best-effort sync hint; REST remains authoritative.

Correct client lifecycle must satisfy:

```text
connect
 -> connected
 -> transient close/error
 -> disconnected
 -> bounded reconnect
 -> connected
 -> authoritative refetch
```

### Required fixes

- `connect()` must re-enable reconnect intent after a prior normal `disconnect()` when a new owner starts the client again;
- error and close paths must schedule exactly one reconnect when appropriate;
- stale socket callbacks must not overwrite the state of a newer socket;
- React StrictMode setup/cleanup/setup must not permanently disable reconnect;
- if a singleton is shared by more than one UI consumer, one consumer unmounting must not unexpectedly disconnect all remaining consumers. Prefer one app-shell owner or an explicit reference-count/ownership model rather than accidental global lifetime.

Add deterministic fake-WebSocket tests for open, close, error, reconnect, disconnect, and remount behavior.

## 7. Routing and deep-link design

Change 001 established controller-side SPA history fallback. The client must actually use history/pathname routing that matches that contract.

Required routes remain approximately:

```text
/                         repositories list
/repositories/new         add repository
/repositories/:id         repository detail
/repositories/:id/edit    edit repository
```

Hash-only routes such as `#/repositories/:id` do not satisfy the direct-reload acceptance requirement.

Implementation may use a small routing library or focused custom history routing. Prefer established routing rather than maintaining a growing manual parser if the dependency is reasonable.

Tests must prove both:

1. controller returns SPA shell for the path; and
2. React booted at that pathname renders the intended screen after repository data loads.

## 8. Sol conversation URL validation

V1 stores one exact dedicated ChatGPT conversation URL per repository.

Validation should accept only recognized conversation-path forms intentionally supported by Orca. For ordinary ChatGPT V1, prefer a strict shape equivalent to:

```text
https://chatgpt.com/c/<conversation-id>
```

Legacy host support may remain if deliberately needed, but generic paths such as:

```text
https://chatgpt.com/pricing
https://chatgpt.com/settings
https://chatgpt.com/foo
```

must be rejected.

Do not expand URL forms for hypothetical future ChatGPT products without evidence.

## 9. Acceptance evidence design

A checked OpenSpec task must map to reproducible evidence.

### Automated evidence

Add or improve tests for:

- migration rollback;
- WebSocket reconnect/remount;
- deep-link routing;
- strict Sol URL validation;
- clean-workspace dependency resolution;
- same-origin client behavior.

### Process/smoke evidence

At minimum record the exact commands/outcomes for:

- clean install;
- root typecheck;
- root tests;
- root lint;
- root build;
- controller standalone start/health;
- `npm run dev` actual controller + Vite + Electron startup;
- controller-served built SPA;
- direct deep-link reload;
- CRUD persistence across controller restart.

Do not infer Electron launch success from a pure helper-function unit test.

## 10. Small contract cleanup

While correcting the above, fix nearby contradictions only when they are low-risk and directly related. Examples:

- use an API-route-not-found code/message appropriate to an unknown API route rather than `REPOSITORY_NOT_FOUND`;
- validate controller port/config values before passing invalid values to runtime APIs;
- ensure README status matches waypoint/OpenSpec status;
- ensure future Change 002 name in waypoint matches the roadmap when Milestone 1 is eventually accepted.

Do not widen this into a general refactor.

## 11. Definition of done

Change 001a is done only when:

1. clean generated outputs are removed and documented root verification still works;
2. `npm run dev` actually launches controller + UI + Electron on Windows;
3. package versions match the locked supported baseline or an evidence-backed decision update exists;
4. migrations are atomic and failure-tested;
5. event reconnect survives errors and React StrictMode lifecycle;
6. pathname deep links resolve correctly in the real UI;
7. non-conversation ChatGPT URLs are rejected;
8. acceptance checkboxes/evidence are reconciled truthfully;
9. no Milestone 2 runtime code was added;
10. the repository returns to `READY_FOR_REVIEW` for a second deep review.