# Orca-Strator Architecture

Status: **locked baseline for V1**

## 1. Product model

Orca-Strator is a Windows-only desktop orchestration application for autonomous AI software-development loops.

The V1 unit of orchestration is a **repository**.

For each configured repository:

- exactly one autonomous Orca session exists at a time;
- exactly one dedicated ChatGPT Sol conversation URL is configured;
- at most one executor process is active at a time;
- the user chooses the executor CLI and model for the run;
- the repository may execute in native Windows/PowerShell or a configured WSL distribution;
- V1 always watches, reconciles, commits, and pushes `main`;
- GitHub is the durable cross-agent handoff layer.

Different repositories are independent and may run concurrently with **no global executor limit**.

Future support for multiple sessions/executors/branches inside one repository is explicitly out of V1 scope.

## 2. Application stack

Use a TypeScript-first stack:

- **Desktop shell:** Electron
- **UI:** React + TypeScript + Vite
- **UI styling/components:** Tailwind CSS + shadcn/ui
- **Client state:** Zustand where local UI state is useful
- **Controller:** separate Node.js/TypeScript background process
- **Controller API:** HTTP + WebSocket under the Orca web origin
- **Durable local runtime state:** SQLite
- **Browser automation:** Playwright
- **Git/process integration:** direct child-process invocation of `git`, PowerShell, `wsl.exe`, and configured agent CLIs

The controller, not Electron, owns orchestration state. Closing/minimizing the desktop UI must not stop active runs.

The responsive React UI is shared by:

1. Electron on Windows; and
2. a phone browser connected privately through Tailscale Serve.

The controller listens on loopback only. Do not expose its raw listener directly to the public internet.

## 3. Web/UI network topology

The UI must not hard-code `127.0.0.1` or `localhost` as its production API destination. In a phone browser those addresses refer to the **phone**, not the Windows Orca machine.

V1 therefore uses one same-origin web contract:

```text
                     Windows machine

             Orca controller/web endpoint
                 127.0.0.1:47100
                 /            built SPA
                 /api/*       REST
                 /api/events  WebSocket
                       ^
                       |
        +--------------+----------------+
        |                               |
Electron/local browser             Tailscale Serve
loads Orca origin                  HTTPS reverse proxy
                                        |
                                        v
                              phone browser tailnet URL
```

### Production-like/local built mode

The controller serves the built React application and the API/WebSocket from the same loopback origin.

The UI uses relative URLs:

```text
/api/health
/api/repositories
/api/events
```

This is the canonical runtime contract.

### Development mode

Vite may run on its own development port. Configure the Vite development server to proxy `/api` and `/api/events` to the loopback controller so application code still uses the same relative URLs.

Do not create separate production and phone API-client implementations.

### Phone mode

Tailscale Serve reverse-proxies the **single Orca loopback web endpoint**. The phone loads that HTTPS tailnet URL; relative `/api` and WebSocket requests therefore return through the same Tailscale origin to the Windows controller.

Milestone 7 configures/operates Tailscale Serve. Change 001 establishes the same-origin application seam but does not manage Tailscale.

Avoid permissive cross-origin exposure merely to make phone access work. Same-origin is the preferred V1 topology.

## 4. Repository configuration

A repository record includes at minimum:

- display name;
- GitHub repository identity/remote URL;
- local working-directory path;
- execution environment: `windows` or `wsl`;
- WSL distribution when applicable;
- executor CLI;
- executor model/configuration selected by the user;
- exact dedicated ChatGPT Sol conversation URL;
- maximum iterations;
- maximum wall-clock runtime.

There is no V1 branch field. `main` is an invariant of the runtime protocol.

Run goal belongs to run/session state rather than static repository configuration.

Configuration/model/environment changes are locked while that repository has an active run.

## 5. Sol -> executor transport

V1 uses a **local remote-Git watcher**, not GitHub Actions, webhooks, or MCP.

Each active repository has an inexpensive watcher that detects remote `main` movement. A normal Sol planning/spec commit does not dispatch work.

