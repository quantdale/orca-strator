# Orca-Strator V1 Test and Qualification Strategy

Status: **normative quality strategy**

Orca-Strator coordinates autonomous coding agents, Git, WSL, browsers, and long-lived state. Unit tests alone are insufficient. The project should build confidence in layers and reserve expensive end-to-end qualification for milestones that need it.

## 1. Testing principles

1. Test state-machine and validation logic deterministically.
2. Keep most tests fast enough for frequent `/go` checkpoints.
3. Isolate tests from user's real repositories, SQLite DB, browser profile, and credentials.
4. Use real subprocess/Git/WSL/Playwright tests only where mocks cannot prove behavior.
5. Every bug fix should add the narrowest useful regression test when practical.
6. Never report a gate as passed unless the relevant command actually ran.
7. V1 Git behavior is fixed to `main`; branch-routing behavior is not part of V1 test surface.
8. Machine-readable protocol schemas are tested independently from runtime semantics.
9. Shared UI networking is same-origin by default; phone access must not depend on phone-local `localhost`.

## 2. Test layers

### Layer A — pure contract/unit tests

Targets:

- shared validation;
- defaults/normalization;
- absence/rejection of configurable branch fields in V1;
- state-transition guards;
- dispatch/result/control JSON Schema validation;
- protocol semantic validation beyond JSON Schema;
- timeout/backoff calculations;
- command construction;
- path/environment helpers;
- browser-profile lock state logic;
- same-origin API/WebSocket URL helpers.

Properties:

- no network;
- no real GitHub;
- no real executor;
- no real ChatGPT;
- very fast.

### Layer B — SQLite/storage tests

Use temporary DB/data directories.

Targets:

- migration ordering/idempotency;
- repository CRUD;
- repository table remains configuration-only and main-only;
- later run/dispatch/wake persistence;
- transaction rollback;
- crash/reopen semantics where feasible.

Never touch production/local user DB.

### Layer C — controller/API/web integration tests

Start controller on an ephemeral test port/data directory.

Targets:

- REST contract;
- validation/error mapping;
- no V1 branch configuration surface;
- WebSocket events;
- reconnect/refetch behavior;
- health/readiness;
- built React SPA static serving;
- SPA history fallback without intercepting `/api`;
- no static access to data/log/browser-profile directories;
- later orchestration service integration.

### Layer D — React UI tests

Targets:

- repository list/empty/offline states;
- Windows/WSL forms;
- no branch selector in V1;
- validation handling;
- relative REST paths;
- same-origin WebSocket URL derivation (`ws:` vs `wss:`);
- control enable/disable rules;
- runtime status rendering later;
- responsive critical flows.

Prefer behavior-visible assertions over implementation-detail snapshots.

### Layer E — Electron smoke tests

Targets:

- desktop launches;
- shared UI loads;
- controller connectivity works;
- built/local mode may load controller-served Orca origin;
- window restart does not own/delete controller state;
- safe BrowserWindow baseline.

Do not duplicate all UI tests inside Electron.

### Layer F — local Git sandbox integration

Create temporary bare remote + working clones locally. Use `main` as only V1 integration branch.

Targets later:

- remote `main` HEAD watcher detection;
- ordinary non-dispatch commits ignored;
- isolated dispatch accepted;
- mixed dispatch commit rejected;
- duplicate dispatch not relaunched;
- push/rebase/divergence scenarios;
- dirty worktree preservation;
- result/control marker isolation.

This avoids consuming real GitHub for most protocol tests.

### Layer G — executor adapter qualification

Use controlled fake executor first.

Fake executor supports scripted behaviors:

```text
success
launch failure
long-running
stdout/stderr
non-zero exit
hang
ignore graceful interrupt
write dirty files
produce result manifest
produce malformed result manifest
```

Then run targeted qualification against actual configured CLIs on development machine.

### Layer H — Playwright bridge qualification

Use a fake local webpage first to test browser-manager mechanics:

- on-demand browser lifecycle;
- persistent-profile global locking;
- headed setup vs headless automation mutual exclusion;
- stale-lock recovery;
- multiple pages;
- per-repository locking;
- message insertion/submit adapter abstraction;
- busy-modal adapter behavior;
- one-page kill without corrupting unrelated repository pages.

Real ChatGPT E2E is separate integration qualification because its DOM/service behavior is external and unstable.

### Layer I — Tailscale/phone qualification

Milestone 7.

Prove the **same built UI** through actual Tailscale Serve:

