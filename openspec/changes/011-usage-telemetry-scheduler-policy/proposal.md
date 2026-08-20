# Change 011: Usage Telemetry & Explicit Scheduler Policy

## Status

Implementing after Change 010 was verified, folded, committed, and pushed.

## Why

Change 010 makes execution and readiness queryable, but it intentionally leaves
provider usage, cost, resource admission, and future role routing without a
durable contract. This change adds truthful partial telemetry and explicit
policy foundations without silently spending another model, changing the
user's configured executor, or imposing a global cap on independent
repositories.

## Scope

1. Record usage only from trustworthy structured executor/provider sources;
   preserve unknown and estimated values distinctly.
2. Persist a transparent scheduler policy and admission decisions for future
   same-repository fan-out. The default permits independent repositories to
   execute concurrently without an Orca-wide limit.
3. Persist user-authored role/model rules. If no rule exists, the repository's
   configured executor/model remains authoritative.
4. Expose usage, scheduler, and role policy through focused APIs and the
   existing operational-intelligence UI.
5. Add unit, deterministic integration, restart, negative, and real local
   qualification coverage without making today's single-agent loop dependent on
   a scheduler or provider telemetry.

## Non-goals

- no automatic adaptive routing, quota spending, or hidden model selection;
- no mandatory global executor limit;
- no same-repository parallel writers, worktrees, swarm, or DAG behavior;
- no fragile scraping of CLI/browser UI output;
- no fabricated token counts or costs.

## Success criteria

- A run with no reliable telemetry is visibly `UNKNOWN`, not zero-cost.
- Exact and estimated cost remain distinguishable and source-attributed.
- Scheduler decisions explain queued/admitted state, limiting policy, and
  runnable time; default independent repositories remain unrestricted.
- Explicit role rules resolve only when user-authored; otherwise resolution is
  exactly the repository configuration.
- All Change 009/010 invariants and gates remain green.