### Transactional dispatch protocol

Sol completes and pushes all planning/OpenSpec changes first. It then creates a final isolated dispatch commit containing only a new dispatch marker under the repository's Orca coordination directory, for example:

```text
.orca/dispatch/<dispatch-id>.json
```

The watcher starts the executor only when all of the following hold:

1. remote `main` advanced;
2. a previously unconsumed dispatch marker appeared;
3. the dispatch marker is valid against the supported protocol schema;
4. the dispatch commit contains only allowed dispatch/control artifacts;
5. no executor is already active for that repository;
6. the run is allowed to accept another handoff.

If Sol mixes ordinary spec/code changes into the final dispatch commit, the watcher rejects the dispatch rather than starting early.

Consumed dispatch IDs are recorded locally in SQLite for idempotency.

Machine-readable protocol schemas live under `schemas/protocol/` in Orca-Strator and define structural validity for dispatch, executor-result, and Sol-control artifacts.

## 6. Executor runtime

The executor is launched headlessly in the repository's configured environment.

Examples:

- native Windows/PowerShell executor;
- `wsl.exe -d <distribution> ...` for repositories/tools hosted inside WSL.

The executor receives a small stable bootstrap instruction. The repository—not a mega-prompt—contains the detailed work contract.

Executor completion contract:

1. inspect/reconcile existing local work instead of discarding it;
2. fetch/rebase remote `main` when necessary;
3. execute the active dispatch/OpenSpec change as far as possible;
4. run relevant verification;
5. resolve ordinary Git divergence/conflicts when possible;
6. commit/push intended safe work to `main`;
7. write/push a structured result manifest;
8. exit rather than looping indefinitely solely to force all tests green.

Automatic force-push is forbidden by default.

An executor may report `COMPLETED`, `BLOCKED`, `NEEDS_HUMAN`, or `FAILED`. These outcomes normally wake Sol for authoritative review.

## 7. Executor -> Sol transport

V1 uses **Playwright**.

Playwright's role is deliberately narrow: wake the repository's configured browser Sol conversation with a fixed trusted instruction telling Sol to inspect GitHub and continue. Playwright output scraping is not part of the protocol.

### Browser authentication/setup

Orca owns one dedicated automation browser profile.

The UI provides **Open ChatGPT Setup Browser**:

- acquire the automation-profile lock;
- launch the automation profile headed;
- user logs in manually if needed;
- existing login can be visually verified;
- closing the setup browser preserves profile state and releases the lock.

Do not automate login or reuse the user's ordinary Chrome profile.

The headed setup browser and the normal automated Chromium instance MUST NOT use the same profile concurrently. If automation is active, setup either waits or requires the active browser manager to shut down cleanly first.

### Browser lifetime and concurrency

Chromium is on-demand, not permanently idle.

- first active Sol wake acquires the profile lock and launches one browser using the dedicated profile;
- each active repository gets its own page/tab with its exact Sol conversation URL;
- different repositories may have Sol pages active concurrently;
- one repository has at most one active Sol operation;
- when active Sol page count reaches zero, Chromium may close and release the profile lock.

Do not launch two Chromium processes against the same persistent profile.

If ChatGPT applies concurrent-request backpressure, treat it as a recoverable busy condition. Dismiss safe informational UI when necessary and queue/retry with bounded backoff; do not attempt to defeat a service limit.

## 8. Detecting Sol completion

Playwright does not read Sol's answer to decide completion.

After a wake is submitted, Orca observes GitHub. Sol is considered to have completed that review turn only when an expected durable repository transition appears, such as:

- a new valid isolated dispatch commit; or
- a durable terminal/control state (`GOAL_COMPLETE`, `BLOCKED`, `NEEDS_HUMAN`, `PAUSED`).

Sol remains the authoritative high-level reviewer even when an executor believes the goal is complete.

Default stall policy:

1. wake Sol;
2. wait about 20 minutes (configurable);
3. if no expected Git transition occurs, retry the wake once;
4. after the second timeout, mark the repository `SOL_STALLED` and notify the user.

