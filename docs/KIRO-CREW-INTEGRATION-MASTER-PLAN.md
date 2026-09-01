# Kiro Crew Integration Master Plan — Orca-Strator

**Status:** FUTURE / POST-V1 / NOT ACTIVE  
**Priority:** High architectural value, but only after the active production-certification work is closed or explicitly superseded  
**Date:** 2026-09-01  
**Current active change effect:** NONE — do not modify or reclassify Change `029-full-project-completion-and-production-certification`

## 1. Executive decision

Kiro Crew is most relevant to Orca-Strator because both systems solve long-running agent orchestration. That overlap is also the main risk.

The correct integration is **not** “put Orca inside Crew” or “replace Orca with Crew.”

The recommended architecture is:

```text
                       Orca-Strator
                OUTER ORCHESTRATION AUTHORITY
                run / lease / dispatch / Git truth
                           |
                 optional executor backend
                           |
                    Kiro Crew adapter
                           |
                 Kiro Crew TaskRunner
                           |
                       kiro-cli / ACP
```

Orca remains responsible for:

- repository/run ownership;
- one-writer guarantees;
- dispatch identity;
- durable transitions/outbox;
- Git handoff truth;
- scheduler ownership;
- process ownership;
- watchdog/cancellation policy;
- final result correlation;
- Sol control loop.

Crew is one optional executor implementation selected by the user.

A second track may **borrow Crew architectural ideas** (memory/lessons/task checkpoints) without making the product dependent on Crew. That track must remain separate from the executor integration.

## 2. Current repository constraint

Orca's current durable state says Milestone 25 / Change 029 is active and local engineering is otherwise complete; remaining work is host/authorization-bound certification.

Therefore:

- do not insert Crew into Change 029;
- do not change the active milestone;
- do not claim Crew is required for V1 completion;
- do not delay existing certification on Crew work.

When activated, Crew should start as a new post-V1 OpenSpec sequence.

Suggested future changes:

1. `030-kiro-crew-executor-profile-and-probe`
2. `031-kiro-crew-result-correlation-and-recovery`
3. `032-kiro-crew-long-run-qualification`
4. optional `033-durable-lessons-and-memory-admission` for Crew-inspired native ideas.

Names/numbers must be re-based against the actual repository at activation time.

## 3. Why integrate at the executor boundary

Orca already has the correct seam:

- `apps/controller/src/executor/adapters/executor-adapter.ts`;
- `apps/controller/src/executor/profiles.ts`;
- `apps/controller/src/executor/capability-probe-service.ts`;
- `apps/controller/src/executor/executor-service.ts`.

The current profile model supports Kimi, Codex, OpenCode, generic and test harnesses while preserving **user-owned executor/model selection**.

Crew should enter through that seam, not through browser/Sol control, not by writing SQLite directly, and not by taking over Orca's scheduler.

## 4. Hard invariant: exactly one outer orchestrator

A Crew-backed Orca run has one authority hierarchy:

```text
Orca run
  -> Orca dispatch
     -> Orca actor/process lease
        -> one Crew task
           -> Crew internal decomposition/subagents
```

Crew may decompose its one assigned dispatch, but it may not:

- create a second Orca run;
- schedule future Orca dispatches;
- write Sol control decisions;
- own repository leases;
- start a sibling executor for the same repository;
- independently decide GOAL_COMPLETE for Orca.

Crew's cron/webhook scheduler is disabled for executor mode.

## 5. Installation model

### 5.1 Optional external runtime

Do not add Kiro Crew as a Node dependency or package it into the Orca desktop application in the first implementation.

The controller detects an externally installed:

- `kirocrew`;
- `kiro-cli`.

If absent, the Crew executor profile is simply NOT_READY.

### 5.2 Per-repository Crew home

Never let every Orca repository share one Crew memory/state directory.

Derive an isolated home from Orca's data directory and repository identity, for example:

```text
<orca-data>/executors/kirocrew/<repository-id>/
```

Set that path as `KIROCREW_HOME` for the child process.

Benefits:

- no cross-repo memory contamination;
- user-selected model/config can be repository-scoped;
- one-repository actor model matches Crew state ownership;
- cleanup/export can be controlled by Orca.

Do not place Crew home inside the managed Git repository.

### 5.3 Version pinning

Repository configuration should support an expected/qualified Crew major-minor range. Capability probes record the actual Crew and kiro-cli versions.

Do not silently accept a behaviorally incompatible major release.

## 6. Model ownership

Orca's current rule is correct: the user owns executor/model selection.

Crew supports its own `agent.model` configuration and served-model discovery. The adapter must not silently replace the model the user chose.

Required behavior:

1. Orca repository config contains the user-selected Crew executor and model.
2. The Crew wrapper reads the selected model.
3. It validates the model against Crew/kiro-cli advertised availability.
4. If unavailable, preflight fails with a structured NOT_READY/UNAVAILABLE classification.
5. No fallback model is selected without explicit policy.

Do not map Orca's `executorModel` to a hardcoded Kiro model list.

