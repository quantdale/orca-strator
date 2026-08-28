# Repository-Local Add-ons — Implementation Handoff

Implements `docs/agent-integrations/REPOSITORY_LOCAL_ADDONS_MASTER_PLAN.md`.

That plan was originally authored on the planning branch
`plan/repo-local-addons-2026-08-28` (tip
`fa9c57767234be3bbc89d70523f657ba8097ca0b`), which held the plan document and
nothing else. The document has since been merged onto `main` unchanged and the
branch deleted, so the reference above resolves in-tree.

Scope: two **dev-only** MCP servers, repository-local and additive-only. They are
consumed by the coding agent (Claude Code / Cursor / VS Code / Codex / Pi /
OpenCode), never by Orca's own autonomous runtime. They must not become Orca's
production Sol automation channel.

## Files changed (additions only)

| File | Purpose |
| --- | --- |
| `.mcp.json` | Universal MCP registry (read by Claude Code, Cursor, VS Code, Codex, Pi, OpenCode-compatible layers). |
| `.opencode/opencode.jsonc` | OpenCode-native mirror of the same two servers (project-scoped). |
| `scripts/mcp-preflight.mjs` | Fail-closed governance check: pinning, no secrets, no global resolution, no unsafe targets, drift-sync. |
| `docs/agent-integrations/REPOSITORY_LOCAL_ADDONS_HANDOFF.md` | This handoff. |

No existing MCP, plugin, skill, agent config, test harness, editor integration,
or durable agent-state mechanism was modified, removed, renamed, or rewritten.

## Selected versions / endpoints (pinned, not `@latest`)

| Server | Package | Pinned | License | Upstream | Engines (Node) |
| --- | --- | --- | --- | --- | --- |
| chrome-devtools | `chrome-devtools-mcp` | `1.8.0` | Apache-2.0 | github.com/ChromeDevTools/chrome-devtools-mcp | `^20.19 \|\| ^22.12 \|\| >=23` |
| context7 | `@upstash/context7-mcp` | `4.0.3` | MIT | github.com/upstash/context7 | `>=20.18.1` |

Both resolved and executed via `npx -y <pkg>@<ver> --help` (exit 0) on Node v24.3.0.

## Activation

Universal (any MCP-aware agent that reads `.mcp.json`): no action — picked up on
next session start.

OpenCode-native: either rely on the `.opencode/opencode.jsonc` mirror, or run
`opencode mcp add` for the project scope. No global/user config was mutated
automatically.

## Scope mechanism

- Repository-tracked configuration only (`.mcp.json` + `.opencode/opencode.jsonc`).
- Launcher is `npx` with an exact pinned version → pinned ephemeral execution
  from the repository cwd. No global install, no `PATH` mutation, no user-wide
  editor settings, no home-directory MCP registry changes.
- `chrome-devtools-mcp` is started with `--no-usage-statistics` (Google
  telemetry opt-out). It is loopback/Electron-diagnostics only; it never becomes
  Orca's Sol bridge.

## Environment-variable names (no secrets committed)

- `CONTEXT7_API_KEY` — optional; raises Context7 rate limits. Read from the
  ambient process environment if present; never stored in the repo.

## Validation results

- `node scripts/mcp-preflight.mjs` → PASS (pinned, secret-free, no global
  resolution, drift-synced between the two mirrors).
- `node scripts/ci/check-source-integrity.mjs` → OK (209 tracked files, 722
  relative imports resolve; new files add no broken imports).
- `npx openspec validate --all --strict` → 28 passed, 0 failed.
- `npx -y @upstash/context7-mcp@4.0.3 --help` → exit 0 (binary runs).
- `npx -y chrome-devtools-mcp@1.8.0 --help` → exit 0 (binary runs).

Full browser-driven validation of Chrome DevTools MCP requires a local Chrome /
Chrome-for-Testing install and an actual browser session; that is a runtime
prerequisite, not a config defect, and is out of scope for a headless preflight.

## Existing-integration preservation proof

`git status` after the change shows only **untracked** new files. `git diff`
against `HEAD` is empty for every pre-existing tracked path. Zero integrations
removed, zero capabilities disabled, zero global configuration changes, zero
secrets committed, zero unrelated dependency churn.

## Explicitly blocked / not-recommended (per plan)

- **GitHub MCP as a runtime dependency** — not added; Orca's durable Git
  protocol stays explicit.
- **Second browser automation authority in production** — not added.
- **Global CLI-agent configuration changes** — `GLOBAL_SCOPE_BLOCKED`; only
  repository-tracked config was introduced.

## Note on the other remote branch (corrected 2026-08-28)

An earlier revision of this handoff recorded
`origin/exploration/openflow-inspired-orca-evolution` as "a divergent
experimental branch (353 files, ~−61k lines) that would delete the product".
**That reading was wrong**, and the error is worth naming because it is easy to
repeat: the session that wrote it inspected the branch from a shallow clone, so
`main` and the exploration tip had no reachable common ancestor and every
`git diff` against a fabricated merge base looked like a mass deletion.

Against the true merge base (`2ba005468c3bbf938e4141ff3883725b223752c0`, found
after `git fetch --unshallow`) the branch was **four documentation commits
adding four files and 1,148 lines, with zero code and zero deletions**. It never
threatened the product.

Operational rule: never characterize a branch from a diff taken in a shallow
clone. Confirm `git merge-base` resolves first, and unshallow if it does not.

The branch content now lives at
`docs/explorations/openflow-inspired-orca-evolution/` and the branch itself has
been deleted.
