import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ORCA_PROTOCOL_VERSION } from "@orca/shared";
import type { ControllerIdentity } from "@orca/shared";
import { MAX_KNOWN_SCHEMA_VERSION } from "../db/schema-compat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Controller build identity. Resolution order:
 * 1. ORCA_BUILD_VERSION (packaged builds stamp this explicitly);
 * 2. the controller package.json resolved relative to THIS module (never cwd),
 *    which works both in the repository layout and in the packaged
 *    resources/controller/ tree where package.json ships next to dist/;
 * 3. an explicit unknown marker rather than a fabricated version.
 */
export function readControllerVersion(): string {
  const fromEnv = process.env.ORCA_BUILD_VERSION;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  try {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch {
    // fall through to the truthful unknown marker
  }
  return "0.0.0-unknown";
}

let cachedBuildId: string | undefined;

/**
 * Immutable build identity (Change 026): the exact Git commit SHA this
 * controller was built from. Packaged builds receive it via ORCA_BUILD_COMMIT
 * (stamped from resources/build-info.json by the supervisor). Development
 * resolves the repository HEAD once and caches it. Wall-clock timestamps are
 * never used as identity. Returns undefined when no truthful source exists.
 */
export function readControllerBuildId(): string | undefined {
  const fromEnv = process.env.ORCA_BUILD_COMMIT;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  if (cachedBuildId !== undefined) return cachedBuildId;
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    cachedBuildId = /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
  } catch {
    cachedBuildId = undefined;
  }
  return cachedBuildId;
}

export function getControllerMode(): "packaged" | "development" {
  return process.env.ORCA_PACKAGED === "1" ? "packaged" : "development";
}

export function getControllerIdentity(): ControllerIdentity {
  const buildId = readControllerBuildId();
  return {
    service: "orca-controller",
    version: readControllerVersion(),
    protocol: ORCA_PROTOCOL_VERSION,
    pid: process.pid,
    ...(buildId ? { buildId } : {}),
    mode: getControllerMode(),
    maxSchemaVersion: MAX_KNOWN_SCHEMA_VERSION
  };
}
