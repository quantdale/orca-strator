# Fresh-machine onboarding

This is the canonical bootstrap entry point for a new workstation or a fresh coding-agent environment. Complete this document before implementation work. The objective is a reproducible machine that can build, test, inspect, and operate this repository without rediscovering tooling mid-campaign.

## 1. Preflight rule

1. Clone the repository and enter its root.
2. Confirm the intended repository/branch and fetch current `origin/main`.
3. Read the repository control-plane documents before changing code: `AGENTS.md`, `README.md`, `.agent/`, `docs/`, active OpenSpec state.
4. Install/verify the machine prerequisites below.
5. Enable the committed agent integrations and repository-local skills.
6. Restore dependencies from lockfiles/pins; do not casually upgrade them during bootstrap.
7. Run the baseline validation commands.
8. Only then begin a development campaign. If a prerequisite cannot be satisfied, record it as an environment blocker rather than weakening a gate.

Credentials, API keys, signing material, account logins, licensed assets, and other secrets are machine/user responsibilities. Never commit them.

## 2. Supported host and prerequisites

**Primary host:** Windows-first. Native PowerShell/Windows execution is first-class; WSL is an optional per-repository execution plane.

**Required machine tools**
- Git
- Node.js 24 LTS + npm
- PowerShell
- installed Chrome/Chromium suitable for Playwright
- Playwright browser/runtime dependencies
- GitHub CLI when operational workflows require it

**Task-dependent / optional tools**
- WSL + target distro for Linux executor lanes
- Tailscale for private phone route
- configured executor CLIs (Codex/Kimi/OpenCode/etc.) required by the repositories Orca will manage


## 3. Agent setup

- Load repository instructions before acting. Prefer committed repository state over chat history.
- Repository-local skills: `goal` and legacy-compatible `go`.
- Discover and use committed agent adapter/config directories in-place; do not duplicate them globally unless the harness cannot load repository-local configuration.
- Relevant committed agent surfaces: `.agent/`, `.agents/`, `.claude/`, `.kimi-code/`, `.opencode/`.
- MCP policy: Use committed `.mcp.json`: pinned `chrome-devtools` for development diagnostics only and pinned `context7` for documentation. Chrome DevTools MCP must never become Orca's production Sol automation channel.
- Keep diagnostic/documentation MCPs narrow. An MCP does not grant architecture, publishing, production, or gate-bypass authority.
- Authenticate GitHub and coding-agent CLIs separately on the machine. Never store tokens in tracked files.

## 4. Bootstrap

```powershell
npm ci
npx playwright install chromium
npm run build
# Then use Orca's System Readiness / repository provisioning flows for machine-specific executor checks.
```

Authentication to ChatGPT, GitHub, and executor CLIs remains user-owned. Preserve the controller as runtime source of truth; Electron is only the desktop shell.


## 5. Editor/LSP baseline

Use the repository-local TypeScript server across npm workspaces plus ESLint/React diagnostics where configured. Keep Node 24 API typing aligned with the pinned runtime.

The editor is optional; reliable language diagnostics are not.

## 6. Baseline verification

```powershell
npm test
npm run build
npm run version:check
npm run smoke:package
npm run test:crash-recovery
npm run test:endurance:short
npm run test:stress:repos
```

A fresh machine is **development-ready** when all applicable non-external gates pass. Hardware/device/signing/account gates may remain explicitly blocked when repository state already classifies them that way.

## 7. Fresh-agent instruction

> Read `ONBOARDING.md` first. Set up every applicable prerequisite, repository-local skill, MCP/plugin, dependency, browser/device/runtime tool, and validation gate described there. Then read the repository's durable agent state and only start implementation after preflight is green or a genuine environment blocker is recorded. Do not replace pinned tooling, skip gates, or invent work to compensate for a missing machine capability.
