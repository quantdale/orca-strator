# Orca-Strator Real External Qualification Report

Status: **IN PROGRESS — blocked at one genuine manual boundary (ChatGPT login)**

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
| 5 Dedicated Sol conversation | PENDING | ChatGPT auth |
| 7 Real authenticated wake smoke | PENDING | ChatGPT auth (folds into run start) |
| 8 Two-iteration Sol↔Kimi loop | PENDING | Phase 5 |
| 10 Codex via Orca (one real turn) | PENDING | Phase 5 |
| 11 Tailscale phone route | BLOCKED_MANUAL_ELEVATION | One elevated install step |

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