Authentication, browser automation, and ChatGPT-busy failures have distinct statuses.

## 9. Run limits and controls

Each run has configurable safety ceilings, initially defaulting to:

- 20 iterations;
- 8 hours wall-clock.

Whichever is reached first moves the run to `DRAINING`.

`DRAINING` never kills the current actor. The actor may finish and publish its result, but Orca does not initiate the next handoff.

### Pause

Pause is executor-credit-oriented:

- if an executor is running, interrupt/terminate its process tree;
- preserve the working directory exactly as-is;
- do **not** wake Sol;
- mark the repository paused;
- Resume launches the same configured executor with recovery instructions to inspect and reconcile unfinished work.

### Stop

Stop is graceful: let the current Sol/executor actor finish, then stop before the next handoff.

### Emergency Kill

Emergency Kill terminates the selected repository's active executor/browser operation immediately and records interrupted/recovery state.

The UI also provides manual `Wake Sol` and `Run executor` recovery controls where safe.

## 10. Dirty trees and Git divergence

Dirty working trees are supported, including leftovers from an interrupted/paused executor.

Orca itself must never blindly discard them with `git reset --hard`. The executor is instructed to inspect, preserve, reconcile, and eventually leave intended work clean, committed, and pushed.

When remote `main` moves during execution, the executor should fetch/rebase/pull, resolve ordinary conflicts, and continue. If it cannot safely resolve the divergence, report `BLOCKED` so Sol can review.

## 11. Phone control and notifications

V1 phone access uses **Tailscale Serve** to reverse-proxy Orca's loopback same-origin web endpoint privately inside the user's tailnet. Do not use a public Funnel endpoint by default.

The phone UI never attempts to call the Windows controller through phone-local `localhost`/`127.0.0.1`; it uses relative routes on its Tailscale Serve origin.

Phone UI has full visibility and operational controls. Risky configuration changes remain disabled while the target repository is active.

Notify actively for meaningful terminal/problem states such as:

- goal complete;
- needs human;
- Sol stalled;
- executor launch/contact failure;
- browser/login failure;
- unrecoverable Git conflict/divergence;
- runtime/iteration ceiling reached;
- emergency stop.

Normal successful iterations remain quiet.

## 12. Crash/reboot recovery

The controller persists runtime state in SQLite and rehydrates active repositories on startup.

Safe waiting states may recover automatically. If an executor process was interrupted mid-work by a crash/reboot, preserve the checkout and mark it `RECOVERY_REQUIRED`; V1 requires explicit Resume before another executor process modifies that repository.

### 12.1 Durable execution ownership and transition consistency (Change 028)

Controller crash is an **epistemic boundary**: in-memory maps, ChildProcess handles, and Promise chains disappear, but SQLite rows, Git commits, workers, and Chrome profiles may survive. The design treats process death as “uncertain != dead.”

* **Repository actor lease (one writer).** Each repository has at most one durable actor lease (`repository_actor_leases` repository_id PRIMARY KEY, UNIQUE). States: `STARTING`/`ACTIVE`/`RELEASING`/`QUARANTINED`. At most one `SINGLE_AGENT` direct lease or one `SWARM`/`DAG` strategy lease may authorize mutation. Workers are child process rows beneath the strategy lease, not competing repository leases. `LIVE_MATCH` or `UNKNOWN` prior ownership blocks or quarantines a second actor; `DEAD` is proven via `ProcessProbe`.

* **Process ownership.** Every real OS spawn attempt gets a distinct durable attempt identity (`process_ownership` rows keyed by attempt) correlated to controller instance (`controller_instance_id` per-process cryptographic ID), actor/packet/run, `hostPid` + `startMarker` (`CreationDate`/`/proc/<pid>/stat` start time) + `executableName`. Classification is `LIVE_MATCH` / `DEAD` / `PID_REUSED` / `UNKNOWN`; only `LIVE_MATCH` authorizes tree kill (`taskkill`/`kill`). Incomplete identity fails closed to `UNKNOWN`. `UNKNOWN`/`PID_REUSED` quarantines instead of retrying into a possible second writer.

