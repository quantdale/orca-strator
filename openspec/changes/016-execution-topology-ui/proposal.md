# Change 016: Execution topology observability UI and strategy presets

## Why

Changes 010–015 now produce durable single-agent, swarm, and DAG evidence, but
the UI still presents most of that evidence as a linear trace. Users need to
see the actual execution topology that occurred—especially isolated packets,
dependencies, permission waits, failures, integration, and usage—without
turning Orca into a graph-authoring product.

## Scope

- add a responsive execution-topology read model component to the existing
  repository campaign detail surface;
- render the real single-agent Sol -> dispatch -> executor -> result -> Sol
  sequence;
- render actual SWARM packets and DAG nodes/dependencies from durable campaign
  detail records, including scheduler/permission/retry/failure/cancellation/
  integration state, duration, executor/model, and usage summaries where
  available;
- add a small shared catalog of reusable strategy-policy presets as explicit
  reference/configuration data, preserving `SINGLE_AGENT` as the default and
  requiring explicit packet/node authoring for SWARM/DAG;
- add responsive, deterministic UI tests and reconcile UI/API/architecture,
  runtime, and test documentation.

## Explicit non-goals

- no visual workflow/DAG composer, drag/drop editor, or graph import format;
- no automatic decomposition, packet creation, model routing, or quota spend;
- no change to campaign/Sol/Git completion authority;
- no global executor cap or same-checkout writer behavior;
- no new topology truth in the browser—the API campaign detail and durable
  strategy/packet/result records remain authoritative.

## Exit evidence

The repository detail UI must show truthful single-agent and strategy topology
states at desktop and narrow phone widths, distinguish unknown data from
success, expose real packet/node dependency and integration evidence, and make
the preset catalog visibly non-authoring. UI tests, build, typecheck, lint,
focused API/read-model tests, and final repository gates must pass.
