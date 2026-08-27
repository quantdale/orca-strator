# Orca-Strator Development Protocol

This document defines how Orca-Strator itself is developed across short or long AI coding sessions. A fresh coding-agent session must recover the current roadmap position without relying on prior chat history.

## 1. Core development model

Development is a continuous sequence of focused OpenSpec changes:

```text
V1 roadmap goal
    ↓
active OpenSpec
    ↓
coherent implementation slices
    ↓
verify → checkpoint → commit → push
    ↓
change complete
    ↓
fold/archive + update waypoint/roadmap
    ↓
create/activate next OpenSpec
    ↓
continue implementation
```

Under unattended goal mode, an intermediate change or review checkpoint is **not** a stopping condition.

The minimum durable recovery set is `AGENTS.md`, `.agent/state.json`, `docs/ROADMAP.md`, the active OpenSpec, and Git state/history.

## 2. Startup/continuation contract

On `/go`, `/goal`, or a continuation request:

1. read `AGENTS.md`;
2. inspect Git status/current HEAD/local-only commits/remote `main` and in-progress Git operations;
3. preserve and reconcile dirty work;
4. fetch/reconcile ordinary remote-main movement without force-push;
5. read `.agent/state.json` and `docs/ROADMAP.md`;
6. read active proposal/spec/design/tasks;
7. inspect relevant implementation/recent commits;
8. start the next coherent incomplete requirement.

**Skip broad baseline testing at startup.** Do not spend the beginning of a long autonomous run establishing a full old baseline simply to classify failures. Use focused checks while implementing and broader gates at meaningful checkpoints.

## 3. Working-tree recovery

Dirty work may come from interrupted agents, pauses, user edits, refactors, or unfinished Git operations. Default policy is recover, inspect, preserve, reconcile.

Do not automatically hard-reset, clean, overwrite local work, stash-and-forget, or force-push.

If one local path is difficult to reconcile, preserve evidence and continue other safe work when possible. A dirty-tree problem only blocks the entire run when no independent safe work remains.

## 4. Coherent implementation slices

Prefer coherent slices that advance one or a small cluster of requirements, keep interfaces consistent, add relevant tests, and leave useful committed checkpoints.

A long goal-mode run may complete many slices and many OpenSpec changes. Keep checkpoints reviewable even when the run continues.

## 5. Verification policy

Verification is evidence, not a mandatory startup ceremony.

- no broad baseline suite at session start unless a specific current task genuinely requires it;
- run narrow tests/checks around changed behavior;
- run broader typecheck/test/build/lint at meaningful checkpoints, before strong acceptance claims, and before folding major changes when useful;
- never report unrun checks as passing;
- fix introduced regressions when practical;
- if one verification path fails and does not block independent work, record it and continue elsewhere;
- do not loop indefinitely solely to make every historical/baseline failure green before progressing.

Repository source truth is a standing gate (Change 027):
`node scripts/ci/check-source-integrity.mjs` runs in `pretest` and Windows CI,
and fails whenever a tracked TypeScript relative import resolves to a module
that is missing from disk, ignored by `.gitignore`, or untracked — the exact
defect class that once made every local check green while a fresh clone could
not build. Generic local-data ignore rules (`/logs/`, `/runtime/`,
`/browser-profile/`, `/.orca-local/`) are anchored to the repository root on
purpose; do not reintroduce unanchored directory-name rules that can swallow
nested production source. Qualification claims that require a buildable tree
must be re-provable from an origin-only clean worktree.

## 6. OpenSpec lifecycle

Significant work uses:

```text
openspec/changes/<change-id>/
├── proposal.md
├── design.md
├── tasks.md
└── specs/<capability>/spec.md
```

During implementation, update artifacts when implementation evidence changes assumptions and check tasks only when acceptance intent is satisfied.

When a change is complete:

1. run meaningful completion verification;
2. reconcile implementation with final delta requirements;
3. fold/archive into canonical `openspec/specs/` as appropriate;
4. update roadmap and waypoint;
5. identify the next roadmap change;
6. create proposal/spec/design/tasks if absent;
7. commit/push the transition;
8. **continue implementing the next change immediately** unless the user explicitly requested a review stop.

