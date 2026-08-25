import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ControllerIdentity,
  ReadinessCheck,
  SystemReadinessResponse
} from "@orca/shared";
import type { DatabaseSync } from "node:sqlite";
import type { RepositoryStore } from "../repositories/repository-store.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { SystemChromeInfo } from "../browser/chrome-discovery.js";

const execFileAsync = promisify(execFile);

/**
 * Change 025 system readiness / doctor.
 *
 * Composes existing capability probes into one controller-level readiness
 * model. Classification is truthful: READY, ACTION_REQUIRED (with a blocking
 * flag), OPTIONAL, or UNKNOWN. External-optional capabilities (Tailscale,
 * OpenCode) never block core readiness, and WSL matters only while a
 * configured repository actually uses it. Nothing here installs, signs in,
 * approves elevation, or mutates credentials.
 */

export interface ReadinessDeps {
  identity: ControllerIdentity;
  dataDir: string;
  port: number;
  db: DatabaseSync;
  repositoryStore: RepositoryStore;
  browserManager?: BrowserManager | null;
  /** Injectable seams for deterministic tests. */
  discoverChrome?: () => Promise<SystemChromeInfo>;
  detectTailscale?: (port: number) => Promise<{ status: string; details: string }>;
  runGitVersion?: () => Promise<string>;
}

function check(
  id: string,
  title: string,
  status: ReadinessCheck["status"],
  blocking: boolean,
  detail?: string,
  remediation?: string
): ReadinessCheck {
  return { id, title, status, blocking, ...(detail ? { detail } : {}), ...(remediation ? { remediation } : {}) };
}

