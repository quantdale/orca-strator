# Orca-Strator Real External Qualification Report

Status: **IN PROGRESS — Change 023 auth bootstrap QUALIFIED; harmless real
wake SUCCEEDED; phase 8 two-iteration real Sol↔Kimi loop COMPLETE with
GOAL_COMPLETE (run de6fc5d2); phase 10 Codex one-turn QUALIFIED (run
a19f488f); remaining optional gate: phase 11 Tailscale (manual elevation)**

This report records factual evidence only. It contains no cookies, tokens, API
keys, or browser profile secrets.

## Campaign context

- Goal: prove Orca with the real external actors it was designed around
  (real authenticated ChatGPT Sol, real Kimi/Codex inference, real GitHub
  remote, real production controller, real autonomous loop).
- Date started: 2026-08-22.
- Orca source at campaign start: `b4c3304` (Milestone 20 qualified baseline).

## Phase 1 — Readiness matrix (2026-08-22 ~13:30–15:00 +08:00)

| Component | Installed | Auth | Runtime | Real inference |
| --- | --- | --- | --- | --- |
| ChatGPT / Chromium | READY (`chromium-1234/chrome-win64/chrome.exe`, provisioning API `ready`) | **NOT_AUTHENTICATED** (no `__Secure-next-auth.session-token` cookie under any chatgpt.com host; login-flow artifacts on auth.openai.com from an earlier partial attempt) | Setup browser opened via production route; stale profile lock auto-recovered by controller | N/A |
| Kimi Code CLI | READY 0.34.0 native exe (`C:\Users\palac\.kimi-code\bin\kimi.exe`) | READY (credentials present; proven by smoke) | READY non-interactive (`-m <model> -p "<prompt>"`); git commit/push verified headless | **QUALIFIED** |
| Codex CLI | READY 0.148.0 exe | READY (ChatGPT-plan OAuth tokens; last refresh 2026-08-20) | READY once sandbox flag present (see defect D1) | **QUALIFIED** |
| Tailscale | NOT_INSTALLED (winget package `Tailscale.Tailscale` 1.102.2 available) | N/A | Install requires elevation (manual) | N/A |
| OpenCode | Not applicable | N/A | N/A | OPTIONAL_EXTERNAL_UNQUALIFIED (no authorized server URL) |

Production controller: `http://127.0.0.1:47100`, data dir
`%LOCALAPPDATA%\Orca-Strator`, runtime DB schema present with zero prior
repositories (clean slate). gh CLI authenticated as `quantdale` (repo scope).

## Phase 6 — Qualification repository

- Repository: <https://github.com/quantdale/orca-strator-dogfood> (PRIVATE)
- Default branch: `main`; initial HEAD: `b526a71c4bbe8533123ea75fa78b160aa22f97a3`
  (README + `.orca/.gitkeep`)
- Local clone: `D:/Documents/tryPython/orca-strator-dogfood`
- Planned executor binding: Windows environment,
  `C:\Users\palac\.kimi-code\bin\kimi.exe`,
  model `opencode/x-preview-f-free` (user's configured Kimi default),
  WSL has no Kimi install (verified: node/git only).

## Phase 2 — REAL_KIMI_INFERENCE = QUALIFIED

Two tiny real turns in disposable temp workspaces (no Orca source modified):

1. `kimi -m "opencode/x-preview-f-free" -p "Create a file named kimi-real-smoke.txt ..."`
   → exit 0; file created containing the required line (trailing period added
   by the model). No permission prompt occurred.
2. Same shape plus git mechanics: create file, commit, push to a local bare
   remote → exit 0; remote main advanced `cae523a..61ecf84`.

Conclusion: authentication works, configured model responds, non-interactive
invocation works, real inference occurs, and executor-side git operations are
auto-approved under `-p` mode. Orca's Kimi profile needs no change.

## Phase 3 — REAL_CODEX_INFERENCE = QUALIFIED (after defect fix D1)

Tiny real turns in disposable temp workspaces:

1. Orca's then-production invocation `codex exec -m gpt-5.6-luna --json "..."`
   → real inference occurred (auth OK), but the turn completed WITHOUT acting:
   "Could not create the file because the current workspace is read-only"
   (default exec sandbox is read-only). Note codex exits 0 even when it could
   not act — Orca's exit-0-without-valid-manifest guard is what prevents a
   false success.
2. Reproduction of Orca's exact spawn conditions (Node default stdio pipes,
   stdin never closed): codex printed "Reading additional input from stdin..."
   and produced nothing for >75s → hang confirmed. With closed stdin the same
   command completes normally.
