# Proposal: Fresh-clone integrity and production resilience hardening

## Why

A repository-wide audit of pushed `main` (planner commit `57cc36f`, planned
from `77f76aa`) found a P0 repository-integrity defect plus adjacent
leave-and-forget hardening gaps:

1. **Ignored production source (P0).** Root `.gitignore` contained the
   unanchored rule `runtime/`, which suppressed
   `apps/controller/src/runtime/**` from Git while committed code imported it
   (`index.ts` -> `runtime/build-identity.js` + `runtime/singleton-lock.js`,
   `config/load-config.ts` -> `../runtime/paths.js`,
   `http/routes/system.ts` -> `../../runtime/readiness-service.js`, and the
   committed `runtime-paths` / `singleton-lock` / `system-readiness` test
   suites -> `../src/runtime/*.js`). Change 025 was qualified locally against
   these ignored files, so its "green" results never proved a fresh clone can
   build or package Orca-Strator.
2. **Unbounded packaged log growth.** The controller checks the 5 MiB log
   rotation limit only during startup, then appends indefinitely; one
   long-running leave-and-forget controller can exceed the intended bound.
3. **Upgrade/data-preservation proof gap.** Upgrade evidence relied on
   close/reopen persistence of one built artifact rather than a clean-origin
   upgrade/reinstall-style exercise.

## What Changes

- Anchor all generic local-data ignore rules (`logs/`, `runtime/`,
  `browser-profile/`, `.orca-local/`) to the repository root so they can never
  swallow nested production source directories again.
- Recover the suppressed runtime sources into Git verbatim
  (`build-identity.ts`, `paths.ts`, `singleton-lock.ts`, `readiness-service.ts`
  plus their leaf dependency `db/schema-compat.ts`); no behavioral redesign.
- Add `scripts/ci/check-source-integrity.mjs`: fails when any relative import
  inside tracked TypeScript source resolves to a missing, Git-ignored, or
  untracked module — the exact defect class that broke fresh clones. Wire it
  into ordinary gates and Windows CI.
- Bound packaged controller logging at runtime (size-checked appender), not
  only at startup.
- Prove the repaired tree from an origin-only clean worktree: install, build,
  focused Change-025/026 suites, full gates, and `package:win` + smoke from
  committed sources only.
- Perform a blast-radius/failure-injection audit across controller lifecycle,
  SQLite/migrations, loop, executors, browser, scheduler boundaries; fix
  reproducible Critical/High defects found.
- Exercise upgrade/data preservation via isolated synthetic-version
  migration/preservation runs; keep installer execution honestly gated to
  sanctioned environments.
- Reconcile Change-025 qualification wording, docs, and `.agent/state.json`;
  fold canonical specs and archive this change when gates pass.

Note on numbering: the next free OpenSpec number at planning time would have
been `026`; current working truth already contains
`026-installed-release-lifecycle-and-endurance` (a parallel hardening wave
recovered from local state), so this campaign takes `027`.

## Capabilities

### New: `repository-source-truth`

Covers anchored ignore semantics for generated data vs production source,
tracked-source integrity enforcement, and fresh-clone reproducibility gates.

### New: `production-resilience-hardening`

Covers runtime-bounded packaged logging, clean-origin upgrade/data-preservation
qualification, and blast-radius/failure-injection closure for long-running
installed operation.

## Impact

- Code: `.gitignore`, `scripts/ci/check-source-integrity.mjs`, recovered
  `apps/controller/src/runtime/**` + `db/schema-compat.ts`,
  `packages/shared/src/product.ts` identity fields (already additive),
  controller logging, CI workflows, packaging scripts.
- No V1 orchestration semantic changes; guards and qualification only.
- External blockers preserved honestly: Tailscale elevation, authorized
  OpenCode endpoint, code-signing certificate, installer execution outside
  sanctioned environments.
