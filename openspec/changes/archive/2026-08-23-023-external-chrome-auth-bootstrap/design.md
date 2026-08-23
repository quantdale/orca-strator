# Design: External Chrome auth bootstrap

## Context

Playwright-managed Chromium is rejected by Google OAuth ("This browser or app
may not be secure"). The fix must keep ALL anti-detection out of the codebase
and instead move the human-authentication moment into an ordinary, unmodified
Chrome process that Orca merely starts and later reuses.

## Non-negotiable constraints

- No webdriver spoofing, no `--disable-blink-features=AutomationControlled`,
  no stealth plugins, no user-agent spoofing for auth bypass, no CAPTCHA
  handling beyond truthful detection, no token/cookie-value copying, no
  private APIs.
- The dedicated Orca profile (`<dataDir>/browser/profile`) remains the ONLY
  browser profile Orca touches. Never the user's personal Chrome profile.
- One executor of the profile at a time (existing Finding J invariant).
- Cookie VALUES never read, logged, or persisted. Cookie NAME families may be
  inspected only as a secondary auth corroboration signal.

## Module boundaries (all under `apps/controller/src/browser/`)

### 1. `chrome-discovery.ts` — pure, injectable discovery

```ts
interface SystemChromeInfo {
  status: "FOUND" | "NOT_FOUND" | "UNKNOWN";
  executablePath: string | null;
  version: string | null;
  source: string; // "registry-app-paths" | "program-files" | ... | human-readable failure
}
```

- `discoverSystemChrome(env?, runners?)`: probe order:
  1. Registry App Paths via `reg query
     "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve`
     (and WOW6432Node view); value used only if the file exists on disk.
  2. `%ProgramFiles%\Google\Chrome\Application\chrome.exe`
  3. `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`
  4. `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
- Version: prefer `HKCU\Software\Google\Chrome\BLBeacon\version`; fallback:
  parse a `<major>.<x>.<y>.<z>` subdirectory name under `Application\`.
  Version is best-effort metadata; absence does not fail FOUND.
- All environment access and child-process execution go through injected
  defaults so tests are deterministic without touching a real machine.
- NOT_FOUND is an actionable readiness state, never a silent fallback.

### 2. `external-setup-browser.ts` — ordinary Chrome as child process

```ts
class ExternalSetupBrowserLauncher {
  spawn(executablePath: string, profileDir: string, loginUrl: string): { pid: number; exit: Promise<{ code: number | null }> }
  async close(): Promise<void>   // Windows: taskkill /PID <pid> /T /F; POSIX: child.kill()
  isRunning(): boolean
}
```

- Spawn args are EXACTLY `["--user-data-dir=<profileDir>", "<loginUrl>"]`.
  No DevTools port, no remote debugging, no automation switches, no sandbox
  downgrades, no user-agent overrides. Pinned by test snapshot.
- `detached: false`, stdio ignore — Chrome runs independently of Playwright;
  controller only knows its PID and exit event.
- Exit event drives ownership release in BrowserManager (user may close the
  window manually at any time).

### 3. `ProfileLockManager` — owner-PID support

- `acquire(reason, opts?: { ownerPid?: number })` records `ownerPid ??
  process.pid`. Mode resolution unchanged ("INTERACTIVE_SETUP..." still maps
  to INTERACTIVE_SETUP because it contains "setup").
- New `releaseFor(pid)`: unlink only when the stored pid matches. Existing
  `release()` stays `releaseFor(process.pid)`.
- Stale recovery semantics unchanged: any acquirer removes the lock when the
  recorded PID fails `isProcessAlive`. This already covers external Chrome
  PID reuse-risk policy identical to today's controller-PID risk.
- While external Chrome lives: its real PID holds INTERACTIVE_SETUP, so every
  AUTOMATED acquire (different PID, alive) is refused — including by the
  same controller process, preserving Finding J.

### 4. `BrowserManager` setup flow rewrite

```
openSetupBrowser():
  if isSetupOpen -> return
  chrome = discoverSystemChrome(); NOT_FOUND/UNKNOWN -> throw actionable ValidationError
  migrateProfileIfNeeded()            // §Migration below
  pre-check lock free                 // friendly conflict message otherwise
  { pid, exit } = launcher.spawn(chrome.executablePath, profileDir, SETUP_LOGIN_URL)
  acquire("INTERACTIVE_SETUP_EXTERNAL_CHROME", ownerPid=pid)
    on failure -> kill spawned child, throw conflict
  isSetupOpen = true
  exit.then(releaseSetupOwnership)    // idempotent; also fires for manual close

closeSetupBrowser():
  await launcher.close()              // kills tree
  releaseFor(setupPid); isSetupOpen=false
```

- `SETUP_LOGIN_URL = "https://chatgpt.com/auth/login"` (constant).
- The Playwright driver is NEVER touched during INTERACTIVE_SETUP. Mock-driver
  tests assert zero `launch()` calls in this flow.

### Migration (`migrateProfileIfNeeded`)

- Read `<profile>/Last Version` (Chromium writes the last writer's version).
- Missing file → fresh/no profile → nothing to do.
- Parse major versions of (profileLastVersion, installedChrome.version):
  equal majors → compatible, untouched. Different/unparseable → rename
  `profile` → `profile.backup-before-chrome-<ISO-timestamp>` (never delete),
  recreate empty `profile`, record one structured event + status detail.
- Never copies individual cookies or any auth state between profiles.

### Automation channel (`PlaywrightDriver`)

- `BrowserDriver.launch(profileDir, headless)` gains optional
  `opts?: { executablePath?: string }`.
- Production resolution order: explicit override → discovered installed
  Chrome executablePath (deterministic, preferred over `channel` because the
  discovery result is already version-checked) → if absent, throw actionable
  `CHROME_NOT_READY` error naming the remediation. Bundled Chromium is NOT
  silently reused against the shared profile (format-compatibility guard).
- Launch options remain exactly `{ headless, viewport,
  executablePath? }` — pinned by test to prove no forbidden flags can creep in.
- Real-qualification amendment: production automation passes
  `headless=false`. Cloudflare serves a "Just a moment" interstitial to
  headless Chrome even with the genuine installed binary and the warm,
  human-authenticated profile, while headed launches reuse that session
  cleanly. This is a launch-mode choice only — no stealth flags, no UA
  spoofing, and the options-shape guard above is unchanged.

### 5. Auth readiness (`auth-readiness.ts`)

```ts
type AuthReadinessStatus = "AUTHENTICATED" | "LOGIN_REQUIRED" | "VERIFICATION_REQUIRED" | "UNKNOWN";
interface AuthReadinessReport {
  status: AuthReadinessStatus;
  checkedAt: string;          // ISO
  evidence: string[];         // signal NAMES only, e.g. "ui:composer-visible"
  profileUsableByAutomation: boolean;
}
```

`checkAuthReadiness()` (on BrowserManager):

1. If setup Chrome open OR lock held → `{ UNKNOWN, evidence: ["profile-busy"] }`
   without launching anything.
2. Acquire AUTOMATED briefly; launch automated Chrome (installed binary,
   same profile); navigate to `https://chatgpt.com/`; classify:
   - captcha/challenge selectors or scoped text signals → VERIFICATION_REQUIRED
   - login affordances (`a[href*='auth/login']`, Log in / Sign up buttons) → LOGIN_REQUIRED
   - composer visible (`#prompt-textarea` family) with no login affordances → AUTHENTICATED
   - otherwise → UNKNOWN
3. Corroboration only: read cookie NAMES (`context.cookies()` mapped to
   `name+domain` strings) for session-indicating next-auth families; a
   contradicting strong pair (e.g., UI says AUTHENTICATED but zero session
   family names) demotes to UNKNOWN with both signals listed.
4. Always close page + driver + release lock in `finally`.

No cookie value ever enters the report, logs, DB, or events (test-enforced).

### 6. HTTP surface + UI

- `GET /api/browser/status` payload extends `BrowserStatus` (shared type):
  `systemChrome: { status, version, executablePath }`,
  `authReadiness: AuthReadinessReport | null`,
  `setupLauncherKind: "external-chrome" | null`, `setupPid: number | null`.
- `POST /api/browser/auth/check` → `{ auth: AuthReadinessReport }` (409-safe:
  returns UNKNOWN/profile-busy rather than failing when locked).
- Setup open/close routes keep their existing shapes (UI-compatible).
- Settings.tsx ChatGPT section: explanatory copy block verbatim from spec §6;
  rows for Chrome detected/version, Profile location, Setup browser
  OPEN/CLOSED, Authentication readiness, Automation-profile ownership; buttons
  Open Setup Browser / Check Login / Close Setup Browser (Check disabled while
  setup is open).

## Test strategy (fast tier, mocked Chrome binary)

Fixture "chrome": a Node script whose absolute path stands in for chrome.exe.
It records argv to a temp file and sleeps; tests assert exact argv, PID
liveness, exit-event behavior, and tree kill. Discovery is tested through the
injectable env/fs/registry seams. PlaywrightDriver launch options are asserted
via an import seam that captures options without launching. All Google-login
behavior is explicitly never automated.

## Risks / mitigations

- Chrome not installed on a machine → every entry point surfaces actionable
  NOT_FOUND/readiness text; nothing falls back silently.
- PID reuse after external Chrome crash → same accepted durable-liveness
  recovery policy as existing locks; mode+PID checks stay conservative.
- Profile format mismatch Chrome vs Playwright Chromium → migration guard
  above; backups never deleted.
