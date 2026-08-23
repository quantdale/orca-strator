# Change 025 implementation notes (task 0.3)

## Selected packaged-controller launch strategy

Decision: execute the bundled Electron runtime in Node mode
(ELECTRON_RUN_AS_NODE=1 + electron.exe + resources/controller/dist/index.js)
as the packaged controller process.

Why this preserves controller independence without system Node:

1. No second runtime. Electron ships a complete Node runtime; Node mode runs
   the compiled controller against it, so ordinary users need no system Node.
2. Independent OS process. The desktop spawns the controller detached with
   stdio ignored and unref'd, so closing or quitting Electron never signals
   controller shutdown; only explicit test-harness teardown stops it.
3. Single dependency closure. The staged resources/controller/node_modules
   tree (exact versions pinned from the root package-lock.json) plus the built
   @orca/shared workspace package satisfy all controller imports at runtime.
4. Verified by artifact-level smoke, not by build success: task 10 proves the
   packaged exe actually boots the controller, serves UI/API, survives UI
   close, and reconnects without duplicate spawn.

Alternatives rejected:

- Shipping a standalone Node.exe copy doubles payload and adds a second
  runtime to keep updated for no functional gain.
- Making Electron itself the orchestration owner violates the locked V1
  architecture invariant that the controller owns runtime state.
- Requiring system Node fails the Change 025 self-contained launch gate.

## Packaged layout contract

resources/
  app/            electron-builder default (desktop dist/main.js + preload.js)
  controller/
    dist/**       compiled controller output (tsc)
    package.json  minimal ESM manifest (name/version/type=module)
    node_modules/ exact production closure incl. @orca/shared
  ui/**           built React SPA served by the controller

Desktop spawn plan: process.execPath (electron.exe) in Node mode with
ORCA_PACKAGED=1, ORCA_BUILD_VERSION=<app version>, NODE_ENV=production,
optional ORCA_HOST/ORCA_PORT/ORCA_DATA_DIR passthrough.
