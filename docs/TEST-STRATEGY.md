# Orca-Strator V1 Test and Qualification Strategy

Status: **normative quality strategy**

Orca-Strator coordinates autonomous coding agents, Git, WSL, browsers, and long-lived state. Unit tests alone are insufficient. The project should build confidence in layers and reserve expensive end-to-end qualification for the milestones that need it.

## 1. Testing principles

1. Test state-machine and validation logic deterministically.
2. Keep most tests fast enough for frequent `/go` checkpoints.
3. Isolate tests from the user's real repositories, SQLite DB, browser profile, and credentials.
4. Use real subprocess/Git/WSL/Playwright tests only where mocks cannot prove the behavior.
5. Every bug fix should add the narrowest useful regression test when practical.
6. Never report a gate as passed unless the relevant command actually ran.
7. V1 Git behavior is fixed to `main`; branch-routing behavior is not part of the V1 test surface.
8. Machine-readable protocol schemas are tested independently from runtime semantics.

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
- browser-profile lock state logic.

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

### Layer C — controller/API/event integration tests

Start controller on an ephemeral test port/data directory.

Targets:

- REST contract;
- validation/error mapping;
- no V1 branch configuration surface;
- WebSocket events;
- reconnect/refetch behavior;
- health/readiness;
- later orchestration service integration.

### Layer D — React UI tests

Targets:

- repository list/empty/offline states;
- Windows/WSL forms;
- no branch selector in V1;
- validation handling;
- control enable/disable rules;
- runtime status rendering later;
- responsive critical flows.

Prefer behavior-visible assertions over implementation-detail snapshots.

### Layer E — Electron smoke tests

Targets:

- desktop launches;
- shared UI loads;
- controller connectivity works;
- window restart does not own/delete controller state;
- safe BrowserWindow baseline.

Do not duplicate all UI tests inside Electron.

### Layer F — local Git sandbox integration

Create temporary bare remote + working clones locally. Use `main` as the only V1 integration branch.

Targets later:

- remote `main` HEAD watcher detection;
- ordinary non-dispatch commits ignored;
- isolated dispatch accepted;
- mixed dispatch commit rejected;
- duplicate dispatch not relaunched;
- push/rebase/divergence scenarios;
- dirty worktree preservation;
- result/control marker isolation.

This should avoid consuming real GitHub for most protocol tests.

### Layer G — executor adapter qualification

Use controlled fake executor first.

Fake executor should support scripted behaviors:

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

Then run targeted qualification against actual configured CLIs on the development machine.

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

Real ChatGPT E2E is a separate integration qualification because its DOM/service behavior is external and unstable.

### Layer I — full autonomy qualification

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

Exact scripts may vary slightly but the root must expose equivalent documented commands.

Functional acceptance:

- create Windows repository;
- create WSL repository;
- list/edit/delete;
- verify repository record/API/UI contain no configurable branch field;
- restart controller and retain data;
- close/reopen Electron without losing controller state;
- verify offline/disconnected UI state;
- verify narrow viewport;
- verify generated local DB/build/browser/auth/log artifacts remain untracked under the seeded hygiene policy.

## 4. Protocol schema test matrix

Even before the watcher is implemented, the versioned protocol schemas themselves should be linted/validated as repository artifacts.

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

## 5. Watcher/dispatch test matrix — Milestone 2

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

## 6. Executor test matrix — Milestone 3

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

- `main` is the fixed target;
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

## 7. Playwright test matrix — Milestone 4

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
- browser-process-wide crash marks every affected active Sol operation independently;
- closing setup browser never closes an unrelated automation browser because the two cannot own the profile simultaneously.

## 8. Runtime/control test matrix — Milestones 5/6

Pause:

- active executor terminated;
- no Sol wake from interrupted turn;
- dirty checkout preserved;
- Resume starts one executor with recovery contract.

Pause while Sol active:

- Sol is not forcibly cancelled solely to save executor credits;
- later durable Sol transition is recorded;
- executor dispatch is suppressed until Resume.

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
- browser-profile lock state reconciles with actual process ownership.

## 9. Multi-repository concurrency qualification

At minimum prove:

```text
Repo A: EXECUTING
Repo B: SOL_REVIEWING
Repo C: EXECUTING
```

simultaneously without global executor serialization.

Then prove per-repository locks still prevent:

```text
Repo A executor #1 + Repo A executor #2
Repo A Sol turn #1 + Repo A Sol turn #2
Repo A Sol + Repo A executor simultaneously
```

in V1.

Global browser-profile locking must not become a global **Sol serialization** mechanism: one Chromium process may host multiple concurrent repository pages after the single profile is opened.

## 10. Fault injection

Add controlled ways in tests to simulate:

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
- controller restart.

Do not require real external outages to test recovery logic.

## 11. Test artifacts/evidence

For significant milestone review, durable state should record:

- verification commands run;
- pass/fail summary;
- known failures and whether pre-existing;
- important E2E/fault cases exercised.

Detailed raw logs do not belong in `.agent/state.json`; keep concise evidence there and details in commits/log artifacts/docs as appropriate.

## 12. Performance checks

V1 does not need elaborate benchmarking, but qualification should ensure:

- idle watcher loop is cheap across several repositories;
- no browser process remains when no Sol work/setup browser exists;
- UI remains responsive while executors stream output;
- log retention does not grow unbounded;
- controller does not busy-loop Git polling;
- multiple Sol pages in one Chromium do not cause avoidable page duplication/leaks after completion.

## 13. Security-oriented tests

Include tests/checks for:

- controller binds loopback by default;
- API does not return secrets/raw stack traces;
- repository config rejects credential fields and configurable branch fields if strict schemas disallow them;
- Electron renderer has no unnecessary Node integration;
- browser profile excluded from Git;
- database/log/runtime dirs excluded from Git;
- `.orca/` is not globally ignored;
- line-ending policy avoids Windows/WSL churn;
- command construction does not concatenate untrusted strings into a shell when direct argv execution is possible;
- protocol path fields cannot escape repository root after semantic canonicalization.

## 14. Review gate philosophy

A milestone exits when its required behaviors are proven—not when code volume is large.

If a test cannot currently pass because an external dependency/UI changed, record that accurately and decide whether the milestone can still be reviewed. Never fake a green status to advance the roadmap.