- Serve proxies the single loopback Orca web endpoint;
- phone loads HTTPS tailnet URL;
- relative `/api` requests reach Windows controller;
- WebSocket connects as `wss:` to same Tailscale origin;
- no client configuration points to phone-local localhost;
- dashboard/control flows remain usable at phone viewport;
- tailnet access restrictions apply as configured;
- public Funnel is not required for normal V1 operation.

### Layer J — full autonomy qualification

Milestone 8 only.

Use test repositories and prove repeated unattended loops across Windows and WSL.

## 3. Change 001 minimum gates

Required before Change 001 review:

```text
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

Exact scripts may vary slightly but root exposes equivalent documented commands.

Functional acceptance:

- create Windows repository;
- create WSL repository;
- list/edit/delete;
- repository record/API/UI contain no configurable branch field;
- restart controller and retain data;
- close/reopen Electron without losing controller state;
- offline/disconnected UI distinct from empty state;
- narrow viewport usable;
- built React app served by controller from same origin as API/WebSocket;
- Vite proxy lets same relative API client work in development;
- a production client bundle/config does not require hard-coded localhost API host;
- local DB/build/browser/auth/log artifacts remain untracked under seeded hygiene policy.

## 4. Protocol schema test matrix

For each schema:

- schema document parses as JSON;
- Draft 2020-12 structure is accepted by chosen validator when runtime work begins;
- valid canonical fixture passes;
- missing required field fails;
- unexpected additional property fails where `additionalProperties: false` is intended;
- bad SHA/date/status/decision values fail;
- dispatch relative path traversal attempts fail structural and/or semantic validation;
- old schema files are not silently rewritten with incompatible meaning after runtime implementation begins.

JSON Schema does not replace semantic checks such as repository-root canonicalization, active run matching, immutable ID history, or Git commit isolation.

## 5. Change 001 web/network matrix

Development mode:

1. Vite loads UI.
2. UI calls relative `/api/health` and it reaches controller proxy.
3. UI opens relative-origin WebSocket and Vite proxies upgrade.
4. Controller unavailable is shown distinctly.

Built mode:

1. controller starts on loopback;
2. `/` returns built SPA;
3. `/assets/*` returns only built assets;
4. `/api/health` remains API, not SPA fallback;
5. `/repositories/<id>` returns SPA shell on direct navigation/reload;
6. `/api/unknown` is not converted into SPA HTML incorrectly;
7. local data/log/browser-profile paths cannot be fetched as static assets;
8. WebSocket derives from current origin;
9. no wildcard CORS is necessary for normal built flow.

Phone seam (without Tailscale implementation yet):

- UI network client has no production assumption that host is localhost;
- test under a synthetic non-localhost HTTPS origin yields `/api` and `wss:` URLs on that origin.

## 6. Watcher/dispatch test matrix — Milestone 2

Cases:

1. no remote `main` movement -> no fetch-heavy work/dispatch;
2. ordinary commit -> observed, no executor;
3. valid isolated marker -> exactly one executor pending;
4. same marker seen twice -> one execution only;
5. marker commit also modifies spec/source -> rejected;
6. malformed JSON -> rejected;
7. JSON Schema-invalid marker -> rejected;
8. unknown schema version -> rejected;
9. new marker while executor active -> never concurrent same repo;
10. separate repositories dispatch together -> independent progression;
11. controller restart after consuming marker -> does not relaunch same dispatch;
12. no branch-routing path exists in V1 watcher configuration/runtime.

## 7. Executor test matrix — Milestone 3

Native Windows:

- command launches in intended working dir;
- stdout/stderr stream;
- exit captured;
- Pause interrupt/kill tree;
- Resume preserves dirty state;
- Stop drains current turn;
- emergency kill marks interrupted/recovery state.

WSL:

- selected distro targeted;
- Linux path used correctly;
- command quoting survives spaces/special characters;
- missing distro clearly diagnosed;
- Windows controller remains owner.

Git reconciliation:

- `main` fixed target;
- dirty local files preserved;
- local unpushed commit preserved;
- remote fast-forward fetched;
- ordinary rebase conflict passed to executor to resolve;
- failed resolution reported rather than force-pushed.

Result publication:

- valid result schema accepted;
- invalid result schema does not wake Sol;
- implementation commits may precede final isolated result commit;
- result manifest push failure does not falsely complete executor turn.

## 8. Playwright test matrix — Milestone 4

Browser lifecycle:

- zero Sol work -> no browser;
- first wake -> one Chromium;
- second repository wake -> second page in same browser;
- first page completes -> browser remains while second active;
- last page completes -> browser closes and releases profile lock;
- browser crash -> affected states recovered/diagnosed.

Profile ownership:

- headless automation acquires global profile lock;
- headed setup cannot launch concurrently against same profile;
- setup flow acquires/releases same lock;
- automation waits/fails clearly while setup owns profile;
- stale lock is not cleared until actual browser ownership is checked.

Authentication:

- setup browser headed;
- persisted profile reused;
- auth missing -> `CHATGPT_AUTH_REQUIRED`;
- normal automation does not require user's ordinary Chrome profile.

Submission:

- exact repository Sol URL used;
- trusted fixed message generated;
- duplicate wake same repository blocked;
- different repositories may submit concurrently subject to service backpressure;
- busy condition queues/retries;
- no DOM response scraping used to declare completion.

Completion:

- remote `main` durable transition completes Sol turn;
- DOM completion without Git transition does not;
- timeout -> retry;
- second timeout -> `SOL_STALLED`.

Isolation:

- Emergency Kill for Repo A closes/interrupts Repo A page/operation without falsely completing Repo B;
- browser-process-wide crash marks every affected active Sol operation independently.

## 9. Runtime/control test matrix — Milestones 5/6

Pause:

- active executor terminated;
- no Sol wake from interrupted turn;
- dirty checkout preserved;
- Resume starts one executor with recovery contract.

Pause while Sol active:

- Sol is not forcibly cancelled solely to save executor credits;
- later durable Sol transition is recorded;
- executor dispatch suppressed until Resume.

Stop:

- current actor allowed to finish;
- next handoff suppressed;
- state becomes stopped.

Runtime ceiling:

- ceiling reached while idle -> no new actor;
- ceiling reached during executor -> executor finishes, no Sol wake;
- ceiling reached during Sol -> Sol transition recorded, no executor launch.

Iteration ceiling:

- same drain semantics as wall time.

Crash/reboot:

- safe waiting state recovers automatically;
- lost executor -> `RECOVERY_REQUIRED`;
- consumed dispatch remains consumed;
- no duplicate actors after restart;
- browser-profile lock reconciles with actual process ownership.

## 10. Multi-repository concurrency qualification

At minimum prove:

```text
Repo A: EXECUTING
Repo B: SOL_REVIEWING
Repo C: EXECUTING
```

simultaneously without global executor serialization.

Then prove per-repository locks prevent:

```text
Repo A executor #1 + Repo A executor #2
Repo A Sol turn #1 + Repo A Sol turn #2
Repo A Sol + Repo A executor simultaneously
```

Global browser-profile locking must not become global Sol serialization: one Chromium may host multiple concurrent repository pages after profile is opened.

## 11. Fault injection

Add controlled ways to simulate:

- process launch failure;
- Git command failure;
- SQLite write failure;
- lost WebSocket;
- malformed protocol artifact;
- browser launch failure;
- browser process crash;
- stale browser-profile lock;
- ChatGPT busy response;
- no Git transition;
- process death;
- controller restart;
- static UI directory missing/corrupt;
- WebSocket proxy disconnect.

Do not require real external outages to test recovery logic.

## 12. Test artifacts/evidence

For significant milestone review, durable state records:

- verification commands run;
- pass/fail summary;
- known failures and whether pre-existing;
- important E2E/fault cases exercised.

Detailed raw logs do not belong in `.agent/state.json`; keep concise evidence there and details in commits/log artifacts/docs as appropriate.

## 13. Performance checks

V1 does not need elaborate benchmarking, but qualification ensures:

- idle watcher loop cheap across several repositories;
- no browser process remains when no Sol work/setup browser exists;
- UI responsive while executors stream output;
- log retention bounded;
- controller does not busy-loop Git polling;
- multiple Sol pages do not leak after completion;
- built static serving does not load huge assets into controller memory unnecessarily.

## 14. Security-oriented tests

Include tests/checks for:

- controller binds loopback by default;
- API does not return secrets/raw stack traces;
- repository config rejects credential and configurable branch fields where strict schemas disallow them;
- Electron renderer has no unnecessary Node integration;
- browser profile excluded from Git;
- database/log/runtime dirs excluded from Git;
- `.orca/` not globally ignored;
- line-ending policy avoids Windows/WSL churn;
- command construction avoids untrusted shell concatenation where direct argv is possible;
- protocol path fields cannot escape repository root after canonicalization;
- static SPA server cannot expose runtime data directory;
- normal built/phone topology does not use wildcard CORS.

## 15. Review gate philosophy

A milestone exits when required behaviors are proven—not when code volume is large.

If a test cannot currently pass because an external dependency/UI changed, record that accurately and decide whether milestone can still be reviewed. Never fake green status to advance roadmap.
