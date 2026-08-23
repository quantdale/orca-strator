import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import {
  ORCA_PROTOCOL_VERSION,
  type ControllerIdentity,
  type DesktopStartupState
} from "@orca/shared";

/**
 * Desktop-side controller supervision (Change 025).
 *
 * Reuse before spawn: probe the loopback identity endpoint first. A compatible
 * live controller is reused; only absence permits a spawn attempt. The spawned
 * controller is detached and never signalled by the desktop, so closing the
 * window cannot terminate controller-owned orchestration. Foreign listeners
 * are diagnosed, never killed.
 */

export const CONTROLLER_START_BUDGET_MS = 45_000;
const PROBE_TIMEOUT_MS = 1500;
const READY_POLL_INITIAL_MS = 250;
const READY_POLL_MAX_MS = 2000;

export type ProbeOutcome =
  | { kind: "compatible"; identity: ControllerIdentity }
  | { kind: "incompatible"; identity: ControllerIdentity | null; reason: string }
  | { kind: "foreign"; status?: number }
  | { kind: "absent" };

export function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<{ status: number; body: string } | { error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { status: number; body: string } | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      req.destroy();
      finish({ error: "timeout" });
    }, timeoutMs);
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => finish({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", (err) => finish({ error: err.message }));
  });
}

