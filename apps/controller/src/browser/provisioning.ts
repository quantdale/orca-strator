import fs from "node:fs";

export type ChromiumProvisioningStatus = "missing" | "ready" | "unknown";

export interface ChromiumStatus {
  status: ChromiumProvisioningStatus;
  executablePath: string | null;
  details: string;
}

/**
 * Checks whether the Playwright Chromium executable is present on disk.
 * Uses playwright-core's chromium.executablePath() and fs.existsSync.
 * Returns missing/ready/unknown without assuming readiness.
 */
export async function getChromiumStatus(): Promise<ChromiumStatus> {
  try {
    const { chromium } = await import("playwright-core");
    let executablePath: string | null = null;
    try {
      executablePath = chromium.executablePath();
    } catch (e: any) {
      return {
        status: "unknown",
        executablePath: null,
        details: `Failed to resolve executablePath: ${e?.message || String(e)}`
      };
    }
    if (!executablePath) {
      return { status: "unknown", executablePath: null, details: "chromium.executablePath() returned empty" };
    }
    const exists = fs.existsSync(executablePath);
    if (exists) {
      return { status: "ready", executablePath, details: "Chromium executable present" };
    }
    return {
      status: "missing",
      executablePath,
      details: "Chromium executable not found. Run: npm run browser:install (pinned playwright 1.62.1 matches playwright-core 1.62.1) and ensure versions align."
    };
  } catch (e: any) {
    return {
      status: "unknown",
      executablePath: null,
      details: `Failed to import playwright-core: ${e?.message || String(e)}`
    };
  }
}

export function getChromiumStatusSync(): ChromiumStatus {
  try {
    // Dynamic import cannot be synchronous; return unknown if async path not usable.
    // Callers that need sync should use getChromiumStatus async.
    return { status: "unknown", executablePath: null, details: "Use async getChromiumStatus() for provisioning check" };
  } catch (e: any) {
    return { status: "unknown", executablePath: null, details: e?.message || String(e) };
  }
}
