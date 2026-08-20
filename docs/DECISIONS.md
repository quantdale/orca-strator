# Orca-Strator V1 Decision Ledger

Status: **locked unless explicitly revised by the user or a later OpenSpec decision**

This file distinguishes product/architecture decisions from implementation preferences. Fresh agents should not reopen locked decisions without evidence that implementation is impossible or the user explicitly changes direction.

## D-001 — Application platform

**Decision:** Windows-only desktop application for V1.

**Notes:** managed repository executors may run in native Windows/PowerShell or WSL.

**Deferred:** native Linux/macOS desktop releases.

## D-002 — Repository as V1 orchestration unit

**Decision:** one repository = one autonomous Orca session in V1.

Per repository:

- one Sol conversation;
- one configured executor/model;
- at most one active executor;
- at most one active Sol turn.

Different repositories may run concurrently with no global executor cap.

**Deferred:** multiple branches/sessions/executors inside one repository.

## D-003 — Executor selection ownership

**Decision:** user selects executor CLI and model/configuration.

Sol cannot dynamically change executor/model during a run.

## D-004 — Sol role

**Decision:** browser ChatGPT Sol is primarily architect/reviewer/high-level decision maker.

Sol may also make code changes, including substantial fixes when useful and feasible.

The executor remains the normal implementation workhorse.

## D-005 — Sol stays in ChatGPT browser

**Decision:** do not move Sol into Codex/API merely for orchestration.

Reason: preserve desired ChatGPT-browser usage economics/limits.

## D-006 — Sol -> executor transport

**Decision:** local remote-Git watcher.

Not GitHub Actions, webhook, or MCP as primary V1 transport.

Watcher sees remote `main` movement and reacts only to valid isolated dispatch markers.

## D-007 — Transactional dispatch

**Decision:** Sol pushes ordinary spec/code work first, then creates a final isolated dispatch commit.

Watcher rejects a dispatch marker mixed with ordinary changes.

## D-008 — Executor -> Sol transport

**Decision:** Playwright browser automation.

Playwright submits a trusted wake message into configured exact ChatGPT conversation URL.

Playwright does not scrape Sol output as completion protocol.

## D-009 — Sol completion signal

**Decision:** durable Git/GitHub transition, not browser DOM response completion.

Expected outcome is new valid dispatch or durable Sol control decision.

## D-010 — Browser architecture

**Decision:** one on-demand Chromium process using one dedicated Orca automation profile; one page/tab per concurrently active repository Sol operation.

Chromium closes when no active Sol operations remain where practical.

Do not run multiple Chromium processes against same persistent profile.

## D-011 — ChatGPT authentication

**Decision:** user manually logs in through an Orca-headed setup browser.

Authentication persists in dedicated profile for later headless use.

Do not automate login or reuse user's ordinary Chrome profile.

## D-012 — ChatGPT backpressure

**Decision:** treat simultaneous-request/busy UI as backpressure.

Dismiss safe informational UI where needed and queue/retry with bounded backoff.

Do not attempt to bypass service-side limits.

## D-013 — Controller ownership

**Decision:** orchestration logic/state lives in standalone Node/TypeScript controller, separate from Electron window lifecycle.

Electron is desktop shell/client.

## D-014 — UI architecture

**Decision:** one responsive React UI shared by Electron and phone browser.

No separate native mobile application in V1.

## D-015 — Phone access

**Decision:** private Tailscale Serve route for V1.

Controller remains loopback-only by default.

Do not expose full control API publicly by default.

## D-016 — Local persistence

**Decision:** SQLite stores local configuration/runtime orchestration state.

Git/GitHub stores durable cross-agent coordination/work state.

These roles remain distinct.

## D-017 — State file ownership

**Decision:** no single global shared state file for all repositories.

Each managed repository has its own coordination artifacts/state; Orca local SQLite stores per-repository runtime rows.

## D-018 — Git integration branch

**Decision:** V1 always watches, reconciles, commits, and pushes `main`.

There is no configurable branch field in V1 repository record, API, or UI. This intentionally removes branch-selection complexity while V1 supports only one session/executor per repository.