## 7. Phase OR-C0 — Upstream contract spike

Before production code:

1. Pin a Crew release.
2. Verify exact `kirocrew run` invocation and exit semantics.
3. Verify model override/config behavior under isolated `KIROCREW_HOME`.
4. Verify TaskRunner checkpoint/resume behavior.
5. Verify cancellation behavior.
6. Verify whether a stable structured-event/result API is available.
7. Verify concurrent independent homes.
8. Verify WSL and Windows behavior separately.

Produce a short compatibility matrix.

Do not mark Orca rich capabilities READY from upstream documentation alone. A capability becomes READY only after Orca proves it against the pinned release.

## 8. Phase OR-C1 — Executor profile and wrapper

### 8.1 Add a Crew profile

Extend `ExecutorProfileId` with `kirocrew`.

Do not invoke Crew directly from `profiles.ts` with an enormous inline prompt. Add an Orca-owned wrapper, e.g.:

```text
scripts/executors/kirocrew-wrapper.mjs
```

The wrapper receives normal Orca identity through environment variables and creates an ephemeral Crew task file under Orca's runtime data directory.

### 8.2 Generated task contract

The generated task spec should include:

- Orca run ID;
- dispatch ID;
- iteration;
- repository path;
- exact starting SHA;
- expected remote/main;
- user-selected model;
- recovery flag;
- Orca bootstrap instructions;
- path/format of the required Orca executor-result artifact;
- explicit prohibition on creating independent schedules;
- stop conditions;
- final Git requirements.

The task file is runtime data, not a tracked planning artifact.

### 8.3 Invocation

Conceptually:

```text
ORCA -> wrapper -> KIROCREW_HOME=<repo-home> kirocrew run <task-file>
```

The exact CLI must be taken from the pinned Crew release and covered by adapter tests.

### 8.4 No shell interpolation

Preserve the existing invocation safety rule: command and arguments are arrays. No command string construction.

## 9. Phase OR-C2 — Capability probing

Extend `CapabilityProbeService` for the Crew profile.

STATIC probe should establish without inference:

- `kirocrew` installed/version;
- `kiro-cli` installed;
- Crew home writable;
- repository cwd accessible;
- required configuration readable;
- wrapper available;
- Git available;
- supported OS/environment.

DEEP probe may additionally run:

- `kirocrew doctor`;
- model advertisement/resolution without inference if upstream supports it;
- sandbox readiness;
- TaskRunner command-shape check.

Inference remains explicit and user-authorized.

Rich capabilities such as sessionResume, structuredEvents, nativeCancellation, subagents, and usageTelemetry must begin UNKNOWN and become READY only after implementation proves exact semantics.

## 10. Phase OR-C3 — Result correlation

A zero exit from Crew is not an Orca success signal.

Orca success continues to require its existing durable result protocol and exact correlation.

The Crew task must end by producing the same Orca executor result expected from other executors, including:

- run/dispatch/iteration correlation;
- executor identity;
- terminal classification;
- Git/result metadata required by existing validation.

`executorIdentityMatches` should recognize the wrapper/Crew identity narrowly without weakening matching for unrelated executors.

Crew internal task state is supporting evidence only.

## 11. Phase OR-C4 — Cancellation, shutdown, and ownership

Crew-backed runs must satisfy the same Change-028 durability rules as every other executor.

Required tests:

1. controller shutdown while Crew is starting;
2. shutdown after Crew child spawn;
3. kill during Crew TaskRunner step;
4. process-tree cleanup including descendants;
5. crash/restart with persisted Orca process ownership;
6. stale PID/reuse classification;
7. launch retry interruption;
8. no second Crew process for the same repository.

If Crew launches child processes beyond the current adapter's process-tree visibility, the integration is NOT production-ready until Orca can safely terminate or classify them.

## 12. Phase OR-C5 — Recovery and resume

Do not claim Crew session/task resume support until Orca can correlate it durably.

Design an Orca-owned recovery record containing only identifiers needed to reconnect or classify the task.

On controller restart:

1. Orca first resolves its durable actor/process ownership.
2. It determines whether the prior Crew process is live, dead, reused, or unknown.
3. Only after ownership is safe may the Crew adapter attempt supported resume.
4. Resume must continue the same Orca dispatch.
5. If Crew cannot prove same-task identity, Orca falls back to the existing recovery policy rather than guessing.

Crew memory never substitutes for dispatch identity.

## 13. Phase OR-C6 — Parallelism and subagents

Orca's concurrency unit remains the repository.

Different repositories may each have independent Crew homes and Crew tasks.

Inside one Crew task, Crew may use subagents if:

- they stay within the assigned repository/task;
- they do not violate one-writer rules;
- any Git write strategy remains compatible with Orca's executor expectations;
- all child processes remain attributable to the parent task.

Do not map Crew subagents onto Orca's SWARM/DAG strategy initially. Those are separate orchestration abstractions. Combining them before single-agent Crew is qualified would create double orchestration.

