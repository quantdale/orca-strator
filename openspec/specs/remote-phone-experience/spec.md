# Private Phone Access and Notifications Specification

## Purpose

Deliver private phone monitoring, responsive mobile layout, Tailscale Serve integration, and event notification filtering.

## Requirements

### Requirement: Responsive phone-optimized layout

The web client SHALL provide responsive layouts adapted for mobile viewports (<640px) with single-column cards, easy touch targets, and full control capabilities.

#### Scenario: Mobile viewport rendering
- GIVEN a phone viewport width (390px)
- WHEN user navigates the repository list or detail view
- THEN repository cards stack vertically with prominent status badges and quick control buttons

---

### Requirement: Tailscale Serve guidance endpoint

The controller SHALL expose `/api/system/tailscale` providing Tailscale Serve configuration instructions and status.

#### Scenario: Query Tailscale guidance
- GIVEN a client on phone or desktop
- WHEN `GET /api/system/tailscale` is called
- THEN controller returns loopback port and CLI instructions to configure Tailscale Serve

---

### Requirement: Problem and terminal event notification filtering

The client and controller SHALL surface high-priority alert events for problem and completion states while keeping standard iteration loops quiet.

#### Scenario: Problem event notification
- GIVEN an active run transitions to `BLOCKED`, `RECOVERY_REQUIRED`, `SOL_STALLED`, `EXECUTOR_UNAVAILABLE`, `NEEDS_HUMAN`, `STOPPED`, or `GOAL_COMPLETE`
- WHEN the event is received
- THEN a prominent alert banner / browser notification is generated for the user