export function parseIdentityBody(body: string): ControllerIdentity | null {
  try {
    const parsed = JSON.parse(body) as Partial<ControllerIdentity> & { identity?: Partial<ControllerIdentity> };
    const candidate = parsed.identity ?? parsed;
    if (
      candidate &&
      candidate.service === "orca-controller" &&
      typeof candidate.version === "string" &&
      typeof candidate.protocol === "number" &&
      typeof candidate.pid === "number"
    ) {
      return candidate as ControllerIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

export async function probeController(baseUrl: string): Promise<ProbeOutcome> {
  const result = await fetchWithTimeout(`${baseUrl}/api/system/identity`, PROBE_TIMEOUT_MS);
  if ("error" in result) {
    return { kind: "absent" };
  }
  const identity = parseIdentityBody(result.body);
  if (!identity) {
    return { kind: "foreign", status: result.status };
  }
  if (identity.protocol !== ORCA_PROTOCOL_VERSION) {
    return { kind: "incompatible", identity, reason: `protocol ${identity.protocol} != ${ORCA_PROTOCOL_VERSION}` };
  }
  return { kind: "compatible", identity };
}

export interface SpawnPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Packaged launch strategy (task 0.3): execute the bundled Electron runtime in
 * Node mode (ELECTRON_RUN_AS_NODE=1) against the compiled controller entry.
 * This keeps the package self-contained (no system Node requirement) while the
 * controller remains an independent OS process outside Electron's lifetime.
 */
export function buildControllerSpawnPlan(options: {
  electronExecPath: string;
  resourcesPath: string;
  version: string;
  host?: string;
  port?: number;
  dataDir?: string;
  logDir?: string;
}): SpawnPlan {
  const controllerEntry = path.join(options.resourcesPath, "controller", "dist", "index.js");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    ORCA_PACKAGED: "1",
    ORCA_BUILD_VERSION: options.version,
    ...(options.host ? { ORCA_HOST: options.host } : {}),
    ...(options.port ? { ORCA_PORT: String(options.port) } : {}),
    ...(options.dataDir ? { ORCA_DATA_DIR: options.dataDir } : {})
  };
  return { command: options.electronExecPath, args: [controllerEntry], env };
}

/** Explicitly gated development fallback used only by tests/manual recovery. */
export function buildDevFallbackSpawnPlan(options: {
  electronExecPath: string;
  desktopDistDir: string;
  version: string;
  host?: string;
  port?: number;
  dataDir?: string;
}): SpawnPlan | null {
  if (process.env.ORCA_ALLOW_DEV_CONTROLLER_SPAWN !== "1") {
    return null;
  }
  const controllerEntry = path.resolve(options.desktopDistDir, "../../controller/dist/index.js");
  return {
    command: options.electronExecPath,
    args: [controllerEntry],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ORCA_BUILD_VERSION: options.version,
      ...(options.host ? { ORCA_HOST: options.host } : {}),
      ...(options.port ? { ORCA_PORT: String(options.port) } : {}),
      ...(options.dataDir ? { ORCA_DATA_DIR: options.dataDir } : {})
    }
  };
}

export interface EnsureControllerDeps {
  baseUrl: string;
  version: string;
  electronExecPath: string;
  /** Packaged apps point this at install resources; dev passes the repo path. */
  resourcesPath: string;
  desktopDistDir: string;
  packaged: boolean;
  host?: string;
  port?: number;
  dataDir?: string;
  onState?: (state: DesktopStartupState, detail?: string) => void;
  spawnFn?: typeof spawn;
  probeFn?: (baseUrl: string) => Promise<ProbeOutcome>;
  sleepFn?: (ms: number) => Promise<void>;
  budgetMs?: number;
}

export type EnsureControllerResult =
  | { outcome: "connected"; reused: boolean; identity: ControllerIdentity | null }
  | { outcome: "terminal"; state: DesktopStartupState; detail: string };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LaunchedChild {
  pid?: number;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
}

function launch(plan: SpawnPlan, spawnFn: typeof spawn): LaunchedChild {
  const child: ChildProcess = spawnFn(plan.command, plan.args, {
    env: plan.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  const tracked: LaunchedChild = { pid: child.pid, exitCode: null, exitSignal: null, exited: false };
  child.once("exit", (code, signal) => {
    tracked.exited = true;
    tracked.exitCode = code;
    tracked.exitSignal = signal;
  });
  // The controller outlives the desktop by design; never hold its event loop.
  child.unref();
  return tracked;
}

export async function ensureController(deps: EnsureControllerDeps): Promise<EnsureControllerResult> {
  const probe = deps.probeFn ?? probeController;
  const spawnFn = deps.spawnFn ?? spawn;
  const sleep = deps.sleepFn ?? defaultSleep;
  const budgetMs = deps.budgetMs ?? CONTROLLER_START_BUDGET_MS;
  const startedAt = Date.now();
  const report = (state: DesktopStartupState, detail?: string) => deps.onState?.(state, detail);

  report("CHECKING_CONTROLLER");
  const existing = await probe(deps.baseUrl);
  if (existing.kind === "compatible") {
    report("CONNECTED", `reused controller pid=${existing.identity.pid}`);
    return { outcome: "connected", reused: true, identity: existing.identity };
  }
  if (existing.kind === "incompatible") {
    const detail = `Incompatible Orca controller already owns ${deps.baseUrl} (${existing.reason}). Close it or update Orca.`;
    report("INCOMPATIBLE_CONTROLLER", detail);
    return { outcome: "terminal", state: "INCOMPATIBLE_CONTROLLER", detail };
  }
  if (existing.kind === "foreign") {
    const detail = `Port at ${deps.baseUrl} is occupied by another application (HTTP ${existing.status ?? "?"}). Orca will not terminate it.`;
    report("PORT_CONFLICT", detail);
    return { outcome: "terminal", state: "PORT_CONFLICT", detail };
  }

  const effectivePlan = deps.packaged
    ? buildControllerSpawnPlan({
        electronExecPath: deps.electronExecPath,
        resourcesPath: deps.resourcesPath,
        version: deps.version,
        host: deps.host,
        port: deps.port,
        dataDir: deps.dataDir
      })
    : buildDevFallbackSpawnPlan({
        electronExecPath: deps.electronExecPath,
        desktopDistDir: deps.desktopDistDir,
        version: deps.version,
        host: deps.host,
        port: deps.port,
        dataDir: deps.dataDir
      });
  if (!effectivePlan) {
    const detail =
      "No controller is running and this build has no packaged controller resources. " +
      "Start the development supervisor (`npm run dev`) instead.";
    report("STARTUP_FAILED", detail);
    return { outcome: "terminal", state: "STARTUP_FAILED", detail };
  }

  report("STARTING_CONTROLLER", effectivePlan.args.join(" "));
  const child = launch(effectivePlan, spawnFn);

  report("WAITING_FOR_READY");
  let delay = READY_POLL_INITIAL_MS;
  while (Date.now() - startedAt < budgetMs) {
    await sleep(delay);
    delay = Math.min(delay * 2, READY_POLL_MAX_MS);

    const outcome = await probe(deps.baseUrl);
    if (outcome.kind === "compatible") {
      report("CONNECTED", `controller pid=${outcome.identity.pid}`);
      return { outcome: "connected", reused: false, identity: outcome.identity };
    }
    if (outcome.kind === "incompatible") {
      const detail = `Controller became ready with an incompatible protocol (${outcome.reason}).`;
      report("INCOMPATIBLE_CONTROLLER", detail);
      return { outcome: "terminal", state: "INCOMPATIBLE_CONTROLLER", detail };
    }
    if (outcome.kind === "foreign") {
      const detail = `Port at ${deps.baseUrl} is occupied by another application; Orca will not terminate it.`;
      report("PORT_CONFLICT", detail);
      return { outcome: "terminal", state: "PORT_CONFLICT", detail };
    }

    // Absent so far: distinguish a crashed child early instead of polling the
    // full budget against a dead process. Exit 10/11 are structured codes from
    // the controller entrypoint (singleton busy / port conflict).
    if (child.exited && child.exitCode !== null) {
      if (child.exitCode === 10 || child.exitCode === 11) {
        const afterRace = await probe(deps.baseUrl);
        if (afterRace.kind === "compatible") {
          report("CONNECTED", `reused controller pid=${afterRace.identity.pid}`);
          return { outcome: "connected", reused: true, identity: afterRace.identity };
        }
        if (afterRace.kind === "foreign") {
          const detail = `Port at ${deps.baseUrl} is occupied by another application; Orca will not terminate it.`;
          report("PORT_CONFLICT", detail);
          return { outcome: "terminal", state: "PORT_CONFLICT", detail };
        }
        const detail =
          `Controller exited during startup (exit code ${child.exitCode}: ` +
          `${child.exitCode === 10 ? "another controller owns the data directory" : "port conflict"}).`;
        report(child.exitCode === 11 ? "PORT_CONFLICT" : "STARTUP_FAILED", detail);
        return {
          outcome: "terminal",
          state: child.exitCode === 11 ? "PORT_CONFLICT" : "STARTUP_FAILED",
          detail
        };
      }
      if (child.exitCode !== 0) {
        // Give a just-spawned twin a moment only if the port answers; otherwise fail fast.
        const detail =
          `Controller process exited unexpectedly (exit code ${child.exitCode}` +
          `${child.exitSignal ? `, signal ${child.exitSignal}` : ""}). Check logs under the Orca data directory.`;
        report("STARTUP_FAILED", detail);
        return { outcome: "terminal", state: "STARTUP_FAILED", detail };
      }
    }
  }

  const last = await probe(deps.baseUrl);
  if (last.kind === "compatible") {
    report("CONNECTED", `controller pid=${last.identity.pid}`);
    return { outcome: "connected", reused: false, identity: last.identity };
  }
  const detail = `Controller did not become ready within ${Math.round(budgetMs / 1000)}s. Check logs under the Orca data directory.`;
  report("STARTUP_FAILED", detail);
  return { outcome: "terminal", state: "STARTUP_FAILED", detail };
}
