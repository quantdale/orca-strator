# Delta spec: external-chrome-auth-bootstrap

## ADDED Requirements

### Requirement: System Chrome discovery

Orca SHALL discover the ordinary installed Google Chrome on Windows before any
browser flow that requires it, probing in order:

1. Registry App Paths (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App
   Paths\chrome.exe`, plus the WOW6432Node view), accepting a value only when
   the referenced file exists;
2. `%ProgramFiles%\Google\Chrome\Application\chrome.exe`;
3. `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`;
4. `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`.

The discovery result SHALL expose FOUND / NOT_FOUND status, the executable
path, and a best-effort VERSION. When Chrome is absent, Orca SHALL surface an
actionable NOT_FOUND readiness state and SHALL NOT silently fall back to an
unsupported setup or automation path.

#### Scenario: Chrome found via Program Files

- **WHEN** registry App Paths yields no result but
  `%ProgramFiles%\Google\Chrome\Application\chrome.exe` exists on disk
- **THEN** discovery reports FOUND with that executable path

#### Scenario: Chrome absent

- **WHEN** no probe location contains chrome.exe
- **THEN** discovery reports NOT_FOUND and setup/automation entry points
  return an actionable error naming the remediation instead of launching an
  incompatible browser

### Requirement: External setup browser is ordinary Chrome

The INTERACTIVE_SETUP login window SHALL be launched by spawning the
discovered installed Chrome binary directly as a child process with exactly
the arguments `--user-data-dir=<orca dedicated profile>` and the ChatGPT login
URL (`https://chatgpt.com/auth/login`). No Playwright/remote automation MAY be
attached during interactive setup, no anti-detection flags, user-agent
overrides, `--no-sandbox`, or remote-debugging ports MAY be passed, and the
user's ordinary personal Chrome profile SHALL NOT be used.

#### Scenario: Setup open launches external Chrome only

- **WHEN** Open Setup Browser is invoked while the profile is free and Chrome
  is installed
- **THEN** an ordinary Chrome child process is spawned against the dedicated
  profile with exactly the two permitted arguments
- **AND** no Playwright launch occurs for this flow

#### Scenario: Prohibited flags can never appear

- **WHEN** the external setup launcher builds its argument list or the
  automation driver builds Playwright launch options
- **THEN** neither contains automation-hiding switches, sandbox downgrades,
  or user-agent overrides

### Requirement: Profile ownership across external and automated browsers

The external Chrome process PID SHALL own the INTERACTIVE_SETUP profile lock.
While that Chrome process remains alive, AUTOMATED acquisition SHALL be
rejected. When Chrome exits — by user action or by Close Setup Browser —
setup ownership SHALL be released so AUTOMATED may acquire the profile. A
stale external-PID lock SHALL recover through the same durable PID-liveness
checks used by existing lock recovery. External setup Chrome and Playwright
automation SHALL NEVER write the profile concurrently.

#### Scenario: Automation blocked while setup Chrome is open

- **WHEN** the external setup Chrome process is running and an AUTOMATED
  profile acquire is attempted
- **THEN** the acquire is refused with a conflict indication

#### Scenario: Ownership released when the human closes Chrome

- **WHEN** the external setup Chrome process exits on its own
- **THEN** setup state becomes closed, the lock file is removed without
  requiring controller restart, and a subsequent AUTOMATED acquire succeeds

#### Scenario: Stale external-PID lock recovery

- **WHEN** a lock records an external Chrome PID that no longer passes
  liveness verification
- **THEN** the next acquire removes the stale lock and succeeds

### Requirement: Automation reuses installed Chrome with the dedicated profile

Production automated browsing (BrowserManager/PlaywrightDriver) SHALL use the
discovered installed Chrome binary with the SAME persistent dedicated user
data directory used by interactive setup, so a session created by manual login
is reused without repeating authentication. If installed Chrome is
unavailable, the system SHALL surface an actionable readiness state rather
than silently launching an incompatible bundled Chromium against the shared
profile.

#### Scenario: Automated wake uses installed Chrome

- **WHEN** BrowserManager launches the browser for a Sol wake after a manual
  sign-in was completed through external setup Chrome
- **THEN** Playwright launches the discovered installed Chrome executable
  with the dedicated profile directory

#### Scenario: No Chrome installed

- **WHEN** automation is requested and Chrome discovery reports NOT_FOUND
- **THEN** the caller receives an actionable readiness failure and no browser
  is launched

### Requirement: Auth readiness truthfulness

Authentication readiness SHALL be reported as AUTHENTICATED,
LOGIN_REQUIRED, VERIFICATION_REQUIRED, or UNKNOWN, derived primarily from
safe UI/navigation behavior (login affordances, composer visibility,
challenge indicators) of the dedicated profile. Cookie NAME-family inspection
MAY corroborate but SHALL NOT be the sole truth source. Cookie VALUES SHALL
never be read into memory for reporting, logged, or persisted anywhere in
Orca.

#### Scenario: Readiness after manual login

- **WHEN** Check Login runs after the human completed sign-in and closed
  setup Chrome, and the loaded chatgpt.com page shows the composer with no
  login affordances
- **THEN** readiness reports AUTHENTICATED with named UI evidence signals

#### Scenario: Readiness while profile busy

- **WHEN** Check Login runs while setup Chrome still owns the profile
- **THEN** readiness reports UNKNOWN with a profile-busy evidence signal and
  launches nothing

#### Scenario: No cookie values leak

- **WHEN** any auth readiness report, log line, event, or persisted record is
  produced
- **THEN** it contains cookie/session names at most as evidence labels and
  never any credential, token, or cookie value material
