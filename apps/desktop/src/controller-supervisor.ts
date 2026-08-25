import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  ORCA_PROTOCOL_VERSION,
  evaluateControllerCompatibility,
  type ControllerIdentity,
  type DesktopStartupState,
  type DesktopBuildIdentity
} from "@orca/shared";

/**
 * Desktop-side controller supervision (Change 025 supervision + Change 026
 * exact-build compatibility and safe replacement).
 *
 * Reuse before spawn: probe the loopback identity endpoint first. A PACKAGED
 * desktop reuses only an exact build (same version AND same buildId); any
 * other Orca-but-different build goes through the authenticated graceful
 * replacement contract instead of being silently mixed. Development keeps the
 * looser protocol-only reuse. Foreign listeners are diagnosed, never killed,
 * and never sent lifecycle requests. The spawned controller is detached and
 * never signalled by the desktop, so closing the window cannot terminate
 * controller-owned orchestration.
 */

export const CONTROLLER_START_BUDGET_MS = 45_000;
export const REPLACEMENT_SHUTDOWN_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 1500;
const READY_POLL_INITIAL_MS = 250;
const READY_POLL_MAX_MS = 2000;

/** Filename of the controller runtime-lock inside the Orca data directory. */
export const CONTROLLER_LOCK_FILENAME = "controller.lock";

export type ProbeOutcome =
  | { kind: "compatible"; identity: ControllerIdentity }
  | { kind: "incompatible"; identity: ControllerIdentity | null; reason: string }
  | { kind: "foreign"; status?: number }
  | { kind: "absent" };

export function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
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
    const req = http.request(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => finish({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", (err) => finish({ error: err.message }));
    if (options.body) req.write(options.body);
    req.end();
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
      // Change 026 additive fields are validated only when present so a
      // Change-025 peer (protocol 1) remains parseable.
      if (candidate.buildId !== undefined && typeof candidate.buildId !== "string") return null;
      if (
        candidate.mode !== undefined &&
        candidate.mode !== "packaged" &&
        candidate.mode !== "development"
      ) {
        return null;
      }
      if (
        candidate.maxSchemaVersion !== undefined &&
        typeof candidate.maxSchemaVersion !== "number"
      ) {
        return null;
      }
      return candidate as ControllerIdentity;
    }
    return null;
  } catch {
    return null;
  }
}

type Probed =
  | { kind: "identity"; identity: ControllerIdentity }
  | { kind: "foreign"; status?: number }
  | { kind: "absent" };

async function probeControllerRaw(baseUrl: string): Promise<Probed> {
  const result = await fetchWithTimeout(`${baseUrl}/api/system/identity`, PROBE_TIMEOUT_MS);
  if ("error" in result) {
    return { kind: "absent" };
  }
  const identity = parseIdentityBody(result.body);
  if (!identity) {
    return { kind: "foreign", status: result.status };
  }
  return { kind: "identity", identity };
}

/**
 * Backward-compatible probe classification used by tests and callers that only
 * need compatible/incompatible/foreign/absent.
 */
export async function probeController(baseUrl: string): Promise<ProbeOutcome> {
  const probed = await probeControllerRaw(baseUrl);
  if (probed.kind === "absent") return { kind: "absent" };
  if (probed.kind === "foreign") return { kind: "foreign", status: probed.status };
  if (probed.identity.protocol !== ORCA_PROTOCOL_VERSION) {
    return {
      kind: "incompatible",
      identity: probed.identity,
      reason: `protocol ${probed.identity.protocol} != ${ORCA_PROTOCOL_VERSION}`
    };
  }
  return { kind: "compatible", identity: probed.identity };
}

// ---------------------------------------------------------------------------
// Runtime-lock metadata access + authenticated graceful replacement (026)
// ---------------------------------------------------------------------------

export interface ControllerLockInfo {
  pid: number;
  startedAt?: string;
  version?: string;
  endpoint?: string;
  controlToken?: string;
}

