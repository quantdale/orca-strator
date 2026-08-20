# Post-V1 Sequencing Proposal

Status: **EXPLORATORY / NOT APPROVED**

This is not a roadmap replacement. It is a suggested sequence for evaluating OpenFlow-inspired capabilities **after Orca V1 is honestly qualified**.

## Gate 0 — finish current V1 qualification

Do not start this work merely because this branch exists.

Required precondition:

- current runtime-integration hardening is complete;
- real external boundaries are qualified or explicitly accepted with truthful status;
- no unresolved Critical/High correctness issue is being hidden by new feature work;
- canonical `main` documentation reflects the true qualification state.

Only then should these ideas move from exploration into a focused OpenSpec.

---

## Phase A — reliability and observability foundations

### A1. Executor Capability Probe

Goal: prove an executor profile can actually run before a campaign relies on it.

Exit evidence should include:

- CLI/version detection;
- auth/model reachability where safely probeable;
- headless launch validation;
- Windows/WSL environment validation;
- Git working/push capability validation;
- capability flags persisted/exposed;
- failures are classified, not flattened into generic executor failure.

### A2. Campaign Run Ledger

Goal: make a multi-iteration campaign reconstructable after the fact.

Exit evidence should include:

- durable run/iteration/phase records;
- timing and correlation IDs;
- executor/model/environment identity;
- retry/recovery/ceiling transitions;
- links/references to dispatch/result/commits;
- redacted event/log handling;
- UI/API can summarize one campaign without parsing raw logs.

### A3. Phase-Specific Budgets

Goal: isolate stalled boundaries precisely.

Exit evidence should include distinct timeout reasons and deterministic tests for executor startup, executor operation, Git/postflight, Sol wake, and Sol completion.

### A4. Explicit Autonomy Permission Policy

Goal: make unattended actions deliberate and auditable.

Exit evidence should include:

- policy model and presets;
- capability distinction between enforceable and advisory policy;
- audit records;
- ATTENTION/NEEDS_HUMAN behavior for asks;
- no accidental silent approval of destructive operations.

---

## Phase B — executor abstraction cleanup

### B1. Capability-Based Executor Adapter Interface

Goal: let Orca use richer engine APIs without sacrificing generic CLI support.

Potential adapters:

```text
GenericCLIAdapter
KimiAdapter
CodexAdapter
OpenCodeAdapter
```

The interface should expose capabilities rather than encouraging orchestration code to switch on executor names.

Exit evidence should include:

- generic CLI behavior remains supported;
- current Kimi/Codex paths do not regress;
- optional structured events/cancellation/session support can be consumed when available;
- unsupported capabilities degrade predictably.

### B2. Optional native OpenCode adapter

Goal: evaluate whether `opencode serve` gives materially better structured control than generic process supervision.

This should be a plug-in execution backend, not a dependency of Orca core.

---

## Phase C — scheduling and economics

Do this before same-repository fan-out.

### C1. Bounded scheduler

Introduce:

- global concurrency;
- per-repository concurrency;
- provider/model concurrency;
- optional token/spend/resource budgets.

### C2. Usage telemetry

Where reliably exposed, record:

- tokens;
- provider/model;
- latency;
- retries/rate limits;
- approximate or exact cost.

Do not fabricate usage metrics for executors that do not expose them.

### C3. Role/model routing

Start with explicit policies, not an opaque adaptive router.

Example:

```text
bulk implementation -> economical coding model
hard debugging       -> stronger reasoning model
review               -> strongest reviewer model
```

Exit evidence should show routing decisions are visible and reproducible.

---

## Phase D — structured intra-iteration work

### D1. Typed work packets and result envelopes

Define structured task/result contracts suitable for one-to-many execution.

Prefer Git/artifacts/manifests as durable shared memory.

### D2. Isolation strategy for parallel writers

This is a hard prerequisite.

Evaluate explicitly:

- Git worktrees;
- temporary branches;
- patch-based isolation;
- file/workstream ownership;
- integration agent/phase;
- conflict semantics.

No production same-repository parallelism until this contract exists and is tested.

### D3. Partial failure semantics

Represent completed, failed, skipped, cancelled, and dependency-blocked work separately.

Sol should receive a structured partial result and choose the next campaign action.

---

## Phase E — optional swarm/DAG execution strategy

Only now consider a graph engine.

Core requirements:

- DAG validation and cycle rejection;
- explicit dependencies;
- bounded concurrency;
- deterministic state transitions;
- cancellation;
- phase/node timeouts;
- partial failure handling;
- integration/reconciliation;
- structured result publication;
- restart/recovery semantics;
- campaign correlation;
- no ambiguity between workflow-complete and GOAL_COMPLETE.

Recommended product shape:

```text
Execution strategy:
  Single Agent       [default]
  Swarm              [advanced]
  DAG Workflow       [advanced]
  External Engine    [advanced]
```

Single-agent execution should remain the simple, reliable baseline.

---

## Phase F — UI only after semantics are stable

### F1. Execution topology view

Show the real running topology and states.

### F2. Reusable workflow presets

Examples:

- Feature Development
- Deep Audit
- Bug Hunt
- Migration
- Release Hardening

### F3. Optional visual composer

Only build a graph authoring canvas if users genuinely benefit after preset and policy-based execution exists.

A canvas should be an advanced authoring surface, not a prerequisite to using Orca.

---

# Recommended first post-V1 package

If only one follow-up OpenSpec is created after V1, the recommended scope is:

1. Executor Capability Probe
2. Campaign Run Ledger
3. Phase-Specific Budgets
4. Explicit Autonomy Permission Policy
5. Capability-Based Executor Adapter interface

Do **not** include swarm/DAG execution in that same change.

This package gives Orca a stronger foundation while keeping blast radius controlled.

# Explicit deferred items

Defer until the foundation proves itself:

- unrestricted same-repo subagents;
- visual DAG composer;
- adaptive automatic model router;
- branch-per-agent orchestration;
- OpenFlow compatibility/import;
- arbitrary plugin marketplace for workflow nodes;
- remote collaborative graph editing.

# Re-evaluation trigger

Before promoting any item from this branch into canonical roadmap/specs, perform a fresh review of:

- Orca's actual post-V1 pain points;
- executor ecosystem capabilities at that time;
- Kimi/Codex/OpenCode APIs and stability;
- provider economics/rate limits;
- real campaign traces showing where orchestration fails or wastes resources.

Prefer solving observed Orca problems over copying attractive features because another orchestrator has them.