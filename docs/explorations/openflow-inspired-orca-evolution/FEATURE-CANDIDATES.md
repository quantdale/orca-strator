# Feature Candidates

Status: **EXPLORATORY / NOT APPROVED**

This document maps useful OpenFlow ideas into Orca-native concepts. The goal is to capture the value without importing OpenFlow's product assumptions wholesale.

## Priority summary

| Priority | Candidate | Orca-native interpretation | Recommendation |
| --- | --- | --- | --- |
| P0 | Model/provider preflight | Executor Capability Probe | Strongly recommend after V1 qualification |
| P0 | Structured run logs | Campaign Run Ledger / Execution Trace | Strongly recommend after V1 qualification |
| P0 | Permission handling | Explicit Autonomy Permission Policy | Strongly recommend after V1 qualification |
| P0 | Node timeouts | Phase-specific execution budgets | Strongly recommend after V1 qualification |
| P0/P1 | Rich engine integration | Capability-based Executor Adapter interface | Strongly recommend as foundation |
| P1 | Bounded parallelism | Global/per-repo concurrency scheduler | Recommend before any swarm/DAG mode |
| P1 | Per-node model selection | Role/model routing + cost-aware scheduling | Recommend after adapter/capability foundation |
| P1 | Failure propagation | Partial-work failure isolation | Recommend with multi-agent execution |
| P1 | Output piping | Typed artifact handoffs | Recommend, but prefer repository/artifact truth over prose piping |
| P2 | Parallel DAG execution | Optional intra-iteration workflow strategy | Useful later, not core Orca abstraction |
| P2 | Live graph/node state | Execution topology telemetry | Recommend when multi-agent execution exists |
| P2 | Visual workflow composer | Advanced optional workflow UI | Defer significantly |
| P2 | OpenCode server integration | Native OpenCode adapter | Useful optional adapter, never mandatory |

---

## 1. Executor Capability Probe

### OpenFlow inspiration

OpenFlow distinguishes several failure classes before or during execution: provider credential availability, whether a runner supports the provider API shape, whether the model is actually available, and whether a real probe request succeeds.

### Orca-native version

Add a first-class executor readiness/capability probe for each configured executor profile.

Possible capability/readiness fields:

```text
CLI installed                 yes/no
CLI version                   value
Authentication usable         yes/no/unknown
Configured model recognized   yes/no
Real inference probe          pass/fail/not-run
Headless invocation           pass/fail
Working directory access      pass/fail
Git access                    pass/fail
Push access                   pass/fail
Windows/WSL environment       pass/fail
Structured event support      yes/no
Resume support                yes/no
Subagent support              yes/no
Cancellation support          yes/no
Token/usage telemetry         yes/no
Permission API support        yes/no
Last successful probe         timestamp
```

### Why it matters

Orca is intended to run unattended. Detecting a broken executor, stale auth, invalid model, wrong CLI invocation, or unusable environment before a campaign starts prevents avoidable autonomous-run failures.

### Recommendation

**High-confidence favorite.** Implement before sophisticated multi-agent work.

---

## 2. Campaign Run Ledger / Execution Trace

### OpenFlow inspiration

OpenFlow records run-level prompts, outputs, timings, node states, and decisions.

### Orca-native version

Orca should have a durable campaign/iteration trace that can explain what happened over hours or days.

Suggested hierarchy:

```text
Campaign / goal
  Iteration
    Sol phase
    Dispatch detection
    Executor launch
    Executor execution
    Git reconciliation
    Result publication
    Sol wake
    Sol review
    Terminal/retry/recovery transition
```

Record at least:

- timestamps and durations;
- repository/run/iteration/dispatch/result correlation IDs;
- executor/model/environment;
- process exit information;
- files/commits/result-manifest references where available;
- tests and validation summaries;
- permission decisions;
- retries/recoveries;
- ceiling/timeout events;
- failures and classified root boundary;
- token/cost telemetry when a provider exposes it without brittle scraping.

### Why it matters

A persistent orchestrator needs postmortem observability more than a one-shot workflow engine does. Without a run ledger, failures become difficult to reconstruct after the fact.

### Recommendation

**High-confidence favorite.** Prefer structured durable records and summarized UI views over raw-log-only observability.

---

## 3. Explicit Autonomy Permission Policy

