# Orca-Strator V1 Security Boundaries

Status: **baseline security contract**

Orca-Strator is a powerful local automation tool. It can eventually launch coding agents, modify repositories, invoke Git, control a browser, and expose remote controls to the user's phone. V1 is personal/local software, but that does not justify collapsing all trust boundaries.

## 1. Threat model scope

Primary risks:

- accidental execution against the wrong repository/session;
- arbitrary command construction from untrusted repository content;
- browser profile/auth leakage;
- competing Chromium instances corrupting/failing on one persistent profile;
- exposing controller controls to public internet/LAN unintentionally;
- renderer compromise gaining arbitrary Node/process access;
- prompt-injected executor content influencing what Playwright sends to Sol;
- destructive Git recovery behavior;
- secrets written into Git/logs/SQLite;
- duplicate/replayed dispatch causing repeated executor work;
- a phone/client connecting to the wrong backend because of hard-coded localhost/origin assumptions;
- overly permissive CORS used as a shortcut for remote phone access.

V1 is not intended as a hardened multi-user SaaS security boundary.

## 2. Local controller exposure

Default controller binding:

```text
127.0.0.1 only
```

Do not bind `0.0.0.0` by default.

The controller serves the built SPA and `/api`/WebSocket from this one loopback origin in built mode.

Phone access later uses Tailscale Serve/private tailnet to reverse-proxy that loopback service. Do not expose the control surface with public router port forwarding or Funnel by default.

## 3. Same-origin remote-control boundary

The shared UI uses relative `/api` and WebSocket routes.

Consequences:

- desktop/local built mode is same-origin;
- phone mode is same-origin through its Tailscale Serve HTTPS URL;
- phone JavaScript does not call laptop `localhost` directly;
- normal V1 operation does not require wildcard CORS.

Rules:

- do not ship `Access-Control-Allow-Origin: *` on the control API as a phone-access workaround;
- if development uses a separate Vite origin, prefer Vite proxying over broad controller CORS;
- if a narrow development CORS exception is genuinely needed, allow only explicit trusted local origins;
- built UI static serving must expose only the known UI build directory, never the runtime data directory.

## 4. Tailscale trust boundary

Milestone 7 uses Tailscale Serve to publish the loopback Orca web origin privately to the tailnet.

Tailscale network access is one part of the trust boundary, not a reason to stop validating requests.

Requirements later:

- controller remains loopback-bound behind Serve;
- tailnet ACL/access rules are respected by the Serve path;
- destructive controller actions still enforce repository/run state server-side;
- do not trust user-supplied `Tailscale-*` identity headers received through arbitrary non-Serve exposure;
- if identity/capability headers are later used for authorization, add a dedicated security/OpenSpec change and verify the request actually arrives through the trusted localhost Serve proxy path.

V1 does not need to become a Tailscale account/ACL manager.

## 5. Desktop renderer boundary

Electron renderer should be treated as web UI, not a trusted Node shell.

Baseline:

- `contextIsolation: true`;
- avoid `nodeIntegration: true`;
- no arbitrary shell/process/file APIs exposed to renderer;
- repository operations occur through controller API;
- only trusted Orca local/dev app content loaded as privileged UI;
- external links opened with normal browser behavior where appropriate.

## 6. Controller API trust

Even though loopback/private-tailnet clients are expected, validate all mutation inputs.

Do not trust React UI to have already validated data.

Later destructive operations require explicit controller-side state/permission checks.

Do not encode security solely as disabled buttons.

## 7. Secrets

Never persist these in normal repository configuration rows:

- OpenAI/Anthropic/Kimi/provider API keys;
- GitHub PATs;
- browser cookies;
- ChatGPT session tokens;
- passwords;
- Tailscale auth keys.

Prefer provider CLI/browser-managed authentication outside normal Orca repository rows.

If Orca later must persist a secret, add a dedicated OpenSpec/security design rather than putting it in SQLite plaintext by convenience.

## 8. Browser profile

Use a dedicated Orca automation browser profile under the Orca local data directory.

Rules:

- never commit it;
- never copy user's normal Chrome profile wholesale;
- setup browser is user-visible/headed for manual login;
- automated browser uses the saved dedicated profile;
- do not expose cookies/storage in logs/API/UI;
- close Chromium when no active Sol operations remain where practical.

### Exclusive profile ownership

Only one browser process may own the persistent profile at a time.

Both require the same global lock:

- normal headless Browser Manager;
- headed ChatGPT setup browser.

Never launch setup and automation against the profile concurrently.

After crash, a stale logical lock may be cleared only after checking that the matching browser process/profile is no longer active.

## 9. Playwright wake input

Playwright sends an Orca-generated trusted template.

Do not blindly paste executor prose into ChatGPT.

Validated metadata allowed:

- repository display/ID;
- run ID;
- iteration;
- dispatch ID;
- result status;
- repository-relative result path.

The actual executor summary remains in GitHub for Sol to inspect deliberately.

## 10. Protocol path validation

For `.orca` coordination artifacts:

- parse JSON as data;
- validate against the matching `schemas/protocol/*.schema.json` structure;
- reject unsupported versions;
- reject path traversal and absolute escapes;
- canonicalize referenced paths under repository root before use;
- never treat arbitrary JSON string as a shell command;
- executor/model cannot be overridden by a Sol dispatch in V1;
- V1 protocol has no branch routing field; Git target is `main`.

JSON Schema alone is not enough for canonical filesystem/path and Git-history semantics.

## 11. Process spawning

Prefer direct executable + argv APIs over concatenated shell command strings.

