# End-to-End Autonomy Qualification Specification

## Purpose

Validate end-to-end autonomous orchestration across concurrent repositories, mixed environments, failure modes, and operational controls.

## Requirements

### Requirement: Full-matrix autonomous qualification

The system SHALL demonstrate full autonomous loop progression, crash recovery, multi-repository concurrency, and phone access in an integrated environment.

#### Scenario: Multi-repo concurrent autonomous qualification
- GIVEN Repository 1 (Windows native) and Repository 2 (WSL Linux)
- WHEN both repositories run autonomous loops simultaneously
- THEN each repository progresses through Sol wakes, Git dispatches, executor runs, and result publications independently without cross-repository interference

#### Scenario: Interruption and recovery qualification
- GIVEN active runs in progress
- WHEN controller experiences unexpected termination and restarts
- THEN in-flight executor work is safely marked `RECOVERY_REQUIRED` while review states are preserved and resumed without duplicate execution
