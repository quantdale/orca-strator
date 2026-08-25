# Execution Prompt — Change 026: Fresh-Clone Integrity & Production Resilience Hardening

Status: **ACTIVE**

Planned-From: `77f76aa4e000e4d30591db242323de8a1ccdf895`

Target branch: `main`

Campaign type: **post-roadmap hardening / ship-readiness repair**

## Objective

Restore Orca-Strator to a state where the pushed repository itself — not an agent's pre-existing ignored working tree — is the complete, reproducible source of truth, then harden the packaged controller and the wider autonomous runtime against the failure modes most likely to break unattended leave-and-forget operation.

This is the next campaign because the implementation roadmap is exhausted through Milestone 23 and there is no active OpenSpec change. Do **not** invent a feature milestone merely to keep moving. Treat this as a hardening campaign. Continue through every justified Critical/High defect uncovered by this audit; do not stop after the first fix.

## Audit evidence that must be reconciled first

Current pushed `main` contains committed imports/tests for runtime source that is not present in the pushed tree:

- `apps/controller/src/index.ts` imports `./runtime/build-identity.js` and `./runtime/singleton-lock.js`.
- `apps/controller/src/config/load-config.ts` imports `../runtime/paths.js`.
- `apps/controller/src/http/routes/system.ts` imports `../../runtime/readiness-service.js`.
- `apps/controller/test/runtime-paths.test.ts` imports `../src/runtime/paths.js`.
- The Change-025 tests/state/docs claim `runtime/paths.ts`, `runtime/singleton-lock.ts`, build identity, and readiness-service implementation exist and passed qualification.
- On pushed GitHub `main`, `apps/controller/src/runtime/` is absent.
- Root `.gitignore` contains the unanchored directory rule `runtime/`. Because this can match nested directories named `runtime`, it can suppress `apps/controller/src/runtime/**` from Git even while local tests/builds use those files.

This is a **P0 repository-integrity defect**. Until fixed, Change 025's local qualification cannot be treated as proof that a fresh clone can build or package the product.

Additional hardening evidence:

- packaged logging in `apps/controller/src/index.ts` checks the 5 MiB limit only when the controller starts, then appends indefinitely; a single long-running controller can exceed the intended bound without restart;
- Change 025 records upgrade/data preservation as complete, but the principal runtime evidence is close/reopen persistence of one built artifact rather than a clean-origin upgrade/reinstall/migration-style exercise;
- current `main` has Windows CI workflow files, but repository truth must be proven from a clean origin-only tree rather than trusted from historical local results;
- no open GitHub issues, pull requests, or active OpenSpec changes currently supersede this campaign.

## Required working method

Read and preserve `AGENTS.md`, `.agent/PLANNER_HANDOFF.md`, this file, `.agent/state.json`, `docs/ROADMAP.md`, and the relevant canonical specs/docs before editing. Inspect Git first. Preserve dirty/user work. Fetch/reconcile `origin/main` safely. Never force-push or use destructive reset/clean as convenience recovery.

Create a focused OpenSpec change for this campaign (use the next appropriate change number; `026-fresh-clone-integrity-and-production-resilience` is the expected name unless current Git truth has already created a successor). Proposal/design/tasks must be based on the actual repository and this evidence, not copied blindly from this prompt.

Do **not** begin with a broad historical test run. First establish source/Git truth and run the narrow checks that can falsify the P0 finding quickly.

## Workstream 1 — P0 forensic Git/source-truth repair

1. Inspect the actual working tree, ignored files, index, and pushed tree together:
   - `git status --short --ignored`
   - `git ls-files`
   - `git check-ignore -v` for every suspicious source path, especially `apps/controller/src/runtime/**`
   - compare current filesystem contents with `HEAD`/`origin/main`, not merely with the build output.
