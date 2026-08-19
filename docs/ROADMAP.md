# Orca-Strator Roadmap

This roadmap is the durable development sequence. Significant implementation should advance through focused OpenSpec changes instead of one giant build prompt.

## Milestone 0 — Architecture and durable workflow

Status: **complete**

- lock V1 product architecture;
- establish `AGENTS.md` recovery contract;
- establish `.agent/state.json` waypoint;
- add repository-local `/go` skill;
- create the first OpenSpec change.

## Milestone 1 — Bootstrap control plane

OpenSpec: `001-bootstrap-control-plane`

Status: **active**

Deliver a runnable Windows-first skeleton with:

- TypeScript workspace;
- separate Node.js controller process;
- responsive React/Vite UI;
- Electron desktop shell that uses the same UI;
- local HTTP/WebSocket controller boundary;
- SQLite persistence foundation;
- repository registry and configuration model;
- basic repository dashboard/status views;
- automated tests for configuration/state primitives;
- build/typecheck/lint/test scripts.

Do not implement full autonomous execution in this milestone.

## Milestone 2 — Repository watcher and transactional dispatch

Planned OpenSpec: `002-repository-watch-dispatch`

Deliver:

- remote branch polling per enabled repository;
- cheap remote-HEAD detection before full fetch;
- isolated dispatch marker schema;
- validation that final dispatch commits contain only allowed control artifacts;
- consumed-dispatch idempotency in SQLite;
- per-repository execution lock;
- observable watcher states/events.

## Milestone 3 — Headless executor runtime

Planned OpenSpec: `003-headless-executor-runtime`

Deliver:

- native Windows/PowerShell execution adapter;
- WSL execution adapter with configurable distribution/path;
- executor/model configuration owned by the user;
- process-tree supervision and live stdout/stderr streaming;
- stable bootstrap prompt contract;
- result-manifest contract;
- dirty-tree recovery/reconciliation instructions;
- fetch/rebase/conflict handling expectations;
- Pause/Resume, graceful Stop, Emergency Kill;
- executor launch retry policy.

## Milestone 4 — Playwright Sol bridge

Planned OpenSpec: `004-playwright-sol-bridge`

Deliver:

- dedicated Playwright automation profile;
- headed ChatGPT login/setup flow;
- per-repository exact Sol conversation URL;
- on-demand Chromium Browser Manager;
- one page per concurrently active repository;
- fixed trusted wake-message generation;
- no Sol-output scraping as protocol;
- ChatGPT busy/backpressure detection and retry queue;
- browser/auth failure states;
- GitHub-transition-based Sol completion detection;
- Sol stall timeout/retry.

## Milestone 5 — Autonomous loop and multi-repository concurrency

Planned OpenSpec: `005-autonomous-loop`

Deliver the complete state machine:

```text
READY_FOR_SOL
  -> SOL_REVIEWING
  -> READY_FOR_EXECUTOR
  -> EXECUTING
  -> RESULT_PUSHED
  -> READY_FOR_SOL
```

plus terminal/control states such as:

- `GOAL_COMPLETE`
- `BLOCKED`
- `NEEDS_HUMAN`
- `PAUSED`
- `STOPPED`
- `DRAINING`
- `SOL_STALLED`
- `RECOVERY_REQUIRED`

Multiple repositories run independently with no global executor cap. V1 retains one active executor per repository.

## Milestone 6 — Runtime ceilings, recovery, and hardening

Planned OpenSpec: `006-runtime-recovery-hardening`

Deliver:

- iteration ceiling;
- wall-clock ceiling;
- drain-at-handoff semantics;
- crash/reboot state reconstruction;
- safe auto-recovery of waiting states;
- explicit recovery for interrupted executors;
- duplicate event/dispatch protection;
- robust structured logging;
- actionable failure diagnostics;
- integration and fault-injection tests.

## Milestone 7 — Private phone access and notifications

Planned OpenSpec: `007-phone-control`

Deliver:

- responsive mobile UI using the same frontend;
- Tailscale Serve setup/status guidance;
- full status visibility;
- operational controls from phone;
- configuration locking while runs are active;
- notifications for meaningful terminal/problem states;
- no noisy notification on ordinary successful iterations.

## Milestone 8 — End-to-end autonomy qualification

Planned OpenSpec: `008-autonomy-qualification`

Prove Orca-Strator can be left unattended:

- configure at least two test repositories;
- run them concurrently;
- exercise both Windows and WSL execution paths;
- complete repeated Sol -> executor -> Sol loops;
- verify transactional dispatch;
- verify Playwright concurrent pages and ChatGPT backpressure behavior;
- exercise Pause/Resume, Stop, Emergency Kill, runtime drain, reboot recovery, and failure notifications;
- confirm every run leaves a durable and inspectable Git/GitHub/SQLite history.

## Future / intentionally deferred

Do not pull these into V1 unless required for compatibility:

- multiple concurrent sessions/executors inside one repository;
- branch-per-session orchestration and automatic merge coordination;
- dynamic executor/model selection by Sol;
- macOS/Linux desktop application support;
- public internet exposure of the control plane;
- GitHub Actions/webhook/MCP transport as the primary dispatcher.
