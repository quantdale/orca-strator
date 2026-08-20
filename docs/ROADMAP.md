# Orca-Strator Roadmap

This roadmap is the durable development sequence. Significant implementation advances through focused OpenSpec changes instead of one giant build prompt.

## How to use this roadmap

Each milestone has:

- **purpose** — why it exists;
- **deliverables** — what must be built;
- **exit gate** — evidence required before complete;
- **review checkpoint** — when Sol/ChatGPT repository review is valuable before next OpenSpec.

A coding-agent `/go` session normally continues the active OpenSpec until its exit gate or a genuine blocker requires review.

Do not implement later milestones merely because their contracts are already documented.

---

## V1 qualification status (Change 009 — NOT YET QUALIFIED)

All nine milestones (0–8) are **implemented** in code. However, the prior
"Milestone 8 complete / V1_ROADMAP_COMPLETE" status was **not** proof of real
end-to-end autonomy: the earlier tests were simulations that manually invoked
internal transition methods and used fake executors/mock browsers.

V1 was reopened as **NOT YET QUALIFIED** and is being hardened under
`openspec/changes/009-v1-runtime-integration-hardening/`. Honest status labels:

- **MACHINE-QUALIFIED** — proven on this machine with real Git, real child-process
  executors, and real `wsl.exe` execution.
- **SIMULATION-TESTED** — implementation present, covered by fake/mock tests; not
  yet proven against the real external dependency here.
- **UNQUALIFIED** — required real external dependency (real Kimi/Codex CLI,
  Chromium, ChatGPT auth, Tailscale) absent on this machine; explicitly not faked.