* **Durable transition processor.** `OrchestrationTransitionService` serializes per-repository transitions and applies them in a `BEGIN IMMEDIATE` SQLite transaction: source consumption (dispatch / `SOL_CONTROL` / executor or strategy completion) + required `runs` transition +`orchestration_outbox` rows commit atomically. No external I/O (browser, Git, spawn, network) occurs inside the transaction; side effects are enqueued as deterministic `effect_key` outbox items (`SUBMIT_SOL_WAKE`, `COMPLETE_SOL_OPERATION`, `START_EXECUTION_ACTOR`, etc.) and delivered after commit via `deliverOutboxEffect` with replay on startup (after `reconcileOnStartup`). Duplicate `(sourceKind, sourceId, operation)` is `UNIQUE` and idempotent; a thrown `apply` rolls back leaving no `consumed-without-transition` state.

* **Dispatch, Sol control, and completion atomicity.** Watcher dispatch detection, Sol-control wake consumption, direct executor and SWARM/DAG/postflight completion, drain-boundary `applyIterationCompletion`, and failure/non-COMPLETED branches all route through the same transition inbox/outbox boundary (see `LoopService` D9.5 paths with legacy inline fallback for tests without wiring). Browser `SOL_OPERATION` close and actor start are post-commit outbox effects, harmless if already closed.

* **Startup and shutdown.** `buildApp` optionally takes an `AbortSignal`; signal during construction or `EADDRINUSE`/`listen` failure tears down the fully assembled graph in deterministic order (watchers → timers → coordinators/executors → `BrowserManager` → Fastify → DB → singleton lock). Startup reconciliation (`RepositoryActorLeaseService.reconcileOnStartup` → `recoverAll` reorder) runs before worktree sweep and respects the abort/shutdown latch; `LIVE`/`UNKNOWN` worktrees are never swept.

## 13. High-level goal loop

Every autonomous run has a required durable high-level goal.

The first Sol interaction asks Sol to inspect the current repository against that goal and create the first focused OpenSpec change plus final dispatch marker. Subsequent iterations follow the same cycle until Sol writes a terminal state or a safety ceiling causes draining.

```text
high-level goal
      |
      v
Sol inspect/review
      |
OpenSpec + final dispatch
      |
local watcher
      |
headless executor
      |
commit + result manifest
      |
Playwright wake
      |
Sol inspect/review
      +---------------------> repeat / terminal state
```

## 14. Design principles

1. Keep V1 simple.
2. GitHub is durable inter-agent truth; SQLite is local runtime truth.
3. State transitions are explicit and idempotent.
4. Repository-level concurrency is independent; per-repository execution is serialized.
5. The user owns executor/model selection.
6. Sol provides architectural/review intelligence but may make code changes when useful.
7. Browser automation is a narrow transport adapter, not the source of truth.
8. Every failure must be observable and recoverable without silently discarding work.
9. V1 branch behavior is intentionally fixed to `main`; branch orchestration is deferred until multi-session-per-repository work exists.
10. Desktop and phone use one same-origin UI/API contract; remote phone access does not require broad CORS or a second backend.

## 15. Post-V1 operational foundation

The hardened campaign remains the top-level owner. Change 010 adds a normalized
campaign trace/read model subscribed to the redacting EventBus, a durable
executor capability probe, optional feature-detected adapter methods, a
per-run effective phase-budget snapshot, and an executor-neutral permission
policy. These are controller services around the existing stores; they do not
replace Git result manifests, SQLite run state, or Sol's completion authority.

Capability probes are levelled: STATIC checks only CLI/profile metadata,
NON_INFERENCE may perform harmless local/Git/environment checks, and INFERENCE
requires explicit authorization. A configured executor/model is never silently
changed. Generic CLIs remain supported and unadvertised native features are
reported as unknown/advisory/unsupported.

