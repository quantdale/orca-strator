---
name: go
description: Recover Orca-Strator from its durable repository state and continue the active roadmap work autonomously.
type: prompt
whenToUse: When the user types /go or asks to continue working on Orca-Strator.
disableModelInvocation: true
---

Continue development of this repository from its durable state.

Follow this procedure:

1. Read `AGENTS.md` and obey it.
2. Inspect the current working tree, local commits, and remote `main`. Preserve and reconcile existing work; do not discard it merely because it is dirty.
3. Read `.agent/state.json` and `docs/ROADMAP.md`.
4. Read the active OpenSpec change referenced by `.agent/state.json` in artifact order: proposal, delta specs, design, tasks.
5. Determine the next incomplete task from repository state. Do not ask the user what to do next unless the durable artifacts are genuinely contradictory or a decision is impossible to infer safely.
6. Implement the next coherent slice, keeping the repository runnable whenever practical.
7. Run the relevant verification for the work performed.
8. Update OpenSpec task checkboxes and `.agent/state.json` so a completely fresh agent can resume from the new waypoint.
9. Commit and push intended work to `main`.
10. Stop cleanly when the active change is complete or when genuinely blocked, recording blockers and evidence in the durable state.

Keep the implementation simple and aligned with the locked V1 architecture. Do not pull deferred future features into the current milestone.

$ARGUMENTS