### OpenFlow inspiration

OpenFlow can automatically answer permission prompts for owned sessions or surface them to the user, and records those decisions.

### Orca-native version

Generalize this into an executor-neutral autonomy policy layer.

Possible action classes:

```text
filesystem inside repository
filesystem outside repository
read .env/secrets
network access
git commit
git push
git force-push
branch creation/deletion
package dependency installation
system package installation
shell command classes
GitHub issue/PR operations
external service writes
```

Possible outcomes:

```text
ALLOW
ALLOW_ONCE
ASK
DENY
```

Possible presets:

- Conservative
- Balanced
- Unattended/YOLO
- Custom

Every automatic decision should be auditable and linked to the executor/run/iteration that triggered it.

### Important boundary

Do not simulate permission control for executors that cannot actually enforce it. Capability detection must distinguish native enforcement from policy that can only be advisory.

### Recommendation

**High-confidence favorite.** Useful even before multi-agent execution.

---

## 4. Phase-Specific Execution Budgets

### OpenFlow inspiration

OpenFlow supports per-node timeouts so one stalled node cannot indefinitely block downstream work.

### Orca-native version

Keep Orca's campaign wall-clock/iteration ceilings, but add subordinate budgets for runtime phases.

Example:

```text
Campaign wall-clock ceiling
Sol turn timeout
Dispatch acquisition timeout
Executor startup timeout
Executor operation timeout
Git reconciliation timeout
Result publication/postflight timeout
Sol wake timeout
Sol completion timeout
```

Each expiration should produce a distinct, observable failure reason rather than collapsing into a generic wall-clock ceiling.

### Recommendation

**High-confidence favorite.** It improves diagnosis and recovery without changing Orca's product model.

---

## 5. Capability-Based Executor Adapter Interface

### OpenFlow inspiration

OpenFlow benefits from talking to a structured OpenCode server instead of treating the engine as undifferentiated terminal text.

### Orca-native version

Preserve the generic CLI execution path, but allow richer adapters to advertise optional capabilities.

Conceptually:

```text
ExecutorAdapter
  GenericCLIAdapter
  KimiAdapter
  CodexAdapter
  OpenCodeAdapter
  FutureAdapter
```

Capability examples:

```text
supportsStructuredEvents
supportsSessionResume
supportsSubagents
supportsNativeModelSelection
supportsToolPermissions
supportsUsageMetrics
supportsCancellation
supportsNativeStatus
supportsSessionHistory
```

Orca should branch on capabilities, not executor brand names scattered across orchestration code.

### Recommendation

**Architectural favorite.** This is the preferred foundation for future richer execution strategies while protecting executor neutrality.

---

## 6. Bounded Parallelism / Scheduler

### OpenFlow inspiration

OpenFlow limits how many graph nodes may run concurrently because wide fan-out can cause provider rate limits and unexpectedly high cost.

### Orca-native version

If Orca later supports subagents or DAG strategies, introduce explicit scheduling before enabling broad concurrency.

Potential limits:

```text
Global active inference sessions
Per-repository active subagents
Per-provider concurrency
Per-model concurrency
Per-machine CPU/memory budget
Per-campaign spend/token budget
```

Potential operating modes:

- Cheap
- Balanced
- Maximum performance
- Custom budget

### Recommendation

**Required prerequisite for multi-agent execution.** Do not add swarm/DAG fan-out first and scheduling later.

---

## 7. Role/Model Routing

### OpenFlow inspiration

Individual nodes can use different agents/models.

### Orca-native version

Allow an execution strategy to route different work classes to different models/providers.

Examples:

```text
architecture/review -> strongest reasoning model
bulk edits          -> economical coding model
tests               -> cheap/reliable executor
difficult debugging -> frontier model
documentation       -> inexpensive general model
```

Eventually routing could consider:

- task difficulty;
- remaining campaign budget;
- model availability;
- provider rate limits;
- historical reliability;
- latency;
- context-window requirement.

### Recommendation

**Strong later feature.** Do not let dynamic routing make V1 executor selection unpredictable; add only after clear policy and telemetry exist.

---

## 8. Partial-Work Failure Isolation

### OpenFlow inspiration

A failed DAG node prevents dependent nodes from running while independent siblings may still finish.