2. Determine exactly which production source/config/test-support files are present locally but missing from Git because of ignore rules or prior commit mistakes. Audit all broad directory ignores (`runtime/`, `logs/`, `build/`, `dist/`, `browser-profile/`, etc.) for unintended suppression of source directories anywhere in the monorepo.
3. Recover the intended Change-025 runtime sources into Git. Prefer preserving the existing local implementation if it exists and matches the qualified behavior. If the files are genuinely gone, reconstruct them only from current imports, committed tests, Change-025 canonical spec/design/tasks, and current architecture; do not silently redesign unrelated behavior.
4. Fix `.gitignore` semantics so generated/local runtime data remains excluded **without** globally ignoring legitimate source directories. Prefer anchored/specific generated-data patterns over blanket directory names. Do not solve this with a brittle one-off exception unless the broader ignore audit proves that is the safest rule.
5. Add a regression guard that fails when required production source is ignored/untracked. The guard must be meaningful from a clean checkout and should make the same class of mistake obvious before future package qualification.
6. Inspect the full repository for other imports/references to files absent from `HEAD`, generated-only source assumptions, or package steps that accidentally depend on ignored/untracked local files.

### P0 gate

Before moving on, prove from an **origin-only clean tree/worktree** that no ignored local source is rescuing the build. A fresh clone or detached clean worktree built strictly from committed files must resolve the runtime modules and pass at least the focused Change-025 path/singleton/readiness/controller-supervisor checks plus type resolution/build of affected workspaces.

Do not mark this gate complete using the existing dirty/ignored working tree alone.

## Workstream 2 — Whole-system blast-radius audit

The missing-source defect was introduced around Windows productization but its effects are system-wide. Audit how the repaired source and packaged-mode assumptions affect the entire codebase, not just the files touched by Change 025.

Trace and verify these boundaries end to end:

- controller bootstrap/config/path resolution, build identity, singleton ownership, listen failure, shutdown, and packaged logging;
- SQLite initialization/migrations, startup reconciliation, run/dispatch/executor stores, durable idempotency, and crash recovery;
- remote Git watcher -> dispatch -> iteration coordinator -> single-agent/swarm/DAG execution -> publication/postflight -> Sol wake/control closure;
- executor start serialization, process-tree kill/shutdown, retry/postflight, WSL/native path handling, and persisted logs;
- browser profile ownership, external setup Chrome, Playwright wake lifecycle, auth readiness, and crash/stale-lock behavior;
- scheduler/usage leases, permission attention parking/resolution, restart reconciliation, and concurrent-repository isolation;
- REST/WebSocket error contracts and UI projections for startup/readiness/failure states;
- Electron shell/preload isolation, startup retry behavior, controller reuse, external navigation/link handling, and background lifetime;
- package staging, production dependency closure, resource immutability, data-directory placement, and CI/release scripts;
- `.orca` protocol schemas/correlation, Git-truth invariants, and all adjacent canonical docs/specs.

For every reproducible Critical/High defect found, add it explicitly to the active OpenSpec tasks and fix it in this campaign. Medium/low findings may be fixed when small and safe or recorded truthfully for later; do not let them distract from P0/P1 work.

## Workstream 3 — Long-running packaged-controller durability

Harden the packaged controller for multi-hour/multi-day unattended use.

1. Replace startup-only packaged log rotation with a genuinely bounded runtime mechanism. Reuse the established executor `LogRotator` concepts where sensible or implement an equivalent safe controller logger.
2. Prove rotation occurs while the same controller process stays alive after crossing the configured limit; do not rely on a restart to enforce the bound.
3. Preserve timestamps/severity and useful error diagnostics/stack information. Do not reduce exceptions to useless `[object Object]` strings.
4. Preserve redaction/secret boundaries: no cookies, auth tokens, provider secrets, raw environment dumps, or browser storage in controller logs.
5. Logging failure, rotation failure, disk-full/permission-like errors, or a closed stream must not crash the orchestration controller. Surface the failure observably where practical.
6. Audit other leave-and-forget growth surfaces (executor logs, event listeners, in-memory maps/timers, retained worktrees/staging directories, stale lock files, artifact/temp directories) and repair concrete unbounded or leak-prone behavior discovered.

## Workstream 4 — Failure-injection and restart resilience

Add focused tests/qualifications for realistic faults that ordinary happy-path tests miss. At minimum cover the applicable cases below and expand when the audit finds adjacent hazards:

