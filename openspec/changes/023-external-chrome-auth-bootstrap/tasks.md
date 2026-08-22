# Change 023 tasks

## 1. System Chrome discovery

- [x] 1.1 New `apps/controller/src/browser/chrome-discovery.ts`: injectable
  probe order (registry App Paths incl. WOW6432Node, ProgramFiles,
  ProgramFiles(x86), LOCALAPPDATA), FOUND/NOT_FOUND/UNKNOWN + version +
  executablePath + source; BLBeacon/version-subdir best-effort version.

## 2. External setup launcher

- [x] 2.1 New `apps/controller/src/browser/external-setup-browser.ts`: direct
  child-process spawn with EXACTLY `--user-data-dir=<profile>` + login URL;
  PID capture, exit event, `close()` tree kill (taskkill on Windows).

## 3. Profile ownership

- [x] 3.1 `ProfileLockManager.acquire(reason, { ownerPid })` support +
  `releaseFor(pid)`; existing mode semantics and stale-liveness recovery
  unchanged.

## 4. BrowserManager external setup flow

- [x] 4.1 Rewrite `openSetupBrowser`/`closeSetupBrowser` to use discovery +
  external launcher (never the Playwright driver); exit event releases
  ownership; conflict errors actionable.
- [x] 4.2 Profile migration guard: `Last Version` major vs installed Chrome
  major; incompatible → timestamped backup dir + fresh profile; never delete/
  copy cookies silently.
- [x] 4.3 Automation launch resolution: PlaywrightDriver uses discovered
  installed Chrome executablePath with same profile; NOT_FOUND → actionable
  readiness failure (no silent bundled-Chromium fallback).
- [x] 4.4 Auth readiness (`auth-readiness.ts` + BrowserManager.check):
  UI/navigation-primary classification into AUTHENTICATED / LOGIN_REQUIRED /
  VERIFICATION_REQUIRED / UNKNOWN; cookie NAME families as corroboration only;
  no cookie values in report/logs/persistence.

## 5. HTTP surface

- [x] 5.1 Extend shared `BrowserStatus` (systemChrome, authReadiness,
  setupLauncherKind, setupPid) + wire status route payload.
- [x] 5.2 New `POST /api/browser/auth/check` returning readiness; UNKNOWN +
  profile-busy evidence instead of hard failure when locked.

## 6. Settings UI truthfulness

- [x] 6.1 Settings.tsx ChatGPT section: spec §6 copy block, Chrome detected/
  version row, profile location, setup OPEN/CLOSED, authentication readiness,
  automation-profile ownership; Open Setup Browser / Check Login / Close
  Setup Browser buttons wired to API client.

## 7. Fast-tier tests (mocked Chrome binary)

- [x] 7.1 `chrome-discovery.test.ts`: found via each probe tier (injectable),
  registry preferred, NOT_FOUND, version extraction paths.
- [x] 7.2 `external-setup-browser.test.ts` (fixture "chrome" script): exact
  argv snapshot, dedicated profile path arg, PID liveness, exit-event release,
  close kills process.
- [x] 7.3 BrowserManager tests: zero Playwright launches during
  INTERACTIVE_SETUP; AUTOMATED acquire refused while external Chrome open;
  release on exit; stale external-PID recovery; setup/automation never
  concurrent; migration backup/fresh-profile behavior.
- [x] 7.4 Launch-options guard tests: driver options contain no
  AutomationControlled / --no-sandbox / user-agent override; launcher argv
  contains exactly the two permitted arguments.
- [x] 7.5 Auth readiness tests: composer→AUTHENTICATED, login affordances→
  LOGIN_REQUIRED, captcha→VERIFICATION_REQUIRED, busy→UNKNOWN; report JSON
  contains no credential/value material.
- [x] 7.6 API test coverage for extended status payload + auth/check route.

## 8. Gates + durable state

- [x] 8.1 Focused suites green; npm test fast tier; typecheck; build; lint;
  `git diff --check`; strict OpenSpec validation.
- [x] 8.2 Update `.agent/state.json`, docs/REAL-DOGFOOD-QUALIFICATION.md,
  docs/ROADMAP.md, docs/TEST-STRATEGY.md; commit/push main.

## 9. Real qualification (external-chrome-auth-bootstrap)

- [ ] 9.1 Close all Orca browser processes; start production controller.
- [ ] 9.2 Invoke Open Setup Browser; verify ordinary installed Chrome (not
  Playwright-managed) on the dedicated profile.
- [ ] 9.3 HUMAN completes ChatGPT Google sign-in manually in that window
  (Orca never automates this step); human closes window.
- [ ] 9.4 Invoke Check Login → AUTHENTICATED expected.
- [ ] 9.5 Start BrowserManager automation on SAME profile; verify session
  reused (no Google OAuth re-run under automation); one harmless real wake.
- [ ] 9.6 Record QUALIFIED verdicts (EXTERNAL_CHROME_AUTH_BOOTSTRAP,
  REAL_CHATGPT_AUTHENTICATED_PROFILE) in qualification doc; resume real
  dogfood campaign (Sol → dispatch#1 → Kimi → result → Sol → dispatch#2 →
  Kimi → result → Sol → GOAL_COMPLETE).
