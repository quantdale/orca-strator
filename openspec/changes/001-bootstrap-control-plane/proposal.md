# Change 001: Bootstrap Control Plane

## Why

Orca-Strator currently has product decisions and a roadmap but no runnable application foundation. Before repository watchers, AI executors, Playwright, or autonomous loops can be implemented safely, the project needs one stable control plane that owns configuration, persistence, status, and UI boundaries.

## What changes

Build the first runnable Orca-Strator skeleton:

- create a TypeScript workspace with a separate background controller, shared responsive React UI, Electron desktop shell, and shared contracts;
- make the controller the source of runtime truth rather than the Electron window;
- expose a localhost HTTP/WebSocket boundary used by both desktop and future phone access;
- add SQLite-backed repository configuration/state persistence;
- support registering repository metadata for native Windows/PowerShell or WSL execution targets;
- provide a basic desktop dashboard for listing, adding, editing, and inspecting repositories;
- establish build, lint/typecheck, and test commands suitable for fresh agent sessions and CI later.

## Scope

This change establishes the control-plane foundation only.

It does **not** yet:

- poll GitHub or dispatch work;
- launch Kimi/Codex/Claude executors;
- automate ChatGPT with Playwright;
- implement the autonomous Sol/executor loop;
- expose the UI through Tailscale;
- implement notifications or crash-recovery policy beyond persistence primitives.

Those are intentionally separate roadmap changes.

## Success criteria

A fresh Windows checkout can install dependencies, start the controller and UI, launch the Electron shell, persist repository configurations in SQLite, and show repository status through a responsive UI. The controller remains architecturally independent from the Electron window so later autonomous runs can survive UI closure.