3. `-s workspace-write`: write succeeded but through an improvised MCP tool;
   codex's own patch/shell helpers were unavailable ("Windows sandbox helper is
   missing") → unusable for git-based executor work on Windows 0.148.0.
4. `-s danger-full-access`: fully working pwsh shell; create + commit + push to
   a real local bare remote verified (commit `13a4538`), exit 0.

Conclusion: provider auth/model/inference all work; two concrete ORCA defects
were exposed and fixed (see Defects below).

## Defects found by real qualification (Change 022)

- **D1 read-only sandbox**: `buildCodexInvocation` lacked a sandbox flag →
  executor could never write. Fix: add `-s danger-full-access`
  (`workspace-write` tested first and rejected: Windows sandbox helper missing
  in codex-cli 0.148.0).
- **D2 open-stdin hang**: Windows/WSL adapters spawned children with default
  `stdio: 'pipe'` and never closed stdin → codex waits for EOF forever. Fix:
  shared `EXECUTOR_SPAWN_STDIO = ['ignore','pipe','pipe']`.
- Fixed in Change 022 (`deac592`): focused tests 6/6, fast tier 53 files /
  259 tests, typecheck/build/lint exit 0, strict OpenSpec validation 22 passed
  / 0 failed, `git diff --check` clean.
- Kimi path: zero changes required (proven safe under open stdin).

## Phase 4 — ChatGPT setup browser (production flow)

- `POST /api/browser/setup/open` → headed Chromium launched with the dedicated
  persistent profile (`%LOCALAPPDATA%\Orca-Strator\browser\profile`),
  page opened at <https://chatgpt.com>.
- Stale `profile.lock` (dead PID 120684, INTERACTIVE_SETUP from ~02:21Z) was
  automatically recovered; live lock now held by the controller (PID 94156).
  This is real-world evidence for stale-lock recovery (J.1/J.2).
- Cookie-store inspection (names only, values never read): no
  `__Secure-next-auth.session-token` under any chatgpt.com host → the profile
  is NOT authenticated. An earlier login attempt left auth.openai.com session
  artifacts.

**BLOCKED_MANUAL_AUTH**: a human must complete ChatGPT login inside the OPEN
setup-browser window on the desktop (enter credentials and any MFA/verification
the site requires). No CAPTCHA/anti-bot circumvention is permitted or used.
The window is intentionally left open for this action.

## Phases still pending

| Phase | Status | Blocked by |
| --- | --- | --- |
| 5 Dedicated Sol conversation | DONE (2026-08-22, user-supplied URL) | — |
| 7 Real authenticated wake smoke | DONE (initial wake SUCCEEDED 15:00:58Z) | — |
| 8 Two-iteration Sol↔Kimi loop | **DONE — GOAL_COMPLETE (run de6fc5d2, 2026-08-23T01:34:46Z)** | — |
| 10 Codex via Orca (one real turn) | **DONE — QUALIFIED (run a19f488f, 2026-08-23)** | — |
| 11 Tailscale phone route | BLOCKED_MANUAL_ELEVATION | One elevated install step |

## Phase 10 — Codex via Orca, one real turn: QUALIFIED (2026-08-23)

Setup: the production repository record was rebound (user-owned config action)
to `codex.exe` 0.148.0 / model `gpt-5.6-luna`; README gained an explicit
active "Phase 10 qualification goal". A first fresh run (`f7ea132c`) produced
a notable real-Sol behavior: Sol inspected main at run start, found the
previous campaign durably GOAL_COMPLETE, and truthfully terminated at
iteration 0 with a control marker instead of fabricating redundant work —
exactly the anti-fabrication behavior the protocol wants. After the operator
pushed the new goal as ordinary content, run `a19f488f` executed:

- Real Sol planned (`1271af7`-style ordinary commit + isolated dispatch
  `3ef73db`, runId-matched).