The next approved changes may introduce typed work packets and isolated
temporary worktrees, but no same-checkout parallel writers are enabled by this
foundation.

Change 011 adds trustworthy usage metrics, an explicit scheduler admission
foundation, and repository-scoped role/model policy. Usage is captured only
through a native/structured adapter hook; generic V1 adapters therefore report
unknown rather than fabricated zeroes. Scheduler limits are nullable and the
default is unlimited across independent repositories. Role resolution is
user-authored and falls back to the repository's exact configured executor and
model. None of these facilities changes the single-agent V1 default or grants
Sol dynamic model-routing authority.

Change 012 supplies the prerequisite typed packet and isolation layer. Each
potential writer gets a deterministic internal Git branch/worktree under Orca's
local data directory; no two writers share the persistent checkout. A clean
worktree may be removed without force, while dirty/unmerged work remains
recoverable. Deterministic integration cherry-picks validated worker commits to
main, preserves successful siblings, and returns conflicts/partial failures as
structured results. Swarm and DAG strategies remain disabled until this layer
passes its real qualification gate.

Change 013 enables the optional `SWARM` strategy now that that gate is green.
Sol or an explicit user API request selects a packet set for one iteration; a
bounded controller scheduler launches each packet through the existing
capability-aware adapter in a distinct temporary worktree, then invokes the
qualified integration service. Strategy controls, scheduler admissions,
worker results, usage references, and integration outcomes return to the
campaign ledger. `SINGLE_AGENT` remains the default, the persistent main
checkout remains integration-only, and no worker result is campaign completion.

## Optional DAG execution (Change 014)

An explicitly selected DAG adds a validated node/dependency layer over the same
strategy runtime:

```text
Sol dispatch
  -> typed packet-linked DAG definition
  -> cycle/dependency/correlation validation
  -> bounded scheduler
  -> isolated worktree workers
  -> deterministic integration
  -> durable node + strategy result
  -> Sol review/replan
```

The DAG service owns node records and topology validation. The Change 013
execution engine still owns adapters, child processes, budgets, permissions,
worktrees, controls, and integration. `SINGLE_AGENT` remains the default and
the UI does not become a graph composer.

## Optional OpenCode adapter (Change 015)

OpenCode is an optional executor profile, not a controller dependency. When a
repository explicitly selects an `opencode` CLI, the profile builds the
documented headless `opencode run --model <provider/model> <prompt>` shape and
the existing `ExecutorRunner` remains responsible for process supervision,
structured result validation, Git postflight, and Sol wake-up. Kimi, Codex,
generic CLI, and deterministic test profiles retain their existing adapters.

The optional `OpenCodeAdapter` can inspect an explicitly configured local
OpenCode server (`ORCA_OPENCODE_SERVER_URL`) through a bounded manual
health/OpenAPI probe. It recognizes legacy, `/api` V2, hybrid, and unknown
route sets and exposes guarded native session/event/permission/usage helpers
only after route discovery. Current OpenCode API migration makes this adapter
experimental; missing or drifting routes produce typed UNKNOWN/UNSUPPORTED
evidence rather than speculative calls. The probe never spends inference, and
OpenCode sessions/events never replace SQLite orchestration truth or Git result
truth.

## Execution topology observability (Change 016)

The UI consumes `CampaignDetail` as a read model and renders the real topology:

```text
SINGLE_AGENT: Sol -> dispatch -> executor -> result/Git -> Sol
SWARM/DAG:   Sol -> strategy -> actual packets/nodes -> integration -> Sol
```

The panel uses durable strategy reports, typed result/node statuses,
dependencies, integration, and usage references. It uses responsive cards and
textual dependency chips rather than a graph canvas, so it cannot author nodes,
decompose goals, or create hidden work. Shared strategy presets are versioned
policy/reference data only; `SINGLE_AGENT` and repository + goal remain the
default user experience.

## Execution-strategy loop integration (Change 017)