## 7. Durable waypoint

`.agent/state.json` is a concise pointer/checkpoint, not a transcript. It should state current status, goal, milestone/change, checkpoint, next action, blockers, and policies.

During long goal-mode development, update it periodically and whenever a change/milestone transition occurs.

## 8. Commit/push policy

At meaningful checkpoints:

1. inspect diff/status;
2. ensure intended files only and no secrets;
3. update tasks/waypoint;
4. run relevant verification;
5. commit descriptively;
6. fetch/rebase ordinary remote movement;
7. push `main`.

Do this throughout long runs rather than accumulating one enormous local session.

## 9. Review checkpoints

The roadmap's review checkpoints mean "the repository should be reviewable here," not "coding must stop here."

External Sol/ChatGPT review can happen while continuous implementation proceeds because state is repeatedly committed/pushed. Only stop at a review checkpoint when the user explicitly asks for a review boundary.

If a later external review commits corrective OpenSpec/state changes, a running/fresh agent should pull/reconcile them and continue according to the updated durable contract.

## 10. Blocker routing

A blocked subtask does not normally block the development goal.

For a local blocker:

1. preserve useful work;
2. capture concise evidence;
3. record it in task/waypoint when material;
4. select another independent safe task/change;
5. continue implementation;
6. revisit later.

Only stop or let Kimi goal mode become globally `blocked` when no safe useful roadmap work remains without external credentials/infrastructure, explicit user input/approval, or a genuinely unresolved product decision.

## 11. Session exit

If the user/process actually ends the session, finish the smallest safe operation, update tasks/waypoint, commit/push intended work, and document unavoidable recovery state.

Do not voluntarily exit merely because an OpenSpec completed, an ordinary review checkpoint was reached, or one line of work is blocked.

## 12. Goal mode

For Kimi Code, use the canonical objective in `docs/GOAL-MODE.md`.

The finish line is the committed Orca-Strator **V1 roadmap**, not `001a` or any other intermediate change. The agent should continuously repair, implement, checkpoint, fold/archive, create/activate subsequent OpenSpec changes, and continue until the V1 target is complete as far as safely possible.

## 13. Simplicity

Continuous development does not authorize scope creep. Build the roadmap in order, keep V1 explicit, and do not implement deferred multi-session-per-repository, dynamic model routing by Sol, public exposure, or unrelated future systems merely to avoid stopping.

## 14. Windows packaging and release engineering (Change 025)

Packaging commands (run on Windows):

- `npm run package:win` — build + stage runtime + electron-builder unpacked artifact (`apps/desktop/release/win-unpacked/`).
- `npm run package:win:installer` — additionally builds the per-user NSIS installer.
- `npm run smoke:package` — real packaged-runtime smoke; requires the built unpacked artifact.
- `npm run openspec:validate` — strict OpenSpec validation using the
  repository-pinned `@fission-ai/openspec` devDependency (never an implicit
  global/npx resolution; a clean `npm ci` machine can always run this gate).

**Code-signing seam (Change 026 §10, disabled by default).** electron-builder
signing is configured through the standard environment credentials only:
set `CSC_LINK` (path/URL to a PFX or base64 blob) and `CSC_KEY_PASSWORD`
before `npm run package:win:installer` to sign. Nothing is committed and no
certificate material belongs in Git. When absent, artifacts are truthfully
UNSIGNED (`apps/desktop/electron-builder.yml` states this; no fallback
certificate exists). Reported signing status is never assumed from
configuration: `scripts/release/generate-release-manifest.mjs` derives it per
artifact from actual `Get-AuthenticodeSignature` verification, so a
configured-but-failed signature cannot yield mislabeled artifacts — the build
itself fails the job before publication.

