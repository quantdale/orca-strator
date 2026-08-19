# Change 004: Playwright Sol Bridge

## Status

**Ready for implementation**

Roadmap milestone: **4 — Playwright Sol bridge**

## Why

Milestones 1-3 built the control plane, remote Git watcher, and headless executor runtime. To close the autonomous loop from executor completion back to Sol review, Orca needs a Playwright browser bridge that can wake the exact ChatGPT Sol conversation with a trusted wake message.

## Goals

1. Manage a dedicated persistent Chromium user-data profile in the Orca data directory (`<dataDir>/browser/profile`).
2. Implement global profile locking and stale-lock recovery to ensure only one browser process accesses the profile.
3. Provide an interactive headed "Setup Browser" flow allowing the user to sign in to ChatGPT once.
4. Implement an on-demand `PlaywrightBrowserManager` that hosts one Page per active repository.
5. Formulate and submit trusted wake messages into the exact configured ChatGPT Sol conversation URL.
6. Adhere to the input-only browser protocol: type wake message, click/press send, verify transmission, and do not scrape ChatGPT output.
7. Handle ChatGPT busy states, Cloudflare/interstitial checks, and modal dialogs with bounded retry.
8. Persist wake attempts, statuses, and browser logs in SQLite.
9. Expose browser status, setup browser launch, and test-wake endpoints over REST.
10. Build a deterministic `MockBrowserDriver` for complete automated testing without live ChatGPT dependencies.

## Non-goals inside 004

- High-level multi-repository autonomous state machine loop (belongs to Milestone 5).
- Phone control or Tailscale setup (belongs to Milestone 7).
