# Orca-Strator

Orca-Strator is a Windows-first autonomous development orchestrator for running multiple repository-level AI coding sessions in parallel while using a browser ChatGPT Sol conversation as the high-intelligence architect/reviewer and a user-selected headless coding agent as the executor.

## Core V1 model

For every configured repository:

```text
1 repository
    = 1 Orca autonomous session
    = 1 dedicated ChatGPT Sol conversation
    = 1 configured executor CLI/model
    = max 1 active executor for that repository
    = max 1 active Sol turn for that repository
```

Different repositories are independent and may run simultaneously with no global executor cap.

A repository executes through either:

- native Windows/PowerShell; or
- a configured WSL distribution and Linux working directory.

The user chooses executor and model. Sol does not dynamically change them in V1.

V1 Git orchestration is intentionally simple: **every managed repository uses `main`**. There is no per-repository branch configuration until future multi-session/branch work is explicitly designed.

## Intended autonomous loop

```text
high-level goal
      |
      v
Browser ChatGPT Sol
architect/reviewer
      |
planning/spec/code commits to main
      |
final isolated dispatch commit
      |
      v
local Orca remote-Git watcher
      |
      v
configured headless executor
(Windows or WSL)
      |
implement/test/reconcile main
      |
commit + isolated result manifest + push
      |
      v
Playwright wakes exact Sol conversation
      |
      v
Sol reviews GitHub
      |
      +----> next OpenSpec + dispatch
      |
      +----> GOAL_COMPLETE / BLOCKED / NEEDS_HUMAN
```

Git/GitHub is durable cross-agent truth. Local SQLite stores machine-local orchestration/runtime state.

## Application architecture

V1 stack baseline:

- **Runtime/tooling:** Node.js 24 LTS + npm workspaces + TypeScript
- **controller HTTP:** Fastify 5
- **local database:** Node `node:sqlite` behind a small storage boundary
- **Windows desktop shell:** Electron stable 43-line baseline
- **shared UI:** React 19.2 + Vite 8.1
- **styling/components:** Tailwind CSS 4.3 + selective shadcn/ui
- **tests:** Vitest 4.1+ plus focused React/controller/storage tests
- **background controller:** standalone Node.js/TypeScript process
- **controller web boundary:** loopback SPA + REST + WebSocket on one origin
- **Sol browser automation later:** Playwright
- **repository/executor integration later:** Git + PowerShell/`wsl.exe` + configured coding-agent CLIs
- **private phone access later:** Tailscale Serve reverse-proxying the same loopback Orca origin

Electron is not the orchestration owner. The controller remains runtime source of truth when desktop window closes.

### Same-origin web seam

Change 001 establishes this runtime shape:

```text
http://127.0.0.1:47100/
├── /                 shared built React UI
├── /api/*             controller REST
└── /api/events        controller WebSocket
```

The UI uses relative `/api` routes. In development, Vite proxies them to controller. A phone loads a private Tailscale HTTPS URL that reverse-proxies this single loopback origin, so the same client keeps working without pointing phone-local `localhost` at the laptop or requiring a second mobile networking layer.

## Windows packaging, releases, and installed lifecycle (Change 025 + 026)

Orca ships as a self-contained Windows desktop product:

```powershell
npm run version:check          # canonical release-version coherence gate
npm run package:win            # unpacked artifact -> apps/desktop/release/win-unpacked/
npm run package:win:installer  # per-user NSIS installer -> apps/desktop/release/*.exe (stamps build-info)
npm run smoke:package          # real packaged-runtime smoke against the built exe
npm run test:crash-recovery    # packaged crash/stale-lock/recovery harness
npm run test:endurance:short   # CI-safe endurance cycles; --cycles 30 = long soak (test:endurance)
npm run test:stress:repos      # multi-repository packaged stress isolation
npm run smoke:installer        # NSIS installer lifecycle acceptance (isolated env only)
npm run backup / restore       # durable-state bundle CLI seams (+ test:backup-restore gate)
```

