import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RuntimeMode = "development" | "packaged";

export interface ResolvedRuntimePaths {
  mode: RuntimeMode;
  dataDir: string;
  dbPath: string;
  logDir: string;
  browserProfileDir: string;
  runtimeLockPath: string;
  uiDistDir: string | null;
}

/**
 * Packaged execution is explicit: the desktop supervisor sets ORCA_PACKAGED=1
 * for the controller it spawns. Development never engages packaged resolution.
 */
export function isPackagedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ORCA_PACKAGED === "1";
}

function defaultDataDir(): string {
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Orca-Strator")
    : path.join(os.homedir(), ".orca-strator");
}

/**
 * Built UI location, resolved relative to THIS module (never process.cwd()):
 * - development: apps/controller/dist/runtime -> ../../../ui/dist = apps/ui/dist
 * - packaged:    <resources>/controller/dist/runtime -> ../../../ui = <resources>/ui
 */
function resolveUiDistDir(mode: RuntimeMode): string | null {
  const override = process.env.ORCA_UI_DIST_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  if (mode === "packaged") {
    return path.resolve(__dirname, "../../../ui");
  }
  // Development fallback keeps the historical repo-relative behavior but is
  // explicitly classified as a development-only convenience.
  const candidate = path.resolve(__dirname, "../../../ui/dist");
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Explicit writable-path contract. Every generated artifact lives under the
 * Orca data directory; nothing writes into packaged resources.
 */
export function resolveRuntimePaths(
  options: { dataDir?: string; dbPath?: string } = {},
  env: NodeJS.ProcessEnv = process.env
): ResolvedRuntimePaths {
  const mode: RuntimeMode = isPackagedRuntime(env) ? "packaged" : "development";
  const dataDir = path.resolve(options.dataDir ?? env.ORCA_DATA_DIR ?? defaultDataDir());
  const dbPath = path.resolve(options.dbPath ?? path.join(dataDir, "orca-strator.sqlite"));
  return {
    mode,
    dataDir,
    dbPath,
    logDir: path.join(dataDir, "logs"),
    browserProfileDir: path.join(dataDir, "browser", "profile"),
    runtimeLockPath: path.join(dataDir, "controller.lock"),
    uiDistDir: resolveUiDistDir(mode)
  };
}
