import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

/**
 * Change 023: Windows system-Chrome discovery.
 *
 * Locates the ORDINARY installed Google Chrome so that:
 * - interactive setup can spawn it directly (no Playwright attached) for
 *   human-controlled Google/OpenAI authentication; and
 * - automated browsing can launch it through Playwright with Orca's dedicated
 *   profile, reusing the human-created session.
 *
 * Probe order (Change 023 spec):
 *   1. Registry App Paths (`HKLM\SOFTWARE\...\App Paths\chrome.exe` and its
 *      WOW6432Node view) — value accepted only when the file exists on disk;
 *   2. %ProgramFiles%\Google\Chrome\Application\chrome.exe
 *   3. %ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
 *   4. %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
 *
 * NOT_FOUND is an actionable readiness state — callers must never silently
 * fall back to an incompatible bundled browser.
 */

export type SystemChromeDiscoveryStatus = "FOUND" | "NOT_FOUND" | "UNKNOWN";

export interface SystemChromeInfo {
  status: SystemChromeDiscoveryStatus;
  executablePath: string | null;
  /** Best-effort version metadata; absence does not fail a FOUND result. */
  version: string | null;
  /** Human-readable probe source or failure reason. */
  source: string;
}

/** Injectable seams so discovery tests stay deterministic on any machine. */
export interface ChromeDiscoveryDeps {
  env?: NodeJS.ProcessEnv;
  fileExists?: (p: string) => boolean;
  listDirs?: (p: string) => string[];
  readRegistryValue?: (
    regKey: string,
    valueName: string,
  ) => Promise<string | null>;
}

const APP_PATHS_KEY =
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe";
const APP_PATHS_WOW64_KEY =
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe";
const BLBEACON_KEY = "HKCU\\Software\\Google\\Chrome\\BLBeacon";
const CHROME_RELATIVE = path.join(
  "Google",
  "Chrome",
  "Application",
  "chrome.exe",
);
const VERSION_DIR_RE = /^\d+\.\d+\.\d+\.\d+$/;

function defaultReadRegistryValue(
  regKey: string,
  valueName: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const args =
      valueName === "(Default)"
        ? ["query", regKey, "/ve"]
        : ["query", regKey, "/v", valueName];
    execFile("reg", args, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const match = stdout.match(/REG_SZ\s+(.*)/);
      const value = match?.[1]?.trim();
      resolve(value ? value : null);
    });
  });
}

export async function discoverSystemChrome(
  deps: ChromeDiscoveryDeps = {},
): Promise<SystemChromeInfo> {
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? ((p: string) => fs.existsSync(p));
  const listDirs =
    deps.listDirs ??
    ((p: string) => (fs.existsSync(p) ? fs.readdirSync(p) : []));
  const readRegistryValue = deps.readRegistryValue ?? defaultReadRegistryValue;

  try {
    // Tier 1/2: registry App Paths (native + WOW6432Node views).
    for (const key of [APP_PATHS_KEY, APP_PATHS_WOW64_KEY]) {
      let value: string | null = null;
      try {
        value = await readRegistryValue(key, "(Default)");
      } catch {
        value = null;
      }
      if (value && fileExists(value)) {
        return {
          status: "FOUND",
          executablePath: value,
          version: await readChromeVersion(env, {
            readRegistryValue,
            listDirs,
          }),
          source:
            key === APP_PATHS_KEY
              ? "registry-app-paths"
              : "registry-app-paths-wow64",
        };
      }
    }

    // Tier 3/4/5: standard filesystem locations.
    const candidates: Array<{ envVar: string; source: string }> = [
      { envVar: "ProgramFiles", source: "program-files" },
      { envVar: "ProgramFiles(x86)", source: "program-files-x86" },
      { envVar: "LOCALAPPDATA", source: "local-app-data" },
    ];
    for (const candidate of candidates) {
      const base = env[candidate.envVar];
      if (!base) continue;
      const exePath = path.join(base, CHROME_RELATIVE);
      if (fileExists(exePath)) {
        return {
          status: "FOUND",
          executablePath: exePath,
          version: await readChromeVersion(env, {
            readRegistryValue,
            listDirs,
          }),
          source: candidate.source,
        };
      }
    }

    return {
      status: "NOT_FOUND",
      executablePath: null,
      version: null,
      source:
        "no probe location contained Google Chrome (registry App Paths, Program Files, Program Files (x86), LocalAppData)",
    };
  } catch (err: any) {
    return {
      status: "UNKNOWN",
      executablePath: null,
      version: null,
      source: `discovery failed unexpectedly: ${err?.message || String(err)}`,
    };
  }
}

/**
 * Best-effort version: HKCU BLBeacon version first, then a `<major>.<x>.<y>.<z>`
 * subdirectory under Chrome's Application folder. Absence never fails FOUND.
 */
async function readChromeVersion(
  _env: NodeJS.ProcessEnv,
  seams: {
    readRegistryValue: (
      regKey: string,
      valueName: string,
    ) => Promise<string | null>;
    listDirs: (p: string) => string[];
  },
): Promise<string | null> {
  try {
    const beacon = await seams.readRegistryValue(BLBEACON_KEY, "version");
    if (beacon && /^\d+(\.\d+)*$/.test(beacon)) return beacon;
  } catch {
    // fall through
  }

  try {
    const base =
      _env["ProgramFiles"] || _env["ProgramFiles(x86)"] || _env["LOCALAPPDATA"];
    if (!base) return null;
    const appDir = path.join(base, "Google", "Chrome", "Application");
    const versions = seams
      .listDirs(appDir)
      .filter((d) => VERSION_DIR_RE.test(d))
      .sort((a, b) => compareVersions(b, a));
    return versions[0] ?? null;
  } catch {
    return null;
  }
}

export function majorOf(version: string | null): number | null {
  if (!version) return null;
  const m = version.match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
