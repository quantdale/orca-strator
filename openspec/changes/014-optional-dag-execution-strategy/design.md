# Design: Optional DAG execution strategy

## Context

The production architecture already has:

- durable campaign/run and Sol-owned outer-loop state;
- typed `WorkPacket` and `WorkPacketResult` envelopes;
- persisted temporary Git worktrees and internal branches;
- deterministic integration/reconciliation;
- capability-aware executor adapters and `ExecutorRunner`;
- explicit scheduler admission and executor-neutral permission policy;
- durable strategy controls and campaign-ledger events from Change 013.

The DAG change must deepen those seams instead of adding a second worker
runtime or moving orchestration into the UI.

## Decisions

### 1. Explicit packet-linked DAG definition

The API accepts a bounded list of user-authored node IDs, packet IDs, and node
dependencies. Node IDs are stable within one strategy run. The service rejects
unknown dependencies, duplicate IDs/packets, packet/run mismatch, dependency
mismatch between the explicit DAG and the packet envelope, and cycles before
creating any worktree or launching any executor.

The packet remains the source of work instructions, allowed paths, executor/model
policy, permission policy, and budget. The DAG node adds dependency identity and
durable node lifecycle; it does not become a prose prompt chain.

### 2. Reuse the Change 013 execution engine

The current isolated worker engine gains a narrow strategy hook so it can run a
validated DAG packet set as `DAG` while retaining the same scheduler admission,
worktree allocation, adapter invocation, watchdog, result validation, controls,
integration, and recovery behavior. DAG-specific orchestration owns node
records and observes the shared strategy events; it does not duplicate process
supervision.

The engine continues to schedule only dependency-ready packets. A node with a
failed, blocked, cancelled, or skipped dependency becomes `SKIPPED` with a
structured reason. Independent siblings can complete and be integrated.

### 3. Durable node state

`execution_dag_nodes` stores the explicit node-to-packet mapping, dependency
IDs, packet budget snapshot, attempt count, lifecycle state, waiting reason,
timestamps, and result reference. Strategy-run persistence remains the common
campaign correlation point. Migration 020 expands the strategy discriminator to
include `DAG`; migration 021 adds node state.

Node states are queryable and map shared worker events to:

`QUEUED`, `STARTING`, `RUNNING`, `WAITING_DEPENDENCY`,
`WAITING_PERMISSION`, `RETRYING`, `COMPLETED`, `FAILED`, `BLOCKED`, `SKIPPED`,
`CANCELLED`, and `INTEGRATING`.

The first implementation uses each packet's persisted effective budget as the
node budget. It records packet retry ceilings without inventing retries or
usage; a future focused change may add explicit node retry execution.

### 4. Controls and recovery

DAG controls use the existing durable strategy control records. PAUSE stops new
node admission and asks active adapters to pause where supported. STOP cancels
queued/dependency-waiting nodes and lets active work drain. KILL terminates
active workers and leaves their worktrees recovery-required. Restart recovery
uses the same orphan strategy/worktree reconciliation as swarm and marks active
nodes `BLOCKED` with `RECOVERY_REQUIRED` evidence.

### 5. Structured API, no graph editor

REST exposes DAG list/start/detail/control/recover routes. Detail returns the
node records, typed packets/results, controls, integration report, and strategy
report. The existing UI may consume this read model later; Change 014 does not
add graph authoring or make DAG the default user experience.

## Rejected alternatives

- A second DAG-specific child-process runner would duplicate Change 013 safety
  behavior and create divergent timeout/control semantics.
- Inferring dependencies from prose or prior transcripts would not be durable
  or deterministic.
- A visual composer would broaden the product beyond the approved campaign and
  obscure the structured packet contract.
- Automatically decomposing a goal into a DAG would spend model quota and
  violate explicit user-authored strategy policy.
