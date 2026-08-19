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
- **Controller API:** local HTTP + WebSocket event stream
- **Durable local runtime state:** SQLite
- **Browser automation:** Playwright
- **Git/process integration:** direct child-process invocation of `git`, PowerShell, `wsl.exe`, and configured agent CLIs

The controller, not Electron, owns orchestration state. Closing/minimizing the desktop UI must not stop active runs.

The responsive React UI is shared by:

1. Electron on Windows; and
2. a phone browser connected privately through Tailscale Serve.

The controller binds to localhost. Do not expose the control API directly to the public internet.

## 3. Repository configuration

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

## 4. Sol -> executor transport

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

## 5. Executor runtime

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

## 6. Executor -> Sol transport

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

## 7. Detecting Sol completion

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

## 8. Run limits and controls

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

## 9. Dirty trees and Git divergence

Dirty working trees are supported, including leftovers from an interrupted/paused executor.

Orca itself must never blindly discard them with `git reset --hard`. The executor is instructed to inspect, preserve, reconcile, and eventually leave intended work clean, committed, and pushed.

When remote `main` moves during execution, the executor should fetch/rebase/pull, resolve ordinary conflicts, and continue. If it cannot safely resolve the divergence, report `BLOCKED` so Sol can review.

## 10. Phone control and notifications

V1 phone access uses **Tailscale Serve** to expose the localhost UI privately inside the user's tailnet. Do not use a public Funnel endpoint by default.

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

## 11. Crash/reboot recovery

The controller persists runtime state in SQLite and rehydrates active repositories on startup.

Safe waiting states may recover automatically. If an executor process was interrupted mid-work by a crash/reboot, preserve the checkout and mark it `RECOVERY_REQUIRED`; V1 requires explicit Resume before another executor process modifies that repository.

## 12. High-level goal loop

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

## 13. Design principles

1. Keep V1 simple.
2. GitHub is durable inter-agent truth; SQLite is local runtime truth.
3. State transitions are explicit and idempotent.
4. Repository-level concurrency is independent; per-repository execution is serialized.
5. The user owns executor/model selection.
6. Sol provides architectural/review intelligence but may make code changes when useful.
7. Browser automation is a narrow transport adapter, not the source of truth.
8. Every failure must be observable and recoverable without silently discarding work.
9. V1 branch behavior is intentionally fixed to `main`; branch orchestration is deferred until multi-session-per-repository work exists.
