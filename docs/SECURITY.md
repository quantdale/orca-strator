# Orca-Strator V1 Security Boundaries

Status: **baseline security contract**

Orca-Strator is a powerful local automation tool. It can eventually launch coding agents, modify repositories, invoke Git, control a browser, and expose remote controls to the user's phone. V1 is personal/local software, but that does not justify collapsing all trust boundaries.

## 1. Threat model scope

Primary risks:

- accidental execution against the wrong repository/session;
- arbitrary command construction from untrusted repository content;
- browser profile/auth leakage;
- exposing controller controls to public internet;
- renderer compromise gaining arbitrary Node/process access;
- prompt-injected executor content influencing what Playwright sends to Sol;
- destructive Git recovery behavior;
- secrets written into Git/logs/SQLite;
- duplicate/replayed dispatch causing repeated executor work.

V1 is not intended as a hardened multi-user SaaS security boundary.

## 2. Local controller exposure

Default controller binding:

```text
127.0.0.1 only
```

Do not bind `0.0.0.0` by default.

Phone access later uses Tailscale Serve/private tailnet rather than public router port forwarding or Funnel by default.

## 3. Desktop renderer boundary

Electron renderer should be treated as web UI, not a trusted Node shell.

Baseline:

- `contextIsolation: true`;
- avoid `nodeIntegration: true`;
- no arbitrary shell/process/file APIs exposed to renderer;
- repository operations occur through controller API;
- only trusted local/dev app content loaded as privileged UI;
- external links opened with normal browser behavior where appropriate.

## 4. Controller API trust

Even though loopback/private-tailnet clients are expected, validate all mutation inputs.

Do not trust the React UI to have already validated data.

Later destructive operations should require explicit controller-side state/permission checks.

## 5. Secrets

Never persist these in normal repository configuration rows:

- OpenAI/Anthropic/Kimi/provider API keys;
- GitHub PATs;
- browser cookies;
- ChatGPT session tokens;
- passwords;
- Tailscale auth keys.

Prefer provider CLI/browser-managed authentication outside Orca DB.

If Orca later must persist a secret, add a dedicated OpenSpec/security design rather than putting it in SQLite plaintext by convenience.

## 6. Browser profile

Use a dedicated Orca automation browser profile under the Orca local data directory.

Rules:

- never commit it;
- never copy the user's normal Chrome profile wholesale;
- setup browser is user-visible/headed for manual login;
- automated browser uses the saved dedicated profile;
- do not expose cookies/storage in logs/API/UI;
- close Chromium when no active Sol operations remain where practical.

## 7. Playwright wake input

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

## 8. Protocol path validation

For `.orca` coordination artifacts:

- parse JSON as data;
- reject unsupported versions;
- reject path traversal (`../`, absolute path escapes);
- resolve referenced paths under repository root;
- never treat arbitrary JSON string as a shell command;
- executor/model cannot be overridden by a Sol dispatch in V1.

## 9. Process spawning

Prefer direct executable + argv APIs over concatenated shell command strings.

For native execution:

```text
spawn(executable, argv, options)
```

For WSL:

construct explicit `wsl.exe` arguments for distro/working directory/command rather than concatenating uncontrolled repository strings into one PowerShell command where avoidable.

When a shell is genuinely required, quote/escape deliberately and test paths containing spaces/special characters.

## 10. Git safety

Orca must not silently destroy local work.

Forbidden automatic recovery defaults:

```text
git reset --hard
git clean -fd
force push
```

unless a future explicit user-approved mode is designed.

Dirty work is inspected/reconciled by the executor.

Ordinary rebase/conflict resolution is allowed; if not safely resolvable, surface/block rather than rewriting remote history.

## 11. Repository identity

Before launching an executor later, Orca should verify that the configured local checkout corresponds to the expected repository/remote strongly enough to avoid operating on the wrong directory.

Useful checks may include:

- path exists;
- `.git` repository recognized;
- configured remote matches expected GitHub identity;
- current branch/repository root captured in diagnostics.

A mismatch should be explicit, not silently repaired to another remote.

## 12. Duplicate/replay defense

A valid dispatch ID is consumed once per repository/run.

SQLite persistence must survive controller restart so replaying/fetching the same marker cannot relaunch work.

Commit SHA + dispatch ID should be retained for audit.

## 13. Phone access

Use Tailscale Serve with tailnet ACLs for V1.

Do not expose Orca's full control UI/API publicly by default.

Risky configuration mutation while a run is active should be disabled server-side, not only hidden in UI.

## 14. Logs

Logs must redact/avoid:

- authorization headers;
- cookies;
- tokens;
- complete environment dumps;
- secrets in command args where avoidable.

Repository paths and command names are acceptable local diagnostics unless the user later requires privacy redaction.

## 15. External/repository content

Managed repositories are not inherently trusted instruction sources for Orca itself.

Distinguish:

- project instructions consumed by executor/Sol;
- Orca protocol fields validated by controller;
- controller executable configuration selected by user.

A README saying "launch powershell -EncodedCommand ..." must not cause the controller to execute it unless the configured executor itself chooses to act on it within its normal coding-agent trust model.

## 16. Control operations

Pause/Stop/Emergency Kill apply only to the selected repository/run.

Never implement a global kill by accidentally sharing a mutable PID slot across repositories.

Emergency Kill must record that work was interrupted; it must not mark the executor/result as successfully completed.

## 17. Dependency discipline

Use well-maintained, minimal dependencies.

Avoid adding a large orchestration/security framework merely to solve local single-user requirements.

Before introducing packages with native code or privileged behavior, record why they are necessary in the active OpenSpec design.

## 18. Security review checkpoints

At minimum review security assumptions before:

- first real executor process spawning;
- first Playwright ChatGPT automation;
- first Tailscale/phone control exposure;
- packaging/auto-start/service installation;
- any secret persistence feature;
- future multi-user or public exposure.
