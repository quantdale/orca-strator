# Orca-Strator Roadmap

This roadmap is the durable development sequence. Significant implementation advances through focused OpenSpec changes instead of one giant build prompt.

## How to use this roadmap

Each milestone has:

- **purpose** — why the milestone exists;
- **deliverables** — what must be built;
- **exit gate** — evidence required before the milestone is considered complete;
- **review checkpoint** — when a Sol/ChatGPT repository review is valuable before the next OpenSpec.

A coding-agent `/go` session should normally continue the currently active OpenSpec until its exit gate is reached or a genuine blocker requires review.

Do not implement later milestones merely because their requirements are already described here.

---

## Milestone 0 — Architecture and durable workflow

Status: **complete**

### Purpose

Establish enough durable repository context that development itself can be resumed safely across disposable AI coding sessions.

### Delivered

- locked V1 product architecture;
- `AGENTS.md` recovery/agent contract;
- `.agent/state.json` waypoint plus schema;
- repository-local `/go` skill;
- detailed development protocol;
- runtime-state/concurrency contract;
- OpenSpec-based implementation sequence;
- initial OpenSpec Change 001.

### Exit gate

A fresh coding-agent session can determine the active work from repository state without this ChatGPT conversation.

---

## Milestone 1 — Bootstrap control plane

OpenSpec: `001-bootstrap-control-plane`

Status: **active**

### Purpose

Create the smallest real application foundation that later watcher, executor, browser, and autonomy systems can plug into without putting orchestration ownership inside Electron.

### Deliverables

- npm/TypeScript workspace;
- separate Node.js controller process;
- responsive React/Vite UI;
- Electron Windows desktop shell using the same UI;
- localhost HTTP + WebSocket controller boundary;
- SQLite migration/persistence foundation;
- repository registry/configuration model;
- native Windows vs WSL configuration validation;
- basic repository dashboard/detail/configuration UI;
- controller health/connection status;
- test/typecheck/build baseline;
- clear developer startup workflow.

### Explicitly not yet

- no GitHub remote watcher;
- no dispatch marker handling;
- no executor launch;
- no Playwright/ChatGPT automation;
- no autonomous run state machine;
- no Tailscale exposure/notifications.

### Exit gate

From a fresh Windows checkout:

1. dependencies install using the documented command;
2. controller starts independently of Electron;
3. SQLite initializes/migrates automatically;
4. repository CRUD works through controller APIs;
5. Windows and WSL repository records validate correctly;
6. configurations survive controller restart;
7. React UI can list/add/edit/view multiple repositories;
8. Electron can open the same UI;
9. narrow phone-like viewport remains usable;
10. closing/reopening Electron does not own/erase controller persistence;
11. root typecheck/test/build commands pass or any intentional limitation is explicitly documented.

### Review checkpoint

Perform a deep repository review before creating Change 002. Verify process boundaries, package structure, API contracts, SQLite choice/migrations, and UI/controller ownership. Correct foundational mistakes now rather than letting later orchestration code depend on them.

---

## Milestone 2 — Repository watcher and transactional dispatch

Planned OpenSpec: `002-repository-watch-dispatch`

Status: **planned**

### Purpose

Turn durable Sol Git commits into a deterministic local executor wake signal without GitHub Actions, public webhooks, MCP, or UI copy/paste.

### Deliverables

- one lightweight remote watcher per active repository;
- configurable watched branch, default `main`;
- cheap remote-HEAD polling before full fetch;
- observable watcher lifecycle/error state;
- `.orca/dispatch/<id>.json` schema;
- isolated final-dispatch-commit validation;
- reject mixed ordinary-work + dispatch commits;
- consumed dispatch IDs persisted in SQLite;
- last observed remote SHA persisted;
- duplicate/event idempotency;
- per-repository executor lock;
- watcher restart/recovery behavior;
- unit/integration tests using temporary Git repositories/remotes where practical.

### Exit gate

Prove that:

- ordinary Sol/spec commits never launch the executor;
- a valid isolated dispatch commit launches exactly once;
- seeing the same commit repeatedly cannot double-launch;
- invalid/mixed dispatch is rejected observably;
- two different repositories may detect/dispatch independently;
- controller restart does not forget consumed dispatches.

### Review checkpoint

