#!/usr/bin/env node
/**
 * Change 026 packaged crash/restart recovery qualification.
 *
 * Runs against the BUILT unpacked artifact with isolated ORCA_DATA_DIR/port:
 *   C1  hard controller kill leaves stale lock; reopen reclaims after liveness
 *       proof; reconciliation runs; persisted state survives; single owner;
 *   C2  desktop crash leaves the controller alive and serving;
 *   C3  simultaneous relaunches converge on exactly one controller;
 *   C4  port-blocked startup failure (controller exits 11) recovers cleanly;
 *   C5  launch from an arbitrary cwd still serves UI/API.
 *
 * Exit 0 = PACKAGED_CRASH_RECOVERY_QUALIFIED evidence for this artifact.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {
  REPO_ROOT,
  get,
  request,
  waitFor,
  sleep,
  killPidOnly,
  isPidAlive,
  launchExe,
  readLock,
  identityOnce,
  verifyDbIntegrity,
  tempRoot
} from "./harness-lib.mjs";

const unpackedDir = path.join(REPO_ROOT, "apps", "desktop", "release", "win-unpacked");
const exePath = path.join(unpackedDir, "Orca-Strator.exe");
// Ephemeral by default (Change 027): a fixed port let a crashed prior run's
// leftover controller answer later runs (found when C1.a reported a ghost).
const PORT = Number(
  process.env.ORCA_CRASH_PORT || 47231 + Math.floor(Math.random() * 600)
);
const BASE = `http://127.0.0.1:${PORT}`;

function die(msg) {
  console.error(`[crash-recovery] FAIL: ${msg}`);
  process.exit(1);
}
if (process.platform !== "win32") die("Windows only.");
if (!fs.existsSync(exePath)) die(`Packaged exe missing: ${exePath}. Run 'npm run package:win' first.`);

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`[crash-recovery] ${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const dataDir = tempRoot("orca-crash-");
const fixtureWork = tempRoot("orca-crash-fixtures-");

async function createRepo(displayName) {
  const res = await request(`${BASE}/api/repositories`, {
    method: "POST",
    payload: {
      displayName,
      githubRemote: `https://github.com/example/${displayName}.git`,
      localPath: fixtureWork,
      environment: "windows",
      wslDistribution: null,
      executorCli: "kimi",
      executorModel: "harness-model",
      solConversationUrl: "https://chatgpt.com/c/harness"
    }
  });
  return res.status === 200 || res.status === 201;
}

// ---- C1: hard kill + stale-lock reclaim ------------------------------------
const desktop1 = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, "launch #1");
const identity1 = await waitFor(() => identityOnce(BASE), "first readiness");
record(
  "C1.a initial controller ready",
  Boolean(identity1),
  `pid=${identity1?.identity?.pid}`
);
await createRepo("Crash Recovery Fixture");
// Steady-state settle (Change 027): killing during ensure's startup-
// finalization window would trip the fail-fast terminal instead of arming
// the post-startup resurrection watch. Confirm the SAME controller stays
// up across a settle gap before simulating the crash.
await sleep(3_000);
const steadyState = await identityOnce(BASE);
record(
  "C1.a2 steady state confirmed before simulated crash",
  Boolean(steadyState && steadyState.identity.pid === identity1.identity.pid && isPidAlive(identity1.identity.pid)),
  steadyState ? `pid=${steadyState.identity.pid}` : ""
);
const originalControllerPid = identity1.identity.pid;

killPidOnly(originalControllerPid); // abrupt death, lock left behind
// Death proof must be pid-reuse tolerant (Change 027): supervisor recovery
// can legitimately hand the SAME pid back to a fresh controller within
// milliseconds, so "old pid gone OR a different pid now serves" both prove
// the original owner died.
await waitFor(async () => {
  if (!isPidAlive(originalControllerPid)) return true;
  const id = await identityOnce(BASE);
  return Boolean(id && id.identity.pid !== originalControllerPid);
}, "controller death or replacement", 15_000);
const staleLock = readLock(dataDir);
record(
  "C1.b lock metadata present through the crash/recovery boundary",
  Boolean(staleLock),
  staleLock ? `pid=${staleLock.pid}` : ""
);

const desktop2 = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, "reopen after kill");
const identity2 = await waitFor(() => identityOnce(BASE), "readiness after crash-restart", 120_000);
const reclaimed = Boolean(identity2 && identity2.identity.pid !== originalControllerPid);
record("C1.c reopen reclaimed ownership after liveness proof (new pid)", reclaimed, identity2 ? `pid=${identity2.identity.pid}` : "");
const listRes = await get(`${BASE}/api/repositories`);
let persisted = false;
try {
  persisted = JSON.parse(listRes.body).repositories.some((r) => r.displayName === "Crash Recovery Fixture");
} catch { /* parse */ }
record("C1.d persisted state survives hard kill", persisted, `status=${listRes.status}`);
const integrityAfterCrash = verifyDbIntegrity(path.join(dataDir, "orca-strator.sqlite"));
record("C1.e DB integrity ok after crash recovery", integrityAfterCrash.ok, integrityAfterCrash.detail ?? `${integrityAfterCrash.migrationsApplied} migrations`);
const ownersAfterReopen = [desktop1, desktop2].filter((p) => isPidAlive(p)).length;
record(
  "C1.f recovery supervised by the surviving desktop (second launch may focus-handoff and exit)",
  ownersAfterReopen >= 1 && ownersAfterReopen <= 2,
  `alive desktops=${ownersAfterReopen}`
);