Change 017 places an `IterationExecutionCoordinator` above the strategy
engines as the single authoritative execution actor for one
repository/campaign iteration. It normalizes start, completion, recovery, and
control across `SINGLE_AGENT`, `SWARM`, and `DAG`:

```text
LoopService (autonomous dispatch seam)
  -> resolveStrategy(dispatch)          # dispatch marker strategy/executionPlan; legacy -> SINGLE_AGENT
  -> assertCampaignIterationOwnership() # shared campaign/iteration boundary
  -> coordinator.start()                # executor OR swarm/DAG engine
  -> handleStrategyCompleted()          # remote-durable publish + normalized result
  -> LoopService.onStrategyCompleted()  # Sol review boundary unchanged

Manual REST (/swarm/start, /dag/start)
  -> assertCampaignIterationOwnership() # same boundary
  -> coordinator.start()
```

`LoopService` no longer contains brand-specific strategy logic: it resolves the
durable dispatch selection, delegates start/completion to the coordinator, and
routes pause/resume/stop/kill through it, which composes the same decision onto
whatever actor is active (executor or strategy engine). The manual
`/swarm/start` and `/dag/start` routes acquire the identical ownership boundary
before starting, so manual and autonomous starts can never both own one
iteration. A structured `StrategyConflictError` is raised when the boundary is
not free; the loop records a `loop.strategy_conflict` event instead of
starting, and the REST routes surface it as a bad-request error envelope.
Strategy completion publishes integrated `main` and the result manifest durably
to the remote before the normalized status returns to the loop; the mapping
never yields `GOAL_COMPLETE`, keeping Sol as the completion authority.

## Strategy postflight and concurrency hardening (Change 018)

Change 018 makes the publication boundary authoritative and the integration
path concurrency-safe:

```text
strategy engine COMPLETED
  -> IntegrationService.publishToRemote   # classify UP_TO_DATE/LOCAL_AHEAD/
                                          # REMOTE_AHEAD/DIVERGED; safe
                                          # reconciliation, never force-push
  -> result manifest @ post-reconciliation HEAD
     (preReconciliationIntegrationSha provenance)
  -> push + remote verification
  -> LoopService.onStrategyCompleted      # success only when PUBLISHED +
                                          # remoteVerified
  -> COMPLETED Sol wake  |  durable retryable postflight evidence
```

A blocked or unverified publication consumes nothing as successful: no
COMPLETED wake is sent, the dispatch stays unconsumed, and retry republishes
postflight-only (workers are never rerun), surviving controller restart.
DAG staging lands on a strategy-owned lineage derived from the immutable
`strategyBaseSha` behind a per-strategy-run integration mutex, keeping
persistent user main untouched until final qualified integration. Campaign
controls are awaited through the coordinator (pause refuses during pending
drain; resume of a non-PAUSED campaign is an explicit 409), normal shutdown is
asynchronous — admissions close, children terminate within bounded grace,
callbacks settle before SQLite closes — and startup sweeps mark orphaned
executor runs failed, remove orphaned staging checkouts, and recover scheduler
leases as `STALE_RECOVERABLE`. Supporting waves added the active-run deletion
guard (`409 REPOSITORY_ACTIVE_RUN`), durable/resolvable permission decisions
driven by capability-probe evidence (`NATIVE_EXECUTOR` vs `ADVISORY_ONLY`),
truthful machine-readable 404/422 API errors across campaign/swarm/DAG/
work-packet routes, and a fixed per-repository executor log rotator with
persisted-log tail serving.

## Packaged desktop/controller topology and singleton supervision (Change 025)

Packaged Windows distribution preserves the ownership invariant: the Node
controller remains the runtime owner; Electron is only a shell that guarantees
a controller exists.

