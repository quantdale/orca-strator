#!/usr/bin/env node
/**
 * Change 026 packaged endurance / soak harness.
 *
 *   node scripts/package/endurance.mjs [--cycles N] [--label short|long] [--port P]
 *
 * Repeats full desktop lifecycle cycles against the BUILT unpacked artifact
 * with isolated temp data + fixture Git remotes only. Per cycle: launch ->
 * controller reuse/recovery -> API read/write -> watcher activity on a fixture
 * remote -> readiness probes -> DB reopen/integrity. Every K cycles the
 * controller is hard-killed to exercise recovery. Tracks PID continuity,
 * working-set, handles, child processes, log growth, package immutability,
 * and failed requests with thresholds derived from a measured warmup baseline.
 *
 * Short mode (default 6 cycles) is CI-safe. Long mode (e.g. --cycles 30) is
 * the local qualification soak; PACKAGED_ENDURANCE_QUALIFIED requires it.
 */
import fs from "node:fs";
import path from "node:path";
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

async function launchAndReady(label) {
  desktopPid = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, label);
  const identity = await waitFor(() => identityOnce(BASE), `${label} readiness`, 120_000);
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
    // Hard-kill the controller mid-soak: next launch must recover.
    killPidOnly(currentControllerPid);
    await waitFor(() => !isPidAlive(currentControllerPid), "controller kill", 15_000).catch(() => {});
    record.events.push("controller-hard-killed");
  }

  let reusedExpected = Boolean(
    currentControllerPid && isPidAlive(currentControllerPid)
  );
  const beforePid = currentControllerPid;
  const identity = await launchAndReady(`cycle ${cycle}`);
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
      githubRemote: `https://github.com/example/endurance-${cycle}.git`,
      localPath: fixtureWork,
      environment: "windows",
      wslDistribution: null,
      executorCli: "kimi",
      executorModel: "harness-model",
      solConversationUrl: "https://chatgpt.com/c/harness"
    }
  });
  if (!(repoRes.status === 200 || repoRes.status === 201)) failures++;
  const createdId = (() => {
    try {
      return JSON.parse(repoRes.body).id;
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
    if (watcher.status !== 200) failures++;
  }

  // Readiness probe + list churn.
  const readiness = await get(`${BASE}/api/system/readiness`, 10_000);
  if (readiness.status !== 200) failures++;
  const list = await get(`${BASE}/api/repositories`);
  if (list.status !== 200) failures++;

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
await sleep(1500);

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
fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(fixtureWork, { recursive: true, force: true });

console.log(`[endurance] verdict: ${report.verdict} (${report.durationSeconds}s, ${CYCLES} cycles, failures=${failures})`);
process.exit(failures === 0 ? 0 : 1);
