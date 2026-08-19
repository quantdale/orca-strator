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

Reason: preserve the user's desired ChatGPT-browser usage economics/limits.

## D-006 — Sol -> executor transport

**Decision:** local remote-Git watcher.

Not GitHub Actions, webhook, or MCP as primary V1 transport.

Watcher sees remote `main` movement and reacts only to valid isolated dispatch markers.

## D-007 — Transactional dispatch

**Decision:** Sol pushes ordinary spec/code work first, then creates a final isolated dispatch commit.

Watcher rejects a dispatch marker mixed with ordinary changes.

## D-008 — Executor -> Sol transport

**Decision:** Playwright browser automation.

Playwright submits a trusted wake message into the configured exact ChatGPT conversation URL.

Playwright does not scrape Sol output as the completion protocol.

## D-009 — Sol completion signal

**Decision:** durable Git/GitHub transition, not browser DOM response completion.

Expected outcome is a new valid dispatch or durable Sol control decision.

## D-010 — Browser architecture

**Decision:** one on-demand Chromium process using one dedicated Orca automation profile; one page/tab per concurrently active repository Sol operation.

Chromium closes when no active Sol operations remain where practical.

Do not run multiple Chromium processes against the same persistent profile.

## D-011 — ChatGPT authentication

**Decision:** user manually logs in through an Orca-headed setup browser.

Authentication persists in the dedicated profile for later headless use.

Do not automate login or reuse the user's ordinary Chrome profile.

## D-012 — ChatGPT backpressure

**Decision:** treat simultaneous-request/busy UI as backpressure.

Dismiss safe informational UI where needed and queue/retry with bounded backoff.

Do not attempt to bypass service-side limits.

## D-013 — Controller ownership

**Decision:** orchestration logic/state lives in a standalone Node/TypeScript controller, separate from Electron window lifecycle.

Electron is a desktop shell/client.

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

These roles must remain distinct.

## D-017 — State file ownership

**Decision:** no single global shared state file for all repositories.

Each managed repository has its own coordination artifacts/state; Orca local SQLite stores per-repository runtime rows.

## D-018 — Git integration branch

**Decision:** V1 always watches, reconciles, commits, and pushes `main`.

There is no configurable branch field in the V1 repository record, API, or UI. This intentionally removes branch-selection complexity while V1 supports only one session/executor per repository.

For Orca-Strator development itself, commit/push directly to `main` unless the user explicitly revises this decision.

**Deferred:** branch-per-session and configurable integration branches when multi-session-per-repository support is designed.

## D-019 — Dirty working trees

**Decision:** dirty/uncommitted work is not grounds to refuse autonomous work.

Preserve, inspect, reconcile, commit/push intended state.

Orca must not automatically discard with hard reset/clean.

## D-020 — Remote divergence

**Decision:** executor should fetch/rebase/pull `main` and resolve ordinary conflicts where possible.

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

All normally wake Sol unless controls/ceilings suppress the handoff.

## D-022 — High-level completion authority

**Decision:** Sol decides high-level `GOAL_COMPLETE`.

Executor saying `COMPLETED` means only that executor turn completed.

## D-023 — Pause

**Decision:** Pause is executor-credit-oriented.

If executor is running:

- interrupt/terminate process tree;
- preserve checkout exactly as-is;
- do not wake Sol due to that interruption;
- resume later on same work with recovery instructions.

If Sol is already running, do not forcibly cancel it solely because Pause was requested; record its later durable result but suppress executor dispatch while paused.

## D-024 — Stop

**Decision:** graceful drain.

Current actor may finish; no next actor starts.

## D-025 — Emergency Kill

**Decision:** immediate termination of selected repository's active executor/browser operation, with explicit interrupted/recovery state.

## D-026 — Runtime ceilings

**Decision:** default 20 iterations and 8 hours; configurable per repository/run.

When ceiling is reached during active work, enter draining: allow actor to finish but do not start next handoff.

## D-027 — Sol timeout

**Decision:** default ~20 minutes after successful wake submission, retry once, then `SOL_STALLED`.

Configurable later.

## D-028 — Executor unavailable retry

**Decision:** up to three bounded launch/contact attempts before `EXECUTOR_UNAVAILABLE`.

This is about launching/contacting the harness, not retrying failing implementation tests three times automatically.

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

Significant milestone implementation returns to Sol/ChatGPT for deep review before the next major OpenSpec change.

## D-031 — Planning method

**Decision:** significant work uses focused OpenSpec changes, not mega-prompts.

Repository artifacts are the detailed work contract; executor bootstrap prompt remains small.

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

Avoid premature plugin systems, distributed services, cloud backend, message brokers, ORMs, and framework layers unless a concrete V1 requirement proves they are needed.

## D-034 — Cross-agent protocol schemas

**Decision:** dispatch, executor-result, and Sol-control artifacts are validated against versioned machine-readable JSON Schemas under `schemas/protocol/`.

The prose protocol explains semantics; schemas define structural validity. Watcher/runtime implementations must reject structurally invalid protocol artifacts rather than guessing missing fields.

Schema version 1 is append-only/backward-stable once runtime implementation begins. Breaking changes require an explicit new schema version and migration/compatibility decision.

## How to revise a locked decision

If a locked decision must change:

1. user explicitly changes it, or implementation evidence proves it infeasible;
2. update this ledger;
3. update `docs/ARCHITECTURE.md` and affected focused docs;
4. update active OpenSpec proposal/spec/design/tasks where relevant;
5. update `.agent/state.json` waypoint;
6. commit the decision change before broad implementation depending on it.

Do not let code silently become the only record of an architectural reversal.