| Area | Status on this machine |
| --- | --- |
| A. Production buildApp lifecycle (watcher auto-start, enabled/disabled, shutdown) | **MACHINE-QUALIFIED** (`Q.APP.1`) |
| A/C/E/Q.1-4/Q.10 service-graph pipeline (watcher→loop→executor→result→loop→Sol) | **MACHINE-QUALIFIED** (`Q.WIN.1`, `Q.WIN.WSL.1`, `Q.WIN.3`) |
| C. Windows/WSL Git adapters (WSL remote probe via `wsl.exe`) | **MACHINE-QUALIFIED** (WSL-aware `GitClient.getRemoteHeadSha(ctx)`) |
| D. Executor profiles + launch handshake | **MACHINE-QUALIFIED** (Kimi 0.34.0 `-m -p`, Codex 0.147.0 `exec -m --json`, WSL node v18 verified; 3× ENOENT retry, single post-spawn, once-only callback) |
| E. Executor result contract (manifest + postflight) | **MACHINE-QUALIFIED** (semantic runId/dispatchId/iteration/baseSha/cli/model/env + ancestry + retryable postflight) |
| F. Git preflight divergence contract | **IMPLEMENTED** (dirty/localHead/remoteHead/relation inspected, never hard-reset, `ORCA_PREFLIGHT_EVIDENCE` to executor; fast gate `loop-drain-correlation` + real controls) |
| G. Wall-clock ceiling separation + drain | **MACHINE-QUALIFIED** (dispatch is actor boundary, `drainReason` persisted, wall-clock + SOL rehydrated, Stop/ceiling complete at dispatch/control) |
| H. Sol control markers | **MACHINE-QUALIFIED** (`Q.APP.1` control half + `loop-drain-correlation` `GOAL_COMPLETE`) |
| I. Pause/Resume/Stop/Emergency-Kill | **MACHINE-QUALIFIED** (slow harness: pause→`PAUSED` + resume SAME dispatch `ORCA_RECOVERY=true`, graceful Stop drains naturally, Stop/ceiling complete at Sol-boundary dispatch; non-skipped `real-runtime-controls.test.ts` proves per-repo `emergencyKill` terminates only the targeted repo's process tree while a sibling repo stays alive and finishes naturally, dispatch not falsely consumed) — `pause` is executor-only (400) |
| J. Browser profile ownership | **SIMULATION-TESTED** |
| K. Playwright provisioning | **MACHINE-QUALIFIED** (`browser:install` + `GET /api/system/provisioning`, Chromium `chromium-1234` present) |
| L. ChatGPT wake lifecycle | **IMPLEMENTED + bounded BUSY→SOL_STALLED, ATTENTION_REQUIRED distinct** (scoped banners only, no body scrape; transport mocked) |
| M/N/O. Startup rehydration / status / secret-redacted logs | **MACHINE-QUALIFIED** (includes `reconciledCount` tolerance for DB-closed surfaced errors) |
| P. Tailscale status truthfulness | **MACHINE-QUALIFIED** (honestly `not_installed` here) |
| B | **SIMULATION-TESTED** (poll/rev-list/idempotency) |
| Q.9 Tailscale phone route, ChatGPT auth, real model inference burn | **UNQUALIFIED** (external deps absent; explicitly not faked) |

The production buildApp gate (`Q.APP.1`) and the service-graph gate (`Q.WIN.1/WSL.1/3`) together prove the pipeline; neither is conflated with the other. Remaining `UNQUALIFIED` items are the truly external ChatGPT/Tailscale/inference dependencies.

---

## Milestone 0 — Architecture and durable workflow

Status: **complete**

### Purpose

Establish enough durable repository context that development can resume safely across disposable AI coding sessions.

### Delivered

- locked V1 product architecture;
- `AGENTS.md` recovery/agent contract;
- `.agent/state.json` waypoint + schema;
- repository-local `/go` skill;
- detailed development protocol;
- runtime-state/concurrency contract;
- OpenSpec-based implementation sequence;
- protocol JSON Schemas;
- cross-platform repository hygiene baseline;
- initial OpenSpec Change 001.

### Exit gate

A fresh coding-agent session can determine active work from repository state without this ChatGPT conversation.

---

## Milestone 1 — Bootstrap control plane

OpenSpec: `001-bootstrap-control-plane` (hardened in `001a`, folded into `openspec/specs/control-plane-foundation/`)

Status: **complete**

### Purpose

Create the smallest real application foundation that later watcher, executor, browser, phone, and autonomy systems can plug into without putting orchestration ownership inside Electron or creating multiple UI networking models.

### Deliverables

- npm/TypeScript workspace;
- separate Node.js controller process;
- responsive React/Vite UI;
- Electron Windows desktop shell using same UI;
- loopback HTTP + WebSocket controller boundary;
- controller-served built SPA so built UI + REST + WebSocket share one origin;
- Vite development proxy so shared UI always uses relative `/api` and event routes;
- SQLite migration/persistence foundation with atomic transactions;
- static repository registry/configuration model;
- V1 main-only contract with no branch config field;
- native Windows vs WSL configuration validation;
- basic repository dashboard/detail/configuration UI;
- controller health/connection status;
- test/typecheck/build/lint baseline;
- clear developer startup + production-like local web workflow.

### Explicitly not yet

- no remote Git watcher;
- no dispatch runtime;
- no executor launch;
- no Playwright/ChatGPT automation;
- no autonomous run state machine;
- no Tailscale configuration/notifications.

### Exit gate

From fresh Windows checkout:

1. dependencies install using documented command;
2. controller starts independently of Electron;
3. SQLite initializes/migrates automatically;
4. repository CRUD works through controller APIs;
5. Windows/WSL records validate correctly;
6. config survives controller restart;
7. repository config/API/UI expose no configurable branch or active-run fields;
8. React UI can list/add/edit/view multiple repositories;
9. Vite development proxy supports same relative REST/WebSocket client;
10. controller serves built SPA + API + WebSocket from one loopback origin;
11. SPA deep links work and do not shadow `/api`;
12. Electron can open same UI and does not own persistence;
13. narrow phone-like viewport remains usable;
14. closing/reopening Electron does not erase controller persistence;
15. root typecheck/test/build/lint pass or any intentional limitation is durably documented.

---

## Milestone 2 — Repository watcher and transactional dispatch

OpenSpec: `002-repository-watch-dispatch` (folded into `openspec/specs/repository-watch-dispatch/`)

Status: **complete**

### Purpose

Turn durable Sol Git commits into a deterministic local executor wake signal without GitHub Actions, public webhooks, MCP, or copy/paste.

### Deliverables

- one lightweight remote watcher per active repository;
- **remote `main` only** in V1; no branch routing/configuration;
- cheap remote-HEAD polling before full fetch;
- observable watcher lifecycle/error state;
- `schemas/protocol/dispatch.schema.json` runtime validation;
- `.orca/dispatch/<id>.json` semantic validation;
- isolated final-dispatch-commit validation;
- reject mixed ordinary-work + dispatch commits;
- consumed dispatch IDs persisted in SQLite;
- last observed remote `main` SHA persisted;
- duplicate/event idempotency;
- per-repository executor lock;
- watcher restart/recovery behavior;
- unit/integration tests with temporary Git remotes.

### Exit gate

Prove:

- ordinary Sol/spec commits never launch executor;
- valid isolated dispatch launches exactly once;
- same commit/ID repeatedly observed cannot double-launch;
- invalid/mixed/schema-invalid dispatch is rejected observably;
- two repositories detect/dispatch independently;
- controller restart does not forget consumed dispatches;
- no branch-routing code path exists in V1 watcher runtime.

---

## Milestone 3 — Headless executor runtime

OpenSpec: `003-headless-executor-runtime` (folded into `openspec/specs/headless-executor-runtime/`)

Status: **complete**

### Purpose

Execute user's configured coding agent/model headlessly in Windows or WSL while preserving repository work and exposing enough observability/control for unattended use.

### Deliverables

- native Windows/PowerShell execution adapter;
- WSL adapter with configured distribution/Linux path;
- user-owned executor CLI/model configuration;
- stable small bootstrap prompt;
- process-tree supervision;
- live stdout/stderr/event capture;
- executor launch/contact retry policy (bounded, baseline three);
- `schemas/protocol/executor-result.schema.json` validation;
- isolated result-manifest publication contract;
- statuses `COMPLETED`, `BLOCKED`, `NEEDS_HUMAN`, `FAILED`;
- dirty-tree preservation/recovery;
- fetch/rebase/conflict resolution against `main`;
- no automatic force-push;
- Pause/Resume, graceful Stop, Emergency Kill;
- deterministic fake executor qualification before real CLI dependence.

### Exit gate

Prove Windows and WSL paths can independently:

1. start in intended repository;
2. stream output;
3. modify/test/commit/push controlled fixture task to `main`;
4. produce valid structured result manifest;
5. recover dirty checkout;
6. handle ordinary remote-main divergence;
7. pause/resume without discarding partial files;
8. stop/kill with accurate state reporting.

---

## Milestone 4 — Playwright Sol bridge

OpenSpec: `004-playwright-sol-bridge` (folded into `openspec/specs/playwright-sol-bridge/`)

Status: **complete**

### Purpose

Remove executor -> browser-Sol manual handoff while keeping browser ChatGPT as Sol intelligence layer.

### Deliverables

- dedicated Orca Playwright/Chromium profile;
- one global persistent-profile ownership lock;
- headed **Open ChatGPT Setup Browser** flow sharing that lock;
- stale-lock recovery that verifies real browser process ownership;
- login-state persistence/verification;
- exact Sol conversation URL per repository;
- on-demand Chromium Browser Manager;
- one page per concurrently active repository;
- no competing Chromium processes against same profile;
- trusted fixed wake message;
- input-only browser protocol (no Sol-output scraping for coordination);
- resilient composer/send adapter;
- safe informational-dialog handling;
- ChatGPT busy/backpressure + bounded retry queue;
- auth/login-required state;
- browser failure diagnostics;
- GitHub-transition-based Sol completion;
- configurable Sol timeout (~20 min baseline), one retry then `SOL_STALLED`;
- headed/debug troubleshooting mode;
- repository-specific page cancellation where possible without disturbing unrelated Sol pages.

### Exit gate

Prove with at least two dedicated conversations:

- saved auth reused after browser restart;
- setup and automation cannot concurrently own persistent profile;
- two repository Sol pages coexist in one Chromium;
- each wake sent only to its configured conversation;
- browser response text/spinner not used as completion;
- Git transition closes correct pending Sol operation;
- busy/auth/selector failures surfaced/retried according to policy;
- killing one repo page does not falsely complete another;
- Chromium closes when no Sol operations remain.

---

## Milestone 5 — Autonomous loop and multi-repository concurrency

OpenSpec: `005-autonomous-loop-engine` (folded into `openspec/specs/autonomous-loop-engine/`)

Status: **complete**

### Purpose

Compose watcher, executor, Git result, Playwright, and Sol review into first true leave-and-forget loop.

### Deliverables

Implement per-repository state machine from `docs/RUNTIME-MODEL.md`, including progression:

```text
SOL_PENDING
  -> SOL_REVIEWING
  -> EXECUTOR_PENDING
  -> EXECUTING
  -> SOL_PENDING
```

plus:

- `GOAL_COMPLETE`;
- `BLOCKED`;
- `NEEDS_HUMAN`;
- `PAUSED`;
- `STOPPED`;
- `DRAINING`;
- `SOL_STALLED`;
- `EXECUTOR_UNAVAILABLE`;
- `RECOVERY_REQUIRED`.

Other requirements:

- durable high-level goal per run;
- initial Sol inspection turn;
- Sol authoritative for high-level completion;
- executor result normally wakes Sol regardless of executor terminal status;
- one active actor per repository;
- no global executor cap;
- manual safe Wake Sol / Run executor controls;
- config/model lock while active;
- coherent event/timeline UI.

### Exit gate

Prove one repository completes several Sol -> executor -> Sol cycles without copy/paste, then at least two repositories progress independently/concurrently without cross-routing state/conversation URLs.

---

## Milestone 6 — Runtime ceilings, recovery, and hardening

OpenSpec: `006-runtime-recovery-hardening` (folded into `openspec/specs/runtime-recovery-hardening/`)

Status: **complete**

### Purpose

Make autonomous loop safe to leave running for hours and recoverable after failures/reboots.

### Deliverables

- iteration ceiling default 20;
- wall-clock ceiling default 8h;
- `DRAINING` at handoff boundaries;
- no killing current actor solely due to ceiling crossing;
- controller crash/reboot reconstruction;
- safe auto-recovery of waiting states;
- `RECOVERY_REQUIRED` for interrupted executor work;
- duplicate wake/dispatch/result protection;
- stale process/browser-profile lock detection;
- structured event/audit log;
- bounded executor-log retention;
- actionable diagnostics;
- fault-injection tests for process loss, Git changes, duplicates, browser failure, controller restart.

### Exit gate

Demonstrate deliberately interrupted/restarted Orca can explain what happened, preserve work, and resume or require explicit recovery without duplicate execution or silent data loss.

---

## Milestone 7 — Private phone access and notifications

OpenSpec: `007-remote-phone-experience` (folded into `openspec/specs/remote-phone-experience/`)

Status: **complete**

### Purpose

Let user monitor/control Orca away from Windows machine without publicly exposing controller.

### Deliverables

- same responsive React UI from Milestone 1;
- Tailscale Serve configuration/status guidance;
- Serve reverse-proxies the **single loopback Orca web origin** established in Change 001;
- phone loads private HTTPS tailnet URL;
- relative `/api` and same-origin `wss:` event channel work through that URL;
- controller remains loopback-only;
- no phone-local localhost backend assumption;
- no wildcard-CORS workaround required;
- status/timeline visibility;
- Start/Pause/Resume/Stop/Emergency Kill/Wake Sol/recovery controls as safe;
- risky configuration edits disabled server-side while run active;
- notifications for meaningful problem/terminal events;
- ordinary successful iterations quiet.

Notification-worthy baseline:

- goal complete;
- needs human;
- blocked;
- Sol stalled;
- executor unavailable;
- browser/auth failure;
- unrecoverable Git divergence;
- runtime/iteration ceiling;
- recovery required;
- emergency stop.

### Exit gate

From authorized phone on private tailnet:

1. load Orca HTTPS origin;
2. verify REST + WebSocket reach Windows controller through same origin;
3. observe concurrent repositories;
4. safely perform core controls;
5. confirm controller is not publicly exposed and Funnel is not required for normal V1 operation.

---

## Milestone 8 — End-to-end autonomy qualification

OpenSpec: `008-end-to-end-autonomy-qualification` (folded into `openspec/specs/end-to-end-autonomy-qualification/`)

Status: **implemented — qualification in progress (Change 009, NOT YET QUALIFIED)**

> The implementation contracts for end-to-end qualification are complete, but the
> milestone is **not** yet fully machine-qualified. The earlier "complete" status
> relied on simulation tests. Real end-to-end qualification (Windows + WSL executor
> paths) is now proven under Change 009; real Kimi/Codex CLI, Chromium/ChatGPT
> wake, and Tailscale phone-route remain UNQUALIFIED. See the V1 qualification
> status banner above and `openspec/changes/009-v1-runtime-integration-hardening/`.

### Purpose

Prove architecture as a system rather than isolated components.

### Qualification matrix

At minimum:

- configure at least two representative repositories;
- run concurrently;
- exercise Windows and WSL executor paths;
- repeated Sol -> executor -> Sol cycles;
- isolated transactional dispatch;
- duplicate dispatch protection;
- multiple concurrent Sol pages;
- ChatGPT busy/backpressure safely if encountered;
- dirty-tree recovery;
- remote-main divergence/rebase;
- Pause/Resume;
- graceful Stop;
- Emergency Kill;
- iteration/wall-clock draining;
- controller restart;
- executor interruption/recovery;
- browser auth/automation failure;
- phone same-origin Tailscale access/control;
- notification routing;
- inspect Git/GitHub/SQLite timeline after run.

### Exit gate

Orca can be started with high-level goal, left unattended for meaningful period, and later explain through durable state/logs exactly what each repository did, why it stopped/continued, and what requires attention.

---

## Future / intentionally deferred

Do not pull these into V1 unless required for low-cost compatibility seam:

- multiple concurrent sessions/executors inside one repository;
- branch-per-session orchestration/configurable integration branches/merge coordination;
- dynamic executor/model selection by Sol;
- resource-based global scheduling/quotas;
- macOS/Linux desktop app;
- public internet exposure;
- GitHub Actions/webhook/MCP as primary dispatcher;
- cross-machine distributed executors;
- arbitrary third-party orchestration plugin framework.

---

## Post-V1 evolution campaign (approved sequential changes)

The V1 runtime is hardened and internally machine-qualified under Change 009,
with external ChatGPT-authenticated wake, Tailscale phone-route, and real model
inference remaining honestly UNQUALIFIED where credentials/dependencies are not
available. The next campaign adopts selected OpenFlow-inspired runtime ideas as
subordinate execution capabilities; it does not change Orca's top-level
campaign/Sol/Git hierarchy.

The historical exploration is non-binding design input only. The canonical
reconciliation is [`docs/OPENFLOW-EVOLUTION-DELTA.md`](OPENFLOW-EVOLUTION-DELTA.md).

### Milestone 9 — Operational intelligence and executor capabilities

OpenSpec: `010-operational-intelligence-executor-capabilities`

Status: **complete / MACHINE-QUALIFIED internally**

Deliverables: campaign run ledger/read models; STATIC/NON_INFERENCE executor
capability probes; capability-aware adapter seam; effective per-run phase
budgets; executor-neutral autonomy permission policy; responsive history,
readiness, policy, and permission views. Fast 179/179 tests, real 12/12
qualification tests, typecheck, build, and lint passed. Provider inference,
ChatGPT-authenticated wake, and Tailscale phone route remain honestly external
UNQUALIFIED as before.

### Milestone 10 — Usage telemetry and explicit scheduler policy

OpenSpec: `011-usage-telemetry-scheduler-policy`

Status: **complete / MACHINE-QUALIFIED internally**

Deliverables: trustworthy partial usage/cost telemetry, transparent optional
scheduler limits that do not cap independent repositories by default, and
explicit user-authored role/model routing foundations. Fast 183/183 tests,
real 12/12 qualification tests, typecheck, build, and lint passed. Provider
telemetry and real model inference remain external/UNQUALIFIED where absent.

### Milestone 11 — Typed work packets and writer isolation

OpenSpec: `012-typed-work-packets-isolation`

Status: **complete / MACHINE-QUALIFIED internally**

Deliverables: versioned packet/result envelopes, persisted Git worktree/temporary
branch lifecycle, deterministic integration/reconciliation, and partial-failure
semantics. Fast 185/185 tests, real 14/14 qualification tests, typecheck, build,
lint, and diff checks passed. Same-repository swarm was forbidden until these
qualification gates passed and is now eligible for the next focused change.

### Milestone 12 — Optional same-repository swarm

OpenSpec: `013-optional-same-repository-swarm`

Status: **complete / MACHINE-QUALIFIED internally / explicitly opt-in**

Single-agent remains default; swarm is explicit, bounded, isolated, and returns a
structured partial result to Sol. Fast 187/187 tests and real 20/20 tests pass,
including Windows worktree/Git controls, partial failure, restart recovery, and
conditional WSL execution. Typecheck, build, lint, and diff checks pass.

### Milestone 13 — Optional DAG execution strategy

OpenSpec: `014-optional-dag-execution-strategy`

Status: **complete / MACHINE-QUALIFIED internally / explicitly opt-in**

Structured DAG definitions/presets only; no visual composer and no DAG default UX.
Fast 189/189 tests and real 25/25 tests pass, including Windows/Git
topological execution, integration conflict/partial failure, controls,
restart recovery, and conditional WSL execution. Typecheck, build, lint, and
diff checks pass.

### Milestone 14 — Optional rich OpenCode adapter

OpenSpec: `015-optional-rich-opencode-adapter`

Status: **complete / experimental and externally UNQUALIFIED where absent**

OpenCode remains optional and absent-safe. An unstable API is documented as
experimental rather than hidden behind brittle hacks.

Delivered: optional profile/invocation, feature-detected non-inference
health/OpenAPI probe, guarded native session/event/permission/usage seam, and
deterministic local protocol qualification. No OpenCode package/server is a
core dependency, and real external server/provider qualification remains
UNQUALIFIED unless explicitly available.

### Milestone 15 — Execution topology UI and strategy presets

OpenSpec: `016-execution-topology-ui`

Status: **complete / MACHINE-QUALIFIED internally / read-only observability**

The UI visualizes actual single-agent/swarm/DAG state and adds a small explicit
policy/reference preset catalog; it does not author graphs. The responsive
projection exposes Sol, dispatch, executor, result/Git, worker/node,
dependency, integration, duration, failure, retry/permission status, and
truthful usage evidence where CampaignDetail provides it. Focused component
tests cover single-agent, DAG dependency/partial integration, unknown usage,
and non-authoring preset presentation. Final gates: focused UI 3/3, fast
47 files / 197 tests, real 7 files / 25 passed with one explicit OpenCode
external skip, typecheck, build, lint, diff check, and strict OpenSpec
validation pass.

The post-V1 evolution scope is complete as far as safely possible. Remaining
qualification blockers are external and remain explicitly UNQUALIFIED: real
ChatGPT-authenticated wake, Tailscale phone routing, real Kimi/Codex inference,
and an authorized OpenCode server/provider. They do not invalidate the
deterministic/internal qualification of the implemented runtime foundations.