### Orca-native version

For a future multi-agent executor strategy, represent partial outcomes explicitly rather than reducing the entire iteration to an undifferentiated failure.

Example:

```text
frontend     completed
backend      failed
docs         completed
migration    skipped (depends on backend)
integration  skipped (dependency incomplete)
```

The resulting structured manifest should let Sol decide whether to retry, repair only the failed branch, integrate successful work, or abandon/replan.

### Recommendation

**Required with DAG/swarm execution.** Not needed for current single-executor V1.

---

## 9. Typed Artifact Handoffs

### OpenFlow inspiration

OpenFlow serializes upstream outputs into downstream prompts.

### Orca-native improvement

Prefer typed, durable artifacts over large prose transfers.

Example result envelope:

```json
{
  "task": "implement-auth",
  "status": "completed",
  "commit": "...",
  "filesChanged": [],
  "tests": {},
  "artifacts": [],
  "findings": [],
  "risks": []
}
```

Prefer the repository, Git commits, structured manifests, and versioned artifacts as the shared memory plane. Agent prose should be supplementary, not authoritative.

### Recommendation

**Strongly recommend the principle.** It fits Orca's existing Git-as-truth philosophy and reduces context duplication.

---

## 10. Optional Intra-Iteration DAG/Swarm Strategy

### OpenFlow inspiration

OpenFlow's core engine topologically layers a DAG and dispatches nodes in parallel where dependencies permit.

### Orca-native version

A future Orca iteration could choose among execution strategies:

```text
Single Agent
Swarm
DAG Workflow
External Engine
```

The governing hierarchy must remain:

```text
Orca campaign
  -> Orca iteration
    -> execution strategy
      -> one or many executor sessions
    -> structured result
  -> Sol review
  -> next iteration or terminal goal state
```

### Recommendation

**Interesting but defer.** This is the main idea most likely to cause architecture and scope creep if introduced before the foundations above are mature.

---

## 11. Execution Topology Telemetry

### OpenFlow inspiration

OpenFlow presents live node/session state on a graph.

### Orca-native version

Visualize the topology Orca is actually running rather than making users infer it from logs.

Single-agent example:

```text
Sol review -> dispatch -> executor -> result -> Sol wake
```

Future multi-agent example:

```text
                 dispatch
             /      |      \
        frontend  backend  tests
             \      |      /
                integration
                    |
                  result
```

Possible node states:

- queued;
- starting;
- running;
- waiting permission;
- waiting dependency;
- completed;
- failed;
- skipped;
- cancelled;
- retrying.

### Recommendation

**Good UX feature once the underlying execution topology becomes richer.** Avoid building the visualization before the runtime semantics exist.

---

## 12. Optional Workflow Composer

### OpenFlow inspiration

Users visually compose reusable role pipelines.

### Orca-native version

Much later, advanced users could define reusable executor strategies such as:

```text
Feature Development
Bug Hunt
Deep Audit
Migration
Release Hardening
```

Possible storage:

```text
.orca/workflows/<name>.json
```

### Recommendation

**Low priority.** The default Orca UX should remain goal-oriented rather than graph-authoring-oriented.

---

## 13. Native OpenCode Adapter

### OpenFlow inspiration

OpenFlow obtains structured control by driving `opencode serve` and consuming its session/event APIs.

### Orca-native version

Treat OpenCode as one optional rich executor backend. A native adapter could expose better structured status, cancellation, model selection, sessions, events, and permissions than generic CLI parsing.

### Recommendation

**Useful, optional integration.** Never make Orca an OpenCode fork or require OpenCode for core orchestration.

---

# Favorites

The strongest candidates are:

1. **Executor Capability Probe**
2. **Campaign Run Ledger / Execution Trace**
3. **Explicit Autonomy Permission Policy**
4. **Phase-Specific Execution Budgets**
5. **Capability-Based Executor Adapter Interface**

These five improve reliability, observability, safety, and extensibility without changing Orca's central product model.

The strongest later-stage candidates are:

6. **Bounded Parallelism / Scheduler**
7. **Role/Model Routing**
8. **Typed Artifact Handoffs**
9. **Partial-Work Failure Isolation**
10. **Optional intra-iteration DAG/swarm strategy**

The visual workflow composer should come much later, if at all.