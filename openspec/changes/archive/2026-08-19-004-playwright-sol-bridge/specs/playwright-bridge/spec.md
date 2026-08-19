# Delta for Playwright Sol Bridge

## Purpose

Automate submission of trusted wake messages to configured browser ChatGPT Sol conversations using a dedicated Playwright persistent profile with single-process locking and input-only transmission.

## ADDED Requirements

### Requirement: Persistent browser profile and single-process locking

The controller SHALL maintain a dedicated Chromium user-data profile in `<dataDir>/browser/profile` protected by an exclusive process/file lock.

#### Scenario: Exclusive profile lock
- GIVEN a running browser process (automated or setup)
- WHEN a second process attempts to open the same profile
- THEN it is blocked or rejected with a clear busy/locked error

#### Scenario: Stale lock recovery
- GIVEN a lock file whose owning PID is dead
- WHEN the browser manager starts
- THEN it cleans up the stale lock and acquires ownership safely

---

### Requirement: Interactive Setup Browser flow

The controller SHALL expose an interactive headed browser launch endpoint for initial ChatGPT login and verification.

#### Scenario: Open setup browser
- GIVEN the user requests setup browser
- WHEN `POST /api/browser/setup/open` is invoked
- THEN a visible Chromium window opens with the persistent profile to `https://chatgpt.com`

---

### Requirement: On-demand browser manager and repository page multiplexing

The browser manager SHALL run Chromium on-demand, opening at most one tab/page per active repository.

#### Scenario: Repository page reuse
- GIVEN a repository wake is initiated
- WHEN a tab for that repository already exists
- THEN the tab is reused to send the wake message rather than recreating the page

---

### Requirement: Input-only trusted wake submission

The bridge SHALL submit trusted wake messages to the configured ChatGPT conversation without scraping assistant output.

#### Scenario: Send wake message
- GIVEN a valid completed executor result
- WHEN the bridge submits a wake
- THEN the message is typed into `#prompt-textarea` or contenteditable composer, Send button is clicked, and transmission is verified without parsing subsequent assistant text
