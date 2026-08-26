# Orca-Strator V1 Technology Baseline

Status: **locked baseline for initial implementation; patch versions may move within compatible lines**

Verified against primary project documentation in August 2026.

## 1. Runtime

### Node.js

Use **Node.js 24 LTS (Krypton)** for the standalone controller and development tooling.

Baseline expectation:

```text
Node major: 24 LTS
minimum recommended: >= 24.15
package manager: npm 11
```

Reasoning:

- Node 24 is LTS through April 2028;
- Playwright officially supports latest Node 22/24/26;
- Electron 43 uses Node 24 internally;
- `node:sqlite` is available without an extra native database package and reached release-candidate stability in Node 24.15.

Prefer the latest security-patched Node 24 LTS release available when scaffolding/installing.

Do not move the project to Node 26 Current merely because it is newer; prefer the LTS line unless a concrete dependency requires otherwise.

## 2. Package manager

Use **npm workspaces**.

Reasons:

- already bundled with selected Node line;
- sufficient for a small monorepo;
- avoids introducing pnpm/yarn/Turborepo solely for workspace management;
- simple for fresh `/go` sessions.

One root `package-lock.json` is authoritative.

## 3. Language

Use **TypeScript** for application/controller/shared code.

Use strict settings from the beginning.

Baseline compiler philosophy:

```text
strict = true
no implicit any
no casual skip of type errors to advance milestones
```

Exact latest compatible TypeScript patch can be selected at scaffold time and committed in lockfile.

## 4. Controller HTTP server

Use **Fastify 5.x** unless implementation evidence shows a materially simpler alternative.

Reasons:

- small local HTTP server fit;
- structured plugin/route model without a large framework;
- built-in schema-oriented ecosystem;
- supports modern Node versions.

Do not add NestJS or another application framework in V1.

## 5. Runtime validation

Preferred: **Zod** or another small Standard-Schema-compatible runtime validator if it avoids duplicating validation.

Selection rule:

- one schema source should ideally support parsing/validation and inferred TS types;
- keep SQL mapping explicit;
- do not introduce an ORM solely for schema validation.

If Fastify JSON Schema alone proves simpler, document the choice in Change 001 design rather than running two independent validation systems.

## 6. SQLite

Preferred initial implementation: **Node `node:sqlite`** under Node 24 LTS.

Use it behind a small storage boundary.

Rationale:

- no native addon rebuild/install complexity;
- controller is a standalone Node process rather than executing DB calls inside Electron renderer;
- functionality is sufficient for Orca's modest local relational workload.

Important:

- in Node 24.15+, `node:sqlite` is release-candidate stability rather than fully stable;
- if implementation discovers a concrete blocker, swapping the storage driver is allowed because DB access is isolated behind storage interfaces;
- do not add Prisma/Drizzle/TypeORM unless later schema complexity clearly justifies it.

Runtime performance contract (do not regress without evidence):

- **WAL + `synchronous = NORMAL`.** The watcher persists liveness every 5s per
  watched repository and the campaign ledger records executor log lines
  individually; with the default `synchronous = FULL` every such commit fsynced
  the WAL. NORMAL is the SQLite-recommended WAL pairing: commits stay
  consistent, only checkpoint-time fsyncs remain. Accepted tradeoff: an OS
  crash/power loss may roll back the most recent commits — Git/GitHub remains
  the durable cross-agent truth.
- **Prepared statements are cached per connection**
  (`apps/controller/src/db/statement-cache.ts`). `node:sqlite` compiles SQL on
  every `prepare()` and keeps no internal cache; stores must go through
  `preparedStatement(db, sql)` instead of raw `db.prepare()` for repeated
  statements (measured 4–11× per-call overhead; benchmark:
  `scripts/profiling/sqlite-prepare-bench.mjs`).
- **No-op watcher polls are silent.** An unchanged remote-HEAD poll updates
  `watcher_state.last_polled_at` but publishes no event and writes no
  `campaign_trace_events` row (a heartbeat here previously added ~17k permanent
  rows/day/watched repository). Polls that observe movement or errors still
  publish and are recorded.

