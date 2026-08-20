# Design: Execution topology observability UI and strategy presets

## Context

The controller already returns `CampaignDetail` with the normalized campaign
timeline, strategy-run records, typed reports/results, DAG node records, and
usage summary. The UI already fetches the latest campaign in
`OperationalIntelligencePanel`. Change 016 should compose these existing read
models instead of adding a second graph database or asking the browser to
reconstruct raw logs.

## Decisions

### 1. Read-model-only topology

`ExecutionTopologyPanel` accepts one `CampaignDetail` and derives a compact
view model. It renders a fixed single-agent sequence when no explicit strategy
run exists. For SWARM it renders the actual packet IDs/results and integration
report. For DAG it renders the durable node IDs, statuses, and `dependsOn`
edges, followed by integration. Missing active data is shown as `QUEUED`,
`UNKNOWN`, or `NOT_RECORDED`; the component never invents completion.

The API remains the source of truth. Live events may cause the existing panel
refresh path to update later, but topology rendering does not scrape logs or
infer hidden worker activity.

### 2. Responsive topology cards, not a graph editor

The visual is a responsive sequence of cards with arrows and dependency chips.
At narrow widths cards wrap into a vertical readable flow. At wider widths
independent workers appear in a bounded grid and dependency labels remain
textual. This makes actual topology legible without adding canvas interaction,
manual node placement, or graph authoring controls.

Each card may show status, duration, executor/model, environment, usage/cost
summary, permission wait, retry count, failure/blocker, worktree/commit, and
dependency information when the durable record supplies it.

### 3. Presets are explicit policy catalog data

The shared package provides a static versioned `EXECUTION_STRATEGY_PRESETS`
catalog for Feature Development, Deep Audit, Bug Hunt, Migration, and Release
Hardening. A preset describes recommended strategy, boundedness, and whether
typed packets/nodes are required. It does not start a campaign, decompose a
goal, select a model, or create a graph. The UI labels it as a reusable policy
reference and keeps repository + goal / `SINGLE_AGENT` as the default path.

### 4. Truthful failure and usage presentation

Status badges use the typed status strings from shared contracts. Unknown or
missing usage displays `UNKNOWN`; exact and estimated cost remain distinct.
Partial, blocked, skipped, cancelled, and integration-conflict outcomes remain
visible instead of collapsing into one failed graph. A strategy result never
gets a goal-complete label from the UI.

## Rejected alternatives

- A React Flow/canvas editor would turn observability into a workflow composer
  and broaden the user experience beyond the approved campaign model.
- Reconstructing topology from raw executor logs would violate structured
  durable truth and be fragile across adapters.
- Automatically applying a preset to a run would silently change execution
  strategy/model or create packets without explicit user authorship.
