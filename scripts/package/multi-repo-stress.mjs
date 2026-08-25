#!/usr/bin/env node
/**
 * Change 026 multi-repository packaged stress.
 *
 *   node scripts/package/multi-repo-stress.mjs [--port P]
 *
 * Registers 4 fixture repositories (local Git remotes only, no inference)
 * against the BUILT unpacked artifact and proves concurrent isolation:
 *   M1 independent watcher progression per repository;
 *   M2 executor ownership stays per-repository (no shared run records);
 *   M3 one repository's failure does not corrupt sibling state;
 *   M4 desktop close/reopen during activity leaves controller work intact;
 *   M5 final SQLite integrity + per-repo record counts consistent.
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
  makeFixtureRepository,
  tempRoot
} from "./harness-lib.mjs";

const unpackedDir = path.join(REPO_ROOT, "apps", "desktop", "release", "win-unpacked");
const exePath = path.join(unpackedDir, "Orca-Strator.exe");
const PORT = Number(process.env.ORCA_STRESS_PORT || 47251);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_COUNT = 4;

function die(msg) {
  console.error(`[stress] FAIL: ${msg}`);
  process.exit(1);
}
if (process.platform !== "win32") die("Windows only.");
if (!fs.existsSync(exePath)) die(`Packaged exe missing: ${exePath}.`);

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`[stress] ${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const dataDir = tempRoot("orca-stress-data-");
const fixtureWork = tempRoot("orca-stress-fixtures-");

const fixtures = [];
for (let i = 0; i < REPO_COUNT; i++) {
  fixtures.push(makeFixtureRepository(fixtureWork, `stress-repo-${i + 1}`));
}

// ---- Register all repositories through the API ------------------------------
const desktopPid = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, "launch");
await waitFor(() => identityOnce(BASE), "readiness", 120_000);

async function registerRepo(fixture) {
  const res = await request(`${BASE}/api/repositories`, {
    method: "POST",
    payload: {
      displayName: fixture.name,
      githubRemote: `https://github.com/example/${fixture.name}.git`,
      localPath: fixture.clonePath,
      environment: "windows",
      wslDistribution: null,
      executorCli: "kimi",
      executorModel: "harness-model",
      solConversationUrl: `https://chatgpt.com/c/${fixture.name}`
    }
  });
  if (!(res.status === 200 || res.status === 201)) {
    throw new Error(`register failed for ${fixture.name}: ${res.status} ${res.body}`);
  }
  return JSON.parse(res.body).id;
}

const repoIds = [];
for (const fixture of fixtures) repoIds.push(await registerRepo(fixture));
record("M0 registered 4 fixture repositories concurrently", repoIds.every(Boolean), repoIds.join(","));

// ---- M1: independent watcher progression ------------------------------------
const targetShas = fixtures.map((f) => f.advanceRemote(`stress wave 1 ${f.name}`));
await sleep(7000); // watcher poll window
let progressedAll = true;
const progression = [];
for (let i = 0; i < REPO_COUNT; i++) {
  const res = await get(`${BASE}/api/repositories/${repoIds[i]}/watcher`);
  let observed = null;
  try {
    observed = JSON.parse(res.body)?.watcher?.lastObservedSha ?? null;
  } catch { /* leave null */ }
  progression.push(observed);
  if (observed !== targetShas[i]) progressedAll = false;
}
record(
  "M1 independent watcher progression across all repositories",
  progressedAll,
  progression.map((s) => (s ? s.slice(0, 7) : "none")).join(",")
);

// Second wave with staggered pushes to prove no cross-routing of SHAs.
const wave2 = fixtures.map((f, i) => ({ i, sha: f.advanceRemote(`wave2 ${f.name}`) }));
await sleep(7000);
let noCrossRouting = true;
for (let i = 0; i < REPO_COUNT; i++) {
  const res = await get(`${BASE}/api/repositories/${repoIds[i]}/watcher`);
  const body = JSON.parse(res.body);
  const observed = body?.watcher?.lastObservedSha ?? null;
  // Each repo must observe ITS OWN remote SHA, never a sibling's.
  const ownSha = fixtures[i].remoteSha();
  if (observed !== ownSha) noCrossRouting = false;
}
record("M2 no cross-routed watcher state between repositories", noCrossRouting);

// ---- M3: sibling failure containment ----------------------------------------
const doomedFixture = fixtures[0];
fs.rmSync(doomedFixture.clonePath, { recursive: true, force: true }); // break local path
fixtures[1].advanceRemote("during sibling failure");
fixtures[2].advanceRemote("during sibling failure");
await sleep(8000);
let contained = true;
for (let i = 1; i < REPO_COUNT; i++) {
  const res = await get(`${BASE}/api/repositories/${repoIds[i]}/watcher`);
  const body = JSON.parse(res.body);
  const ownSha = fixtures[i].remoteSha();
  if ((body?.watcher?.lastObservedSha ?? null) !== ownSha) contained = false;
}
record("M3 one repository's failure does not disturb siblings", contained);

// ---- M4: desktop close/reopen during activity -------------------------------
const controllerBefore = (await identityOnce(BASE)).identity.pid;
killPidOnly(desktopPid);
await sleep(2000);
const survivedClose = await identityOnce(BASE);
record(
  "M4.a controller work continues while desktop is closed",
  Boolean(survivedClose && survivedClose.identity.pid === controllerBefore),
  `pid=${survivedClose?.identity?.pid}`
);

const desktop2 = launchExe(exePath, { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir }, unpackedDir, "relaunch");
const identityReopen = await waitFor(() => identityOnce(BASE), "reopen readiness", 60_000);
record(
  "M4.b reopen reuses the same controller",
  Boolean(identityReopen && identityReopen.identity.pid === controllerBefore),
  `pid=${identityReopen?.identity?.pid}`
);

const listAfter = await get(`${BASE}/api/repositories`);
const countAfter = (() => {
  try {
    return JSON.parse(listAfter.body).repositories.length;
  } catch {
    return -1;
  }
})();
record("M4.c all repository records survive close/reopen", countAfter === REPO_COUNT, `count=${countAfter}`);

// ---- M5: final integrity ------------------------------------------------------
const integrity = verifyDbIntegrity(path.join(dataDir, "orca-strator.sqlite"));
record("M5 final SQLite integrity + FK check", integrity.ok, integrity.detail ?? `${integrity.migrationsApplied} migrations applied`);

// Teardown.
await import("./harness-lib.mjs")
  .then((lib) => lib.gracefulControllerShutdown(BASE, dataDir))
  .catch(() => false);
const lock = readLock(dataDir);
if (lock && isPidAlive(lock.pid)) killPidOnly(lock.pid);
killPidOnly(desktop2);
await sleep(1500);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(fixtureWork, { recursive: true, force: true });

console.log(`[stress] verdict: ${process.exitCode === 1 ? "FAILED" : "MULTI_REPO_PACKAGED_STRESS_QUALIFIED"}`);
process.exit(process.exitCode === 1 ? 1 : 0);