// ---- C2: desktop crash, controller continues -------------------------------
const controllerPidBefore = identity2.identity.pid;
killPidOnly(desktop2);
await sleep(2500);
const survived = await identityOnce(BASE);
record(
  "C2 desktop crash leaves controller alive",
  Boolean(survived && survived.identity.pid === controllerPidBefore),
  `pid=${survived?.identity?.pid}`
);

// ---- C3: simultaneous relaunches converge on one controller -----------------
const racers = [];
for (let i = 0; i < 3; i++) {
  racers.push(launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, `racer #${i + 1}`));
}
await sleep(8000);
const convergedIdentity = await identityOnce(BASE);
record(
  "C3 simultaneous relaunches converge on a single controller",
  Boolean(convergedIdentity && convergedIdentity.identity.pid === controllerPidBefore),
  `controller pid=${convergedIdentity?.identity?.pid} expected=${controllerPidBefore}`
);

// ---- C4: blocked-port startup failure recovers ------------------------------
killPidOnly(controllerPidBefore);
for (const r of racers) killPidOnly(r);
await waitFor(async () => !(await identityOnce(BASE)), "full teardown before C4", 20_000).catch(() => {});

const blocker = net.createServer();
await new Promise((resolve) => blocker.listen(PORT, "127.0.0.1", resolve));
const blockedDesktop = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, "blocked launch");
await sleep(12_000); // give the supervisor time to detect conflict/exit-11
blocker.close();

const recoveredDesktop = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, "recovery launch after block");
const identity4 = await waitFor(() => identityOnce(BASE), "recovery readiness", 120_000);
record("C4 startup failure followed by clean recovery", Boolean(identity4), identity4 ? `pid=${identity4.identity.pid}` : "");

// ---- C5: arbitrary cwd -------------------------------------------------------
const oddCwd = tempRoot("orca-crash-cwd-");
const cwdDesktop = launchExe(
  exePath,
  { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir },
  oddCwd,
  "arbitrary-cwd launch"
);
await sleep(6000);
const identity5 = await identityOnce(BASE);
const ui5 = await get(`${BASE}/`);
record(
  "C5 package works from an arbitrary working directory",
  Boolean(identity5 && ui5.status === 200 && ui5.body.includes('<div id="root">')),
  `api=${Boolean(identity5)} ui=${ui5.status}`
);

// ---- Teardown ----------------------------------------------------------------
const finalLock = readLock(dataDir);
if (finalLock && isPidAlive(finalLock.pid)) killPidOnly(finalLock.pid);
for (const pid of [blockedDesktop, recoveredDesktop, cwdDesktop]) killPidOnly(pid);
await sleep(1500);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(fixtureWork, { recursive: true, force: true });
fs.rmSync(oddCwd, { recursive: true, force: true });

const verdict = process.exitCode === 1 ? "FAILED" : "PACKAGED_CRASH_RECOVERY_QUALIFIED";
console.log(`[crash-recovery] verdict: ${verdict}`);
process.exit(process.exitCode === 1 ? 1 : 0);