Review the dispatch protocol and Git edge cases before process execution is attached to it.

---

## Milestone 3 — Headless executor runtime

Planned OpenSpec: `003-headless-executor-runtime`

Status: **planned**

### Purpose

Execute the user's configured coding agent/model headlessly in either Windows or WSL while preserving repository work and exposing enough observability/control for unattended use.

### Deliverables

- native Windows/PowerShell execution adapter;
- WSL adapter with configurable distribution/Linux working path;
- user-owned executor CLI/model configuration;
- stable small bootstrap prompt contract;
- process-tree supervision;
- live stdout/stderr/event capture;
- executor launch/contact retry policy (default bounded retries, e.g. three);
- result-manifest schema and writer contract;
- executor statuses `COMPLETED`, `BLOCKED`, `NEEDS_HUMAN`, `FAILED`;
- dirty-tree preservation/recovery instructions;
- fetch/rebase/conflict-resolution expectations;
- no automatic force-push;
- Pause/Resume semantics;
- graceful Stop semantics;
- Emergency Kill semantics;
- integration tests with deterministic fake/test executors before relying exclusively on real model CLIs.

### Exit gate

Prove Windows and WSL executor paths can independently:

1. start in the configured repository;
2. stream observable output;
3. modify/test/commit/push a controlled fixture task;
4. produce a structured result manifest;
5. recover a deliberately dirty checkout;
6. handle ordinary remote divergence;
7. be paused/resumed without discarding partial files;
8. be stopped/killed with accurate state reporting.

### Review checkpoint

Deep review the process model, WSL boundary, Git reconciliation policy, and interruption semantics before automated Sol wake-up is added.

---

## Milestone 4 — Playwright Sol bridge

Planned OpenSpec: `004-playwright-sol-bridge`

Status: **planned**

### Purpose

Remove the executor -> browser-Sol manual handoff while keeping the ChatGPT browser subscription as the Sol intelligence layer.

### Deliverables

- dedicated Orca Playwright/Chromium user-data directory;
- headed **Open ChatGPT Setup Browser** flow;
- login-state persistence/verification;
- exact Sol conversation URL per repository;
- on-demand Chromium Browser Manager;
- one page per concurrently active repository;
- no competing Chromium processes against one profile;
- trusted fixed wake-message construction;
- input-only browser protocol (no Sol-output scraping for coordination);
- composer/send automation with resilient selectors;
- safe handling of informational confirmation dialogs;
- ChatGPT busy/backpressure state and bounded retry/backoff queue;
- auth/login-required state;
- browser automation failure state/diagnostics;
- GitHub-transition-based Sol completion detection;
- configurable Sol timeout (initially ~20 min);
- one wake retry before `SOL_STALLED` by default;
- headed/debug mode for troubleshooting.

### Exit gate

Prove with at least two dedicated ChatGPT conversation URLs that:

- Orca can reuse saved authentication after browser restart;
- two repository Sol pages can coexist inside one Chromium process;
- each wake is sent only to its configured conversation;
- browser completion is not inferred from response text;
- Git transition closes the correct pending Sol operation;
- busy/auth/selector failures are surfaced and retried according to policy;
- Chromium closes when no Sol operations remain.

### Review checkpoint

Review browser security, session isolation, retry behavior, and UI fragility before enabling the full autonomous loop.

---

## Milestone 5 — Autonomous loop and multi-repository concurrency

Planned OpenSpec: `005-autonomous-loop`

Status: **planned**

### Purpose

Compose watcher, executor, Git result, Playwright, and Sol review into the first true leave-and-forget loop.

### Deliverables

Implement the durable per-repository state machine described in `docs/RUNTIME-MODEL.md`, including core progression similar to:

```text
SOL_PENDING
  -> SOL_REVIEWING
  -> EXECUTOR_PENDING
  -> EXECUTING
  -> SOL_PENDING
```

plus terminal/control/recovery states such as:

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

- required durable high-level goal per run;
- initial Sol inspection turn;
- Sol remains authoritative for high-level completion;
- executor result normally wakes Sol regardless of `COMPLETED/BLOCKED/NEEDS_HUMAN/FAILED`;
- one active actor per repository;
- no global executor cap across repositories;
- manual safe `Wake Sol` / `Run executor` controls;
- configuration/model lock while a run is active;
- coherent event/timeline representation for UI.

