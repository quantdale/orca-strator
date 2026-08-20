# Orca-Strator V1 UI/UX Specification

Status: **product/UI contract; implemented incrementally by roadmap milestone**

The UI is an operations console for autonomous repository sessions. It should optimize for clarity, observability, and safe control rather than decorative complexity.

## 1. Product surfaces

One responsive React application serves two surfaces:

1. Windows desktop inside Electron;
2. phone browser through private Tailscale access later.

The phone experience is not a second app and must not require a separate state model or a separate API client.

## 2. Shared-origin networking model

The UI uses relative controller routes in normal application code:

```text
/api/health
/api/repositories
/api/events
```

It must **not** hard-code `localhost`/`127.0.0.1` as the production API host. A phone browser's localhost points to the phone itself.

Runtime modes:

```text
Development:
Vite origin
  -> Vite proxies /api and /api/events to controller

Built desktop/local:
Controller origin
  -> serves React SPA + /api + /api/events

Phone later:
Tailscale HTTPS origin
  -> Serve reverse-proxies single Orca controller/web origin
  -> same SPA + same /api + same WebSocket
```

This same-origin design is intentional: phone access should not require wildcard CORS or duplicating environment-specific networking logic across components.

## 3. Navigation model

V1 top-level information architecture:

```text
Repositories
Settings
```

Later optional additions if real need appears:

```text
Activity
Diagnostics
```

Do not create many empty navigation sections before their functionality exists.

## 4. Repository dashboard

The dashboard is the default home screen.

Each repository card/row should eventually answer at a glance:

- display name;
- execution environment (`Windows` / `WSL` + distro);
- configured executor/model;
- high-level run state;
- current actor (`Sol`, `Executor`, `None`);
- iteration / limit;
- elapsed time / limit;
- latest meaningful activity;
- warning/error indicator;
- primary control/action appropriate to state.

V1 always integrates through `main`; this is not a per-repository setting that needs dashboard prominence.

Change 001 only has configuration/status placeholders and must not fake autonomous states that are not implemented.

## 5. Dashboard visual hierarchy

Recommended card hierarchy later:

```text
Nightwatch                                      EXECUTING
WSL · Ubuntu-24.04
Kimi · DeepSeek V4 Flash

Iteration 7 / 20               3h 14m / 8h
Current: executor implementing CHANGE-047

[Open] [Pause] [Stop]
```

Use badges/icons consistently but do not communicate critical state through color alone.

## 6. Empty state

When controller is connected but no repositories exist:

```text
No repositories configured.
Add a repository to begin setting up Orca-Strator.

[ Add Repository ]
```

This must be visually distinct from controller unavailable.

## 7. Controller unavailable state

When UI cannot reach controller:

```text
Controller unavailable
Orca-Strator's controller is not reachable through this Orca origin.

[ Retry ]
```

Do not show an empty repository list as though configuration was deleted.

The message should work on desktop and phone; avoid telling a phone user to call laptop localhost directly.

## 8. Add/Edit Repository form

Sections:

### Identity

- Display name
- GitHub remote

V1 uses `main` automatically. Do not show a branch selector/input.

### Local execution

- Environment selector: Windows / WSL
- Local path
- WSL distribution when WSL

### Executor

- Executor CLI
- Model/configuration string

### Sol

- Exact ChatGPT conversation URL

### Safety ceilings

- Max iterations (default 20)
- Max runtime (prefer user-friendly hours/minutes UI while API stores minutes)

## 9. Form guidance

Use contextual labels/examples:

Windows path:

```text
D:\Projects\TabDock
```

WSL path:

```text
/home/dale/projects/nightwatch
```

WSL distro:

```text
Ubuntu-24.04
```

Sol URL:

```text
https://chatgpt.com/c/...
```

Executor/model fields may initially be free-form text with remembered presets later. Do not hardcode a stale provider catalog in Change 001.

## 10. Form validation UX

Validation happens in two layers:

- immediate obvious client feedback;
- authoritative controller validation.

On server validation failure:

- preserve user input;
- highlight relevant fields;
- show concise summary;
- do not dump raw JSON/stack traces.

## 11. Repository detail screen

Change 001 detail screen shows persisted configuration:

```text
Repository
Execution
Executor
Sol
Safety
```

A small non-editable note may state `Integration branch: main (V1)` if useful, but this is not stored repository configuration.

Later milestones add:

```text
Current Run
Timeline
Executor Console
Git/Dispatch
Sol Bridge
Diagnostics
```

Do not put every future panel on screen before it has real data.

## 12. Runtime control semantics in UI

Once implemented, controls map exactly to runtime contract.

### Start

Starts a new run from a user-provided high-level goal.

Must not silently reuse a previous terminal goal as a new run without showing it.

### Pause

Meaning shown to user:

> Stop executor inference now and preserve unfinished work. Sol will not be awakened because of this interruption.

Use when executor is active or to prevent next executor dispatch.

### Resume

Meaning:

> Continue the paused active dispatch/run, recovering preserved work.

### Stop

Meaning:

> Gracefully finish the current actor, then stop before the next handoff.

### Emergency Kill

Meaning:

> Immediately terminate the selected repository's active executor/browser operation. Recovery may be required.

This action needs stronger confirmation than normal Stop.

### Wake Sol

Manual recovery/diagnostic action; disabled when same repository already has active Sol turn.

### Run Executor

Manual recovery action; disabled without valid work/dispatch unless explicit recovery semantics are met.

## 13. Configuration lock while active

While repository run is active, fields that would mutate execution identity should be read-only:

