# OpenFlow-Inspired Orca Evolution Exploration

Status: **NON-BINDING / EXPLORATORY**  
Date captured: **2026-08-20**  
Branch: `exploration/openflow-inspired-orca-evolution`

## Purpose

This directory preserves ideas prompted by reviewing OpenFlow and considering which concepts could strengthen Orca-Strator without changing Orca's core product model.

This is intentionally a **documentation-only design branch**. Nothing in this directory authorizes implementation, changes V1 requirements, changes current runtime behavior, or supersedes the canonical roadmap/specs on `main`.

## Core conclusion

OpenFlow and Orca operate at different orchestration layers.

- **OpenFlow** is primarily an intra-run multi-agent workflow/DAG system on top of OpenCode.
- **Orca-Strator** is a persistent autonomous repository-development control loop: Sol architects/reviews, an executor implements, Git carries durable cross-agent truth, Orca reconciles runtime state, and the loop continues until a terminal goal state.

The recommended direction is therefore **not to turn Orca into OpenFlow**. Instead, selected OpenFlow concepts should inform a future executor/runtime subsystem beneath Orca's persistent campaign loop.

Conceptually:

```text
High-level goal
      |
      v
Persistent Orca campaign loop
      |
      v
One Orca iteration
      |
      v
Executor strategy
  |       |       |        |
Single   Swarm   DAG    External engine
Agent   Agents  Workflow   adapter
  \       |       |        /
      Structured result
             |
             v
            Git
             |
             v
            Sol
             |
            repeat
```

The persistent Orca loop remains the top-level abstraction. A DAG, swarm, or external workflow engine may eventually become one **execution strategy for a single iteration**, not the product's governing state machine.

## Source/reference

The ideas were prompted by reviewing:

- OpenFlow repository: `SeeRay11/OpenFlow`
- OpenFlow's `packages/flow` implementation and documentation
- OpenFlow concepts including per-node sessions, bounded parallelism, model/provider probing, run logs, permission handling, timeouts, DAG failure propagation, and visual execution state

This exploration is conceptual. If any source code is ever reused rather than independently implemented, perform an explicit license/provenance review first.

## Documents

- [`FEATURE-CANDIDATES.md`](FEATURE-CANDIDATES.md) — candidate features, Orca-native interpretation, value, risks, and priority.
- [`RECOMMENDED-DIRECTION.md`](RECOMMENDED-DIRECTION.md) — recommended architecture, favorites, explicit non-goals, and what not to copy.
- [`POST-V1-SEQUENCING.md`](POST-V1-SEQUENCING.md) — suggested implementation order only after current V1 qualification is honestly complete.

## Guardrails

1. **Do not implement these ideas during Change 009 solely because this branch exists.**
2. **Do not weaken executor neutrality.** OpenCode may become one rich adapter, not the mandatory runtime.
3. **Do not replace Git/GitHub as durable cross-agent truth with ephemeral agent-to-agent chat output.**
4. **Do not make a visual DAG the default Orca UX.** The default mental model should remain: give Orca a repository and goal; Orca manages the campaign.
5. **Do not introduce same-repository parallel writes without an explicit isolation/merge design.**
6. **Do not conflate an executor workflow's completion with the campaign goal being complete.** Sol/Orca must retain that decision boundary.
7. **Do not let exploration docs silently become normative specs.** A future decision requires a focused OpenSpec/change on the canonical development branch.

## Decision state

No feature in this directory is approved for implementation yet.

The current recommendation is to finish real V1 qualification first, then consider a small set of low-risk foundation features before any multi-agent/DAG work.