- Orca spawned real Codex via the production invocation
  (`codex exec -s danger-full-access -m gpt-5.6-luna --json`); Codex
  reconciled to the dispatch commit, echoed verbatim `ORCA_EXECUTOR_CLI`,
  created `codex-smoke.md` with the exact post-reconciliation pre-work SHA,
  pushed work `7d81b31`, and published an isolated COMPLETED result manifest
  `546e05c`.
- The terminal COMPLETED wake hit the session's intermittent network outage
  (`page.goto ERR_CONNECTION_TIMED_OUT`) and the run honestly entered
  SOL_STALLED. Recovery used the canonical manual wake control
  (`POST /api/repositories/:id/wake`) once connectivity returned — submitted
  successfully at 02:07:08Z.
- Real Sol independently verified every correlation detail from Git and
  published GOAL_COMPLETE sol-control `6a7649c`
  (`2026-08-23T020700Z-i001-codex-goal-complete`).

Verdict: **REAL_CODEX_INFERENCE_VIA_ORCA = QUALIFIED** — one real Codex turn
end-to-end through the production loop with valid durable correlation.

Recorded finding (candidate future hardening, intentionally not changed here):
Sol's GOAL_COMPLETE control for the stalled run was rejected BY DESIGN with
`no active run for repository` because SOL_STALLED is excluded from the
active-run boundary; the control stays durably auditable (status `rejected`,
reason recorded). There is currently no Git-truthful closure path for an
already-stalled run; changing terminal-state semantics deserves its own
focused OpenSpec change rather than a mid-campaign patch.

## Addendum — resume verification (2026-08-22 ~16:40–16:50 +08:00)

Resumed from main `4048a08` after the human was given the opportunity to log in.

**Auth verdict: still NOT_AUTHENTICATED.** Evidence (cookie values never read):

- Cookie-store copy inspected by NAME+host only, across ALL chatgpt.com /
  openai.com hosts (not one hard-coded name): fresh NextAuth CSRF/callback-url
  cookies exist on chatgpt.com (set by any page visit) but NO session-indicating
  cookie family appeared anywhere; all `.auth.openai.com` artifacts date from the
  morning's failed Google OAuth attempt.
- History DB: last entry is the controller's own plain `https://chatgpt.com/`
  load at ~15:30; zero login-flow navigation after it.
- Profile disk writes stop at 15:36–15:41 — no human browsing activity since.

**New real-world observation:** the headed setup-browser window had been closed
externally sometime after ~15:36 (no `chrome.exe` process held the Orca profile;
only the controller node process remained as recorded lock holder), while the
controller still reported `isRunning:true` (stale in-memory flag).
Recovery through the CANONICAL lifecycle only:

1. `POST /api/browser/setup/close` → cleared stale state, released profile lock
   (`lockHolderPid:null`). No process kill, no lock file surgery.
2. `POST /api/browser/setup/open` → relaunched headed Chromium on the SAME
   persistent profile at chatgpt.com (verified live `chrome.exe` PID with
   `--user-data-dir=...Orca-Strator\browser\profile`).

Classified as normal recovery via public API, NOT an Orca defect (the manager
self-heals via close→open; only an un-recoverable stall here would be a defect).
Window left OPEN for the human login retry.

## Manual actions required to unblock

1. **ChatGPT login** (unblocks everything core): complete sign-in inside the
   already-open headed Chromium window (Orca setup browser) sitting at
   <https://chatgpt.com>. Credentials/MFA are entered by the human only.
2. **Tailscale install** (optional, independent): run
   `winget install --id Tailscale.Tailscale` from an elevated shell (or approve
   its UAC prompt). Non-elevated attempts fail with exit 1602. Serve
   configuration follows docs/SECURITY.md (private tailnet only, no Funnel).

No other external dependency is missing. Everything else continues
automatically once item 1 is done.

## Change 023 addendum — external-Chrome auth bootstrap (2026-08-22)

The blocker above was root-caused: the Playwright-managed setup Chromium is
rejected by Google OAuth ("This browser or app may not be secure"). Orca must
not bypass that check. OpenSpec change `023-external-chrome-auth-bootstrap`
separates HUMAN AUTHENTICATION from AUTOMATION instead:

- INTERACTIVE_SETUP now spawns the ordinary installed Google Chrome binary
  directly as a child process (`chrome.exe --user-data-dir=<dedicated profile>
  https://chatgpt.com/auth/login`) with no Playwright/remote automation
  attached; the spawned Chrome PID owns the INTERACTIVE_SETUP profile lock and
  ownership is released when the human closes the window.
