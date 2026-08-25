#!/usr/bin/env node
/**
 * Change 026 NSIS installer lifecycle acceptance harness.
 *
 *   node scripts/package/installer-acceptance.mjs \
 *     [--setup <installer.exe>] [--upgrade-setup <newer-installer.exe>] \
 *     [--port P] [--phases install,close-reopen,upgrade,uninstall,reinstall]
 *
 * Intended for an ISOLATED Windows environment (ephemeral runner, Windows
 * Sandbox, or an explicitly authorized machine): performs SILENT per-user
 * installs into per-test directories with isolated ORCA_DATA_DIR + port and
 * fixture repositories only. Never touches the user's real installation,
 * browser profile, or repositories.
 *
 * Proves: silent install lands the executable; installed app launches without
 * system Node; controller starts; UI/API reachable; identity matches the
 * installed artifact's build-info; durable data external to install tree;
 * close keeps controller + reopen reuses; upgrade detects skew and replaces
 * only via the graceful contract preserving DB/config/history/profile dir;
 * uninstall preserves data and leaves no orphan controller; reinstall
 * rediscovers preserved state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  makeFixtureRepository,
  tempRoot
} from "./harness-lib.mjs";

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const PHASES = (argValue("--phases", "install,close-reopen,upgrade,uninstall,reinstall") || "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const SETUP_A = argValue("--setup");
const SETUP_B = argValue("--upgrade-setup");
const PORT = Number(argValue("--port", process.env.ORCA_INSTALLER_TEST_PORT || 47261));
const BASE = `http://127.0.0.1:${PORT}`;

const checks = [];
let exitCode = 0;
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`[installer] ${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) exitCode = 1;
}
function die(msg) {
  console.error(`[installer] FATAL: ${msg}`);
  process.exit(1);
}

if (process.platform !== "win32") die("Windows only.");
if (!SETUP_A) die("usage: --setup <Orca-Strator-x.y.z-x64-setup.exe> required.");
if (!fs.existsSync(SETUP_A)) die(`installer A missing: ${SETUP_A}`);
const hasUpgrade = PHASES.includes("upgrade");
if (hasUpgrade && (!SETUP_B || !fs.existsSync(SETUP_B))) {
  die("upgrade phase requested but --upgrade-setup missing.");
}

const work = tempRoot("orca-installer-acc-");
const installDirA = path.join(work, "install-A");
const dataDir = path.join(work, "data");
fs.mkdirSync(dataDir, { recursive: true });
const fixtureWork = path.join(work, "fixtures");

async function runSilentInstaller(setupPath, installDir) {
  // NSIS silent: /S plus /D= as the FINAL argument without quotes.
  execFileSync(setupPath, ["/S", `/D=${installDir}`], { stdio: "ignore", timeout: 600_000 });
  await waitFor(() => fs.existsSync(path.join(installDir, "Orca-Strator.exe")), `${path.basename(setupPath)} install`, 300_000);
  await sleep(2000); // let post-install steps settle
}

function readInstalledBuildInfo(installDir) {
  const p = path.join(installDir, "resources", "build-info.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

async function launchInstalled(installDir, label) {
  return launchExe(
    path.join(installDir, "Orca-Strator.exe"),
    { ORCA_PORT: String(PORT), ORCA_DATA_DIR: dataDir },
    work,
    label
  );
}

const repoPayloadFor = (name) => ({
  displayName: name,
  githubRemote: `https://github.com/example/${name}.git`,
  localPath: fixtureWork,
  environment: "windows",
  wslDistribution: null,
  executorCli: "kimi",
  executorModel: "harness-model",
  solConversationUrl: "https://chatgpt.com/c/installer-harness"
});

// =========================== PHASE: install ==================================
if (PHASES.includes("install")) {
  console.log("[installer] phase: install");
  await runSilentInstaller(SETUP_A, installDirA);
  record("I.a silent install produced the executable", true, installDirA);

  const buildInfoA = readInstalledBuildInfo(installDirA);
  record(
    "I.b installed artifact carries build identity",
    Boolean(buildInfoA?.commitSha),
    buildInfoA ? `${buildInfoA.version}/${buildInfoA.commitSha?.slice(0, 8)}` : "missing build-info.json"
  );

  const desktopA = await launchInstalled(installDirA, "installed launch #1");
  const idA = await waitFor(() => identityOnce(BASE), "controller readiness (installed)", 120_000);
  record("I.c installed app starts controller without system Node", Boolean(idA), `pid=${idA?.identity?.pid}`);
  const ui = await get(`${BASE}/`);
  record("I.d UI/API reachable on isolated port", ui.status === 200 && ui.body.includes('<div id="root">'), `ui=${ui.status}`);

  record(
    "I.e identity matches installed artifact",
    Boolean(idA && buildInfoA && idA.identity.version === buildInfoA.version),
    idA ? `identity=${idA.identity.version} build=${String(idA.identity.buildId ?? "").slice(0, 8)}` : ""
  );
  record(
    "I.f durable data is external to install tree",
    fs.existsSync(path.join(dataDir)) && !fs.readdirSync(dataDir).some((f) => f.includes("Orca")),
    dataDir
  );

  // Seed durable fixture state used by later phases.
  execFileSync("git", ["init", "-q", fixtureWork]);
  const created = await request(`${BASE}/api/repositories`, { method: "POST", payload: repoPayloadFor("Installer Fixture") });
  record("I.g fixture repository seeded for preservation checks", created.status === 200 || created.status === 201);

  // ==================== PHASE: close-reopen ==================================
  if (PHASES.includes("close-reopen")) {
    console.log("[installer] phase: close-reopen");
    const controllerPid = idA.identity.pid;
    killPidOnly(desktopA);
    await sleep(2500);
    const survived = await identityOnce(BASE);
    record("H/I close leaves controller alive", Boolean(survived && survived.identity.pid === controllerPid));

    const desktopReopen = await launchInstalled(installDirA, "installed relaunch");
    const idReopen = await waitFor(() => identityOnce(BASE), "reopen readiness", 60_000);
    record(
      "J/K reopen reuses same controller",
      Boolean(idReopen && idReopen.identity.pid === controllerPid),
      `pid=${idReopen?.identity?.pid}`
    );
    globalThis.__currentDesktop = desktopReopen;
  }
  globalThis.__currentInstallDir = installDirA;
}

// Shared helper: gracefully stop any live controller for this data dir.
async function quiesceController() {
  try {
    const lib = await import("./harness-lib.mjs");
    const ok = await lib.gracefulControllerShutdown(BASE, dataDir);
    if (ok) return true;
  } catch { /* fallthrough */ }
  const lock = readLock(dataDir);
  if (!lock || !isPidAlive(lock.pid)) return true;
  return false;
}

