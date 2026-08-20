# Recommended Direction

Status: **EXPLORATORY / NOT APPROVED**

## Executive recommendation

Use OpenFlow as a **reference for future executor/runtime capabilities**, not as a new product blueprint for Orca-Strator.

Orca's differentiator should remain the persistent autonomous repository lifecycle:

```text
Goal
 -> Sol architect/reviewer
 -> durable Git dispatch/spec state
 -> executor
 -> structured result + Git
 -> Sol review
 -> repeat until terminal goal state
```

A swarm, DAG, or external workflow engine should eventually be an implementation choice **inside one Orca iteration**, never the outer lifecycle itself.

## Recommended long-term architecture

```text
                         ORCA-STRATOR
                              |
                    Autonomous Campaign
                              |
               +--------------+--------------+
               |                             |
          Control Plane                  Scheduler
               |                             |
        +------+------+             +--------+--------+
        |             |             |                 |
       Sol        Durable Git     budgets          providers
    Architect        State        limits           resources
        |
        v
     ITERATION
        |
        v
 Executor Strategy
        |
 +------+------+------------------+
 |      |              |          |
 v      v              v          v
Single Swarm        DAG Flow   External Engine
Agent  Agents                    Adapter
 |      |              |          |
 +------+------+-------+----------+
               |
               v
        Structured Result
               |
               v
              Git
               |
               v
              Sol
               |
             repeat
```

## What should remain invariant

The following Orca principles should survive future evolution:

1. **Repository/goal lifecycle is the top-level abstraction.**
2. **Git/GitHub remains durable cross-agent truth.**
3. **SQLite/local runtime state remains machine-local orchestration truth.**
4. **Executor/model choice remains user-controlled and adapter-driven.**
5. **The system must survive fresh sessions, crashes, restarts, and partial failures.**
6. **A completed executor run is not equivalent to GOAL_COMPLETE.**
7. **Sol/reviewer retains the outer-loop decision boundary unless a later design deliberately changes it.**
8. **One repository's failure must not corrupt unrelated repository campaigns.**
9. **No silent destructive Git behavior.**
10. **Observability and correlation remain first-class rather than inferred from UI text.**

## Recommended changes

### Tier 1 — adopt conceptually after V1 qualification

These are the favorites because they improve Orca without expanding the core orchestration model.

#### 1. Executor Capability Probe

Make readiness explicit before autonomous execution:

- installed/version;
- auth usable;
- model reachable;
- headless invocation works;
- working directory and Git access work;
- rich capabilities advertised when available.

Why first: it prevents campaigns from starting with a broken executor configuration.

#### 2. Campaign Run Ledger / Execution Trace

Create a durable campaign/iteration history with timings, correlations, retries, permission decisions, executor/model identity, result references, and failure boundaries.

Why first: long-running autonomy without reconstructable history becomes impossible to debug.

#### 3. Explicit Autonomy Permission Policy

Define what unattended agents may do, what requires attention, and what is denied. Record every automated permission decision.

Why first: unattended execution needs a policy plane, not only a process launcher.

#### 4. Phase-Specific Budgets

Separate campaign ceilings from Sol, startup, executor, Git, postflight, and wake budgets.

Why first: a stalled subsystem should be diagnosable and recoverable without waiting for the broadest ceiling.

#### 5. Capability-Based Executor Adapter Interface

Keep `GenericCLIAdapter`, but let richer executors expose structured events, session resume, native permissions, usage telemetry, subagents, cancellation, and model selection.

Why first: this prevents future features from becoming executor-specific conditionals throughout the control plane.

### Tier 2 — prepare foundations for richer execution

#### 6. Bounded Scheduler

Introduce global, per-repository, per-provider, and optionally budget-aware concurrency controls before enabling swarm/DAG fan-out.

#### 7. Role/Model Routing

Allow expensive models only where they are valuable and cheaper models for bulk work. Routing should be explicit, observable, and policy-driven.

#### 8. Typed Artifact Handoffs

Use Git commits, manifests, test results, file references, and structured result envelopes instead of blindly injecting large upstream prose into downstream prompts.

### Tier 3 — optional multi-agent execution

Only after the above exists:

- same-iteration subagents;
- dependency graph execution;
- partial failure semantics;
- integration/reconciliation phase;
- execution topology telemetry;
- reusable workflow presets.

## What NOT to copy

### 1. Do not make DAG authoring the primary Orca experience

OpenFlow's product centers on composing a graph. Orca should continue to center on a high-level repository goal.

Bad direction:

```text
User must design agent graph before Orca can do useful work.
```

Preferred direction:

```text
User supplies goal.
Orca chooses or applies an execution strategy.
Advanced users may override it later.
```

### 2. Do not bind Orca to OpenCode

OpenCode may be a valuable rich adapter, but Orca should continue to support Kimi, Codex, generic CLIs, and future engines.

Do not fork OpenCode as the foundation of Orca.

### 3. Do not replace repository truth with prompt chaining

Passing entire agent outputs directly into later agents is easy but expensive, ephemeral, and fragile.

Prefer:

```text
agent -> files/commit/manifest -> repository -> next agent
```

not:

```text
agent -> huge prose transcript -> next agent
```

### 4. Do not add unrestricted same-repository parallel writers

Multi-agent fan-out can produce:

- conflicting edits;
- Git races;
- ambiguous ownership;
- integration failures;
- duplicate work;
- token waste;
- provider rate limiting.

Any future same-repository parallelism needs an isolation and reconciliation design first: worktrees, branches, patch queues, explicit file ownership, or another deliberate mechanism.

### 5. Do not treat workflow completion as goal completion

A DAG finishing successfully means only that the current execution strategy completed.

It does not mean the high-level objective is satisfied.

The result must return to the Orca/Sol outer loop for review and next-step/terminal-state determination.

### 6. Do not introduce dynamic model routing without observability

Automatic routing is attractive but can become opaque. Any router should record:

- selected provider/model;
- reason/policy match;
- fallback path;
- cost/usage when known;
- failure/retry information.

### 7. Do not build the visual canvas before the runtime semantics

Visualization should reflect a real execution model. Building graph UI first risks committing Orca to accidental semantics based on presentation rather than correctness.

### 8. Do not copy implementation code casually

Concepts may inspire independent implementation. Reusing source code requires explicit license/provenance review.

## Product positioning this enables

A useful conceptual distinction is:

```text
OpenFlow-like systems
    = intra-run orchestration

Orca-Strator
    = persistent autonomous development lifecycle
```

Long term, Orca can subsume or invoke multiple intra-run strategies while continuing to own the campaign lifecycle above them.

That gives Orca a broader role:

```text
Repository + Goal
      |
      v
     Orca
      |
      +-> single Kimi/Codex/OpenCode agent
      +-> executor-native swarm
      +-> Orca-managed DAG
      +-> external workflow engine
      |
      v
structured durable result
      |
      v
Sol review / next iteration
```

## Recommended decision today

**Preserve these ideas, but do not implement them yet.**

The only near-term action recommended by this branch is documentation preservation. Finish current V1 real-runtime qualification first. After that, open a fresh focused design/OpenSpec for the Tier 1 foundation set rather than implementing directly from this exploration branch.