- AUTOMATED browsing launches the same discovered installed Chrome through
  Playwright against the SAME dedicated profile, reusing the human-created
  session without repeating Google OAuth under automation.
- Auth readiness (Check Login) derives AUTHENTICATED / LOGIN_REQUIRED /
  VERIFICATION_REQUIRED / UNKNOWN primarily from safe UI/navigation signals,
  corroborated by cookie NAME families only. Cookie VALUES are never read into
  reports, logs, events, or persistence.
- No anti-detection switches, sandbox downgrades, user-agent spoofing, or
  credential automation exist anywhere in the implementation; this is pinned
  by launcher argv snapshots and driver launch-options guard tests.

Implementation status: implemented and machine-gated on this tree (fast tier
58 files / 300 tests green including the new Change 023 suites; typecheck,
build, lint, strict OpenSpec validation, and `git diff --check` all pass).

Qualification verdict for this change:

- EXTERNAL_CHROME_AUTH_BOOTSTRAP: **QUALIFIED (2026-08-22)** — real evidence:
  the production controller spawned ordinary installed Chrome v151.0.7922.138
  as the setup browser (`chrome.exe --user-data-dir=<dedicated profile>
  https://chatgpt.com/auth/login`, no Playwright attachment); a human
  completed ChatGPT Google sign-in inside that window and closed it; profile
  ownership released cleanly (`lockHolderPid: null`).
- REAL_CHATGPT_AUTHENTICATED_PROFILE: **PARTIALLY QUALIFIED** — `POST
  /api/browser/auth/check` returned `AUTHENTICATED` (evidence:
  `ui:composer-visible`, `cookies:session-family-present`,
  `profileUsableByAutomation: true`) on a headed installed-Chrome automation
  launch against the SAME profile, proving session reuse with NO Google OAuth
  re-run. Final verdict still requires one harmless real wake under
  BrowserManager automation, which awaits the user-supplied dedicated Sol
  conversation URL (phase 5, user-owned configuration).

Real-qualification finding folded back into implementation (2026-08-22):
headless Playwright launches of the genuine installed Chrome receive a
Cloudflare "Just a moment" interstitial on chatgpt.com even with the warm,
human-authenticated profile, while headed launches of the same binary reuse
the human session cleanly. Production automation therefore runs HEADED
(headless=false). This is a launch-mode choice only: no anti-detection
switches, no sandbox downgrades, no user-agent spoofing were added, and the
launch-options guard tests now pin headed automation. Design §Automation
channel and docs/RUNTIME-MODEL.md were updated to match observed reality.

## Change 023 completion addendum — real wake + campaign resumed (2026-08-22 ~23:00 +08:00)

The last user-owned input arrived: the dedicated Sol conversation URL.

