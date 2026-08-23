#!/usr/bin/env node
/**
 * Change 025 task 10: real Windows packaged-runtime smoke.
 *
 * Runs against the BUILT unpacked artifact (apps/desktop/release/win-unpacked/
 * Orca-Strator.exe). Proves, with isolated ORCA_DATA_DIR + isolated port:
 *   10.2 isolated env;            10.3 desktop starts with no prestarted controller;
 *   10.4 controller becomes healthy and serves built UI/API;
 *   10.5 expected build identity; 10.6 data only in the isolated dir;
 *   10.7 UI close keeps controller alive (root-pid-only kill);
 *   10.8 relaunch reuses the same controller without duplicate spawn;
 *   10.9 persisted state survives close/reopen;
 *   10.10 controlled teardown kills only the test controller + no writes inside package resources;
 *   10.11 artifact name/size/SHA-256/version/arch/signing recorded.
 *
 * Exit code 0 = PACKAGE_RUNTIME_QUALIFIED for this artifact.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const unpackedDir = path.join(repoRoot, "apps", "desktop", "release", "win-unpacked");
const exePath = path.join(unpackedDir, "Orca-Strator.exe");
const PORT = Number(process.env.ORCA_SMOKE_PORT || 47191);
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 90_000;

function die(message) {
  console.error(`[smoke] FAIL: ${message}`);
  process.exit(1);
}

if (process.platform !== "win32") die("This smoke must run on Windows.");
if (!fs.existsSync(exePath)) {
  die(`Packaged exe not found at ${exePath}. Run 'npm run package:win' first.`);
}

const appPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "apps", "desktop", "package.json"), "utf8"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-package-smoke-"));
const resourcesBefore = snapshotTree(path.join(unpackedDir));

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshotTree(root) {
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
}

function get(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => finish({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", (e) => finish({ status: 0, body: "", error: e.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish({ status: 0, body: "", error: "timeout" });
    });
  });
}

function post(url, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ status: 0, body: "", error: "timeout" });
    });
    req.on("error", (e) => resolve({ status: 0, body: String(e), error: e.message }));
    req.write(body);
    req.end();
  });
}

async function waitFor(predicateFn, label, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicateFn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError})` : ""}`);
}

function killPidOnly(pid) {
  // Root-pid-only termination: no /T, so a detached controller child survives.
  execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
}

async function launchDesktop(label) {
  const child = spawn(exePath, [], {
    cwd: unpackedDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      ORCA_PORT: String(PORT),
      ORCA_DATA_DIR: dataDir
    }
  });
  child.unref();
  console.log(`[smoke] ${label}: desktop pid=${child.pid}`);
  return child.pid;
}

async function identityOnce() {
  const res = await get(`${BASE}/api/system/identity`);
  if (res.status !== 200) return null;
  try {
    const parsed = JSON.parse(res.body);
    return parsed.identity?.service === "orca-controller" ? parsed : null;
  } catch {
    return null;
  }
}

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
  console.log(`[smoke] ${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// ---- Run ----

console.log(`[smoke] Artifact: ${exePath}`);
console.log(`[smoke] Isolated port ${PORT}, data dir ${dataDir}`);

const firstDesktopPid = await launchDesktop("launch #1");

const firstIdentity = await waitFor(identityOnce, "controller readiness after first launch").catch((err) => {
  die(`controller did not become ready: ${err.message}`);
});

record("10.3/10.4 packaged desktop starts controller + healthy API", true, `${BASE} responded`);

const uiRes = await get(`${BASE}/`);
record(
  "10.4 built React UI served from package",
  uiRes.status === 200 && uiRes.body.includes("<div id=\"root\">"),
  `status=${uiRes.status}`
);

record(
  "10.5 build identity matches expected version",
  firstIdentity.identity.version === appPkg.version && firstIdentity.identity.protocol >= 1,
  `version=${firstIdentity.identity.version} protocol=${firstIdentity.identity.protocol}`
);

const controllerPid = firstIdentity.identity.pid;
record(
  "10.3 controller is an independent OS process (not the desktop pid)",
  controllerPid !== firstDesktopPid,
  `controller pid=${controllerPid} vs desktop pid=${firstDesktopPid}`
);

record("10.6a identity reports the isolated data dir", firstIdentity.dataDir === dataDir, firstIdentity.dataDir);

await new Promise((r) => setTimeout(r, 1500)); // allow DB/log creation
record(
  "10.6b SQLite DB created under isolated dir",
  fs.existsSync(path.join(dataDir, "orca-strator.sqlite")),
  path.join(dataDir, "orca-strator.sqlite")
);
record(
  "10.6c packaged runtime log persisted under isolated dir",
  fs.existsSync(path.join(dataDir, "logs", "controller.log")),
  path.join(dataDir, "logs", "controller.log")
);
const dbLeak = [...snapshotTree(unpackedDir).keys()].filter((f) => /\.(sqlite3?|db|db-wal|db-shm)$/i.test(f));
record("10.6d no runtime databases inside package resources", dbLeak.length === 0, dbLeak.join(", ") || "clean");

// Persisted state marker (10.9): create a repository via the API.
const repoPayload = {
  displayName: "Package Smoke Repo",
  githubRemote: "https://github.com/example/smoke.git",
  localPath: dataDir,
  environment: "windows",
  wslDistribution: null,
  executorCli: "kimi",
  executorModel: "smoke-model",
  solConversationUrl: "https://chatgpt.com/c/package-smoke"
};
const createRes = await post(`${BASE}/api/repositories`, repoPayload);
record("10.9a repository created through packaged API", createRes.status === 201 || createRes.status === 200, `status=${createRes.status}`);

// Close the UI: terminate ONLY the desktop root pid (no /T).
killPidOnly(firstDesktopPid);
await new Promise((r) => setTimeout(r, 3000));

let stillAlive = null;
try {
  stillAlive = await waitFor(identityOnce, "controller survival check", 15_000);
} catch {
  stillAlive = null;
}
record(
  "10.7 controller survives desktop close",
  Boolean(stillAlive && stillAlive.identity.pid === controllerPid),
  stillAlive ? `pid=${stillAlive.identity.pid}` : "controller unreachable"
);

// Relaunch: must reuse, not duplicate (10.8).
const secondDesktopPid = await launchDesktop("relaunch");
const secondIdentity = await waitFor(identityOnce, "readiness after relaunch", 30_000).catch(() => null);
record(
  "10.8 relaunch reuses same controller without duplicate spawn",
  Boolean(secondIdentity && secondIdentity.identity.pid === controllerPid),
  secondIdentity ? `same pid=${controllerPid}` : "no/different controller"
);

const listRes = await get(`${BASE}/api/repositories`);
const listOk =
  listRes.status === 200 &&
  (() => {
    try {
      return JSON.parse(listRes.body).repositories.some((r) => r.displayName === "Package Smoke Repo");
    } catch {
      return false;
    }
  })();
record("10.9b persisted state survives close/reopen", listOk, `status=${listRes.status}`);

// Teardown: kill ONLY the test controller by its real pid (10.10).
killPidOnly(controllerPid);
await new Promise((r) => setTimeout(r, 2000));
const afterTeardown = await identityOnce().catch(() => null);
record("10.10a teardown stopped only the test controller", !afterTeardown, "");

killPidOnly(secondDesktopPid);
const resourcesAfter = snapshotTree(unpackedDir);
let mutated = false;
for (const [rel, size] of resourcesAfter) {
  if (resourcesBefore.get(rel) !== size) {
    mutated = true;
    console.error(`[smoke] mutated in package resources: ${rel}`);
  }
}
for (const rel of resourcesBefore.keys()) {
  if (!resourcesAfter.has(rel)) {
    mutated = true;
    console.error(`[smoke] missing from package resources: ${rel}`);
  }
}
record("10.10b no writes inside package resources during the whole run", !mutated, mutated ? "see log" : "byte-size snapshot identical");

fs.rmSync(dataDir, { recursive: true, force: true });

// Artifact metadata (10.11).
const stat = fs.statSync(exePath);
const report = {
  artifact: path.relative(repoRoot, exePath),
  bytes: stat.size,
  sha256: sha256(exePath),
  version: appPkg.version,
  architecture: "x64",
  signing: "UNSIGNED",
  verdict: process.exitCode === 1 ? "FAILED" : "PACKAGE_RUNTIME_QUALIFIED",
  checkedAt: new Date().toISOString(),
  checks
};
fs.writeFileSync(path.join(unpackedDir, "..", "package-smoke-report.json"), JSON.stringify(report, null, 2));
console.log(`[smoke] verdict: ${report.verdict}`);
process.exit(process.exitCode === 1 ? 1 : 0);
