# Orca-Strator Continuous Goal Mode

This document defines the canonical Kimi Code `/goal` objective for long unattended development of Orca-Strator.

## Purpose

Goal mode is used when the user wants Orca-Strator development to continue across many turns without prompting after every OpenSpec change or review checkpoint.

The finish line is **the V1 roadmap outcome**, not the currently active change.

Intermediate change completion, review checkpoints, failing tests, or a blocked subtask do not by themselves end the goal.

## Canonical goal prompt

Use this in Kimi Code:

```text
/goal Continue building Orca-Strator autonomously from the durable repository state until the V1 roadmap is implemented as far as safely possible.

First recover from AGENTS.md, .agent/state.json, docs/ROADMAP.md, and the active OpenSpec. Preserve and reconcile all existing Git work and remote main changes. Skip broad baseline testing at startup; begin the active implementation directly and use focused verification while working, with broader typecheck/test/build/lint only at meaningful checkpoints.

Resolve all current review findings and active OpenSpec requirements. When the current change is complete, do not stop and do not wait for a review by default. Fold/archive it as appropriate, update the durable waypoint/roadmap, create or activate the next focused OpenSpec change required by the roadmap, and continue implementing it. Repeat this process across milestones.

Treat blockers as local whenever possible. If one test, tool, task, environment path, or implementation approach is blocked, preserve useful work, record concise evidence, and continue other independent safe work in the codebase. Revisit blockers later when new context may help. Do not mark the overall goal blocked while meaningful safe roadmap work remains.

Commit and push coherent checkpoints directly to main throughout the run. Keep .agent/state.json accurate and concise. Never force-push automatically, never discard dirty/user work for convenience, never commit secrets or machine-local runtime/browser/database state, and keep V1 architecture/decisions authoritative unless implementation evidence requires an explicit durable amendment.

Do not voluntarily stop after fixing 001a, after completing any intermediate OpenSpec, or at ordinary review checkpoints. Continue through the roadmap. Only stop/mark the goal blocked if no safe useful implementation work remains without external credentials or unavailable infrastructure, explicit user input/approval, a truly unresolved product decision, or if the user explicitly pauses/cancels/stops the goal.

Do not implement explicitly deferred features merely to keep busy. The target is the committed V1 roadmap and its required quality/hardening work.
```

## Why the goal is phrased this way

Kimi goal mode automatically continues turns while a goal remains active. The objective therefore must describe what should become true rather than merely name the next task.

The roadmap provides ordered scope. OpenSpec provides current implementation detail. `.agent/state.json` provides the waypoint. Git provides durable reality.

## Verification behavior

`skip baseline testing` means:

- do not start the session with a broad full-suite baseline merely to classify pre-existing failures;
- start implementation from durable state;
- use focused tests/checks around changed behavior;
- run broader gates at meaningful checkpoints, before folding important changes when useful, and before making strong quality claims;
- never claim a check passed when it was not run.

It does **not** mean disabling testing or ignoring introduced regressions.

## Blocked behavior

Do not mark the whole goal blocked because one line of work is blocked.

Route around local blockers and continue independent safe roadmap work. The overall goal becomes legitimately blocked only when every meaningful next step depends on an external requirement the agent cannot satisfy autonomously.

## Review behavior

External Sol/ChatGPT reviews remain useful and can happen at any time because work is continuously committed/pushed and the waypoint stays current.

During unattended goal mode, review checkpoints are non-blocking unless the user explicitly asks the coding agent to stop for review.