- Repository record created via production API for
  `quantdale/orca-strator-dogfood` (Windows executor binding:
  `kimi.exe`, user's configured model; watcher auto-started). Campaign goal +
  Sol protocol + executor instructions were pushed as ordinary commits
  (`c4fc149`) so both real actors read their contracts from Git.
- Run `706002fd` started via `POST /runs/start`; **initial real wake
  SUCCEEDED** (`sol.wake_submitted`, 2026-08-22T15:00:58Z): BrowserManager
  launched the discovered installed Chrome v151.0.7922.138 headed against the
  SAME dedicated authenticated profile and submitted the trusted wake into the
  exact configured conversation. No Google OAuth re-run occurred under
  automation.
- Verdict updates: REAL_CHATGPT_AUTHENTICATED_PROFILE = **QUALIFIED**
  (session reuse under headed installed-Chrome automation + one harmless real
  wake); EXTERNAL_CHROME_AUTH_BOOTSTRAP remains QUALIFIED. Phase 5 and phase 7
  gates are closed.
- Real campaign resumed with all-real actors: within ~3 minutes of the wake,
  real Sol pushed an ordinary work-contract commit (`c28e835`,
  `openspec/changes/001-dogfood-iteration-1/tasks.md`) followed by a clean
  isolated dispatch commit (`5b4d80c`,
  `.orca/dispatch/2026-08-22T150239Z-i001-706002fd.json`) whose runId matched
  the live run; the production watcher validated and consumed it and started
  the real Kimi executor on iteration 1 (EXECUTING with live executor.log
  activity). Phases 8–10 continue in this file as they complete.

## Phase 8 — Two-iteration real Sol↔Kimi loop: COMPLETE (2026-08-23)

### Attempt 1 (run `706002fd`) — BLOCKED by real Sol, two real defects found

Real Kimi executed iteration 1 correctly (reconcile → `dogfood-log.md` → push
→ isolated result manifest), but Orca's production result validator rejected
the manifest (`INVALID_OR_INCOMPLETE_RESULT` → `RECOVERY_REQUIRED`). Root
causes, both real-world integration defects:

1. **Executor CLI correlation over-strict** (fixed in Orca `3ef43d8`):
   `readAndValidateResult` required `executor.cli === repo.executorCli`
   exactly; a truthful harness name like `kimi-code-cli` can never equal the
   configured absolute path. Fix: `executorIdentityMatches()` normalized
   correlation (exact echo / basename / descriptive-name stem containment;
   unrelated harnesses still rejected) plus a new `ORCA_EXECUTOR_CLI` env var
   so executors can echo the exact value.
2. **baseSha capture ambiguity** (fixed via executor instructions): the
   executor recorded its stale pre-reconcile local HEAD; the contract requires
   the post-reconciliation base (dispatch baseSha or dispatch commit SHA).
   The dogfood `AGENTS.md` now pins both rules explicitly.

Recovering via `POST /runs/recover {action:"retry"}` re-woke Sol, which
reviewed GitHub, independently diagnosed BOTH defects from durable evidence,
corrected `.orca/SOL-PROTOCOL.md` (canonical control path is
`.orca/sol-control/`, matching production — my seed doc had used the outdated
`suggested` path from CROSS-AGENT-PROTOCOL §14; the doc is now fixed in Orca
`c2b6a7a`), and published a schema-valid BLOCKED sol-control marker
(`8789659`-style isolated commit). The watcher consumed it and the run became
BLOCKED. This attempt is preserved as honest history.

### Attempt 2 (run `de6fc5d2`) — GOAL_COMPLETE with zero manual injection

Fresh run started after the fix. Full timeline, all actors real:

| When (UTC) | Event |
| --- | --- |
| 2026-08-23T01:19:57 | Run started; initial wake submitted into the configured Sol conversation (headed installed-Chrome automation, same authenticated dedicated profile) |
| +~2 min | Sol pushed work-contract `1271af7` then isolated dispatch `23aa112` (`2026-08-23T012100Z-i001-de6fc5d2.json`, strict-correlation instructions) |
| 01:22–01:25 | Real Kimi reconciled to `23aa112f`, refreshed `dogfood-log.md` with post-reconciliation pre-work HEAD, pushed work `3b908ae`, published manifest `ad5e9e0` echoing verbatim ORCA_* values |
| 01:25:13 | `executor.completed` SUCCEEDED — fixed validator accepted a real manifest for the first time |
| 01:25:44 | COMPLETED wake submitted → SOL_REVIEWING |
| +~2 min | Sol verified iteration 1 and dispatched iteration 2 (`b2f4430` plan, `61c36ed` marker) |
| 01:28–01:31 | Kimi appended the VERIFIED section (work `e0b5854`) and published its manifest (`b15bddd`) |
| 01:34:46 | After the second COMPLETED wake, Sol published GOAL_COMPLETE sol-control `8789659`; watcher applied it; run terminal status **GOAL_COMPLETE** |

Verdicts:

- **REAL_SOL_INTELLIGENCE**: QUALIFIED — planned, dispatched twice,
  reviewed results, self-corrected protocol docs, and authored a truthful
  BLOCKED decision when evidence demanded it.
- **REAL_KIMI_INFERENCE_VIA_ORCA**: QUALIFIED — two real executor turns end to
  end through the production loop with valid durable correlation.
- **REAL_CHATGPT_AUTHENTICATED_PROFILE**: QUALIFIED (final) — session reuse +
  four successful real wakes under headed installed-Chrome automation.
- **PHASE_8_TWO_ITERATION_LOOP**: QUALIFIED — persistent campaign → Sol →
  iteration → structured result → Git → Sol hierarchy proven with real externals.

Transient environment note: intermittent github.com:443 connect failures
occurred throughout (also at first watcher poll); every occurrence self-healed
on later polls and never wedged the loop.