- concurrent desktop/controller startup and singleton race;
- stale/corrupt lock plus PID-reuse/ownership-safety edge cases;
- foreign/incompatible listener without killing it;
- abrupt controller termination followed by restart reconciliation;
- signal during controller initialization and shutdown while work is active;
- unwritable/missing data/log directories and log sink failure;
- database migration/init failure without reset/data loss;
- path handling with spaces and non-ASCII characters for data dir/repository/package paths;
- arbitrary process `cwd` in development and packaged mode;
- controller version/protocol mismatch and reuse rules;
- watcher/network/Git transient failures without duplicate executor launch;
- executor/browser child failure during shutdown/restart without orphaning sibling repositories;
- stale scheduler/strategy/worktree state recovery after process interruption.

Tests must assert durable state and cross-subsystem side effects, not just returned status codes.

## Workstream 5 — Clean-origin packaging and upgrade/data-preservation truth

1. Run the Windows build/package pipeline from a clean origin-only tree after P0 repair. Packaging must not consume ignored/untracked source from the developer workspace.
2. Re-run the real unpacked packaged-runtime smoke on the final implementing tree.
3. Strengthen package smoke so it explicitly proves the staged controller dependency/source closure is derived from committed build inputs.
4. Add a realistic data-preservation/migration exercise using an isolated `ORCA_DATA_DIR`: seed persisted repositories/run history/permissions/browser-profile metadata as appropriate, start a prior-compatible or pre-upgrade state, launch the current package/controller, let migrations/reconciliation run, and verify intended data survives unchanged except for documented migrations.
5. Do not falsely call close/reopen of the same binary an "upgrade" test.
6. Do not execute an NSIS install/uninstall or request elevation unless the current environment/user authorization already permits that machine mutation. If installer execution remains external, keep it explicitly `UNQUALIFIED` while still fully qualifying the unpacked/package and migration paths that can be tested safely.
7. Code signing, application icon work, auto-update infrastructure, Tailscale installation, and real OpenCode provider qualification remain outside this campaign unless they are already available and become necessary to fix a concrete hardening defect.

## Workstream 6 — CI/repository-integrity enforcement

Make it difficult to repeat the ignored-source qualification failure.

- Ensure Windows CI from a clean checkout runs dependency install, the repository-integrity/fresh-tree guard, fast tests, typecheck, build, lint, strict OpenSpec validation, and diff check.
- Add the cheapest reliable check that catches "build passes only because an ignored local source directory exists". A detached clean worktree/build step, tracked-source manifest check, or equivalent is acceptable if deterministic and maintainable.
- Keep package CI's `PACKAGE_BUILT` vs local real `PACKAGE_RUNTIME_QUALIFIED` distinction truthful.
- Investigate any reason CI is not actually executing/visible for pushes; fix repository-controlled workflow/config defects if present. Do not fabricate successful CI evidence when account/repository settings outside Git are the blocker.

## Workstream 7 — Documentation, OpenSpec, and durable state truth

After implementation evidence is real:

1. Update Change-025 qualification wording wherever it overstates fresh-clone or upgrade proof. Preserve historical evidence, but clearly distinguish what was local-tree-qualified from what this campaign newly proves from committed origin truth.
2. Update `docs/ROADMAP.md`, `README.md`, `docs/DEVELOPMENT.md`, `docs/TEST-STRATEGY.md`, `docs/SECURITY.md`, `docs/OBSERVABILITY-AND-FAILURES.md`, `docs/ARCHITECTURE.md`, and other affected canonical docs only where the audit/implementation changes the contract.
3. Update `.agent/state.json` to activate and later close this hardening campaign with exact evidence and remaining external blockers.
4. Fold completed OpenSpec deltas into canonical specs and archive the change only after all acceptance gates are met.
5. If this campaign uncovers another independent Critical/High hardening wave that cannot be safely folded here, activate the next hardening change and continue rather than stopping merely because Change 026 closed.

## Constraints / invariants