- local path;
- environment/distro;
- executor CLI/model;
- Sol conversation URL;
- possibly ceilings depending later semantics.

Do not rely only on UI disabling; controller enforces this later.

## 14. Start-run goal dialog

A run requires a high-level goal.

Example:

```text
Goal
Audit and harden the repository until Sol determines all critical/high correctness issues are resolved.
```

Show effective configuration before Start:

```text
Executor: Kimi / DeepSeek V4 Flash
Environment: WSL / Ubuntu-24.04
Git: main
Sol: configured ✓
Limits: 20 iterations / 8 hours
```

This makes accidental wrong-repository/model runs less likely.

## 15. Live activity timeline

Later runtime UI uses structured events, not scraped terminal prose, for the main timeline.

Example:

```text
19:12  Dispatch 047 accepted
19:12  Executor launched
19:28  Verification started
19:34  Result pushed: BLOCKED
19:34  Sol wake queued
19:35  Sol wake submitted
19:43  New dispatch 048 detected
```

Raw executor output belongs in a separate console panel.

## 16. Executor console

Requirements later:

- live stdout/stderr;
- monospace display;
- auto-follow with ability to scroll back;
- clear distinction stdout/stderr if practical;
- bounded UI memory/log loading;
- no need for interactive terminal input in V1 unless an executor requires it (headless is the contract).

## 17. Error presentation

Repository-level failure card should show:

```text
SOL_STALLED
No durable Git transition was detected after two wake attempts.
Last wake: 19:02
Next action: inspect ChatGPT/browser or use Wake Sol.

[Open Diagnostics] [Wake Sol] [Stop]
```

Do not show only generic `Something went wrong`.

Connection errors should distinguish an Orca controller problem from an empty repository registry.

## 18. Notifications center/history

Full notification center is optional. The core requirement is that current and recent actionable status is visible per repository.

Phone/system notifications later trigger only meaningful terminal/problem states.

## 19. ChatGPT setup UI

Settings -> ChatGPT Automation:

```text
Automation profile: Configured / Not configured
Profile use: Available / Automation active / Setup active
Last setup verification: timestamp or unknown

[ Open ChatGPT Setup Browser ]
[ Test Setup ]  (when implemented safely)
```

Open Setup Browser:

- acquires exclusive access to the dedicated automation profile;
- starts headed Playwright Chromium using that profile;
- user logs in/visually checks account;
- closing preserves profile and releases the lock;
- normal automation remains headless.

If the automated browser is already using the profile, the UI must not launch a second competing browser process. It should wait, explain the conflict, or cleanly stop the idle automation browser first.

Do not display browser cookies/session tokens.

## 20. Tailscale/phone setup UI

Later Settings section:

```text
Phone access
Status: Not configured / Available
Controller remains loopback-only.
Tailscale Serve publishes the Orca web origin privately to your tailnet.
```

The expected phone URL is the Tailscale HTTPS origin, not a localhost controller URL.

The phone page and its `/api`/WebSocket traffic remain same-origin through that URL.

Orca can provide setup guidance/status but does not need to become a Tailscale account manager.

## 21. Responsive rules

Primary target narrow widths:

```text
360px
390px
430px
```

At narrow widths:

- cards stack;
- forms become single column;
- tables should become cards/list rows rather than require horizontal scroll for core information;
- destructive controls may live in overflow/details but remain reachable;
- status/primary action stays near top;
- raw terminal panel may use horizontal scrolling because terminal text is inherently wide, but navigation/status must not.

## 22. Desktop layout

At wide widths, use space for information density without turning into a monitoring wall.

Potential repository detail layout later:

```text
┌──────────────────────────────────────────────────────────┐
│ Repository header / state / controls                    │
├───────────────────────────┬──────────────────────────────┤
│ Run & timeline            │ Current actor / diagnostics │
├───────────────────────────┴──────────────────────────────┤
│ Executor console                                         │
└──────────────────────────────────────────────────────────┘
```

## 23. Accessibility baseline

- semantic buttons/forms/labels;
- keyboard reachable controls;
- visible focus state;
- error text associated with fields;
- state not encoded by color only;
- adequate contrast;
- confirmation dialogs focus/escape behavior correct.

## 24. Networking UX tests

Change 001 should prove:

- UI uses relative `/api` routes;
- Vite development proxy makes the same client work in dev;
- controller-served built SPA uses same-origin REST/WebSocket;
- no production hard-coded localhost API host appears in client behavior;
- client-side deep links survive reload in built mode;
- API failure is presented clearly rather than being mistaken for an empty registry.

Milestone 7 later proves the same build through an actual Tailscale Serve origin on a phone.

## 25. UI simplicity rule

Do not build:

- drag/drop dashboard customization;
- theme marketplace;
- complicated graphing;
- multi-pane IDE/editor;
- embedded Git client;
- fake AI chat interface;
- branch management UI in V1;
- a second mobile-specific API/networking layer;

until the core autonomous loop is proven.

The product is an orchestrator/status/control UI, not another IDE.

## 26. Operational intelligence surface

After V1 hardening, repository detail includes compact responsive sections for:

- recent campaigns and a current structured trace;
- iteration/phase timestamps, durations, correlation IDs, retry/recovery and
  failure markers;
- executor readiness with probe level, CLI/version, environment/Git status,
  and explicit unknown auth/model state;
- effective run policy and permission preset/decision summaries.

The `Test executor` action is explicitly labelled no inference and uses the
NON_INFERENCE probe. Permission summaries show enforcement type so advisory
generic-CLI policy is not presented as a security guarantee. This surface is
observability, not a graph/workflow composer.