The smoke harness (`scripts/package/package-smoke.mjs`) launches the built exe
with isolated `ORCA_DATA_DIR`/port, proves controller autostart + UI/API +
identity, data placement, survival after desktop close, reuse-without-duplicate
on relaunch, persistence, controlled teardown, and package-resource immutability,
then writes `release/package-smoke-report.json`. CI workflows live under
`.github/workflows/`: `windows-ci.yml` (fast tests/typecheck/build/lint/OpenSpec/
diff-check) and `windows-package.yml` (tag/manual packaging with artifact upload;
hosted results are labeled PACKAGE_BUILT, never runtime-qualified). Operator
rollback procedure: docs/RELEASE-AND-ROLLBACK.md.

## 15. Change 028 failure-injection harnesses: endurance and multi-repo stress

Both harnesses are **Change 026 pack** qualification (Windows, against the
built `apps/desktop/release/win-unpacked/Orca-Strator.exe` with isolated
`ORCA_DATA_DIR` + fixture Git remotes only; no inference, no real user
profile). Exact commands are committed in `package.json`:

```bash
npm run test:endurance:short   # short soak: 6 cycles, restart every 3
npm run test:endurance         # long soak: cycles 30 (alias --cycles 30 --label long)
npm run test:stress:repos      # multi-repo stress: 4 repos
```

Flags: `node scripts/package/endurance.mjs [--cycles N] [--label short|long]
[--restart-every 3] [--port P]` (default short: `CYCLES=6`,
`RESTART_EVERY=3`, `PORT=47241`). `stress` honors `ORCA_STRESS_PORT` with
randomized ephemeral fallback `47251+rand(600)` to avoid cross-run port
collision.

### 15.1 Endurance (`scripts/package/endurance.mjs`)

Per cycle: `launchExe` → controller reuse/recovery probe (identity PID
continuity) → API read/write churn (`/api/repositories` CRUD) → watcher
activity on fixture remote (`advanceRemote`) → `GET /api/system/readiness` +
`GET /api/repositories` churn → `sampleProcessMetrics` (working-set, handles)
→ `kill desktopPid` (controller survives). Every third cycle the controller
itself is hard-killed: `killPidOnly(pid)` → `taskkill /T /F` → PowerShell
`Stop-Process` retries, `waitFor(!isPidAlive, 15s)`, port-release probe, `2s`
drain, then relaunch with `180s` readiness (vs `120s` ordinary). One retry on
transient `launchAndReady` failure for restart cycles.

Thresholds (derived from warmup baseline, not arbitrary tiny numbers):
`MEMORY_GROWTH_FACTOR_MAX=2.5`, `HANDLES_GROWTH_FACTOR_MAX=3.0`,
`LOG_BYTES_MAX=50MiB`, package immutability (`snapshotTree` before/after),
`PRAGMA integrity_check`, `verifyDbIntegrity` + migration count. Output:
`release/endurance-<label>-report.json` with verdict
`ENDURANCE_QUALIFIED`/`FAILED`. Teardown: `gracefulControllerShutdown` →
`killPidOnly` → 20×500 ms lock-drain loop → 2 s sleep → retrying `rmSync`
(5× dataDir, 3× fixtures) for Windows `EBUSY`/`EPERM`.

### 15.2 Multi-repo stress (`scripts/package/multi-repo-stress.mjs`)

Proves 4 repositories stay independent against one packaged controller:

1. `M0` register 4 fixture clones concurrently;
2. `M1` `advanceRemote("stress wave 1")` on all 4 → `sleep 12s` (≥2 watcher
   cycles) → every repo observes its own HEAD vs initial SHA;
3. `M2` staggered second wave (`wave2`) → no cross-routed watcher SHAs;
4. `M3` make repo-1 local path invalid (`rm -rf clonePath`) while advancing
   repos 2/3 → sibling failure containment (only doomed repo stalls);
5. `M4.a`/`.b`/`.c` desktop close → `identityOnce` proves controller PID
   unchanged → relaunch desktop → `waitFor(reopen readiness,60s)` reuses same
   controller → `GET /api/repositories` count `===4`;
6. `M5` final SQLite + FK integrity (`verifyDbIntegrity`).

Teardown: `gracefulControllerShutdown` → `readLock`/`killPidOnly` → `rmSync`
both temps. Verdict `MULTI_REPO_PACKAGED_STRESS_QUALIFIED`.