### Exit gate

Prove one repository can complete several Sol -> executor -> Sol cycles without manual copy/paste, then prove at least two repositories can progress independently/concurrently without cross-routing state or conversation URLs.

### Review checkpoint

Perform a full architecture/code review before adding long-duration unattended recovery/ceilings.

---

## Milestone 6 — Runtime ceilings, recovery, and hardening

Planned OpenSpec: `006-runtime-recovery-hardening`

Status: **planned**

### Purpose

Make the autonomous loop safe to leave running for hours and recoverable after ordinary failures/reboots.

### Deliverables

- iteration ceiling (default 20);
- wall-clock ceiling (default 8h);
- `DRAINING` at handoff boundaries;
- no killing current actor solely due to ceiling crossing;
- controller crash/reboot reconstruction;
- safe auto-recovery of waiting states;
- `RECOVERY_REQUIRED` for interrupted executor work;
- duplicate wake/dispatch/result protection;
- stale process detection;
- structured event/audit log;
- retention policy for large executor logs;
- actionable diagnostics;
- fault-injection/integration tests for process loss, Git changes, duplicate events, browser failure, and controller restart.

### Exit gate

Demonstrate a deliberately interrupted/restarted Orca instance can explain what happened, preserve repository work, and resume or require explicit recovery without duplicate execution or silent data loss.

### Review checkpoint

Security/reliability review before enabling remote phone controls.

---

## Milestone 7 — Private phone access and notifications

Planned OpenSpec: `007-phone-control`

Status: **planned**

### Purpose

Let the user monitor/control Orca away from the Windows machine without publicly exposing the controller.

### Deliverables

- same responsive React UI usable from phone;
- Tailscale Serve setup/status guidance;
- controller remains localhost-only by default;
- status/timeline visibility;
- operational controls: Start/Pause/Resume/Stop/Emergency Kill/Wake Sol/recovery actions as safe;
- risky configuration edits disabled while target run is active;
- notifications for meaningful problem/terminal events;
- ordinary successful iterations remain quiet.

Initial notification-worthy events:

- goal complete;
- needs human;
- blocked;
- Sol stalled;
- executor unavailable;
- browser/auth failure;
- unrecoverable Git conflict/divergence;
- runtime/iteration ceiling reached;
- recovery required;
- emergency stop.

### Exit gate

From an authorized phone on the private tailnet, observe concurrent repositories and safely perform core run controls without opening a public control endpoint.

---

## Milestone 8 — End-to-end autonomy qualification

Planned OpenSpec: `008-autonomy-qualification`

Status: **planned**

### Purpose

Prove the architecture as a system rather than merely testing components in isolation.

### Qualification matrix

At minimum:

- configure at least two real/representative repositories;
- run them concurrently;
- exercise native Windows executor path;
- exercise WSL executor path;
- perform repeated Sol -> executor -> Sol cycles;
- verify isolated transactional dispatch;
- verify duplicate dispatch protection;
- verify multiple concurrent Sol pages;
- observe ChatGPT busy/backpressure behavior safely if encountered;
- exercise dirty-tree recovery;
- exercise remote-main divergence/rebase;
- exercise Pause/Resume;
- exercise graceful Stop;
- exercise Emergency Kill;
- exercise iteration and wall-clock draining;
- exercise controller restart;
- exercise executor interruption/recovery;
- exercise browser auth/automation failure path;
- verify phone status/control;
- verify notification routing;
- inspect Git/GitHub/SQLite timeline after the run.

### Exit gate

Orca can be started with a high-level goal, left unattended for a meaningful period, and later explain through durable state/logs exactly what each repository did, why it stopped/continued, and what requires user attention.

---

## Future / intentionally deferred

Do not pull these into V1 unless required for a low-cost compatibility seam:

- multiple concurrent sessions/executors inside one repository;
- branch-per-session orchestration and merge coordination;
- dynamic executor/model selection by Sol;
- resource-based global scheduling/quotas;
- macOS/Linux desktop application support;
- public internet exposure of the control plane;
- GitHub Actions/webhook/MCP as the primary dispatcher;
- cross-machine distributed executors;
- arbitrary third-party orchestration plugin framework.