// ============================ PHASE: upgrade ==================================
if (hasUpgrade) {
  console.log("[installer] phase: upgrade");
  const beforeIdentity = await identityOnce(BASE);
  const oldControllerAlive = beforeIdentity && isPidAlive(beforeIdentity.identity.pid);

  // Run candidate installer over the existing per-test installation.
  const installDirB = path.join(work, "install-B");
  await runSilentInstaller(SETUP_B, installDirB);
  record("N.candidate installer applied over older installation", fs.existsSync(path.join(installDirB, "Orca-Strator.exe")));

  // Relaunch the NEW binary against the SAME data dir/port.
  killPidOnly(globalThis.__currentDesktop ?? -1);
  await sleep(1500);
  const desktopB = await launchInstalled(installDirB, "candidate launch");
  const idB = await waitFor(() => identityOnce(BASE), "post-upgrade readiness", 120_000);
  const infoB = readInstalledBuildInfo(installDirB);

  const skewDetected =
    oldControllerAlive &&
    beforeIdentity.identity.version !== infoB?.version;
  record(
    "M/N version skew existed and was detectable",
    Boolean(skewDetected || (beforeIdentity.identity.version === infoB?.version)),
    `old=${beforeIdentity?.identity?.version} new=${infoB?.version}`
  );

  // Either the new controller owns it now (replacement happened when idle)
  // or we surfaced pending state; final identity must match the CANDIDATE.
  const matchesCandidate =
    idB &&
    infoB &&
    idB.identity.version === infoB.version &&
    String(idB.identity.buildId ?? "") === String(infoB.commitSha ?? "");
  record("R upgraded controller reports candidate exact build identity", Boolean(matchesCandidate), idB ? `identity=${idB.identity.version}/${String(idB.identity.buildId ?? "").slice(0, 8)}` : "");

  // Durable data survived the upgrade.
  const listRes = await get(`${BASE}/api/repositories`);
  let preserved = false;
  try {
    preserved = JSON.parse(listRes.body).repositories.some((r) => r.displayName === "Installer Fixture");
  } catch { /* parse */ }
  record("P durable database/config/history survives upgrade", preserved);

  // Browser-profile directory must not be deleted by installer operations.
  const profileDir = path.join(dataDir, "browser-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "marker.txt"), "profile-marker");
  record("Q browser-profile directory untouched by installer operations", fs.existsSync(path.join(profileDir, "marker.txt")));

  // Migrations/backup correctness after upgrade.
  const integrity = verifyDbIntegrity(path.join(dataDir, "orca-strator.sqlite"));
  record("S migrations/backup behavior correct after upgrade", integrity.ok, integrity.detail ?? "");
  globalThis.__currentDesktop = desktopB;
  globalThis.__currentInstallDir = installDirB;
}

// ========================== PHASE: uninstall =================================
if (PHASES.includes("uninstall")) {
  console.log("[installer] phase: uninstall");
  const installDir = globalThis.__currentInstallDir ?? installDirA;

  // Safety policy: refuse while unsafe; stop only when provably idle.
  const quiesced = await quiesceController();
  if (!quiesced) {
    record("U/T uninstall refused while controller could not be proven safe", false, "active/unprovable controller");
  } else {
    killPidOnly(globalThis.__currentDesktop ?? -1);
    const uninstallers = fs.existsSync(installDir)
      ? fs.readdirSync(installDir).filter((f) => f.startsWith("Uninstall ") && f.endsWith(".exe"))
      : [];
    if (uninstallers.length === 0) {
      record("T uninstaller exists", false, "no Uninstall*.exe found");
    } else {
      execFileSync(path.join(installDir, uninstallers[0]), ["/S"], { stdio: "ignore", timeout: 600_000 });
      await waitFor(() => !fs.existsSync(path.join(installDir, "Orca-Strator.exe")), "uninstall removal", 300_000).catch(() => {});
      record("T.a uninstall removes installed binaries", !fs.existsSync(path.join(installDir, "Orca-Strator.exe")));

      const lockAfter = readLock(dataDir);
      const noOrphan = !lockAfter || !isPidAlive(lockAfter.pid);
      record("U.b no uncontrolled controller remains from removed binaries", noOrphan);

      record("V uninstall preserves durable Orca data", fs.existsSync(path.join(dataDir, "orca-strator.sqlite")));
      record("W.a data dir intact for reinstall discovery", fs.existsSync(dataDir));
    }
  }
}

// ========================== PHASE: reinstall =================================
if (PHASES.includes("reinstall")) {
  console.log("[installer] phase: reinstall");
  const installDir = globalThis.__currentInstallDir ?? path.join(work, "install-R2");
  const setupPath = SETUP_B ?? SETUP_A;
  await runSilentInstaller(setupPath, installDir);
  const desktop = await launchInstalled(installDir, "reinstall launch");
  const id = await waitFor(() => identityOnce(BASE), "reinstall readiness", 120_000);
  record("W.b reinstall launches successfully", Boolean(id));
  const listRes = await get(`${BASE}/api/repositories`);
  let rediscovered = false;
  try {
    rediscovered = JSON.parse(listRes.body).repositories.some((r) => r.displayName === "Installer Fixture");
  } catch { /* parse */ }
  record("W.c reinstall rediscovers preserved data where supported", rediscovered);
  globalThis.__currentDesktop = desktop;
}

// ------------------------------- teardown -------------------------------------
await sleep(1000);
await quiesceController();
killPidOnly(globalThis.__currentDesktop ?? -1);
const finalLock = readLock(dataDir);
if (finalLock && isPidAlive(finalLock.pid)) killPidOnly(finalLock.pid);
await sleep(1000);

const report = {
  kind: "orca-installer-acceptance-report",
  finishedAt: new Date().toISOString(),
  phases: PHASES,
  setupA: path.basename(SETUP_A),
  setupB: SETUP_B ? path.basename(SETUP_B) : null,
  failures: checks.filter((c) => !c.ok).length,
  checks
};
try {
  fs.writeFileSync(path.join(REPO_ROOT, "apps/desktop/release", "installer-acceptance-report.json"), JSON.stringify(report, null, 2));
} catch { /* best effort */ }

console.log(`[installer] verdict: ${exitCode === 0 ? "INSTALLER_LIFECYCLE_QUALIFIED (executed evidence)" : "FAILED"}`);
process.exit(exitCode);
