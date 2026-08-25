# Design: Fresh-clone integrity and production resilience hardening

## Context

The P0 defect is not a code bug — every local check was green because ignored
files rescued the build. The failure mode is *Git truth divergence*: the
pushed tree was not the system that was qualified. Repair therefore optimizes
for restoring Git truth verbatim and making recurrence structurally visible,
not for rewriting anything.

## Decisions

### D1 — Recover sources verbatim; no opportunistic redesign

`build-identity.ts`, `paths.ts`, `singleton-lock.ts`, `readiness-service.ts`
and leaf `db/schema-compat.ts` are committed exactly as locally qualified
(they carry additive Change-026 fields such as `controlToken` and
`maxSchemaVersion`; these are backward-compatible protocol-1 extensions).
Reconstructing "cleaner" variants would invalidate the qualification story a
second time.

### D2 — Anchor generic data rules instead of negation exceptions

`.gitignore` gains root anchoring (`/logs/`, `/runtime/`, `/browser-profile/`,
`/.orca-local/`) rather than `!` exceptions per source path. Build-output
patterns (`dist/`, `build/`, `out/`, ...) stay unanchored because each
workspace legitimately produces them. The rule: **generic directory names that
also exist as source directories must never be ignore rules**; generated data
lives under the Orca data directory or explicit root-level paths.

### D3 — Integrity guard checks resolution, not ignore lists

`scripts/ci/check-source-integrity.mjs` enumerates tracked TS source via
`git ls-files` with `:(glob)` pathspecs (plain `**/*.ts` silently skips files
directly under `src/`), extracts relative imports from comment-stripped text,
resolves candidates with Node ESM + TypeScript `.js -> .ts` semantics, and
classifies each unresolved winner through authoritative
`git check-ignore --stdin` output (IGNORED_BY_GITIGNORE vs UNTRACKED) before
failing with precise diagnostics. On a fresh clone an ignored-required module
is simply missing, so the same guard fails there too — no reliance on local
state to detect local-state rescue.

### D4 — Guard enforcement rides existing gates

Cheapest reliable enforcement: `pretest` hook plus Windows CI step, so any
`npm test` and every CI run fails on Git-truth divergence before expensive
stages. A detached clean-worktree build remains the periodic deep check
(P0 gate) rather than a per-run cost.

## Risks / Trade-offs

- Verbatim recovery commits in-flight Change-026 fields inside a repair
  commit; accepted deliberately and documented so history explains why.
- Import extraction by regex can theoretically false-positive; comment
  stripping plus human-reviewable failure output keeps this acceptable for a
  guard whose failure mode is "stop and look".
- Runtime log bounding adds a stat call per write batch; negligible against
  process-spawn-dominated controller workloads.