- Preserve controller ownership of orchestration; Electron remains a shell/supervisor.
- Preserve Git/GitHub as durable cross-agent truth.
- Preserve one active executor/strategy owner per repository campaign boundary and cross-repository independence.
- Preserve strict dispatch/result/control correlation and replay/idempotency guards.
- Preserve dirty work; never `git reset --hard`, destructive-clean, or force-push as convenience recovery.
- Never kill foreign processes to resolve port/lock conflicts.
- Keep default controller exposure loopback-only and preserve Electron `contextIsolation`, disabled `nodeIntegration`, and sandboxing.
- Do not weaken path/schema validation or broaden shell-command construction from untrusted repository/UI data.
- Do not commit DBs, logs, browser profiles/cookies, credentials, generated package resources, or machine-local runtime state while fixing `.gitignore`.
- Do not fake Tailscale, OpenCode, ChatGPT auth, installer, signing, or other external qualification.
- Do not assume any particular model, provider, agent harness, or reasoning-effort setting. Use repository contracts and available tools.

## Validation requirements

Use focused tests during implementation. At meaningful checkpoints and before closeout, run the complete applicable gates on the final committed-source tree:

- repository-integrity / clean-worktree or fresh-clone guard added by this campaign;
- focused Change-025/026 suites for runtime paths, singleton ownership, readiness, controller supervision, logging, failure injection, upgrade/data preservation, and any repaired subsystems;
- `npm test`;
- `npm run test:real` — only explicitly classified external-unqualified skips are acceptable;
- `npm run typecheck`;
- `npm run build`;
- `npm run lint`;
- `npx openspec validate --all --strict`;
- `git diff --check`;
- Windows `npm run package:win` from a clean origin-only tree;
- final real `npm run smoke:package` against that artifact;
- any additional targeted real-Git/process/restart qualifications required by defects fixed in this campaign.

Record exact commands, counts, skips, artifacts, and failures. Historical green results are not substitutes.

## Acceptance / completion gates

This campaign is complete only when all of the following are true:

1. Every production source file required by committed imports/build/package steps is actually tracked in Git and present in a fresh clone; `apps/controller/src/runtime/**` is no longer rescued by ignored local state.
2. `.gitignore` still excludes runtime data/secrets/artifacts but cannot silently swallow legitimate nested production source directories of the same generic names.
3. A clean origin-only tree installs/builds/tests the affected workspaces without borrowing ignored files from the original workspace.
4. The full application/package pipeline passes from committed source, and the real packaged-runtime smoke is re-qualified on the final tree.
5. Controller logging is bounded during one long-running process and preserves useful/redacted diagnostics.
6. Reproducible Critical/High defects found by the whole-codebase blast-radius/failure audit are fixed with regression evidence.
7. Upgrade/data-preservation claims are backed by a real isolated migration/preservation exercise, while installer execution remains honestly external if not authorized.
8. OpenSpec/canonical docs/`.agent/state.json` reflect exact current truth with no stale "roadmap exhausted, ask user" waypoint while this campaign is active.
9. Intended work is committed and pushed to `origin/main`; final local HEAD equals `origin/main`; working tree is clean except for explicitly documented user/machine-local ignored state.

## Git and reporting requirements

Work directly on `main` per repository policy unless the user explicitly changes it. Reconcile remote divergence safely. Commit coherent checkpoints and push them; do not accumulate an enormous unpushed final state.

The final implementation commit/handoff message must be a substantive session report including:

- starting and final SHAs;
- root cause of the ignored-source/fresh-clone defect and exactly what was recovered/tracked;
- `.gitignore` changes and the regression guard;
- every Critical/High defect fixed across the blast-radius audit;
- focused/full/fresh-tree/package verification evidence;
- upgrade/data-preservation evidence;
- exact external-unqualified blockers still remaining;
- OpenSpec/docs/state reconciliation performed;
- confirmation that `main == origin/main` and intended work is pushed.

Do not stop to print another prompt. Execute this ACTIVE campaign under `/goal continue` semantics from the first genuinely incomplete requirement until the completion gates are satisfied or no safe useful work remains without a true external dependency.