- **Launch**: `Orca-Strator.exe` probes the loopback controller first. A PACKAGED desktop reuses only an **exact build** (same semantic version AND same Git build identity); any other Orca-but-different build is replaced through an authenticated graceful-shutdown contract, or surfaces a truthful `RESTART_PENDING` state when campaigns are active. Development mode keeps looser protocol-only reuse.
- **Safe replacement**: the controller publishes a per-start random control token in its runtime-lock metadata; `POST /api/system/shutdown` requires it (constant-time compare), reports truthful quiescence (`/api/system/lifecycle`: idle vs active-campaigns), and refuses to terminate running work. Renderer JavaScript and web pages have no process-control authority; foreign listeners are never sent lifecycle requests and never killed.
- **Database compatibility**: a binary refuses (typed `DATABASE_TOO_NEW`, exit code 12) to start on a database whose schema is NEWER than it knows — no migrations, watchers, browsers, or executors run and nothing is mutated. Before applying migrations to existing data, a verified consistent snapshot (SQLite `VACUUM INTO` + SHA-256 metadata, bounded retention) is written under `<dataDir>\backups\pre-migration\`; backup failure blocks the migration.
- **Backup / recovery**: Settings → Create Backup (and `npm run backup`) produces a manifest+checksummed SQLite bundle that structurally excludes cookies/profiles, credentials, repositories, worktrees, locks, and logs. Restore validates checksums/schema/quiescence, preserves prior state as a recovery copy, and rejects tampered archives.
- **Background lifetime**: closing the window quits only the shell; controller-owned campaigns keep running. Relaunch reuses the same controller without duplicate spawn. A full Orca shutdown exists ONLY through the authenticated contract above — there is deliberately no unauthenticated shutdown endpoint.
- **Data placement**: SQLite DB, logs (`logs/controller.log`, size-rotated), browser profile, backups, and the singleton lock live under `%LOCALAPPDATA%\Orca-Strator` (override with `ORCA_DATA_DIR`), never inside the install directory. Upgrades/reinstalls preserve all of it; uninstall never deletes user data (`deleteAppDataOnUninstall: false`). The installer/uninstaller aborts when safe controller quiescence cannot be proven (active-campaign guidance included); it never task-kills by name or PID wildcard.
- **System readiness**: Settings → System Readiness composes writable-data-dir, database, Git, Chrome, ChatGPT auth, repository paths, conditional WSL, and optional Tailscale/OpenCode into READY / ACTION_REQUIRED / OPTIONAL / UNKNOWN checks with remediation hints (`/api/system/readiness`).
- **Releases**: one canonical product version lives in the root `package.json` (`npm run release:prepare -- <semver>` updates everything atomically). Tag-triggered CI verifies tag==version, builds from the recorded commit SHA, derives signing truth from actual Authenticode verification, and publishes provenance (`release-manifest.json`), `SHA256SUMS.txt`, and a CycloneDX SBOM with the GitHub Release. Artifacts remain UNSIGNED unless you configure real signing; automatic updates stay deferred while releases are unsigned.

## Current development status

**Milestone 1 — Bootstrap control plane** is complete and folded (`openspec/specs/control-plane-foundation/`).

**Milestone 2 — Repository watcher and transactional dispatch** is complete and folded (`openspec/specs/repository-watch-dispatch/`).

**Milestone 3 — Headless executor runtime** is complete and folded (`openspec/specs/headless-executor-runtime/`).

**Milestone 4 — Playwright Sol bridge** is complete and folded (`openspec/specs/playwright-sol-bridge/`).

**Milestone 5 — Autonomous loop and multi-repository concurrency** is complete and folded (`openspec/specs/autonomous-loop-engine/`).

**Milestone 6 — Runtime ceilings, recovery, and hardening** is complete and folded (`openspec/specs/runtime-recovery-hardening/`).

**Milestone 7 — Private phone access and notifications** is complete and folded (`openspec/specs/remote-phone-experience/`).

**Milestone 8 — End-to-end autonomy qualification** is *implemented* and folded (`openspec/specs/end-to-end-autonomy-qualification/`). Its real end-to-end qualification was completed by the Change 009 hardening campaign (folded into `openspec/specs/runtime-integration-hardening/`) plus the 2026-08-23 real-dogfood campaign with real external actors (see below).

All nine V1 milestones are **implemented in code** and internally
machine-qualified by the Change 009 hardening campaign: production `buildApp`
lifecycle, the watcher -> loop -> executor -> result -> Sol service graph,
Windows/WSL executors and Git adapters, controls, recovery, and scheduler/
permission foundations all pass their real-tier gates on this machine with real
Git, real child-process executors, and real `wsl.exe` execution.

The formerly external core dependencies are now **QUALIFIED on real externals**
(2026-08-23 real-dogfood campaign, see
[`docs/REAL-DOGFOOD-QUALIFICATION.md`](docs/REAL-DOGFOOD-QUALIFICATION.md)):
real ChatGPT-authenticated wake through headed installed-Chrome automation on
the dedicated authenticated profile (eight successful real wakes across four
runs), and real Kimi + Codex inference executed by Orca's production loop
(two-iteration GOAL_COMPLETE campaign run `de6fc5d2`; one-turn Codex run
`a19f488f`). V1 remains honestly UNQUALIFIED only for genuinely external
dependencies that are still absent on this machine: the Tailscale phone route
(installation requires manual elevation) and an authorized OpenCode server —
neither is faked.

Honest status (this machine):

- **MACHINE-QUALIFIED** — production `buildApp` lifecycle (Q.APP.1) + service-graph `Q.WIN.1`/`Q.WIN.WSL.1`/`Q.WIN.3`; Windows/WSL Git adapters (WSL remote probe via `wsl.exe`); deterministic harness (slow mode, `ORCA_SLOW_MS`, `ORCA_RECOVERY`, graceful Stop naturally, isolated emergency kill, ceiling no-kill); executor result contract with semantic validation + nonzero-exit preservation + retryable postflight; Sol-boundary drain completion (dispatch is boundary); strict dispatch correlation (stale/wrong-run rejected); drainReason persistence + wall-clock / SOL rehydration; PaUSE is executor-only; honest Tailscale detection; secret-redacted event stream; Chromium provisioning (`chromium-1234` present via `browser:install`, version-pinned `playwright@1.62.1`) + `provisioning.ts`; Kimi 0.34.0 (`-m/-p`) / Codex 0.147.0 (`codex exec -m --json`) verified. **Emergency-kill isolation and wall-clock active-actor ceiling are proven by the real, non-skipped `real-runtime-controls.test.ts` (per-repo process termination with sibling survival; ceiling crosses while executor stays alive then drains to CEILING_REACHED with no Sol wake).**
- **SIMULATION-TESTED** — thin remaining coverage where real external wiring not yet exercised end-to-end here; Playwright busy/auth/ATTENTION spurs and artificial divergence cases.
- **REAL-QUALIFIED (2026-08-23)** — EXTERNAL_CHROME_AUTH_BOOTSTRAP,
  REAL_CHATGPT_AUTHENTICATED_PROFILE, REAL_KIMI_INFERENCE_VIA_ORCA,
  REAL_CODEX_INFERENCE_VIA_ORCA, and PHASE_8_TWO_ITERATION_LOOP, proven end to
  end with real ChatGPT Sol, real GitHub remotes, and real executor CLIs
  (docs/REAL-DOGFOOD-QUALIFICATION.md).
- **UNQUALIFIED** — Tailscale phone-route (`not_installed`; elevated install
  required, honestly not faked) and an authorized real OpenCode
  server/provider.

Only the truly external ChatGPT browser boundary is mocked for pipeline proof; the internal wiring being qualified is real. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full qualification matrix.

Latest full qualification run on this tree (Changes 026+027): `npm test` fast
tier 69 test files / 400 tests green — including the repository source-integrity
pretest guard (all tracked relative imports resolve to Git-tracked modules),
controller-compatibility, lifecycle-shutdown, schema-downgrade-guard,
migration-backup, state-backup, runtime-log-bound, and release-tooling suites —
with `npm run typecheck` and `npm run lint` exit 0. The P0 fresh-clone defect
(ignored `runtime/` production sources) is repaired and re-proven from an
origin-only clean worktree; `UNPACKED_UPGRADE_PRESERVATION_QUALIFIED` (10/10)
and a re-run `PACKAGE_RUNTIME_QUALIFIED` packaged smoke back the upgrade and
packaging truth on committed sources.

## Durable development workflow

Orca-Strator is itself developed through disposable coding-agent sessions. The repository must always contain enough durable state for a fresh agent to recover without prior chat history.

### Normal session

1. Open/clone/pull repository.
2. Start coding agent.
3. Run:

   ```text
   /go
   ```

4. Agent recovers Git + durable state, reads active OpenSpec, and continues next coherent unfinished slice.
5. It verifies work, updates task checkboxes and `.agent/state.json`, reconciles remote `main`, commits, and pushes.
6. Exit whenever appropriate.
7. A completely fresh later session can run `/go` again.

Fallback for agents without repository-local skill support:

```text
Continue this repository according to AGENTS.md and its durable state.
```

### Canonical recovery order

```text
AGENTS.md
   -> Git working/local/remote main state
   -> .agent/state.json
   -> docs/ROADMAP.md
   -> active OpenSpec proposal/spec/design/tasks
   -> focused normative docs required by task
   -> relevant implementation