## 7. Frontend

### React

Use **React 19.2** major/minor baseline.

No framework such as Next.js is required because Orca is a local SPA/desktop UI.

### Vite

Use **Vite 8.1** baseline.

This is appropriate for the shared React SPA and currently stable.

### Tailwind CSS

Use **Tailwind CSS 4.3** baseline.

Use the modern Vite integration/configuration style rather than legacy Tailwind 3 scaffolding.

### shadcn/ui

Use current shadcn/ui primitives selectively.

Do not install a giant component catalog. Add only components actually needed by the active screen/task.

### Client state

Use React local state by default.

Use **Zustand** only for genuinely shared client-only state where React/query-derived state becomes awkward.

Do not mirror all server state into a global Zustand store unnecessarily.

## 8. Testing

Use **Vitest 4.1+** baseline for TypeScript/unit/integration tests.

Vitest 4.1 explicitly supports Vite 8.

For React DOM behavior, add the smallest standard testing stack needed (for example Testing Library + jsdom/happy-dom depending compatibility).

Playwright later owns browser/E2E automation; do not force every component test through Playwright.

## 9. Electron

Use the **Electron 43 stable line** for initial scaffold unless a newer stable release is available and verified compatible at implementation time.

Do not use prerelease/nightly Electron for V1.

Electron is the Windows desktop shell only.

Baseline security:

```text
contextIsolation = true
nodeIntegration = false
```

No direct SQLite ownership in renderer/main simply because Electron includes Node.

## 10. Playwright

Playwright is not implemented until Milestone 4, but the baseline is:

- current stable Playwright compatible with Node 24;
- Chromium automation only for the Sol bridge unless another browser is later justified;
- Windows 11 supported;
- headless normal mode;
- headed setup/debug mode;
- one dedicated persistent Orca automation profile;
- one browser process with multiple pages for concurrent repositories.

Pin Playwright dependency/browser versions together in lockfile when Milestone 4 starts.

## 11. Lint and formatting

Keep tooling minimal.

Preferred approach:

- ESLint current compatible line for correctness/style rules;
- Prettier only if it adds clear value rather than duplicating formatter behavior;
- one root command each for lint/format checks.

Do not spend Change 001 building a complex lint configuration.

## 12. Root script contract

Target root scripts:

```json
{
  "scripts": {
    "dev": "...",
    "build": "...",
    "typecheck": "...",
    "test": "...",
    "lint": "..."
  }
}
```

Optional later:

```text
test:watch
test:e2e
format
format:check
```

A fresh agent should not need to discover package-specific commands for the common verification path.

## 13. Dependency update policy

During V1 development:

- commit exact resolved versions in `package-lock.json`;
- use supported stable release lines;
- avoid prerelease dependencies unless necessary;
- do not constantly churn dependencies during unrelated feature work;
- security/compatibility updates may move patch/minor versions after verification.

Architecture docs describe compatible baseline lines; lockfile records exact build state.

## 14. Explicit non-selections

V1 deliberately does not use:

- Next.js;
- Tauri/Rust;
- NestJS;
- Prisma/large ORM by default;
- Redis/message broker;
- Docker as a required local runtime;
- Kubernetes;
- Turborepo/Nx unless workspace complexity later proves npm scripts insufficient;
- separate native mobile app;
- public cloud backend.

These are not forbidden forever. They simply do not solve current V1 problems better than the selected simpler stack.

## 15. Primary references checked August 2026

- Node.js downloads/releases: https://nodejs.org/en/download
- Node.js SQLite API: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- Electron releases/schedule: https://releases.electronjs.org/
- React versions: https://react.dev/versions
- Vite blog/releases: https://vite.dev/blog
- Tailwind blog/releases: https://tailwindcss.com/blog
- Fastify v5 documentation: https://fastify.dev/docs/latest/
- Vitest blog/releases: https://vitest.dev/blog
- Playwright installation/system requirements: https://playwright.dev/docs/intro
