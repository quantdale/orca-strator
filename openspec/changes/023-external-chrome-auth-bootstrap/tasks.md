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

- [x] 9.1 Close all Orca browser processes; start production controller.
- [x] 9.2 Invoke Open Setup Browser; verify ordinary installed Chrome (not
  Playwright-managed) on the dedicated profile.
- [x] 9.3 HUMAN completes ChatGPT Google sign-in manually in that window
  (Orca never automates this step); human closes window.
- [x] 9.4 Invoke Check Login → AUTHENTICATED expected.
- [x] 9.5 Start BrowserManager automation on SAME profile; verify session
  reused (no Google OAuth re-run under automation); one harmless real wake.
- [x] 9.6 Record QUALIFIED verdicts (EXTERNAL_CHROME_AUTH_BOOTSTRAP,
  REAL_CHATGPT_AUTHENTICATED_PROFILE) in qualification doc; resume real
  dogfood campaign (Sol → dispatch#1 → Kimi → result → Sol → dispatch#2 →
  Kimi → result → Sol → GOAL_COMPLETE).

## 10. Real-qualification evidence log (2026-08-22)

- 9.1–9.2 VERIFIED: production controller on 47100; Open Setup Browser spawned
  ordinary installed Chrome v151.0.7922.138 (`chrome.exe --user-data-dir=
  <dedicated profile> https://chatgpt.com/auth/login`), zero Playwright
  involvement; exit released profile ownership (`lockHolderPid: null`).
- 9.3 DONE: human completed ChatGPT Google sign-in in the external window and
  closed it (Orca never touched credentials).
- 9.4 VERIFIED: `POST /api/browser/auth/check` returned
  `AUTHENTICATED` with evidence `ui:composer-visible`,
  `cookies:session-family-present`, `profileUsableByAutomation: true`.
- REAL FINDING folded back into implementation: headless Playwright launches
  receive a Cloudflare "Just a moment" interstitial even with the genuine
  installed Chrome + warm authenticated profile; headed launches of the same
  binary reuse the human session cleanly. Automation therefore runs HEADED
  (`AUTOMATION_HEADED=false` headless flag) — launch mode only, no stealth.
  Design §Automation channel + RUNTIME-MODEL updated accordingly; guard tests
  updated to pin headed automation.
- 9.5 PARTIAL: automation on SAME profile verified via the readiness check
  path itself (headed installed-Chrome launch, session reused, no Google OAuth
  re-run). The one harmless real wake remains PENDING the user-supplied
  dedicated Sol conversation URL (qualification phase 5, user-owned config).
- 9.6 EXTERNAL_CHROME_AUTH_BOOTSTRAP: QUALIFIED.
  REAL_CHATGPT_AUTHENTICATED_PROFILE: session-reuse half QUALIFIED; final
  verdict awaits the harmless real wake.

## 11. Real qualification completion (2026-08-22 ~23:00 +08:00)

- User supplied the dedicated Sol conversation URL (chatgpt.com/c/<uuid>,
  user-owned config; recorded only in the production DB repository record).
- Smoke repository created via production API (`POST /api/repositories`,
  Windows env, real kimi.exe + user model binding); watcher auto-started.
- Run started via `POST /api/repositories/:id/runs/start` →
  `sol.wake_submitted` **SUCCEEDED** at 2026-08-22T15:00:58Z through
  BrowserManager headed automation using the discovered installed Chrome
  (v151.0.7922.138) and the SAME dedicated authenticated profile — the
  harmless real wake completed with NO Google OAuth re-run under automation.
- REAL_CHATGPT_AUTHENTICATED_PROFILE: QUALIFIED (auth reuse + real wake).
- Campaign resumed with real actors: Sol authored an ordinary work-contract
  commit plus a schema-valid isolated dispatch commit within ~3 minutes of the
  wake; the production watcher consumed it and the real Kimi executor began
  iteration 1. Loop continuation evidence lives in docs/REAL-DOGFOOD-QUALIFICATION.md
  phase 8 and the campaign timeline API.
