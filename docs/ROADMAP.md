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

OpenSpec: `001-bootstrap-control-plane`

Status: **active**

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
- SQLite migration/persistence foundation;
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

### Review checkpoint

Perform deep repository review before Change 002. Verify process/package boundaries, SQLite migrations, API/event contracts, same-origin delivery seam, Windows/WSL model, and UI/controller ownership.

---

## Milestone 2 — Repository watcher and transactional dispatch

Planned OpenSpec: `002-repository-watch-dispatch`

Status: **planned**

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

### Review checkpoint

Review dispatch protocol and Git edge cases before process execution attaches to it.

---

## Milestone 3 — Headless executor runtime

Planned OpenSpec: `003-headless-executor-runtime`

Status: **planned**

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

### Review checkpoint

Deep-review process model, WSL boundary, Git reconciliation, interruption semantics before automated Sol wake.

---

## Milestone 4 — Playwright Sol bridge

Planned OpenSpec: `004-playwright-sol-bridge`

Status: **planned**

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

### Review checkpoint

Review browser security, profile ownership, page isolation, retry behavior, UI fragility before full loop.

---

## Milestone 5 — Autonomous loop and multi-repository concurrency

Planned OpenSpec: `005-autonomous-loop`

Status: **planned**

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

### Review checkpoint

Full architecture/code review before long-duration recovery/ceilings.

---

## Milestone 6 — Runtime ceilings, recovery, and hardening

Planned OpenSpec: `006-runtime-recovery-hardening`

Status: **planned**

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

### Review checkpoint

Security/reliability review before remote phone controls.

---

## Milestone 7 — Private phone access and notifications

Planned OpenSpec: `007-phone-control`

Status: **planned**

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

Planned OpenSpec: `008-autonomy-qualification`

Status: **planned**

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
