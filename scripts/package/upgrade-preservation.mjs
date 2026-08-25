#!/usr/bin/env node
/**
 * Change 027 WS4 task 4.2: synthetic-version upgrade / data-preservation
 * exercise against the UNPACKED packaged runtime.
 *
 * Why this exists: Change 025's upgrade evidence was close/reopen persistence
 * of ONE artifact. A genuine older-binary rebuild from Git is impossible by
 * construction — pre-repair commits cannot compile (that IS the P0 being
 * fixed) — and executing the NSIS installer locally remains sanctioned-env
 * only. This harness therefore exercises the REAL cross-generation seams that
 * any installer upgrade produces, using the PRODUCTION stamping path:
 *
 *   Generation A (current artifact, as built):
 *     desktop -> controller vA (real version + real buildId), seed durable
 *     state through the packaged API, verify DB integrity, graceful shutdown
 *     through the authenticated lifecycle contract.
 *   Generation B (same artifact binary, stamped as a NEWER release via the
 *     exact env seams write-build-info/supervisor use in production):
 *     controller-only relaunch on the SAME data dir/port must (a) pass the
 *     schema downgrade preflight instead of refusing, (b) report the new
 *     identity (version + buildId skew visible), (c) preserve every durable
 *     row seeded under vA, (d) keep SQLite integrity/FK clean, and (e) shut
 *     down gracefully again through the authenticated contract.
 *
 * Honest tier: this proves UNPACKED_UPGRADE_PRESERVATION_QUALIFIED at the
 * controller-generation tier. NSIS installer lifecycle acceptance
 * (INSTALLER_LIFECYCLE_QUALIFIED) stays with the ephemeral-CI release job.
 *
 * Usage: node scripts/package/upgrade-preservation.mjs [--exe <Orca-Strator.exe>] [--port P]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  REPO_ROOT,
  get,
  request,
  waitFor,
  sleep,
  killPidOnly,
  isPidAlive,
  readLock,
  identityOnce,
  gracefulControllerShutdown,
  verifyDbIntegrity,
  tempRoot
} from "./harness-lib.mjs";

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const exePath = path.resolve(
  argValue("--exe", path.join(REPO_ROOT, "apps", "desktop", "release", "win-unpacked", "Orca-Strator.exe"))
);
if (!fs.existsSync(exePath)) {
  console.error(`[upgrade] missing unpacked artifact: ${exePath}. Run npm run package:win first.`);
  process.exit(1);
}
const resourcesDir = path.resolve(path.dirname(exePath), "resources");
const electronExe = exePath;
const PORT = Number(argValue("--port", String(47190 + Math.floor(Math.random() * 400))));
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function record(id, label, ok, detail = "") {
  results.push({ id, label, ok, detail });
  console.log(`[upgrade] ${ok ? "PASS" : "FAIL"} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
}

const workspace = tempRoot("orca-upgrade-preserve-");
const dataDir = path.join(workspace, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "orca-strator.sqlite");

let desktopPid = null;
let controllerPid = null;

function dumpLock(label) {
  const lockPath = path.join(dataDir, "controller.lock");
  const raw = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, "utf8") : "(absent)";
  console.log(`[upgrade][diag] ${label} controller.lock: ${raw.slice(0, 300)}`);
  const logPath = path.join(dataDir, "logs", "controller.log");
  if (fs.existsSync(logPath)) {
    const tail = fs.readFileSync(logPath, "utf8").split("\n").slice(-8).join(" | ");
    console.log(`[upgrade][diag] ${label} controller.log tail: ${tail.slice(0, 600)}`);
  }
}

async function launchGeneration({ version, buildId, label }) {
  // Exact production controller execution shape (controller-supervisor.ts
  // buildControllerSpawnPlan): Electron in Node mode against the staged entry.
  const child = spawn(
    electronExe,
    [path.join(resourcesDir, "controller", "dist", "index.js")],
    {
      cwd: workspace,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "production",
        ELECTRON_RUN_AS_NODE: "1",
        ORCA_PACKAGED: "1",
        ...(version ? { ORCA_BUILD_VERSION: version } : {}),
        ...(buildId ? { ORCA_BUILD_COMMIT: buildId } : {}),
        ORCA_PORT: String(PORT),
        ORCA_DATA_DIR: dataDir
      }
    }
  );
  child.unref();
  if (label === "A") controllerPid = child.pid;
  return child;
}

try {
  // ===================== Generation A: current artifact =====================
  await launchGeneration({ label: "A" });
  const idA = await waitFor(() => identityOnce(BASE), "generation-A readiness").catch(() => null);
  if (!idA) throw new Error("generation A controller never became ready");
  record("UP.A1", "generation A ready on isolated port/data dir", true, `pid=${idA.identity.pid} version=${idA.identity.version}`);
  controllerPid = idA.identity.pid;

  const repoPayload = {
    displayName: "Upgrade Preservation Repo",
    githubRemote: "https://github.com/example/upgrade-preservation.git",
    localPath: path.join(workspace, "repo"),
    environment: "windows",
    wslDistribution: null,
    executorCli: "kimi",
    executorModel: "preserve-model",
    solConversationUrl: "https://chatgpt.com/c/upgrade-preservation"
  };
  const createRes = await request(`${BASE}/api/repositories`, { method: "POST", payload: repoPayload });
  record("UP.A2", "durable fixture repository created under generation A", createRes.status === 200 || createRes.status === 201, `status=${createRes.status}`);

  const integrityA = verifyDbIntegrity(dbPath);
  record("UP.A3", "generation A database integrity", integrityA.ok === true, `migrations=${integrityA.migrationsApplied}`);

  dumpLock("A-after-seed");
  const probeHeaders = (() => {
    const l = readLock(dataDir);
    return l?.controlToken ? { "x-orca-control-token": l.controlToken } : {};
  })();
  const lc = await request(`${BASE}/api/system/lifecycle`, { headers: probeHeaders });
  console.log(`[upgrade][diag] lifecycle status=${lc.status} body=${lc.body?.slice(0, 200)}`);
  const shutdownA = await gracefulControllerShutdown(BASE, dataDir);
  record("UP.A4", "authenticated graceful shutdown of generation A", shutdownA === true);
  dumpLock("A-after-shutdown");
  if (!shutdownA) {
    const lockA = readLock(dataDir);
    if (lockA && isPidAlive(lockA.pid)) killPidOnly(lockA.pid);
  }

  // ============== Generation B: synthetic newer-release stamping ==============
  const syntheticVersion = "9.9.9";
  const syntheticBuildId = "b0adc0de5feedface00000000000000000000beef".slice(0, 40);
  await launchGeneration({ version: syntheticVersion, buildId: syntheticBuildId, label: "B" });
  await sleep(4000);
  dumpLock("B-early");

  const idB = await waitFor(() => identityOnce(BASE), "generation-B readiness").catch(() => null);
  record("UP.B1", "newer generation starts on preserved data dir (no DATABASE_TOO_NEW refusal)", idB !== null, idB ? `pid=${idB.identity.pid}` : "no identity");
  if (!idB) throw new Error("generation B controller never became ready");
  controllerPid = idB.identity.pid;

  record("UP.B2", "identity shows synthetic version/buildId skew", idB.identity.version === syntheticVersion && idB.identity.buildId === syntheticBuildId, `version=${idB.identity.version} buildId=${String(idB.identity.buildId).slice(0, 12)}…`);

  const listRes = await get(`${BASE}/api/repositories`);
  const listBody = (() => {
    try { return JSON.parse(listRes.body); } catch { return null; }
  })();
  const preserved = listRes.status === 200 &&
    Array.isArray(listBody?.repositories) &&
    listBody.repositories.some((r) => r.displayName === "Upgrade Preservation Repo");
  record("UP.B3", "durable repository rows survive the generation transition", preserved, `status=${listRes.status}`);

  const integrityB = verifyDbIntegrity(dbPath);
  record("UP.B4", "database integrity after upgrade generation", integrityB.ok === true && integrityB.migrationsApplied === integrityA.migrationsApplied, `migrations=${integrityB.migrationsApplied}`);

  const lockBefore = readLock(dataDir);
  record("UP.B5", "runtime lock metadata carries control token for replacement flows", Boolean(lockBefore?.controlToken), lockBefore ? `pid=${lockBefore.pid}` : "no lock");

  const shutdownB = await gracefulControllerShutdown(BASE, dataDir);
  record("UP.B6", "authenticated graceful shutdown of newer generation", shutdownB === true);

  // Teardown safety: only pids we observed in OUR isolated environment.
  const lockAfter = readLock(dataDir);
  if (lockAfter?.pid && isPidAlive(lockAfter.pid)) killPidOnly(lockAfter.pid);
  await sleep(1000);

  const failed = results.filter((r) => !r.ok);
  const verdict = failed.length === 0 ? "UNPACKED_UPGRADE_PRESERVATION_QUALIFIED" : "UNPACKED_UPGRADE_PRESERVATION_FAILED";
  console.log(`[upgrade] verdict: ${verdict} (${results.length - failed.length}/${results.length} checks passed)`);
  console.log(`[upgrade] workspace retained for inspection: ${workspace}`);
  process.exit(failed.length === 0 ? 0 : 1);
} catch (err) {
  console.error(`[upgrade] fatal: ${err?.message ?? err}`);
  try {
    const lock = readLock(dataDir);
    if (lock?.pid && isPidAlive(lock.pid)) killPidOnly(lock.pid);
  } catch { /* ignore */ }
  process.exit(1);
}
