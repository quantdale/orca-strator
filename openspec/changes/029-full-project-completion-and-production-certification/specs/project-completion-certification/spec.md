# Project completion certification

## ADDED Requirements

### Requirement: Completion campaigns preserve unfinished dependency truth
The system's project-completion process SHALL NOT treat an umbrella completion campaign as superseding unfinished active changes.

#### Scenario: Earlier active change remains incomplete
- **WHEN** a completion campaign begins while an earlier active change still has unsatisfied acceptance criteria
- **THEN** that earlier change remains active until its criteria are satisfied
- **AND** its unresolved acceptance truth is carried into final certification

### Requirement: Production completion requires repository-wide certification
The project SHALL be considered locally complete only after all supported local correctness, build, static-analysis, specification, integrity, packaging/recovery and stress gates required by the documented product scope have passed on the final candidate tree.

#### Scenario: A required local gate fails
- **WHEN** any required locally executable certification gate fails
- **THEN** project completion SHALL remain false
- **AND** the failure SHALL be repaired or explicitly demonstrated to be outside the documented supported scope before certification continues

### Requirement: Qualification tiers are evidence-backed
Every qualification tier SHALL be reported from actual evidence produced by the environment and command/workflow required for that tier.

#### Scenario: Sanctioned external environment is unavailable
- **WHEN** installer/release/endurance qualification requires an environment that is genuinely unavailable locally
- **THEN** the tier SHALL be reported as EXTERNAL-BLOCKED rather than PASS
- **AND** the exact command or workflow needed to obtain the evidence SHALL be recorded
- **AND** unavailable external evidence SHALL NOT conceal unfinished locally solvable engineering

### Requirement: Final audit covers all tracked repository content
The final completion audit SHALL inventory every tracked file and SHALL trace all correctness-critical end-to-end flows across source, tests, scripts, workflows, packaging assets, specifications and documentation.

#### Scenario: Critical or High defect is found during final audit
- **WHEN** the final audit finds a locally reproducible Critical or High defect
- **THEN** certification SHALL stop
- **AND** the defect SHALL be fixed with regression evidence
- **AND** affected certification gates SHALL be rerun before completion can be declared

### Requirement: Completion state is durable and reproducible
Final completion SHALL leave repository state, canonical specifications, documentation, agent state and pushed Git history mutually consistent and sufficient for another operator or agent to reproduce the qualification result.

#### Scenario: Final completion is recorded
- **WHEN** the project is declared complete
- **THEN** the final report SHALL record start and final SHAs, exact gate results, relevant stress counts, artifact identity/hashes where applicable, remaining external-only evidence, and known blocker status
- **AND** useful work SHALL be committed and pushed
- **AND** the final working tree SHALL be clean or any intentional residual state SHALL be explicitly documented