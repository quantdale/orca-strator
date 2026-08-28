# Durable Execution Ownership Specification

## Purpose

Guarantee that at most one mutating repository execution actor exists at any moment, including across controller process death. Ownership of a repository and of every child process it spawned is durable, is classified against real OS identity evidence rather than a bare PID, and fails closed whenever liveness or identity cannot be proven. `uncertain` is never converted to `dead` for convenience.

## Requirements

### Requirement: one durable repository execution actor

The controller SHALL enforce one durable repository-level execution actor lease for every repository that is allowed to mutate repository state.

The lease MUST survive controller process death and MUST be enforced by a durable uniqueness boundary, not only an in-memory map.

SWARM/DAG worker concurrency MAY occur beneath one strategy actor lease when workers use isolated Orca-owned worktrees.

#### Scenario: second start while prior actor is live

- Given repository A has a durable actor lease from controller instance X
- And the controller process X dies while its executor process remains alive
- When controller instance Y restarts and a user/dispatch requests another mutating actor for repository A
- Then Orca refuses the new actor
- And repository A is reported as quarantined/recovery-required with prior ownership evidence
- And the old actor is not assumed dead merely because controller X is dead.

#### Scenario: independent repositories

- Given repository A is quarantined by uncertain prior ownership
- And repository B has no conflicting ownership
- When repository B receives a valid start
- Then repository B may proceed
- And repository A's quarantine does not impose a global execution stop.

### Requirement: durable child-process identity

Every mutating executor/worker child SHALL have a durable ownership record correlated to controller instance, repository, run, iteration, and actor/packet identity where applicable.

The record SHALL include enough non-secret OS evidence to classify the process after restart as live match, dead, PID reused, or unknown/unprovable (equivalent implementation names allowed).

#### Scenario: controller restarts after child spawn

- Given an executor child successfully spawned and its durable process identity was captured
- When the controller restarts
- Then Orca classifies the recorded process before releasing the repository actor lease
- And it does not start a replacement writer until that classification allows lease release.

### Requirement: uncertain process ownership fails closed

If Orca cannot prove that an old owned process is dead, it SHALL preserve a blocking ownership/quarantine state.

Unknown evidence SHALL NOT be converted to “dead” for convenience.

#### Scenario: process probe unavailable

- Given a prior actor lease exists
- And the process probe cannot authoritatively classify the recorded child
- When startup reconciliation runs
- Then the actor lease remains blocking/quarantined
- And no new mutating actor starts for that repository.

### Requirement: verified kill only

Orca SHALL NOT terminate a process solely because a numeric PID matches a historical record.

A kill operation MUST require a live process identity match against the durable ownership evidence. PID-reused and unknown verdicts MUST refuse the kill.

#### Scenario: PID reused by foreign process

- Given an old Orca process record contains PID P
- And the OS now assigns PID P to a different process whose identity evidence does not match
- When Orca reconciles or receives an emergency-kill/recovery request
- Then Orca does not kill that process
- And the repository remains in a safe recoverable/quarantine state until ownership can be resolved.

### Requirement: ownership persistence completes before successful admission

A process spawn MUST NOT be reported as safely active until durable process ownership is recorded.

If durable ownership persistence fails after a child has spawned, Orca SHALL either terminate the verified child and record failure, or quarantine ownership when safe termination cannot be proven.

#### Scenario: persistence fails after spawn

- Given a child emits `spawn`
- And writing its durable ownership record fails
- Then the start operation does not report ordinary success
- And Orca performs only a verified termination if identity evidence permits it
- Otherwise it blocks the repository with uncertain ownership evidence.

### Requirement: exit precedes lease release

A repository actor lease SHALL NOT be released until all associated mutating child processes are terminal or proven dead and the actor has reached a durable boundary.

#### Scenario: asynchronous child exit

- Given a repository actor is stopping
- When its child process exits
- Then the process record is made terminal before the actor lease becomes reusable
- And a concurrent start cannot acquire the lease in the intermediate window.

### Requirement: worktree cleanup respects process ownership

Restart worktree/staging reconciliation MUST NOT automatically remove/release a workspace that is still owned by a live or unclassified process.

#### Scenario: live SWARM worker after controller crash

- Given a SWARM worker process remains live in an isolated worktree after controller death
- When the new controller reconciles strategy/worktree state
- Then the worktree is preserved
- And no cleanup sweep destroys it
- And the repository actor remains blocked until the worker ownership is reconciled.

### Requirement: explicit recovery is truthful

Recovery MAY offer a verified kill/reconcile path, but SHALL NOT offer a force-clear action that can make a second writer possible while prior ownership remains live or unknown.

#### Scenario: user retries a quarantined campaign

- Given repository ownership is quarantined as UNKNOWN
- When the user requests retry/resume/start
- Then the request returns a structured conflict
- And Orca explains the blocking actor/evidence without exposing secrets
- And it does not clear the lease merely to satisfy the request.


### Requirement: identity evidence is authoritative, not a wildcard

A process SHALL be classified as `LIVE_MATCH` only when the supported host probe has enough durable identity evidence to distinguish that process from PID reuse.

Missing creation/start identity or an undecidable OS query MUST NOT be treated as a successful match.

#### Scenario: Windows record lacks creation identity

- Given an Orca ownership record contains a PID but lacks the creation/start marker required by the Windows classifier
- And a process currently exists at that PID
- When Orca classifies the record
- Then the verdict is UNKNOWN rather than LIVE_MATCH
- And verified kill is refused.

#### Scenario: Windows PID is absent versus probe failure

- Given one historical PID no longer exists
- And a second process query fails because the OS query is unavailable or undecidable
- When Orca classifies both records
- Then the absent PID may be classified DEAD
- And the failed query is classified UNKNOWN
- And the two conditions are never collapsed into one permissive verdict.

### Requirement: ambiguous spawn-to-persistence ownership remains blocking

A prior repository actor lease in STARTING or ACTIVE state SHALL NOT be released solely because zero child-process rows are present.

Zero rows MAY represent controller death after OS spawn but before durable process insertion. Automatic release requires separate durable evidence proving that no child crossed the spawn boundary.

#### Scenario: controller dies between spawn and process-row insertion

- Given controller X owns a STARTING repository actor lease
- And an executor child has emitted spawn
- And controller X dies before the child ownership row is committed
- When controller Y reconciles the lease and finds zero process rows
- Then controller Y preserves a blocking quarantine/uncertain state
- And it does not admit a second writer.

### Requirement: post-spawn ownership failure does not blindly retry

Once a real child has crossed the OS spawn boundary, a failure in ownership capture/persistence SHALL NOT be handled as an ordinary pre-spawn launch failure.

A replacement spawn is allowed only after the prior child is verified terminated and its attempt is durably terminal. If that proof is unavailable, the repository remains quarantined.

#### Scenario: ownership write fails and termination is uncertain

- Given attempt A has spawned
- And its ownership persistence fails
- And Orca cannot verify termination of attempt A
- When the generic launch policy has remaining retry budget
- Then Orca does not create attempt B
- And the actor lease remains quarantined.

### Requirement: child exit is observable during the ownership handshake

Executor lifecycle observation SHALL cover the interval in which post-spawn ownership persistence is awaiting completion.

A short-lived child that exits during that interval MUST still produce exactly-once completion/terminal ownership evidence.

#### Scenario: child exits while onSpawn persistence awaits

- Given the runner has received the child spawn event
- And the ownership hook is awaiting durable persistence
- When the child exits before that hook returns
- Then Orca still observes and persists the terminal child outcome exactly once
- And lease release/quarantine follows the durable ownership rules rather than losing the exit event.
