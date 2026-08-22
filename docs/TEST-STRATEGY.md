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

## 16. Change 010 operational-intelligence matrix

Focused coverage includes:

- migration/reopen persistence for trace, policy, capability, and permission
  records;
- EventBus correlation/redaction and campaign/iteration duration read models;
- two-repository trace isolation and restart history reconstruction;
- STATIC probes that never touch the model/provider, NON_INFERENCE local/Git
  probes, typed CLI/version failures, and explicit inference authorization;
- generic/Kimi/Codex/test profile capability classification and optional adapter
  fallback behavior;
- effective policy snapshots across repository edits, distinct budget reasons,
  and wall-clock drain/no-kill regression;
- permission presets, absolute DENY invariants, advisory-vs-native labeling,
  durable ASK attention, and API/UI presentation.

Real WSL/Git probe coverage is machine-qualified only when a usable WSL
distribution and repository are actually exercised; otherwise the result stays
UNQUALIFIED rather than being inferred from a Windows test.

## 17. Change 011 usage/scheduler/role matrix

Focused coverage includes:

- exact, estimated, partial, unknown, and invalid usage records;
- adapter usage capture only from structured native data, with no UI scraping;
- campaign/iteration usage correlation and SQLite restart persistence;
- unlimited default admission across independent repositories;
- explicit total/provider/model limits, queue reasons, runnable timestamps,
  release, and stale admission recovery;
- role rule exact resolution, repository-default fallback, duplicate/PRIMARY
  rejection, and no dynamic routing;
- API/UI display of unknown usage and transparent policy identity.

No Change 011 test claims provider spend or model inference qualification when a
reliable provider telemetry source is unavailable.

## 18. Change 012 packet/isolation matrix

Focused coverage includes:

- versioned packet/result schema validation, correlation, restart persistence,
  safe-path rejection, and typed partial statuses;
- distinct deterministic worktree paths/branches for one repository;
- no shared persistent-checkout writer, clean-only release, dirty-work
  preservation, stale/orphan recovery, and no-force cleanup;
- deterministic dependency order, missing/cyclic dependency rejection,
  non-overlap integration, path conflict, Git conflict abort, partial success,
  and `SKIPPED_DEPENDENCY` behavior;
- real Windows Git worktree/commit/cherry-pick qualification and real WSL
  worktree allocation/recovery when Ubuntu is actually available.

The real tier reports WSL as UNQUALIFIED when the required distro/tools are not
available; Windows results never substitute for WSL evidence.

## 19. Change 013 optional swarm matrix

Focused coverage includes:

- shared strategy/control/report schemas and migration/restart persistence;
- explicit opt-in and strict packet/run/iteration/cycle correlation;
- bounded worker scheduling, scheduler queue provenance, dependency waits, and
  no opaque executor/model switching;
- real Windows child-process workers in distinct worktrees, local commits,
  non-pushing integration, path/commit provenance, partial failure, conflict,
  dependency skip, and dirty-work preservation;
- pause/resume, graceful stop, emergency kill, restart recovery, orphan/stale
  worktree evidence, and no shared persistent-checkout writers;
- conditional real WSL worker launch/integration through `wsl.exe` and the
  Linux node/Git path;
- REST correlation and campaign-ledger events without raw transcript truth.

The deterministic worker harness is qualification-only. Missing real provider
credentials or telemetry keeps provider inference/usage claims UNKNOWN or
UNQUALIFIED; it does not turn a local child-process result into provider
qualification.

## 20. Change 014 DAG qualification

The DAG tier covers:

- fast contract/store validation, duplicate/unknown dependency, mismatch, and
  cycle-negative paths;
- real Windows child-process/Git independent and dependent nodes, concurrency
  bounds, distinct worktrees, deterministic integration, conflict, and partial
  result semantics;
- real graceful stop, orphan/restart recovery, path preservation, and
  conditional WSL adapter execution;
- multi-repository isolation and no shared persistent checkout writes.