async function probeWritableDataDir(dataDir: string): Promise<ReadinessCheck> {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probePath = path.join(dataDir, `.readiness-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probePath, "probe", "utf8");
    fs.rmSync(probePath, { force: true });
    return check("writable-data-dir", "Orca data directory is writable", "READY", true, dataDir);
  } catch (err) {
    return check(
      "writable-data-dir",
      "Orca data directory is writable",
      "ACTION_REQUIRED",
      true,
      `${dataDir}: ${(err as Error).message}`,
      "Ensure the Orca data directory exists and the current user can write to it."
    );
  }
}

async function probeDatabase(db: DatabaseSync): Promise<ReadinessCheck> {
  try {
    db.prepare("SELECT 1").get();
    return check("database", "SQLite runtime database initialized", "READY", true);
  } catch (err) {
    return check(
      "database",
      "SQLite runtime database initialized",
      "ACTION_REQUIRED",
      true,
      (err as Error).message,
      "Controller restart re-runs migrations; do not delete the database file."
    );
  }
}

async function probeGit(run?: () => Promise<string>): Promise<ReadinessCheck> {
  if (!run) {
    run = async () => (await execFileAsync("git", ["--version"], { timeout: 5000 })).stdout.trim();
  }
  try {
    return check("git", "Git executable available", "READY", true, await run());
  } catch {
    return check(
      "git",
      "Git executable available",
      "ACTION_REQUIRED",
      true,
      "`git --version` failed",
      "Install Git for Windows and ensure git.exe is on PATH."
    );
  }
}

async function probeChrome(deps: ReadinessDeps, repositoriesConfigured: boolean): Promise<ReadinessCheck> {
  let info: SystemChromeInfo;
  try {
    info = deps.discoverChrome
      ? await deps.discoverChrome()
      : await import("../browser/chrome-discovery.js").then((m) => m.discoverSystemChrome());
  } catch (err) {
    return check(
      "chrome",
      "Google Chrome availability",
      "UNKNOWN",
      false,
      `Discovery failed: ${(err as Error).message}`
    );
  }
  if (info.status === "FOUND") {
    return check("chrome", "Google Chrome availability", "READY", false, [info.version, info.source].filter(Boolean).join(" — "));
  }
  const detail = info.status === "NOT_FOUND" ? "Installed Chrome not found" : `Discovery unknown (${info.source})`;
  return check(
    "chrome",
    "Google Chrome availability",
    repositoriesConfigured ? "ACTION_REQUIRED" : "OPTIONAL",
    repositoriesConfigured,
    detail,
    "Install Google Chrome; Sol wake automation requires it (Settings shows detection details)."
  );
}

async function probeChatGptAuth(deps: ReadinessDeps, repositoriesConfigured: boolean): Promise<ReadinessCheck> {
  if (!deps.browserManager) {
    return check(
      "chatgpt-auth",
      "ChatGPT authentication readiness",
      repositoriesConfigured ? "UNKNOWN" : "OPTIONAL",
      false,
      "Browser manager not initialized yet"
    );
  }
  try {
    const report = await deps.browserManager.checkAuthReadiness();
    if (report.status === "AUTHENTICATED") {
      return check("chatgpt-auth", "ChatGPT authentication readiness", "READY", false, report.evidence.join(", ") || "authenticated");
    }
    if (report.status === "LOGIN_REQUIRED" || report.status === "VERIFICATION_REQUIRED") {
      return check(
        "chatgpt-auth",
        "ChatGPT authentication readiness",
        repositoriesConfigured ? "ACTION_REQUIRED" : "OPTIONAL",
        repositoriesConfigured,
        report.status,
        "Open Settings → ChatGPT Setup Browser and complete sign-in once."
      );
    }
    return check("chatgpt-auth", "ChatGPT authentication readiness", "UNKNOWN", false, report.status);
  } catch (err) {
    return check("chatgpt-auth", "ChatGPT authentication readiness", "UNKNOWN", false, (err as Error).message);
  }
}

async function probeRepositories(deps: ReadinessDeps): Promise<{ check: ReadinessCheck; wslRepos: number }> {
  let repos;
  try {
    repos = deps.repositoryStore.list();
  } catch (err) {
    return {
      check: check("repositories", "Configured repository paths", "UNKNOWN", false, (err as Error).message),
      wslRepos: 0
    };
  }
  if (repos.length === 0) {
    return {
      check: check("repositories", "Configured repository paths", "OPTIONAL", false, "No repositories configured yet"),
      wslRepos: 0
    };
  }
  const missing = repos.filter((r) => !fs.existsSync(r.localPath)).map((r) => r.displayName);
  const wslRepos = repos.filter((r) => r.environment === "wsl").length;
  if (missing.length > 0) {
    return {
      check: check(
        "repositories",
        "Configured repository paths",
        "ACTION_REQUIRED",
        true,
        `Missing local paths: ${missing.slice(0, 5).join(", ")}`,
        "Restore the checkouts or update each repository's local path."
      ),
      wslRepos
    };
  }
  return { check: check("repositories", "Configured repository paths", "READY", true, `${repos.length} repositories validated`), wslRepos };
}

async function probeWsl(wslRepos: number, runGitVersion?: () => Promise<string>): Promise<ReadinessCheck> {
  if (wslRepos === 0) {
    return check("wsl", "WSL distribution (conditional)", "OPTIONAL", false, "No WSL-configured repositories");
  }
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["--status"], { timeout: 10000 });
    void stdout;
    return check("wsl", "WSL distribution (conditional)", "READY", true, `${wslRepos} WSL repository(ies)`);
  } catch {
    void runGitVersion;
    return check(
      "wsl",
      "WSL distribution (conditional)",
      "ACTION_REQUIRED",
      true,
      `${wslRepos} WSL-configured repository(ies) but wsl.exe status failed`,
      "Install a WSL distribution (`wsl --install`) or switch those repositories to the Windows environment."
    );
  }
}

async function probeTailscale(deps: ReadinessDeps): Promise<ReadinessCheck> {
  try {
    const result = deps.detectTailscale
      ? await deps.detectTailscale(deps.port)
      : await import("../tailscale/status.js").then((m) => m.detectTailscaleStatus(deps.port));
    if (result.status === "configured") {
      return check("tailscale", "Tailscale phone route (optional)", "READY", false, result.details);
    }
    return check(
      "tailscale",
      "Tailscale phone route (optional)",
      result.status === "unknown" ? "UNKNOWN" : "OPTIONAL",
      false,
      result.details,
      "Optional: install Tailscale and run the documented serve command for private phone access."
    );
  } catch (err) {
    return check("tailscale", "Tailscale phone route (optional)", "UNKNOWN", false, (err as Error).message);
  }
}

function probeOpenCode(): ReadinessCheck {
  const qualifiedUrl = process.env.ORCA_OPENCODE_QUALIFY_URL;
  if (!qualifiedUrl) {
    return check("opencode", "OpenCode adapter (optional)", "OPTIONAL", false, "Not configured");
  }
  return check("opencode", "OpenCode adapter (optional)", "UNKNOWN", false, "Configured; run qualification to classify");
}

export async function buildSystemReadiness(deps: ReadinessDeps): Promise<SystemReadinessResponse> {
  const repoProbe = await probeRepositories(deps);
  const repositoriesConfigured = deps.repositoryStore.list().length > 0;

  const checks: ReadinessCheck[] = [
    await probeWritableDataDir(deps.dataDir),
    await probeDatabase(deps.db),
    await probeGit(deps.runGitVersion),
    await probeChrome(deps, repositoriesConfigured),
    await probeChatGptAuth(deps, repositoriesConfigured),
    repoProbe.check,
    await probeWsl(repoProbe.wslRepos, deps.runGitVersion),
    await probeTailscale(deps),
    probeOpenCode()
  ];

  const ready = !checks.some((c) => c.status === "ACTION_REQUIRED" && c.blocking);
  return { ready, identity: deps.identity, checks };
}
