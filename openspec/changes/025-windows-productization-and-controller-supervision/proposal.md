# Proposal: Windows productization and release qualification

## Why

Orca's orchestration runtime is now qualified through real ChatGPT Sol, GitHub, Kimi, and Codex execution, but the application is still operated as a development checkout. The Electron shell expects a controller to already be listening on the loopback origin, the development supervisor is responsible for starting controller/UI/Electron, and the desktop workspace has no Windows installer/distribution pipeline. That is a product gap: a normal Windows user should not need npm, Node, or a separate terminal merely to launch Orca.

The next milestone therefore turns the qualified engine into a self-contained Windows application while preserving the architectural invariant that the controller—not Electron—owns orchestration and may outlive the desktop window.

## What changes

- Add a real Windows packaging/distribution pipeline producing an unpacked artifact and per-user installer without bundling runtime data, credentials, repository checkouts, or browser profiles.
- Add a production desktop/controller supervision contract: probe and reuse an existing compatible controller; otherwise launch the packaged controller, wait for readiness, and surface bounded actionable startup errors.
- Add controller singleton/ownership protection with stale-lock recovery, version/build identity, foreign-port safety, and no duplicate controller races.
- Make packaged resource, writable data, UI-dist, browser-profile, database, and log paths explicit rather than relying on repository `cwd`.
- Preserve background autonomy when the Electron window closes and make that lifecycle understandable to the user.
- Add a system-readiness/doctor surface that composes existing capability probes into blocking/optional/action-required results without faking Tailscale/OpenCode qualification.
- Add durable bounded packaged-runtime logs and document the upgrade/data-preservation contract.
- Add a real packaged Windows smoke harness proving controller autostart, UI/API readiness, external data placement, controller survival after UI close, and reconnect-without-duplicate on relaunch.
- Add Windows CI/package workflows and truthful unsigned-artifact qualification when no signing credential exists.

## Scope boundaries

This change does **not**:

- move orchestration ownership into Electron;
- expose the controller beyond loopback by default;
- require or automate privilege elevation;
- install or authenticate third-party executor CLIs automatically;
- automate ChatGPT login;
- fake Tailscale or OpenCode external qualification;
- add cloud accounts, sync, auto-update infrastructure, or code signing credentials;
- delete or reset existing local Orca state during install/upgrade.

## Exit gate

1. A Windows package can launch from an isolated environment with no manually prestarted controller and no system Node requirement for ordinary application launch.
2. The packaged desktop reuses or starts exactly one compatible loopback controller and never kills a foreign process occupying the port.
3. Closing the Electron UI does not terminate active controller-owned orchestration; relaunch reconnects without spawning a duplicate controller.
4. SQLite/data/log/browser-profile writes occur outside packaged resources and persist across UI close/reopen and package upgrades.
5. System readiness reports blocking vs optional dependencies truthfully.
6. A real packaged-runtime smoke test proves the startup/reconnect/data-preservation path against the built artifact.
7. Windows CI/package workflows, focused tests, full project gates, strict OpenSpec validation, and `git diff --check` are green on the implementing tree.
8. Change 025 is folded/archived only after real package evidence is recorded; unsigned and externally unqualified items remain labeled honestly.