The final real tier records skipped WSL/provider/browser cases honestly and
does not call them machine-qualified.

## 21. Change 015 optional OpenCode adapter

Focused coverage includes:

- profile detection and documented headless invocation without changing the
  configured model;
- absent endpoint/no-network behavior and Settings-safe non-inference probing;
- deterministic V1/V2/hybrid OpenAPI discovery, route-level readiness, URL
  redaction, malformed/timeout/unavailable classification, and API drift;
- guarded session/prompt/wait/cancel/permission/message/SSE operations that
  require observed routes;
- structured assistant-message usage extraction with exact-cost-only handling;
- generic/Kimi/Codex/test regression coverage and optional adapter selection for
  ordinary and isolated worker paths;
- conditional real OpenCode server probing. When no authorized endpoint is
  configured, the real test is explicitly UNQUALIFIED/skipped and does not
label OpenCode machine-qualified.

## 22. Change 016 topology UI matrix

Focused coverage includes:

- single-agent Sol/dispatch/executor/result/Sol rendering from incomplete and
  complete campaign evidence;
- actual SWARM packet/report/integration rendering with partial/failure states;
- DAG node dependency, waiting/permission/retry/conflict, and integration
  rendering without fabricated workers;
- unknown usage/cost and exact-versus-estimated display;
- preset catalog presence, explicit no-auto-start semantics, and absence of
  graph-authoring controls;
- responsive card-flow markup suitable for narrow phone and desktop layouts.

## 23. Change 017 — production-loop strategy qualification

Change 017 adds a real tier that proves the qualified SWARM/DAG engines inside
the production autonomous campaign loop rather than through direct engine
invocation:

- a production `buildApp` SWARM loop: a durable dispatch marker with
  `strategy: "SWARM"` plus an execution plan autonomously enters the campaign
  loop, workers run in isolated worktrees, integration publishes durably, and
  the normalized result returns to the Sol review boundary;
- a DAG A -> B dependency loop: node B starts only after node A's dependency
  input SHA materialization, with the structured DAG result mapped back to the
  enclosing iteration;
- campaign-level controls composition: pause/resume/stop/kill and controller
  shutdown route through the `IterationExecutionCoordinator` onto the active
  strategy, and manual `/swarm/start` + `/dag/start` share the same
  campaign/iteration ownership boundary.

These production-loop qualifications now exist and pass on this machine under
production `buildApp` wiring with real temporary Git repositories, real bare
remotes, and deterministic real child workers (browser mocked only at the
external ChatGPT transport):

- `test/real-strategy-loop-swarm.test.ts` — autonomous SWARM loop: dispatch ->
  watcher -> coordinator -> isolated worktrees -> integration -> remote main +
  result manifest -> Sol wake -> second Sol transition with the default
  strategy; manual-start conflict rejection mid-flight; and allowedPaths
  out-of-scope enforcement (violating worker BLOCKED/POLICY_VIOLATION, never
  integrated, worktree preserved);
- `test/real-strategy-loop-dag.test.ts` — autonomous DAG loop with a true
  A -> B state dependency (B's worker fails unless A's committed output is
  materialized into B's base; byte-level derived-from proof and dependency
  input SHA provenance) plus a falsifiability case where B must fail;
- `test/real-strategy-controls.test.ts` — campaign-level pause/resume,
  graceful stop, emergency kill, wall-clock drain, controller restart recovery,
  and ownership-conflict rejection for SWARM and DAG through the campaign
  control seam.

With this evidence, Changes 013/014 are ENGINE MACHINE-QUALIFIED and their
autonomous campaign integration is MACHINE-QUALIFIED by Change 017. Engine-tier
evidence and loop-integration evidence remain distinct tiers; neither
substitutes for the other.

The genuinely external tiers remain honestly UNQUALIFIED and are not faked:
real ChatGPT-authenticated wake, the Tailscale phone route, real Kimi/Codex
inference burn, and an authorized OpenCode server/provider.

## 24. Change 018 postflight/concurrency hardening matrix