For Orca-Strator development itself, commit/push directly to `main` unless user explicitly revises this decision.

**Deferred:** branch-per-session and configurable integration branches when multi-session-per-repository support is designed.

## D-019 — Dirty working trees

**Decision:** dirty/uncommitted work is not grounds to refuse autonomous work.

Preserve, inspect, reconcile, commit/push intended state.

Orca must not automatically discard with hard reset/clean.

## D-020 — Remote divergence

**Decision:** executor fetches/rebases/pulls `main` and resolves ordinary conflicts where possible.

Do not automatically force-push.

If it cannot safely resolve, publish truthful blocked/failure result for Sol review.

## D-021 — Executor completion contract

**Decision:** executor performs best safe implementation, verification, commit/push, result manifest, then exits.

Do not loop indefinitely solely to force every test green.

Executor result status may be:

- `COMPLETED`;
- `BLOCKED`;
- `NEEDS_HUMAN`;
- `FAILED`.

All normally wake Sol unless controls/ceilings suppress handoff.

## D-022 — High-level completion authority

**Decision:** Sol decides high-level `GOAL_COMPLETE`.

Executor saying `COMPLETED` means only executor turn completed.

## D-023 — Pause

**Decision:** Pause is executor-credit-oriented.

If executor is running:

- interrupt/terminate process tree;
- preserve checkout exactly as-is;
- do not wake Sol due to interruption;
- resume later on same work with recovery instructions.

If Sol already running, do not forcibly cancel solely because Pause was requested; record later durable result but suppress executor dispatch while paused.

## D-024 — Stop

**Decision:** graceful drain.

Current actor may finish; no next actor starts.

## D-025 — Emergency Kill

**Decision:** immediate termination of selected repository's active executor/browser operation, with explicit interrupted/recovery state.

For shared Chromium, isolate the selected repository page/operation where practical; process-wide failure must reconcile all affected repository Sol operations independently.

## D-026 — Runtime ceilings

**Decision:** default 20 iterations and 8 hours; configurable per repository/run.

When ceiling reached during active work, enter draining: allow actor to finish but do not start next handoff.

## D-027 — Sol timeout

**Decision:** default ~20 minutes after successful wake submission, retry once, then `SOL_STALLED`.

Configurable later.

## D-028 — Executor unavailable retry

**Decision:** up to three bounded launch/contact attempts before `EXECUTOR_UNAVAILABLE`.

This is about launching/contacting harness, not retrying failing implementation tests three times automatically.

## D-029 — Crash/reboot recovery

**Decision:** safe waiting states may auto-rehydrate.

Executor interrupted mid-work -> preserve checkout + `RECOVERY_REQUIRED`; V1 requires explicit Resume.

## D-030 — Development workflow for Orca-Strator

**Decision:** durable `/go` workflow.

Fresh coding session:

- read agent contract + waypoint + roadmap + active OpenSpec;
- recover Git/dirty work;
- continue next coherent task;
- verify;
- update tasks/waypoint;
- commit/push main;
- exit cleanly.

Significant milestone implementation returns to Sol/ChatGPT for deep review before next major OpenSpec change.

## D-031 — Planning method

**Decision:** significant work uses focused OpenSpec changes, not mega-prompts.

Repository artifacts are detailed work contract; executor bootstrap prompt remains small.

## D-032 — Initial technology stack

**Decision baseline:**

- Node 24 LTS;
- npm workspaces;
- TypeScript;
- Fastify 5;
- `node:sqlite` behind storage boundary;
- React 19.2;
- Vite 8.1;
- Tailwind 4.3;
- selective shadcn/ui;
- Vitest 4.1+;
- stable Electron 43 line for initial scaffold;
- Playwright later for browser bridge.

Patch versions follow lockfile/current compatible security releases.

## D-033 — Simplicity

**Decision:** detailed specification should reduce ambiguity, not justify elaborate implementation.

Avoid premature plugin systems, distributed services, cloud backend, message brokers, ORMs, and framework layers unless concrete V1 requirement proves needed.