## 14. Phase OR-C7 — Usage telemetry

If Crew exposes trustworthy usage telemetry, add it behind the existing executor usage interface.

Requirements:

- source/provider identified;
- units explicit;
- no fabricated cost when unavailable;
- model identity matches the configured/served model;
- missing telemetry is UNKNOWN, not zero.

Do not make usage telemetry a prerequisite for basic Crew execution unless policy requires it.

## 15. Phase OR-C8 — Long-run qualification

Qualification scenario:

- dedicated non-critical dogfood repository;
- one long multi-step goal;
- at least one forced Crew restart/interruption;
- at least one controller restart;
- at least one failed task step requiring bounded retry;
- Git checkpoint(s);
- final exact result correlation;
- no duplicate executor;
- no lost process;
- no ambiguous ownership.

Compare against the same goal run through the current preferred executor.

Metrics:

- wall time;
- model usage;
- interventions;
- resume fidelity;
- duplicate work;
- Git conflicts;
- stale-memory mistakes;
- recovery time;
- final correctness.

## 16. Crew-inspired native architecture track

This is deliberately separate from the Crew executor.

Potential ideas worth borrowing into Orca natively:

- durable lessons;
- cross-session project summaries;
- knowledge retrieval;
- task decomposition/checkpoint objects;
- bounded scheduled jobs.

But Orca should not blindly copy Crew's storage model.

### Proposed lesson-admission pipeline

```text
runtime observation
   -> lesson candidate
   -> deterministic classification/sanitization
   -> reviewable proposal
   -> canonical repository/Orca rule only after acceptance
```

A lesson database must never outrank Git, OpenSpec, runtime state, or current tests.

Start this track only after the Crew executor pilot proves the concept has measurable value.

## 17. Security

Crew/kiro-cli tool access is powerful. Treat its sandbox as defense in depth, not Orca's sole protection.

The adapter must preserve:

- no secrets in tracked files;
- no auth data copied to result artifacts;
- repository-scoped working directory;
- explicit environment construction;
- process ownership records;
- bounded logs;
- user-owned model selection;
- no silent executor/provider fallback.

Crew messaging channels should be disabled for executor mode unless a future design explicitly qualifies them.

## 18. Test strategy

### Unit

- profile resolution;
- invocation construction;
- env isolation;
- model validation;
- result identity matching;
- capability classification;
- error mapping;
- version mismatch;
- missing Crew/kiro-cli;
- home-path confinement.

Use a deterministic fake `kirocrew` executable for most tests.

### Real-process

- wrapper process tree;
- cancellation;
- forced crash;
- controller restart;
- same-dispatch resume;
- no duplicate start;
- result artifact correlation.

### Real inference

Explicit opt-in only. Qualify one harmless dogfood turn before long campaigns.

### Regression

Existing Kimi/Codex/OpenCode/generic executor behavior must remain byte/semantically unchanged unless the OpenSpec says otherwise.

## 19. Rollout

1. NOT_READY profile hidden/disabled by default.
2. Developer-only opt-in.
3. Deterministic wrapper qualification.
4. Real one-turn dogfood.
5. Long-run dogfood.
6. Optional UI exposure after evidence.
7. No default-executor change without a separate product decision.

## 20. Kill criteria

Keep Crew unsupported/experimental if:

- it cannot produce reliable Orca result correlation;
- child processes cannot be owned/killed safely;
- restart cannot prove same-task identity;
- Crew scheduler/task state races Orca scheduling;
- model selection cannot remain user-owned;
- per-repository state isolation is unreliable;
- long-run performance is not better enough to justify the new dependency.

Rollback means selecting another executor. Existing Orca runs, SQLite state, Git protocol, and Sol control must not depend on Crew.

## 21. Expected repository artifacts

When activated, use normal OpenSpec workflow.

Likely implementation surface:

```text
openspec/changes/03x-kiro-crew-.../
apps/controller/src/executor/profiles.ts
apps/controller/src/executor/capability-probe-service.ts
apps/controller/src/executor/executor-service.ts
apps/controller/src/executor/adapters/...
scripts/executors/kirocrew-wrapper.mjs
apps/controller/test/...
docs/KIRO-CREW-OPERATIONS.md
```

Update `.agent/state.json` only when the post-V1 change is actually activated.

## 22. External references

Re-check exact behavior against the pinned upstream release:

- https://github.com/kirodotdev/KiroCrew
- https://kiro.dev/docs/crew/

Current upstream design is KiroACP/kiro-cli-only and provides persistent memory, TaskRunner checkpointing, subagents, schedules, and configurable model/reasoning settings. Treat all exact CLI/config semantics as versioned external contracts.

## 23. Final recommendation

Of the three projects, Orca has the strongest **architectural** fit for Crew, but also the highest overlap risk. The right experiment is a clean optional executor backend with Orca remaining the outer authority. If that works, selectively borrow the best persistence/lesson ideas into Orca itself. If it does not, remove the executor profile with no effect on Orca's core architecture.