Focused coverage includes:

- authoritative postflight: an engine `COMPLETED` takes the success path only
  when remote publication is `PUBLISHED` and `remoteVerified`; a blocked or
  unverified publication sends no COMPLETED Sol wake, leaves the authorizing
  dispatch unconsumed as successful, and persists retryable postflight/recovery
  evidence on the strategy record, run state, and event stream;
- postflight-only retry (no worker rerun), including after controller restart,
  with a refusal when the campaign is mid-flight on a newer iteration;
- explicit `UP_TO_DATE` / `LOCAL_AHEAD` / `REMOTE_AHEAD` / `DIVERGED` remote
  classification in `publishToRemote`, safe pre-manifest reconciliation, and
  structured blockers for unsafe divergence (never force-push/reset);
- manifest `finalCommitSha` equals the actual post-reconciliation HEAD with
  pre-reconciliation integration SHA preserved as provenance;
- DAG staging lineage from the immutable `strategyBaseSha`, a per-strategy-run
  integration mutex serializing simultaneous completions (stress-tested, no
  Git index-lock failures), dependency-isolated node snapshots (A -> C must not
  see unrelated B), and restart-lineage continuation;
- awaited/acknowledged campaign controls: pause refuses while a stop/ceiling
  drain is pending (a graceful Stop is not cancellable by Pause), resume of a
  non-PAUSED campaign is an explicit `409` conflict instead of a silent no-op,
  and resume failure never marks the campaign `EXECUTING`;
- graceful asynchronous shutdown: `fastify.close()` plus database close alone
  terminates children within bounded grace (including the launch-retry window),
  settles completion callbacks, and preserves worktrees; startup then marks
  orphaned active executor runs failed, sweeps orphaned DAG staging checkouts,
  and recovers persisted `ADMITTED` scheduler leases as `STALE_RECOVERABLE`.

## 25. Protocol schema <-> Zod conformance guard

`apps/controller/test/schema-conformance.test.ts` (37 tests, fast tier) pins
each documented protocol schema under `schemas/protocol/` to its runtime Zod
mirror in `@orca/shared` so silent drift fails CI:

- `dispatch.schema.json` <-> `validateDispatchMarker`;
- `executor-result.schema.json` <-> `validateExecutorResult`;
- `sol-control.schema.json` <-> `validateSolControlMarker`.

A coverage meta-guard fails the suite if a new `schemas/protocol/*.schema.json`
is added without its own conformance block.

Four divergences between the published JSON Schemas and the runtime Zod mirrors
are KNOWN, REVIEWED, and intentionally left unfixed; the suite asserts each one
explicitly so it cannot widen silently:

1. **SHA case-insensitivity leniency in Zod** — the JSON patterns are
   case-sensitive (`^[0-9a-f]{40}$`) while the Zod mirrors accept uppercase
   hex, so uppercase SHAs pass runtime enforcement but fail the published
   contract.
2. **`relatedDispatchId` nullability** — JSON lists the key in `required`
   (present, value may be null) while the Zod chain is `.nullable().optional()`,
   so an absent key passes runtime enforcement but fails the published
   contract.
3. **`changePath` backslash normalization** — Zod normalizes `\` to `/` (and
   rejects a leading `\`) before traversal checks; the JSON pattern inspects
   only `/`, so Windows-style traversal strings pass the published pattern but
   are rejected at runtime.
4. **date-time format vocabulary gap** — JSON uses `format: "date-time"`
   (annotation-only in Draft 2020-12) while Zod enforces `z.string().datetime()`
   (UTC `Z` only); the semantics are not directly comparable across
   vocabularies, so only obviously malformed timestamps are asserted.

These divergences are recorded here and in the suite rather than hidden;
tightening them is deliberate future schema work, not drift.

## 26. Qualification tier evidence (as of this qualification run)

Executed gates on this tree after the Changes 019 + 020 + 021 implementation
waves (executor-start serialization + stale-lease reconciliation; permission
ask-resolution end-to-end; executor shutdown-path unit coverage), via the
canonical gates:

```text
focused new tests (019/020/021)       all green (11 tests across touched suites)
npm run typecheck                     exit 0 (all workspaces)
npm test (fast tier)                  52 test files passed / 253 tests passed
npm run build                         exit 0
npm run lint                          exit 0
git diff --check                      pass
npx openspec validate --all --strict  21 passed / 0 failed
```

The real tier was last executed in full during the Change 018 qualification
campaign with these results, which remain the latest real-tier evidence:

```text
npm run test:real                     14 files passed + 1 skipped file;
                                      65 passed / 3 skipped / 0 failed (exit 0)