```text
User launches Orca-Strator.exe (packaged Electron)
  |
  +--> probe /api/system/identity on loopback
  |      compatible controller -> reuse (no spawn)
  |      foreign listener      -> PORT_CONFLICT diagnostic (never killed)
  |      incompatible protocol -> INCOMPATIBLE_CONTROLLER diagnostic
  |      no listener           -> spawn packaged controller, detached
  |
  +--> packaged controller process
         ELECTRON_RUN_AS_NODE=1 <electron.exe> resources/controller/dist/index.js
         ORCA_PACKAGED=1, ORCA_BUILD_VERSION=<app version>
         data-directory lock (controller.lock) + port bind guard
         SQLite + watchers + executors + browser automation
         serves built SPA/REST/WebSocket from packaged resources

Closing the window quits the shell only; the detached controller keeps running.
Relaunch repeats probe/reuse against the same controller pid.
```

Singleton ownership is the data-directory lock file (atomic O_EXCL create,
PID-liveness validation, reclaim only demonstrably stale locks) with the OS
port bind as final guard. Writable state (SQLite, logs, browser profile,
locks) lives under the Orca data directory — `%LOCALAPPDATA%\Orca-Strator` by
default, `ORCA_DATA_DIR` override for tests/isolation — never inside packaged
resources. Development mode (`ORCA_UI_DEV_URL`, `scripts/dev.js`) is explicit:
the desktop never spawns a production controller there without the
`ORCA_ALLOW_DEV_CONTROLLER_SPAWN=1` gate.

## Installed-release lifecycle and resilience (Changes 026/027)

Change 026 turns the packaged product into a safely upgradable application
while preserving the ownership invariant above:

- **Exact-build compatibility verdicts.** `ControllerIdentity` carries the
  immutable build identity (`version`, `buildId` Git SHA, `mode`,
  `maxSchemaVersion`; wall-clock is never identity). A packaged desktop
  evaluates an explicit verdict (`EXACT_MATCH`, version-skew/
  `RESTART_REQUIRED`, `PROTOCOL_INCOMPATIBLE`, `DATABASE_INCOMPATIBLE`) and
  refuses silent reuse of a different build; development keeps looser
  protocol-only reuse.
- **Authenticated graceful replacement.** The controller writes a per-start
  random control token into its runtime-lock metadata (constant-time compared,
  never served over HTTP) and exposes loopback-only `/api/system/lifecycle`
  + `/api/system/shutdown`. A mismatched packaged desktop replaces an idle
  controller only through that contract (shutdown → observed exit + lock
  release → spawn bundled build → exact-identity verify); active campaigns
  yield a truthful `RESTART_PENDING`. Renderers/web pages receive no process
  authority, foreign listeners are never touched.
- **Database forward-compatibility guard.** A strict preflight refuses startup
  with typed `DATABASE_TOO_NEW` (controller exit 12; desktop terminal recovery
  state) when the on-disk schema exceeds the binary's knowledge — before any
  migration/service runs, without mutating the database.
- **Pre-migration snapshots** (`VACUUM INTO` + sidecar metadata + SHA-256,
  bounded retention, fail-closed) under `<dataDir>/backups/pre-migration/`;
  **user state backup bundles** via `POST /api/system/backup` (Settings →
  Create Backup) and `npm run backup`; restore stays an offline CLI so
  quiescence is provable. Bundles contain only the checksummed SQLite image +
  manifest — cookies/profiles/credentials/repos/locks/logs are structurally
  excluded. Rollback operator procedure: docs/RELEASE-AND-ROLLBACK.md.
- **Single-source versioning + provenance.** Root `package.json` is canonical
  (`npm run release:prepare` / `version:check` gates); releases carry a
  machine-readable manifest, `SHA256SUMS.txt`, CycloneDX SBOM, tag==version
  verification, and signing status derived from actual Authenticode results
  (UNSIGNED unless real credentials are configured).

Change 027 hardens long-running operation: anchored `.gitignore` semantics +
`scripts/ci/check-source-integrity.mjs` keep Git truth equal to build truth,
packaged controller logging is bounded while running, the post-startup
controller resurrection watch lets the still-running supervisor recover a dead
controller (a second app instance never can), and campaign-trace telemetry
enforces referential integrity without ever crashing the event graph.