```

Dirty local work is preserved/reconciled, not automatically discarded.

### Review workflow

After significant implementation:

1. coding agent checkpoints/commits/pushes;
2. Sol/ChatGPT deeply reviews actual GitHub repository;
3. reviewer updates architecture/OpenSpec/state where needed;
4. fresh coding-agent session starts;
5. `/go` pulls/reconciles durable changes and continues.

The repository—not a mega-prompt—is the detailed work contract.

## Documentation map

Start with [`docs/INDEX.md`](docs/INDEX.md).

### Development continuity

- [`AGENTS.md`](AGENTS.md) — non-negotiable agent/recovery contract
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — `/go`, checkpoint, OpenSpec, Git, blocked, exit procedure
- [`.agent/state.json`](.agent/state.json) — current waypoint
- [`.agent/state.schema.json`](.agent/state.schema.json) — waypoint schema
- [`.agents/skills/go/SKILL.md`](.agents/skills/go/SKILL.md) — repository-local `/go`

### Product/runtime architecture

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — locked V1 decisions
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system/network architecture
- [`docs/RUNTIME-MODEL.md`](docs/RUNTIME-MODEL.md) — runtime states/concurrency/controls
- [`docs/CROSS-AGENT-PROTOCOL.md`](docs/CROSS-AGENT-PROTOCOL.md) — Git mailbox semantics
- [`schemas/protocol/`](schemas/protocol/) — machine-readable dispatch/result/control schemas
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — milestone sequence/gates

### Implementation contracts

- [`docs/TECH-BASELINE.md`](docs/TECH-BASELINE.md)
- [`docs/IMPLEMENTATION-BLUEPRINT.md`](docs/IMPLEMENTATION-BLUEPRINT.md)
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)
- [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md)
- [`docs/UI-UX-SPEC.md`](docs/UI-UX-SPEC.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OBSERVABILITY-AND-FAILURES.md`](docs/OBSERVABILITY-AND-FAILURES.md)
- [`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md)

### Implementation checkpoint

- Completed: [`openspec/changes/010-operational-intelligence-executor-capabilities/`](openspec/changes/010-operational-intelligence-executor-capabilities/)
- Completed: [`openspec/changes/011-usage-telemetry-scheduler-policy/`](openspec/changes/011-usage-telemetry-scheduler-policy/)
- Completed: [`openspec/changes/012-typed-work-packets-isolation/`](openspec/changes/012-typed-work-packets-isolation/)
- Completed: [`openspec/changes/013-optional-same-repository-swarm/`](openspec/changes/013-optional-same-repository-swarm/)
- Completed: [`openspec/changes/014-optional-dag-execution-strategy/`](openspec/changes/014-optional-dag-execution-strategy/)
- Completed: [`openspec/changes/015-optional-rich-opencode-adapter/`](openspec/changes/015-optional-rich-opencode-adapter/)
- Completed: [`openspec/changes/016-execution-topology-ui/`](openspec/changes/016-execution-topology-ui/)
- Completed: [`openspec/changes/017-execution-strategy-loop-integration/`](openspec/changes/017-execution-strategy-loop-integration/) (folded into `openspec/specs/execution-strategy-loop-integration/`)
- Completed: [`openspec/changes/archive/2026-08-22-018-strategy-postflight-and-concurrency-hardening/`](openspec/changes/archive/2026-08-22-018-strategy-postflight-and-concurrency-hardening/) (folded into `openspec/specs/execution-strategy-postflight-hardening/`)

Change 010, Change 011, and Change 012 are complete and internally
machine-qualified. Change 012 established typed work packets, isolated
temporary worktrees/internal branches, deterministic integration, and explicit
partial-failure results. Change 013 and Change 014 are complete at the engine
tier — their swarm/DAG engines, worktrees, controls, and integration mechanics
are machine-qualified by their own focused real-tier tests — and their
autonomous campaign-loop integration is now separately machine-qualified by
Change 017's production-loop qualifications. Change 015 is complete with an
experimental, absent-safe OpenCode adapter and non-inference server probe; its
real server/provider tier remains explicitly unqualified without an authorized
endpoint. Change 016 is complete with the execution-topology observability UI
and explicit non-authoring strategy presets.

Change 017 integrates the qualified SWARM/DAG engines into the autonomous
campaign loop through an `IterationExecutionCoordinator`: LoopService resolves
the durable dispatch `strategy`/`executionPlan` selection and delegates
start/completion/controls to the coordinator, manual `/swarm/start` and
`/dag/start` enforce the same campaign/iteration ownership boundary, strategy
results are normalized back into the loop without ever producing
`GOAL_COMPLETE`, and migrations 021/022 persist dispatch linkage, an immutable
`strategyBaseSha`, and DAG dependency input SHAs. Qualification: real
production `buildApp` tests prove the autonomous SWARM loop (dispatch ->
isolated workers -> integration -> remote main + result manifest -> Sol wake ->
second Sol transition), the autonomous DAG loop with true A->B dependency-state
materialization plus a falsifiability case, and campaign-level
pause/resume/stop/emergency-kill/wall-clock/restart composition for both
strategies through the campaign control seam. Authoring these tests surfaced
and fixed real integration bugs (non-durable dispatch strategy selection,
SWARM-labeled DAG starts, a dead completion bridge, a missing result-manifest
directory, and a stale-dependency skip on DAG resume).

Change 018 hardens the strategy completion boundary: a strategy `COMPLETED`
now wakes Sol only after its remote publication is `PUBLISHED` and
remote-verified — otherwise the dispatch stays unconsumed as successful and
durable retryable postflight evidence is recorded, retried postflight-only
(never rerunning workers), including across controller restart. Remote
advancement is explicitly classified (`UP_TO_DATE`/`LOCAL_AHEAD`/
`REMOTE_AHEAD`/`DIVERGED`) and safely reconciled before the manifest commit,
whose `finalCommitSha` is the actual post-reconciliation HEAD with
pre-reconciliation provenance. DAG staging lands on a strategy-owned lineage
from the immutable `strategyBaseSha` behind a per-strategy integration mutex,
with dependency-isolated snapshots and restart-lineage continuation. Campaign
controls are awaited/acknowledged (pause refuses during pending drain; resume
of a non-PAUSED campaign is an explicit 409), shutdown is asynchronous and
sweeping (no orphan children; startup marks orphaned executor runs failed and
recovers scheduler leases), and supporting hard waves added the active-run
deletion guard (`409 REPOSITORY_ACTIVE_RUN`), durable/resolvable permission
decisions driven by native-permission-API capability probes, truthful 404/422
API errors, and the fixed per-repository executor log rotator with persisted
tail serving. Qualification evidence for this campaign is recorded in
[`docs/TEST-STRATEGY.md`](docs/TEST-STRATEGY.md) §24–§26.

Post-V1 evolution is implemented as focused sequential changes. The
historical OpenFlow-inspired exploration is explicitly non-binding; see the
[canonical design delta](docs/OPENFLOW-EVOLUTION-DELTA.md). Orca remains a
persistent repository/goal campaign with Sol-owned completion, Git as durable
cross-agent truth, and one active writer per repository; the opt-in
SWARM/DAG strategies use isolated worktrees under the same boundary with their
autonomous loop integration machine-qualified by Change 017.

## Repository hygiene

The repo intentionally seeds:

- `.gitattributes` for stable Windows/WSL line endings;
- `.editorconfig` for basic editor consistency;
- `.gitignore` protecting local DB/browser/auth/log/secret/build artifacts;
- versioned protocol JSON Schemas.

`.orca/` is intentionally **not** globally ignored because managed repositories later commit Orca coordination artifacts.

## Development principles

1. Keep V1 simple despite detailed specs.
2. One repository is the concurrency unit.
3. Different repositories may run concurrently; one repo is serialized in V1.
4. GitHub is durable inter-agent truth; SQLite is local runtime truth.
5. V1 uses `main` only.
6. Static repository config is separate from active-run state.
7. State transitions/dispatches are explicit and idempotent.
8. User owns executor/model selection.
9. Sol is primarily architect/reviewer but may make code fixes.
10. Playwright is narrow wake transport, not source of truth.
11. Never silently discard dirty repository work or auto-force-push.
12. One persistent browser profile has one browser-process owner at a time, while that process may host multiple repository pages.
13. Desktop and phone share one same-origin UI/API contract.
14. Every meaningful development session leaves a durable waypoint.
15. Significant work uses focused OpenSpec changes/review gates, not giant prompts.
16. Detailed documentation reduces ambiguity; it does not authorize premature complexity.