```

Real-tier skips are classified `EXPECTED_EXTERNAL_UNQUALIFIED` and are not
faked: five WSL-distro-gated scenarios (real WSL Ubuntu required) and one
OpenCode scenario (`ORCA_OPENCODE_QUALIFY_URL` absent). All internal suites ran
non-skipped. The external qualifications remain unchanged and honestly
UNQUALIFIED: real ChatGPT-authenticated wake, the Tailscale phone route, real
Kimi/Codex inference burn, and an authorized OpenCode server.

## 27. Change 023 external-Chrome auth bootstrap matrix

Fast-tier suites (mocked Chrome binary / fake child processes — no real Google
login is ever automated):

- `chrome-discovery.test.ts`: registry App Paths preferred (incl. WOW6432Node),
  ProgramFiles / ProgramFiles(x86) / LOCALAPPDATA probe order, registry value
  accepted only when the file exists, actionable NOT_FOUND, BLBeacon version
  preference with version-subdirectory fallback, FOUND never fails on absent
  version metadata.
- `external-setup-browser.test.ts`: pinned argv snapshot proving EXACTLY
  `--user-data-dir=<dedicated profile>` + login URL (and nothing else), PID
  liveness, exit-promise wiring, tree-kill close, second-spawn refusal,
  undefined-pid spawn failure surfaced as an error. Real-process mechanics are
  proven with node.exe as a stand-in binary.
- `external-setup-manager.test.ts`: ZERO automation-driver launches during
  INTERACTIVE_SETUP; AUTOMATED acquisition refused while external Chrome owns
  the lock; ownership released on human close freeing AUTOMATED; stale
  external-PID recovery through durable liveness checks; conflict refusal with
  no spawn while automation holds the profile; actionable NOT_FOUND error with
  no fallback launch; migration guard backs up incompatible profiles
  (timestamped backup preserved, fresh dedicated profile without auth state)
  and leaves compatible profiles untouched; production automation requires
  installed Chrome (`CHROME_NOT_READY` actionable failure) and passes the
  discovered executablePath to the driver.
- `playwright-launch-guard.test.ts`: persistent-context options pinned to
  exactly `{headless, viewport}` plus optional `executablePath`; serialized
  options can never contain AutomationControlled / `--no-sandbox` /
  user-agent overrides / custom args; cookie access exposes NAME|DOMAIN labels
  only (values asserted absent).
- `auth-readiness.test.ts`: composer -> AUTHENTICATED; login affordances or
  login redirect -> LOGIN_REQUIRED; challenge indicator ->
  VERIFICATION_REQUIRED; no signals -> UNKNOWN; cookie NAME corroboration only
  (UI-authenticated with zero session-family names demotes to UNKNOWN);
  profile-busy returns UNKNOWN/profile-busy evidence and launches NOTHING;
  report shape contains fixed label evidence only with no credential material.
- `browser-api.test.ts` / `browser-integration.test.ts`: extended status
  payload (systemChrome/authReadiness/setupLauncherKind/setupPid), setup
  open/close via the external launcher seam, `POST /api/browser/auth/check`.

Security invariants pinned by these tests: no anti-detection switches anywhere
(launcher argv snapshot + driver options snapshot), no sandbox downgrades, no
user-agent spoofing, cookie VALUES never read into reports/logs/persistence,
and Google/OpenAI login is never automated.
