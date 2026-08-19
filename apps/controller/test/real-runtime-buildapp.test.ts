/**
 * Q.APP.1 — Production buildApp() qualification gate (Fix #2).
 *
 * Uses the REAL production application lifecycle: buildApp(config, overrides)
 * with only the external ChatGPT browser driver mocked. Proves:
 *   create repo via app seam -> start run -> push isolated dispatch ->
 *   production watcher (auto-started) -> loop -> real harness child process ->
 *   durable result -> loop -> Sol wake
 * WITHOUT manually assembling the service graph, nor calling
 * watcherService.start / onDispatchDetected / onExecutorCompleted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";

const HARNESS_PATH = path.resolve(__dirname, "fixtures", "real-executor-harness.mjs");
if (!process.env.ORCA_TEST_EXECUTOR_HARNESS) process.env.ORCA_TEST_EXECUTOR_HARNESS = HARNESS_PATH;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}
function waitForCondition(fn: () => boolean, timeoutMs: number, everyMs = 150): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = fn(); } catch { ok = false; }
      if (ok) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`waitForCondition timed out after ${timeoutMs}ms`)); return; }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

describe("Real Runtime Q.APP.1 — buildApp production controller gate", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-app-qual-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });
    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-app-qual@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca App Qual"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# Orca App Qualification Fixture\n");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "initial"]);
    git(cloneDir, ["remote", "add", "origin", bareDir]);
    git(cloneDir, ["push", "-u", "origin", "main"]);

    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });
    // buildApp now auto-starts watcherService; do NOT call watcherService.start()
  });

  afterEach(async () => {
    try { await app.fastify.close(); } catch {}
    try { app.dbContext.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Q.APP.1 buildApp watcher startup + pipeline via production lifecycle: no manual watcher start, no transition calls", async () => {
    // Prove watcher auto-started: create enabled repo via app seam, then verify it becomes watched without manual start
    const created = app.repositoryService.createRepository({
      displayName: "App Qual Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/app-qual-test",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });
    const repoId = created.id;

    // Disabled repo must remain unwatched
    const disabled = app.repositoryService.createRepository({
      displayName: "Disabled Repo",
      githubRemote: bareDir,
      localPath: path.join(tempDir, "unused-clone"),
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/disabled",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: false
    });

    // Tiny delay to let reconcileWatchingForRepository run
    await new Promise((r) => setTimeout(r, 200));
    expect(app.watcherService.getWatcherStatus(repoId).isWatching).toBe(true);
    expect(app.watcherService.getWatcherStatus(disabled.id).isWatching).toBe(false);

    // Start a real run through the API seam (loopService via app)
    const startRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/runs/start`,
      payload: { goal: "Q.APP.1 production buildApp qualification", maxIterations: 5 }
    });
    expect(startRes.statusCode).toBe(201);
    const runId: string = startRes.json().run.id;
    expect(["SOL_PENDING", "SOL_REVIEWING"]).toContain(startRes.json().run.status);

    // Push a real isolated dispatch marker correlated to that run
    const dispatchId = `disp-app-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/009-real",
      goal: "Q.APP.1 dispatch",
      instructionsVersion: 1
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`), JSON.stringify(marker, null, 2));
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(cloneDir, ["push", "origin", "main"]);

    // Wait for the production watcher->loop->real harness->result->loop without any manual transition call
    await waitForCondition(() => app.dispatchStore.get(dispatchId)?.status === "consumed", 90000);

    const execRuns = app.executorStore.getByRepository(repoId);
    expect(execRuns.length).toBeGreaterThan(0);
    expect(execRuns.find((r) => r.status === "completed")).toBeTruthy();

    const wakes = app.wakeStore.getByRepository(repoId);
    expect(wakes.length).toBeGreaterThan(0);
    const page = mockBrowser.history.get(repoId);
    expect(page, "sol wake page should exist").toBeTruthy();
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);

    // Durable result manifest committed/pushed
    const remoteResultPath = `.orca/results/${dispatchId}.json`;
    const remoteHead = git(bareDir, ["rev-parse", "HEAD"]);
    expect(git(bareDir, ["rev-parse", `${remoteHead}:${remoteResultPath}`])).toBeTruthy();

    // Loop must be SOL_REVIEWING (waiting for Sol), not GOAL_COMPLETE (Sol is authoritative)
    const statusRes = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repoId}/runs/active` });
    expect(statusRes.json().status.state).toBe("SOL_REVIEWING");

    // Shutdown must stop timers cleanly
    await app.fastify.close();
    expect(app.watcherService.getWatcherStatus(repoId).isWatching).toBe(false);
    // Re-open fastify db context already closed; avoid double close in afterEach
    (app as any).fastify = { close: async () => {} } as any;
  }, 120000);

  it("H.4 via buildApp: real Sol-control marker (GOAL_COMPLETE) detected by production watcher without onControlDetected call", async () => {
    const created = app.repositoryService.createRepository({
      displayName: "App Qual SolControl Repo",
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "orca-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/app-qual-control",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });
    const repoId = created.id;

    const startRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/runs/start`,
      payload: { goal: "H.4 sol-control qualification", maxIterations: 5 }
    });
    const runId: string = startRes.json().run.id;

    // First, drive one executor turn so run is SOL_REVIEWING
    const dispatchId = `disp-ctrl-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1, type: "dispatch", runId, dispatchId, iteration: 1,
      createdAt: new Date().toISOString(), baseSha, changePath: "openspec/changes/009-real",
      goal: "H.4 dispatch", instructionsVersion: 1
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`), JSON.stringify(marker, null, 2));
    git(cloneDir, ["add", "-A"]); git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]); git(cloneDir, ["push", "origin", "main"]);
    await waitForCondition(() => app.dispatchStore.get(dispatchId)?.status === "consumed", 90000);
    expect(app.loopService.getStatus(repoId).state).toBe("SOL_REVIEWING");

    // Now push an isolated Sol-control marker for GOAL_COMPLETE correlated to same run/iteration
    const controlId = `ctrl-${crypto.randomUUID().slice(0, 8)}`;
    const solControl = {
      schemaVersion: 1,
      type: "sol-control",
      runId,
      controlId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      decision: "GOAL_COMPLETE",
      relatedDispatchId: dispatchId,
      summary: "Sol marks goal complete via durable control marker"
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "sol-control"), { recursive: true });
    fs.writeFileSync(path.join(cloneDir, ".orca", "sol-control", `${controlId}.json`), JSON.stringify(solControl, null, 2));
    git(cloneDir, ["add", "-A"]); git(cloneDir, ["commit", "-m", `chore(sol): control ${controlId}`]); git(cloneDir, ["push", "origin", "main"]);

    // Do NOT call app.loopService.onControlDetected directly; watcher must detect it
    await waitForCondition(() => {
      const latest = app.runStore.get(runId);
      return latest?.status === "GOAL_COMPLETE";
    }, 20000);
    expect(app.runStore.get(runId)?.status).toBe("GOAL_COMPLETE");
    expect(app.solControlStore.get(controlId)?.status).toBe("consumed");
    // GOAL_COMPLETE is terminal, so loop getStatus collapses to IDLE by design (N)
    expect(["IDLE", "GOAL_COMPLETE"]).toContain(app.loopService.getStatus(repoId).state);

    await app.fastify.close();
    (app as any).fastify = { close: async () => {} } as any;
  }, 150000);
});
