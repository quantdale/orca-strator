# Change 023: External Chrome auth bootstrap

## Why

The real external dogfood qualification is blocked at a genuine, reproduced
boundary: Orca's "Open ChatGPT Setup Browser" launches the dedicated persistent
profile through Playwright (`chromium.launchPersistentContext`). During ChatGPT
"Continue with Google", Google rejects that automation-controlled browser with
"This browser or app may not be secure." No human can complete Google OAuth
inside the Playwright-managed setup window.

This is a real-world qualification blocker, not speculative work: without it,
the real Sol wake campaign cannot proceed past login.

The correct design separates HUMAN AUTHENTICATION from AUTOMATION:

- INTERACTIVE_SETUP: spawn the ordinary installed Chrome binary directly as an
  external child process against Orca's dedicated user-data directory. The
  human completes Google/OpenAI auth in a fully ordinary browser.
- AUTOMATED: BrowserManager keeps using Playwright — but pointed at the same
  installed Chrome (`channel: "chrome"` or discovered executablePath) and the
  same persistent profile, so the human-created session is reused without
  re-running Google OAuth under automation.

Forbidden and out of scope forever: webdriver spoofing,
`--disable-blink-features=AutomationControlled`, stealth plugins, user-agent
spoofing for auth bypass, CAPTCHA bypass, copying OAuth/session tokens, private
Google/OpenAI APIs. Orca must never type Google credentials, touch MFA, or
automate any part of the login itself.

## Scope

1. Windows system-Chrome discovery (registry App Paths preferred, then the
   standard `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%LOCALAPPDATA%`
   locations), exposing FOUND/NOT_FOUND, VERSION, EXECUTABLE_PATH. No silent
   insecure fallback.
2. An external setup-browser launcher that spawns installed Chrome directly
   (`chrome.exe --user-data-dir=<orca dedicated profile>
   https://chatgpt.com/auth/login`) with no remote automation attached, no
   anti-detection flags, no `--no-sandbox`, and never the user's ordinary
   Chrome profile.
3. Profile ownership integration: the external Chrome PID owns the
   INTERACTIVE_SETUP lock; AUTOMATED acquisition is refused while Chrome is
   open; exit releases ownership; stale external-PID locks recover through the
   existing durable PID liveness checks.
4. PlaywrightDriver production automation uses installed Chrome with the same
   profile (`channel: "chrome"`, deterministic executablePath override). If
   Chrome is absent, surface an actionable readiness state instead of silently
   launching an incompatible bundled Chromium profile.
5. Auth readiness statuses AUTHENTICATED / LOGIN_REQUIRED /
   VERIFICATION_REQUIRED / UNKNOWN derived primarily from safe UI/navigation
   signals, with cookie NAME-family inspection only as corroboration. Cookie
   values are never read into logs or persistence.
6. Settings UI truthfulness updates: explicit copy about ordinary Chrome +
   dedicated profile + manual sign-in, Chrome detected/version, profile
   location, setup OPEN/CLOSED, authentication readiness, profile ownership;
   Open Setup Browser / Check Login / Close Setup Browser controls.
7. Migration: keep `%LOCALAPPDATA%\Orca-Strator\browser\profile` usable where
   compatible; if a prior Playwright Chromium profile cannot safely be opened
   by system Chrome, preserve it as a timestamped backup and create a clean
   dedicated profile. Never delete silently; never copy auth cookies.

## Impact

- Affected: `apps/controller/src/browser/*` (new discovery/launcher modules,
  BrowserManager setup flow, ProfileLockManager owner-PID support,
  PlaywrightDriver launch options), `apps/controller/src/http/routes/browser.ts`
  (status payload + new auth-check route), shared `BrowserStatus` types,
  `apps/ui Settings.tsx`, tests, docs.
- Unaffected invariants: input-only browser protocol (no output scraping for
  coordination), one persistent profile per repository set, BrowserManager owns
  automated lifecycle, no security-evasion flags anywhere.
- Real qualification resumes immediately after gates: open setup browser ->
  human signs in -> close -> readiness check -> BrowserManager reuses session
  -> one harmless real ChatGPT wake.