export function readControllerLockInfo(dataDir: string, opts: { now?: typeof Date.now } = {}): ControllerLockInfo | null {
  void opts;
  const lockPath = path.join(dataDir, CONTROLLER_LOCK_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ControllerLockInfo> & { service?: string };
    if (!parsed || parsed.service !== "orca-controller" || typeof parsed.pid !== "number") {
      return null;
    }
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : undefined,
      controlToken: typeof parsed.controlToken === "string" ? parsed.controlToken : undefined
    };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export interface LifecycleStatusResponse {
  state: "idle" | "active-campaigns" | "shutting-down";
  activeCampaigns?: { repositoryId: string; runId: string; loopState: string }[];
}

export async function fetchLifecycleStatus(
  baseUrl: string,
  controlToken: string
): Promise<{ ok: true; status: LifecycleStatusResponse } | { ok: false; reason: string }> {
  const result = await fetchWithTimeout(`${baseUrl}/api/system/lifecycle`, PROBE_TIMEOUT_MS, {
    headers: { "x-orca-control-token": controlToken }
  });
  if ("error" in result) return { ok: false, reason: `unreachable: ${result.error}` };
  if (result.status === 401) return { ok: false, reason: "token-rejected" };
  if (result.status !== 200) return { ok: false, reason: `http-${result.status}` };
  try {
    const parsed = JSON.parse(result.body) as LifecycleStatusResponse;
    if (parsed?.state !== "idle" && parsed?.state !== "active-campaigns") {
      return { ok: false, reason: "unrecognized-state" };
    }
    return { ok: true, status: parsed };
  } catch {
    return { ok: false, reason: "unparseable-body" };
  }
}

export async function requestGracefulShutdown(
  baseUrl: string,
  controlToken: string
): Promise<{ accepted: true } | { accepted: false; reason: string; activeCampaigns?: LifecycleStatusResponse["activeCampaigns"] }> {
  const result = await fetchWithTimeout(`${baseUrl}/api/system/shutdown`, PROBE_TIMEOUT_MS, {
    method: "POST",
    headers: {
      "x-orca-control-token": controlToken,
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  if ("error" in result) return { accepted: false, reason: `unreachable: ${result.error}` };
  if (result.status === 409) {
    try {
      const parsed = JSON.parse(result.body) as { error?: string; activeCampaigns?: LifecycleStatusResponse["activeCampaigns"] };
      return {
        accepted: false,
        reason: parsed.error === "SHUTDOWN_REFUSED_ACTIVE" ? "active-campaigns" : `http-409`,
        activeCampaigns: parsed.activeCampaigns
      };
    } catch {
      return { accepted: false, reason: "http-409" };
    }
  }
  if (result.status === 401) return { accepted: false, reason: "token-rejected" };
  if (result.status !== 200) return { accepted: false, reason: `http-${result.status}` };
  return { accepted: true };
}

export interface ReplacementDeps {
  baseUrl: string;
  dataDir: string;
  /** Bounded wait for process exit + lock release after an accepted shutdown. */
  shutdownTimeoutMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  /** Liveness seam for tests (defaults to real signal-0 probing). */
  aliveFn?: (pid: number) => boolean;
  lifecycleFn?: typeof fetchLifecycleStatus;
  shutdownFn?: typeof requestGracefulShutdown;
  lockInfoFn?: (dataDir: string) => ControllerLockInfo | null;
}

export type ReplacementOutcome =
  | { outcome: "lock-absent"; detail: string }
  | { outcome: "owner-dead"; detail: string }
  | { outcome: "not-replaceable"; detail: string }
  | { outcome: "active-campaigns"; detail: string; activeCampaigns: NonNullable<LifecycleStatusResponse["activeCampaigns"]> }
  | { outcome: "shutdown-timeout"; detail: string }
  | { outcome: "replaced"; detail: string };

/**
 * Attempt safe replacement of a live mismatched controller. Never signals or
 * kills a PID: shutdown happens only when the listener itself proves ownership
 * of the current control token and accepts a graceful request. The desktop
 * then waits for real process exit plus lock-file release before reporting
 * success.
 */
export async function attemptControllerReplacement(deps: ReplacementDeps): Promise<ReplacementOutcome> {
  const sleep = deps.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const lifecycleFn = deps.lifecycleFn ?? fetchLifecycleStatus;
  const shutdownFn = deps.shutdownFn ?? requestGracefulShutdown;
  const lockInfoFn = deps.lockInfoFn ?? readControllerLockInfo;
  const aliveFn = deps.aliveFn ?? isPidAlive;
  const timeoutMs = deps.shutdownTimeoutMs ?? REPLACEMENT_SHUTDOWN_TIMEOUT_MS;

  const lock = lockInfoFn(deps.dataDir);
  if (!lock || !Number.isInteger(lock.pid)) {
    return {
      outcome: "lock-absent",
      detail: "No readable controller ownership metadata; treating previous owner as absent."
    };
  }
  if (!aliveFn(lock.pid)) {
    return {
      outcome: "owner-dead",
      detail: `Previous controller (pid=${lock.pid}) is not alive; stale lock can be reclaimed safely.`
    };
  }
  if (!lock.controlToken) {
    return {
      outcome: "not-replaceable",
      detail:
        "The running controller predates safe-replacement metadata (no control token). " +
        "Quit the old Orca controller manually, then retry."
    };
  }

  const status = await lifecycleFn(deps.baseUrl, lock.controlToken);
  if (!status.ok) {
    return {
      outcome: "not-replaceable",
      detail: `Cannot prove safe shutdown of pid=${lock.pid} (${status.reason}); refusing to disturb it.`
    };
  }
  if (status.status.state === "active-campaigns") {
    const count = status.status.activeCampaigns?.length ?? 0;
    return {
      outcome: "active-campaigns",
      detail:
        `${count} active campaign${count === 1 ? "" : "s"} still running under the previous ` +
        `controller (pid=${lock.pid}). Background work continues; Orca will retry once idle.`,
      activeCampaigns: status.status.activeCampaigns ?? []
    };
  }

  const shutdown = await shutdownFn(deps.baseUrl, lock.controlToken);
  if (!shutdown.accepted) {
    if (shutdown.reason === "active-campaigns") {
      return {
        outcome: "active-campaigns",
        detail: `Controller refused shutdown because campaigns became active (pid=${lock.pid}).`,
        activeCampaigns: shutdown.activeCampaigns ?? []
      };
    }
    return {
      outcome: "not-replaceable",
      detail: `Graceful shutdown was not accepted (reason: ${shutdown.reason}); nothing was terminated.`
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    if (!aliveFn(lock.pid)) {
      // Wait briefly for the lock file itself to disappear (graceful release).
      const releaseDeadline = Date.now() + 5000;
      while (Date.now() < releaseDeadline) {
        if (lockInfoFn(deps.dataDir) === null) {
          return {
            outcome: "replaced",
            detail: `Previous controller (pid=${lock.pid}) exited gracefully and released ownership.`
          };
        }
        await sleep(100);
      }
      return {
        outcome: "shutdown-timeout",
        detail: `Process exited but ownership metadata did not clear within 5s; refusing to race it.`
      };
    }
  }
  return {
    outcome: "shutdown-timeout",
    detail: `Controller (pid=${lock.pid}) did not exit within ${Math.round(timeoutMs / 1000)}s of an accepted graceful shutdown.`
  };
}

// ---------------------------------------------------------------------------
// Spawn planning + ensure flow
// ---------------------------------------------------------------------------

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
  buildId?: string;
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
    ...(options.buildId ? { ORCA_BUILD_COMMIT: options.buildId } : {}),
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
  buildId?: string;
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
      ...(options.buildId ? { ORCA_BUILD_COMMIT: options.buildId } : {}),
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
  /** Immutable build identity of THIS desktop build (Change 026). */
  buildId?: string;
  maxSchemaVersion?: number;
  host?: string;
  port?: number;
  dataDir?: string;
  logDir?: string;
  onState?: (state: DesktopStartupState, detail?: string) => void;
  spawnFn?: typeof spawn;
  probeFn?: (baseUrl: string) => Promise<ProbeOutcome>;
  sleepFn?: (ms: number) => Promise<void>;
  budgetMs?: number;
  /** Test seam: override the safe-replacement attempt. */
  replacementFn?: (deps: ReplacementDeps) => Promise<ReplacementOutcome>;
}

export type EnsureControllerResult =
  | { outcome: "connected"; reused: boolean; identity: ControllerIdentity | null }
  | { outcome: "restart-pending"; detail: string }
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

interface DesktopIdentityView extends DesktopBuildIdentity {
  dataDir?: string;
}

function classify(probed: Probed, desktop: DesktopIdentityView) {
  return evaluateControllerCompatibility(
    {
      version: desktop.version,
      buildId: desktop.buildId,
      mode: desktop.mode,
      maxSchemaVersion: desktop.maxSchemaVersion
    },
    probed
  );
}

/**
 * Single probe path: uses the injected legacy probeFn (older tests) when
 * present, otherwise the raw prober. Legacy outcomes are translated into the
 * Probed shape so classification stays uniform.
 */
async function probeWithDeps(deps: EnsureControllerDeps): Promise<Probed> {
  if (!deps.probeFn) return probeControllerRaw(deps.baseUrl);
  const legacy = await deps.probeFn(deps.baseUrl);
  if (legacy.kind === "absent") return { kind: "absent" };
  if (legacy.kind === "foreign") return { kind: "foreign", status: legacy.status };
  if (legacy.kind === "incompatible") {
    // Protocol mismatched peer; synthesize a minimal identity for classification.
    return {
      kind: "identity",
      identity:
        legacy.identity ?? {
          service: "orca-controller",
          version: "unknown",
          protocol: ORCA_PROTOCOL_VERSION + 999,
          pid: -1
        }
    };
  }
  return { kind: "identity", identity: legacy.identity };
}

/**
 * Handle a RESTART_REQUIRED verdict (different Orca build owns the endpoint).
 * Attempts safe replacement through the authenticated contract. Returns a
 * result when startup should stop with a truthful pending state; returns null
 * when the caller may proceed (replacement done / owner already gone).
 */
async function resolveRestartRequired(
  deps: EnsureControllerDeps,
  report: (state: DesktopStartupState, detail?: string) => void
): Promise<EnsureControllerResult | null> {
  if (!deps.dataDir) {
    const detail =
      "A different Orca controller build owns this endpoint and no data directory is configured " +
      "for safe replacement. Quit the old Orca controller, then retry.";
    report("RESTART_PENDING", detail);
    return { outcome: "restart-pending", detail };
  }
  const attempt = deps.replacementFn
    ? await deps.replacementFn({ baseUrl: deps.baseUrl, dataDir: deps.dataDir })
    : await attemptControllerReplacement({ baseUrl: deps.baseUrl, dataDir: deps.dataDir });

  if (
    attempt.outcome === "active-campaigns" ||
    attempt.outcome === "not-replaceable" ||
    attempt.outcome === "shutdown-timeout"
  ) {
    const detail = `Update pending: background work continues under the previous controller. ${attempt.detail}`;
    report("RESTART_PENDING", detail);
    return { outcome: "restart-pending", detail };
  }
  // lock-absent / owner-dead / replaced: safe to proceed.
  report("STARTING_CONTROLLER", attempt.detail);
  return null;
}

export async function ensureController(deps: EnsureControllerDeps): Promise<EnsureControllerResult> {
  const spawnFn = deps.spawnFn ?? spawn;
  const sleep = deps.sleepFn ?? defaultSleep;
  const budgetMs = deps.budgetMs ?? CONTROLLER_START_BUDGET_MS;
  const startedAt = Date.now();
  const report = (state: DesktopStartupState, detail?: string) => deps.onState?.(state, detail);
  const desktop: DesktopIdentityView = {
    version: deps.version,
    buildId: deps.buildId,
    mode: deps.packaged ? "packaged" : "development",
    maxSchemaVersion: deps.maxSchemaVersion,
    dataDir: deps.dataDir
  };

  report("CHECKING_CONTROLLER");
  const existingProbed = await probeWithDeps(deps);
  const existingVerdict = classify(existingProbed, desktop);

  if (existingVerdict === "EXACT_MATCH" || existingVerdict === "COMPATIBLE_VERSION_SKEW") {
    const identity = existingProbed.kind === "identity" ? existingProbed.identity : null;
    report(
      "CONNECTED",
      `reused controller pid=${identity?.pid}${existingVerdict === "COMPATIBLE_VERSION_SKEW" ? " (development version skew tolerated)" : ""}`
    );
    return { outcome: "connected", reused: true, identity };
  }

  if (existingVerdict === "RESTART_REQUIRED") {
    // Packaged upgrade path: replace through the authenticated contract.
    const resolved = await resolveRestartRequired(deps, report);
    if (resolved) return resolved;
  } else if (existingVerdict === "DATABASE_INCOMPATIBLE") {
    const probedSchema =
      existingProbed.kind === "identity" ? existingProbed.identity.maxSchemaVersion : undefined;
    const detail =
      `The running Orca controller manages a newer database schema (${probedSchema ?? "unknown"}) ` +
      `than this application supports (${deps.maxSchemaVersion ?? "unknown"}). Install a matching ` +
      `or newer Orca release; your data was not modified.`;
    report("DATABASE_TOO_NEW", detail);
    return { outcome: "terminal", state: "DATABASE_TOO_NEW", detail };
  } else if (existingVerdict === "PROTOCOL_INCOMPATIBLE") {
    const identity = existingProbed.kind === "identity" ? existingProbed.identity : null;
    const detail = `Incompatible Orca controller already owns ${deps.baseUrl} (protocol ${identity?.protocol} != ${ORCA_PROTOCOL_VERSION}). Close it or update Orca.`;
    report("INCOMPATIBLE_CONTROLLER", detail);
    return { outcome: "terminal", state: "INCOMPATIBLE_CONTROLLER", detail };
  } else if (existingVerdict === "FOREIGN_LISTENER") {
    const status = existingProbed.kind === "foreign" ? existingProbed.status : undefined;
    const detail = `Port at ${deps.baseUrl} is occupied by another application (HTTP ${status ?? "?"}). Orca will not terminate it.`;
    report("PORT_CONFLICT", detail);
    return { outcome: "terminal", state: "PORT_CONFLICT", detail };
  }

  const effectivePlan = deps.packaged
    ? buildControllerSpawnPlan({
        electronExecPath: deps.electronExecPath,
        resourcesPath: deps.resourcesPath,
        version: deps.version,
        buildId: deps.buildId,
        host: deps.host,
        port: deps.port,
        dataDir: deps.dataDir
      })
    : buildDevFallbackSpawnPlan({
        electronExecPath: deps.electronExecPath,
        desktopDistDir: deps.desktopDistDir,
        version: deps.version,
        buildId: deps.buildId,
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

    const pollProbed = await probeWithDeps(deps);
    const pollVerdict = classify(pollProbed, desktop);

    if (pollVerdict === "EXACT_MATCH" || pollVerdict === "COMPATIBLE_VERSION_SKEW") {
      const identity = pollProbed.kind === "identity" ? pollProbed.identity : null;
      report("CONNECTED", `controller pid=${identity?.pid}`);
      return { outcome: "connected", reused: false, identity };
    }
    if (pollVerdict === "RESTART_REQUIRED") {
      // A skew controller appeared mid-wait (lost ownership race): try the
      // authenticated replacement path instead of spinning until budget end.
      const resolved = await resolveRestartRequired(deps, report);
      if (resolved) return resolved;
      continue;
    }
    if (pollVerdict === "DATABASE_INCOMPATIBLE") {
      const detail =
        "The controller that just became ready manages a database schema newer than this application supports.";
      report("DATABASE_TOO_NEW", detail);
      return { outcome: "terminal", state: "DATABASE_TOO_NEW", detail };
    }
    if (pollVerdict === "PROTOCOL_INCOMPATIBLE") {
      const detail = "Controller became ready with an incompatible protocol.";
      report("INCOMPATIBLE_CONTROLLER", detail);
      return { outcome: "terminal", state: "INCOMPATIBLE_CONTROLLER", detail };
    }
    if (pollVerdict === "FOREIGN_LISTENER") {
      const detail = "Port at the configured endpoint is occupied by another application; Orca will not terminate it.";
      report("PORT_CONFLICT", detail);
      return { outcome: "terminal", state: "PORT_CONFLICT", detail };
    }

    // Absent so far: distinguish a crashed child early instead of polling the
    // full budget against a dead process. Exit codes 10/11/12 are structured
    // codes from the controller entrypoint (singleton busy / port conflict /
    // database too new).
    if (child.exited && child.exitCode !== null) {
      if (child.exitCode === 10 || child.exitCode === 11 || child.exitCode === 12) {
        const afterRace = await probeWithDeps(deps);
        const afterVerdict = classify(afterRace, desktop);
        if (afterVerdict === "EXACT_MATCH" || afterVerdict === "COMPATIBLE_VERSION_SKEW") {
          const identity = afterRace.kind === "identity" ? afterRace.identity : null;
          report("CONNECTED", `reused controller pid=${identity?.pid}`);
          return { outcome: "connected", reused: true, identity };
        }
        if (afterVerdict === "FOREIGN_LISTENER") {
          const detail = "Port at the configured endpoint is occupied by another application; Orca will not terminate it.";
          report("PORT_CONFLICT", detail);
          return { outcome: "terminal", state: "PORT_CONFLICT", detail };
        }
        if (afterVerdict === "RESTART_REQUIRED") {
          const resolved = await resolveRestartRequired(deps, report);
          if (resolved) return resolved;
          continue;
        }
        if (afterVerdict === "DATABASE_INCOMPATIBLE" || afterVerdict === "PROTOCOL_INCOMPATIBLE") {
          const detail =
            afterVerdict === "DATABASE_INCOMPATIBLE"
              ? "The winning controller manages a newer database schema than this application supports."
              : "The winning controller speaks an incompatible protocol.";
          const state: DesktopStartupState =
            afterVerdict === "DATABASE_INCOMPATIBLE" ? "DATABASE_TOO_NEW" : "INCOMPATIBLE_CONTROLLER";
          report(state, detail);
          return { outcome: "terminal", state, detail };
        }
        const exitDetail =
          child.exitCode === 12
            ? "its database schema is newer than this build supports (downgrade refused; data untouched)"
            : child.exitCode === 10
              ? "another controller owns the data directory"
              : "the port is occupied";
        const detail = `Controller exited during startup (exit code ${child.exitCode}: ${exitDetail}).`;
        const state: DesktopStartupState =
          child.exitCode === 12 ? "DATABASE_TOO_NEW" : child.exitCode === 11 ? "PORT_CONFLICT" : "STARTUP_FAILED";
        report(state, detail);
        return { outcome: "terminal", state, detail };
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

  const lastProbed = await probeWithDeps(deps);
  const lastVerdict = classify(lastProbed, desktop);
  if (lastVerdict === "EXACT_MATCH" || lastVerdict === "COMPATIBLE_VERSION_SKEW") {
    const identity = lastProbed.kind === "identity" ? lastProbed.identity : null;
    report("CONNECTED", `controller pid=${identity?.pid}`);
    return { outcome: "connected", reused: false, identity };
  }
  const detail = `Controller did not become ready within ${Math.round(budgetMs / 1000)}s. Check logs under the Orca data directory.`;
  report("STARTUP_FAILED", detail);
  return { outcome: "terminal", state: "STARTUP_FAILED", detail };
}
