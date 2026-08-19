# Change 002: Repository Watcher and Transactional Dispatch

## Status

**Ready for implementation**

Roadmap milestone: **2 — Repository watcher and transactional dispatch**

## Why

Milestone 1 established the foundation control plane, SQLite persistence, and responsive UI. To connect Sol's Git commits to local autonomous execution without GitHub Actions, public webhooks, MCP servers, or manual copy-paste, Orca needs a deterministic remote Git watcher and transactional dispatch protocol validator.

## Goals

1. Implement a lightweight remote Git watcher per active repository in the controller.
2. Watch **remote `main` only** in V1 with cheap remote HEAD polling before full fetch.
3. Validate `.orca/dispatch/<dispatchId>.json` against `schemas/protocol/dispatch.schema.json`.
4. Validate that dispatch commits are isolated final commits (only `.orca/dispatch/<dispatchId>.json` added).
5. Reject mixed commits, schema-invalid dispatches, malformed JSON, and branch modifications.
6. Persist consumed dispatch IDs, observed commit SHAs, and watcher state in SQLite.
7. Implement duplicate protection and idempotency so repeated observation of a commit or dispatch cannot double-launch.
8. Expose watcher lifecycle, status, and health via controller REST and WebSocket events.
9. Support independent concurrent watchers across multiple configured repositories.
10. Test all watcher and dispatch validation behavior thoroughly with temporary Git remotes and unit/integration tests.

## Non-goals inside 002

- Headless executor CLI process launch (WSL/PowerShell execution belongs to Milestone 3).
- Playwright/ChatGPT Sol browser wake bridge (belongs to Milestone 4).
- Multi-repository autonomous state machine loop (belongs to Milestone 5).
- Phone control or Tailscale setup (belongs to Milestone 7).

## Verification Posture

- Unit tests for dispatch schema validation, commit isolation rules, and idempotency store.
- Integration tests using temporary local Git repositories acting as remotes (`git init --bare`).
- Controller API/event verification for watcher status endpoints.
- Clean-output typecheck/test/build/lint checkpoints.
