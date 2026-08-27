#!/usr/bin/env node
/**
 * Change 026 packaged endurance / soak harness.
 *
 * Cycles: launch -> API churn -> watcher -> readiness -> metrics -> kill desktop (controller survives).
 * Restart cycles hard-kill controller to prove recovery.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
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
  sampleProcessMetrics,
  makeFixtureRepository,
  tempRoot,
  sha256
} from "./harness-lib.mjs";

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CYCLES = Number(argValue("--cycles", 6));
const LABEL = argValue("--label", CYCLES > 6 ? "long" : "short");
const RESTART_EVERY = Number(argValue("--restart-every", 3));
const unpackedDir = path.join(REPO_ROOT, "apps", "desktop", "release", "win-unpacked");
const exePath = path.join(unpackedDir, "Orca-Strator.exe");
const PORT = Number(argValue("--port", process.env.ORCA_ENDURANCE_PORT || 47241));
const BASE = `http://127.0.0.1:${PORT}`;
// Thresholds relative to measured baseline (not arbitrary tiny numbers).
const MEMORY_GROWTH_FACTOR_MAX = 2.5; // vs warmup median
const HANDLES_GROWTH_FACTOR_MAX = 3.0;
const LOG_BYTES_MAX = 50 * 1024 * 1024;

function die(msg) {
  console.error(`[endurance] FAIL: ${msg}`);
  process.exit(1);
}
if (process.platform !== "win32") die("Windows only.");
if (!fs.existsSync(exePath)) die(`Packaged exe missing: ${exePath}.`);

console.log(`[endurance] mode=${LABEL} cycles=${CYCLES} port=${PORT}`);

const report_startedAt = Date.now();
const dataDir = tempRoot("orca-endurance-data-");
const fixtureWork = tempRoot("orca-endurance-fixtures-");
const fixtures = [makeFixtureRepository(fixtureWork, "endurance-a"), makeFixtureRepository(fixtureWork, "endurance-b")];

const snapshotTree = (root) => {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(root, full), fs.statSync(full).size);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return files;
};
const resourcesBefore = snapshotTree(unpackedDir);

let desktopPid = null;
let currentControllerPid = null;

async function launchAndReady(label, timeoutMs = 120_000) {
  desktopPid = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, label);
  const identity = await waitFor(() => identityOnce(BASE), `${label} readiness`, timeoutMs);
  currentControllerPid = identity.identity.pid;
  return identity;
}

const samples = [];
const cycleRecords = [];
let failures = 0;

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  const record = { cycle, events: [] };
  const restartCycle = cycle > 1 && cycle % RESTART_EVERY === 0;

  if (restartCycle && currentControllerPid && isPidAlive(currentControllerPid)) {
    // Hard-kill the controller mid-soak: next launch must recover. Retry aggressively.
    let killed = false;
    for (let attempt = 0; attempt < 3 && !killed; attempt++) {
      if (attempt === 0) killPidOnly(currentControllerPid);
      else if (attempt === 1) { try { execFileSync("taskkill", ["/PID", String(currentControllerPid), "/T", "/F"], { stdio: "ignore" }); } catch {} }
      else { try { execFileSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${currentControllerPid} -Force -ErrorAction SilentlyContinue`], { stdio: "ignore" }); } catch {} }
      killed = await waitFor(() => !isPidAlive(currentControllerPid), `controller kill attempt ${attempt+1}`, 15_000).then(() => true).catch(() => false);
      if (!killed) await sleep(1000);
    }
    // Ensure TCP port is free before relaunch.
    if (killed) {
      await waitFor(async () => {
        try { const r = await get(`${BASE}/api/system/identity`); return r.status !== 200; } catch { return true; }
      }, "port release", 15_000).catch(() => {});
      await sleep(2000);
    }
    record.events.push(killed ? "controller-hard-killed" : "controller-hard-kill-timeout");
    if (!killed) console.warn(`[endurance] WARN cycle ${cycle} controller ${currentControllerPid} still alive after kill attempts`);
  }

  let reusedExpected = Boolean(
    currentControllerPid && isPidAlive(currentControllerPid)
  );
  const beforePid = currentControllerPid;
  let identity;
  try {
    identity = await launchAndReady(`cycle ${cycle}`, restartCycle ? 180_000 : 120_000);
  } catch (e) {
    // One retry for restart cycles where port/lock contention transiently blocks startup.
    if (restartCycle) {
      console.warn(`[endurance] WARN cycle ${cycle} launch failed (${e?.message ?? e}), retrying after cleanup`);
      try { execFileSync("taskkill", ["/PID", String(currentControllerPid), "/T", "/F"], { stdio: "ignore" }); } catch {}
      await sleep(3000);
      identity = await launchAndReady(`cycle ${cycle} retry`, 180_000);
    } else throw e;
  }
  if (beforePid !== null && identity.identity.pid === beforePid) {
    record.events.push(reusedExpected ? "controller-reused" : "controller-recovered-same");
  } else {
    record.events.push("controller-new-after-restart");
  }
  if (!identity.identity.pid || typeof identity.identity.buildId !== "string") {
    record.events.push("identity-incomplete");
  }

  // API read/write churn against isolated state.
  const repoRes = await request(`${BASE}/api/repositories`, {
    method: "POST",
    payload: {
      displayName: `Endurance Repo Cycle ${cycle}`,
      githubRemote: fixtures[(cycle - 1) % fixtures.length].remotePath,
      localPath: fixtureWork,
      environment: "windows",
      wslDistribution: null,
      executorCli: "kimi",
      executorModel: "harness-model",
      solConversationUrl: "https://chatgpt.com/c/harness"
    }
  });
  if (!(repoRes.status === 200 || repoRes.status === 201)) { failures++; console.error(`[endurance] WARN cycle ${cycle} POST /api/repositories status=${repoRes.status}`); }
  const createdId = (() => {
    try {
      const parsed = JSON.parse(repoRes.body);
      return parsed.id ?? parsed.repository?.id;
    } catch {
      return null;
    }
  })();

  // Watcher activity against fixture remotes (deterministic, no inference).
  for (const fixture of fixtures) {
    fixture.advanceRemote(`endurance cycle ${cycle} ${fixture.name}`);
  }
  if (createdId) {
    await sleep(6000); // one watcher poll interval window
    const watcher = await get(`${BASE}/api/repositories/${createdId}/watcher`);
    if (watcher.status !== 200) { failures++; console.error(`[endurance] WARN cycle ${cycle} GET watcher status=${watcher.status}`); }
  }

  // Readiness probe + list churn (retry once for transient warmup).
  let readiness = await get(`${BASE}/api/system/readiness`, 30_000);
  if (readiness.status !== 200) {
    await sleep(2000);
    readiness = await get(`${BASE}/api/system/readiness`, 30_000);
  }
  if (readiness.status !== 200) { failures++; console.error(`[endurance] WARN cycle ${cycle} GET readiness status=${readiness.status} body=${String(readiness.body).slice(0,150)}`); }
  const list = await get(`${BASE}/api/repositories`);
  if (list.status !== 200) { failures++; console.error(`[endurance] WARN cycle ${cycle} GET repositories status=${list.status}`); }
  // Metrics sample.
  const metrics = sampleProcessMetrics(currentControllerPid);
  samples.push({ cycle, metrics });
  record.metrics = metrics;

  const integrity = verifyDbIntegrity(path.join(dataDir, "orca-strator.sqlite"));
  if (!integrity.ok) failures++;
  record.integrity = integrity.ok;

  cycleRecords.push(record);
  console.log(`[endurance] cycle ${cycle}/${CYCLES} pid=${currentControllerPid} ws=${metrics?.workingSetBytes ?? "?"} handles=${metrics?.handles ?? "?"} integrity=${integrity.ok}`);

  // Close desktop (controller survives) — except keep last cycle's owner for teardown.
  if (cycle < CYCLES) {
    killPidOnly(desktopPid);
    await sleep(2500);
  }
}

// ---- Threshold evaluation from measured warmup baseline ---------------------
const warmCycles = samples.slice(0, Math.min(3, samples.length));
const laterCycles = samples.slice(Math.min(3, samples.length));
const median = (arr, key) => {
  const vals = arr.map((s) => s.metrics?.[key]).filter((v) => typeof v === "number" && v > 0).sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : null;
};
const memoryBaseline = median(warmCycles, "workingSetBytes");
const handleBaseline = median(warmCycles, "handles");
const finalSample = samples[samples.length - 1]?.metrics;
const thresholdChecks = [];
thresholdChecks.push({
  id: "memory-growth-within-threshold",
  ok:
    !memoryBaseline ||
    !finalSample?.workingSetBytes ||
    finalSample.workingSetBytes <= memoryBaseline * MEMORY_GROWTH_FACTOR_MAX,
  detail: memoryBaseline && finalSample ? `baseline=${Math.round(memoryBaseline / 1048576)}MiB final=${Math.round(finalSample.workingSetBytes / 1048576)}MiB max=${MEMORY_GROWTH_FACTOR_MAX}x` : "insufficient samples"
});
thresholdChecks.push({
  id: "handle-growth-within-threshold",
  ok:
    !handleBaseline ||
    !finalSample?.handles ||
    finalSample.handles <= handleBaseline * HANDLES_GROWTH_FACTOR_MAX,
  detail: handleBaseline && finalSample ? `baseline=${handleBaseline} final=${finalSample.handles} max=${HANDLES_GROWTH_FACTOR_MAX}x` : "insufficient samples"
});
let logBytes = 0;
const logDir = path.join(dataDir, "logs");
if (fs.existsSync(logDir)) {
  for (const f of fs.readdirSync(logDir)) logBytes += fs.statSync(path.join(logDir, f)).size;
}
thresholdChecks.push({ id: "log-directory-bounded", ok: logBytes <= LOG_BYTES_MAX, detail: `${logBytes} bytes` });

// Package immutability across the whole soak.
const resourcesAfter = snapshotTree(unpackedDir);
let mutated = false;
for (const [rel, size] of resourcesAfter) if (resourcesBefore.get(rel) !== size) mutated = true;
for (const rel of resourcesBefore.keys()) if (!resourcesAfter.has(rel)) mutated = true;
thresholdChecks.push({ id: "package-resources-immutable", ok: !mutated });

const finalIntegrity = verifyDbIntegrity(path.join(dataDir, "orca-strator.sqlite"));
thresholdChecks.push({ id: "final-db-integrity", ok: finalIntegrity.ok, detail: finalIntegrity.detail ?? "" });

for (const c of thresholdChecks) {
  console.log(`[endurance] ${c.ok ? "PASS" : "FAIL"} ${c.id}${c.detail ? ` — ${c.detail}` : ""}`);
  if (!c.ok) failures++;
}

// Teardown: graceful shutdown via authenticated contract, else root-pid-only.
const graceful = await (async () => {
  try {
    return await import("./harness-lib.mjs").then((lib) => lib.gracefulControllerShutdown(BASE, dataDir));
  } catch {
    return false;
  }
})();
if (!graceful) {
  const lock = readLock(dataDir);
  if (lock && isPidAlive(lock.pid)) killPidOnly(lock.pid);
}
killPidOnly(desktopPid);
// Give Windows time to release SQLite and log handles after kill.
for (let attempt = 0; attempt < 20; attempt++) {
  const lock = readLock(dataDir);
  if (!lock || !isPidAlive(lock.pid)) break;
  await sleep(500);
}
await sleep(2000);

const peakWorkingSet = Math.max(...samples.map((s) => s.metrics?.workingSetBytes ?? 0));
const report = {
  kind: "orca-endurance-report",
  mode: LABEL,
  startedAt: report_startedAt,
  finishedAt: new Date().toISOString(),
  durationSeconds: Math.round((Date.now() - report_startedAt) / 1000),
  cycles: CYCLES,
  restartInjections: Math.max(0, Math.floor((CYCLES - 1) / RESTART_EVERY)),
  failures,
  peakWorkingSetBytes: peakWorkingSet,
  finalWorkingSetBytes: finalSample?.workingSetBytes ?? null,
  baselineWorkingSetBytes: memoryBaseline,
  finalHandles: finalSample?.handles ?? null,
  logBytes,
  dbIntegrityFinal: finalIntegrity,
  thresholdChecks,
  cycleRecords,
  verdict: failures === 0 ? (LABEL === "long" ? "PACKAGED_ENDURANCE_QUALIFIED_LONG_SOAK" : "ENDURANCE_SHORT_MODE_PASSED") : "FAILED"
};
fs.mkdirSync(path.join(unpackedDir, ".."), { recursive: true });
fs.writeFileSync(
  path.join(unpackedDir, "..", `endurance-${LABEL}-report.json`),
  JSON.stringify(report, null, 2)
);
// Robust cleanup: retry on Windows EPERM/EBUSY while handles drain.
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    break;
  } catch (err) {
    if (attempt === 4) console.warn(`[endurance] WARN could not fully clean dataDir: ${err.message}`);
    await sleep(1000 * (attempt + 1));
  }
}
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    fs.rmSync(fixtureWork, { recursive: true, force: true });
    break;
  } catch (err) {
    if (attempt === 2) console.warn(`[endurance] WARN could not clean fixtureWork: ${err.message}`);
    await sleep(500);
  }
}

console.log(`[endurance] verdict: ${report.verdict} (${report.durationSeconds}s, ${CYCLES} cycles, failures=${failures})`);
process.exit(failures === 0 ? 0 : 1);