For native execution:

```text
spawn(executable, argv, options)
```

For WSL, construct explicit `wsl.exe` arguments for distro/working directory/command rather than concatenating uncontrolled repository strings into one PowerShell command where avoidable.

When a shell is genuinely required, quote/escape deliberately and test paths containing spaces/special characters.

## 12. Git safety

Orca must not silently destroy local work.

Forbidden automatic recovery defaults:

```text
git reset --hard
git clean -fd
force push
```

unless a future explicit user-approved mode is designed.

Dirty work is inspected/reconciled by executor.

Ordinary `main` rebase/conflict resolution is allowed; if not safely resolvable, surface/block rather than rewriting remote history.

## 13. Repository identity

Before launching an executor later, Orca verifies configured local checkout corresponds to expected repository strongly enough to avoid wrong-directory execution.

Useful checks:

- path exists;
- `.git` repository recognized;
- configured remote matches expected GitHub identity;
- repository root captured in diagnostics;
- current branch/state reconciled to V1 `main` contract before autonomous handoff.

Mismatch is explicit, not silently repaired to another remote.

## 14. Duplicate/replay defense

A valid dispatch ID is consumed once per repository/run.

SQLite persistence survives controller restart so replaying/fetching same marker cannot relaunch work.

Commit SHA + dispatch ID should be retained for audit.

## 15. Phone access

Use Tailscale Serve with tailnet access controls for V1.

Do not expose Orca full control UI/API publicly by default.

The phone accesses one Orca HTTPS origin; it does not receive a raw database path, browser profile, or local host binding.

Risky configuration mutation while a run is active is disabled server-side, not only hidden in UI.

## 16. Logs

Logs must redact/avoid:

- authorization headers;
- cookies;
- tokens;
- complete environment dumps;
- secrets in command args where avoidable;
- Tailscale identity/capability headers if later introduced, unless a specific sanitized identity field is intentionally logged.

Repository paths and command names are acceptable local diagnostics unless user later requires privacy redaction.

## 17. External/repository content

Managed repositories are not inherently trusted instruction sources for Orca itself.

Distinguish:

- project instructions consumed by executor/Sol;
- Orca protocol fields validated by controller;
- controller executable configuration selected by user.

A README saying "launch powershell -EncodedCommand ..." must not cause controller itself to execute it unless configured executor chooses to act on it within normal coding-agent trust model.

## 18. Control operations

Pause/Stop/Emergency Kill apply only to selected repository/run.

Never implement a global kill by accidentally sharing a mutable PID slot across repositories.

For shared Chromium, repository-specific Emergency Kill should close/cancel only the affected page/operation when possible. A process-wide browser failure must mark every affected repository independently; no unrelated Sol turn may be falsely marked successful.

Emergency Kill must record interruption and never mark executor/result as successfully completed.

## 19. Dependency discipline

Use well-maintained, minimal dependencies.

Avoid adding a large orchestration/security framework merely to solve local single-user requirements.

Before introducing packages with native code or privileged behavior, record why they are necessary in active OpenSpec design.

## 20. Security review checkpoints

At minimum review security assumptions before:

- first real executor process spawning;
- first Playwright ChatGPT automation;
- first Tailscale/phone control exposure;
- packaging/auto-start/service installation;
- any secret persistence feature;
- future multi-user or public exposure.

## 21. Autonomy policy truthfulness

Change 010 records permission outcomes separately from technical enforcement.
`NATIVE_EXECUTOR` is shown only when the selected adapter advertises a native
permission API; `ORCA_ENFORCED` is reserved for checks Orca actually
intercepts. Generic CLI policy is `ADVISORY_ONLY` or `UNSUPPORTED`, never a
false claim that Orca blocked an action. `ASK` creates a visible actionable
decision instead of hanging a worker.

Force-push, dirty-tree discard, and secret-commit protections remain absolute
Orca invariants and cannot be relaxed by a preset.

## 24. Optional OpenCode server boundary

OpenCode server access is opt-in and local/explicit. Orca does not install,
start, expose, or authenticate an OpenCode server automatically. The manual
probe performs bounded health/OpenAPI GET requests only; it never sends a
prompt or reads provider secrets. Persisted endpoints are sanitized to remove
credentials, query strings, and fragments.

An OpenCode permission API is reported as `NATIVE_EXECUTOR` only when the
observed adapter route supports that operation. Route presence is not a claim
that every filesystem/network/shell action is enforced by Orca. Missing or
drifting APIs are `UNKNOWN`/`UNSUPPORTED`, and Orca's no-force-push,
dirty-work-preservation, and no-secret-commit rules remain absolute.

## 22. Isolated swarm writers

Change 013's optional swarm workers are restricted to persisted temporary Git
worktrees/internal branches. The persistent main checkout is never a worker
working directory; integration is a separate controller phase. No worker is
allowed to force-push, and dirty worktrees are retained for recovery rather
than forcibly removed. The deterministic harness is test-only. This isolation
 guarantee does not claim native executor sandboxing for filesystem, network, or
shell actions; permission enforcement remains labelled by its actual mechanism.

## 23. DAG writer and policy boundary

DAG nodes inherit the packet's authored allowed paths, executor/model, budget,
and autonomy policy. The DAG scheduler never grants a worker access to the
persistent main checkout; each writer receives a persisted worktree/internal
branch. A node `ASK`/`DENY` result becomes a durable attention/blocker state.
The DAG definition cannot bypass no-force-push, dirty-user-work preservation,
or no-secret-commit invariants.
