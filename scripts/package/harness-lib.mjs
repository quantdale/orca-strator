#!/usr/bin/env node
/**
 * Shared library for Change 026 packaged-runtime harnesses.
 * Everything runs against isolated temp data dirs, isolated ports, and
 * fixture Git repositories. Real user data is never touched; teardown kills
 * only pids this harness started or verified as its own controller.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPathRepo()), "..", "..");

function fileURLToPathRepo() {
  return new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
}

export function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function get(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => {
      if (!settled) {
        settled = true;
        resolve(r);
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

export function request(url, { method = "GET", payload, headers = {} } = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(body !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body ?? "") }
            : {}),
          ...headers
        }
      },
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
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function waitFor(predicateFn, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicateFn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError})` : ""}`);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Root-pid-only termination: no /T, detached children survive by design. */
export function killPidOnly(pid) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

export function launchExe(exePath, env, cwd, label = "") {
  const child = spawn(exePath, [], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  child.unref();
  if (label) console.log(`[harness] ${label}: pid=${child.pid}`);
  return child.pid;
}

export function readLock(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, "controller.lock"), "utf8"));
    return parsed?.service === "orca-controller" ? parsed : null;
  } catch {
    return null;
  }
}

export async function identityOnce(baseUrl) {
  const res = await get(`${baseUrl}/api/system/identity`);
  if (res.status !== 200) return null;
  try {
    const parsed = JSON.parse(res.body);
    return parsed.identity?.service === "orca-controller" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Graceful shutdown through the Change 026 authenticated contract. Returns
 * true when the owning controller exited and released its lock.
 */
export async function gracefulControllerShutdown(baseUrl, dataDir, timeoutMs = 25_000) {
  const lock = readLock(dataDir);
  if (!lock?.controlToken || !isPidAlive(lock.pid)) return false;
  const tokenHeader = { "x-orca-control-token": lock.controlToken };
  const lifecycle = await request(`${baseUrl}/api/system/lifecycle`, { headers: tokenHeader });
  if (lifecycle.status !== 200) return false;
  const state = (() => {
    try {
      return JSON.parse(lifecycle.body).state;
    } catch {
      return "unknown";
    }
  })();
  if (state !== "idle") return false;
  const shutdown = await request(`${baseUrl}/api/system/shutdown`, {
    method: "POST",
    headers: tokenHeader,
    payload: {}
  });
  if (shutdown.status !== 200) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(lock.pid)) {
      // Wait briefly for lock release.
      const releaseDeadline = Date.now() + 5000;
      while (Date.now() < releaseDeadline) {
        if (!readLock(dataDir)) return true;
        await sleep(100);
      }
      return false;
    }
    await sleep(200);
  }
  return false;
}

/** SQLite integrity + FK verification against a durable DB file. */
export function verifyDbIntegrity(dbPath) {
  if (!fs.existsSync(dbPath)) return { ok: false, detail: "db missing" };
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    return { ok: false, detail: `open failed: ${err.message}` };
  }
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity[0]?.integrity_check !== "ok") {
      return { ok: false, detail: `integrity=${integrity[0]?.integrity_check}` };
    }
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    if (fk.length > 0) return { ok: false, detail: `foreign_key violations=${fk.length}` };
    const applied = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get();
    return { ok: true, migrationsApplied: applied.n };
  } catch (err) {
    return { ok: false, detail: err.message };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Windows working-set + handle count for a pid (best-effort, null on failure). */
export function sampleProcessMetrics(pid) {
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p=Get-Process -Id ${pid} -ErrorAction Stop; "{0}:{1}:{2}" -f $p.WorkingSet64,$p.HandleCount,(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Measure-Object | Select-Object -ExpandProperty Count)`
      ],
      { encoding: "utf8" }
    ).trim();
    const [ws, handles, children] = out.split(":");
    return { workingSetBytes: Number(ws), handles: Number(handles), childCount: Number(children) };
  } catch {
    return null;
  }
}

/** Create a fixture bare remote + seeded clone with one commit. */
export function makeFixtureRepository(workDir, name) {
  const remotePath = path.join(workDir, `${name}.git`);
  const clonePath = path.join(workDir, name);
  execFileSync("git", ["init", "--bare", "-q", remotePath]);
  fs.rmSync(clonePath, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", remotePath, clonePath]);
  const gitOpts = { cwd: clonePath };
  execFileSync("git", ["config", "user.email", "harness@orca.invalid"], gitOpts);
  execFileSync("git", ["config", "user.name", "Orca Harness"], gitOpts);
  fs.writeFileSync(path.join(clonePath, "README.md"), `# fixture ${name}\n`);
  execFileSync("git", ["add", "."], gitOpts);
  execFileSync("git", ["commit", "-q", "-m", `fixture seed ${name}`], gitOpts);
  execFileSync("git", ["push", "-q", "origin", "HEAD:main"], gitOpts);

  /** Advance the remote main by one deterministic commit; returns new SHA. */
  const advanceRemote = (message) => {
    fs.appendFileSync(path.join(clonePath, "README.md"), `${message}\n`);
    const opts = { cwd: clonePath };
    execFileSync("git", ["add", "."], opts);
    execFileSync("git", ["commit", "-q", "-m", message], opts);
    execFileSync("git", ["push", "-q", "origin", "HEAD:main"], opts);
    return execFileSync("git", ["rev-parse", "HEAD"], opts).toString().trim();
  };
  const remoteSha = () =>
    execFileSync("git", ["ls-remote", remotePath, "refs/heads/main"])
      .toString()
      .split("\t")[0]
      .trim();

  return { remotePath, clonePath, advanceRemote, remoteSha, name };
}

export function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