## D-034 — Cross-agent protocol schemas

**Decision:** dispatch, executor-result, and Sol-control artifacts are validated against versioned machine-readable JSON Schemas under `schemas/protocol/`.

Prose protocol explains semantics; schemas define structural validity. Watcher/runtime implementations reject structurally invalid artifacts rather than guessing missing fields.

Schema version 1 is append-only/backward-stable once runtime implementation begins. Breaking changes require explicit new schema version and migration/compatibility decision.

## D-035 — Same-origin web/API topology

**Decision:** the shared React UI, controller REST API, and WebSocket share one Orca origin in built/runtime mode.

Canonical built shape:

```text
/
/api/*
/api/events
```

The UI uses relative routes. Vite proxies them in development. The controller serves built SPA in production-like local mode.

Future Tailscale Serve phone access reverse-proxies this one loopback origin, so phone browser does not try to call laptop `localhost` directly and no second mobile API client is needed.

Wildcard CORS is not the normal V1 phone-access design.

## D-036 — Exclusive browser-profile ownership

**Decision:** one browser process at a time owns the dedicated persistent Orca automation profile.

Both headless Browser Manager and headed ChatGPT setup browser use same global profile lock.

After profile opens, one browser process may host multiple concurrent repository Sol pages. The lock prevents competing browser **processes**, not concurrent pages inside the owner process.

Stale lock recovery must verify actual browser ownership before clearing it.

## D-037 — Post-V1 execution capabilities remain subordinate

**Decision:** OpenFlow-inspired capabilities such as ledgers, probes, budgets,
permissions, swarm, and DAG execution are subordinate strategies/facilities
inside one persistent Orca iteration. They do not replace the campaign/Sol/Git
hierarchy or make Orca an OpenFlow clone.

## D-038 — Capability probes never spend implicitly

**Decision:** STATIC and NON_INFERENCE probes are the default. An INFERENCE
probe requires an explicit user authorization and its result remains unknown if
the provider response was not actually obtained.

## D-039 — No default global executor cap

**Decision:** Independent repositories remain concurrently runnable without an
Orca-wide executor cap by default. Any later scheduler limit must be explicit,
transparent, and policy-recorded.

## D-040 — Parallel writers require qualified isolation

**Decision:** Same-repository parallel writing is forbidden until typed work
packets, isolated temporary worktrees/branches, integration semantics, crash
recovery, and deterministic qualification are complete. Single-agent remains
the default strategy.

## D-041 — Usage is evidence, never inference

**Decision:** Persist usage and cost only from reliable structured
executor/provider sources. Unknown remains unknown; estimated cost is visibly
estimated; Orca never scrapes fragile UI output or invents token/cost values.

## D-042 — Scheduler limits are explicit and unlimited by default

**Decision:** The scheduler foundation records transparent admission/queue
decisions, but nullable limits mean independent repositories remain runnable
without an Orca-wide cap unless the user configures one.

## D-043 — Role/model routing is user-authored only

**Decision:** A named role may resolve to an exact user-authored executor/model
rule. Without that rule, the repository's configured primary executor/model is
returned unchanged. Sol and hidden heuristics cannot switch quotas/models.

## D-044 — Typed packets precede same-repository writers

**Decision:** Any future same-repository fan-out must use versioned structured
packets/results and distinct isolated worktrees/internal branches. Single-agent
mode remains the default until real isolation/integration qualification passes.

## D-045 — Integration is a separate phase

**Decision:** A worker branch/result is not iteration completion. Deterministic
integration to main owns conflict detection, partial success, dependency skips,
and the structured result returned to Sol. No force-push or dirty-work discard
is permitted.

## How to revise a locked decision

If a locked decision must change:

1. user explicitly changes it, or implementation evidence proves infeasible;
2. update this ledger;
3. update `docs/ARCHITECTURE.md` and affected focused docs;
4. update active OpenSpec proposal/spec/design/tasks where relevant;
5. update `.agent/state.json` waypoint;
6. commit decision change before broad implementation depending on it.

Do not let code silently become only record of architectural reversal.
