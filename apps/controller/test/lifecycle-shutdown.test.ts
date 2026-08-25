import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { RunRecord } from "@orca/shared";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { generateControlToken } from "../src/runtime/singleton-lock.js";
import type { LifecycleControl } from "../src/http/routes/lifecycle.js";

describe("Change 026 authenticated lifecycle control", () => {
  let tempDir: string;
  let dbPath: string;
  let appInstance: AppInstance;
  let control: (LifecycleControl & { requests: string[] }) | null;

  async function boot(withControl: boolean): Promise<void> {
    const token = generateControlToken();
    control = withControl
      ? {
          controlToken: token,
          requests: [],
          requestShutdown: (reason) => control?.requests.push(reason)
        }
      : null;
    const config = loadConfig({
      dbPath,
      dataDir: tempDir,
      logLevel: "error",
      nodeEnv: "test"
    });
    appInstance = await buildApp(config, control ? { lifecycle: control } : {});
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-lifecycle-"));
    dbPath = path.join(tempDir, "test.sqlite");
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    control = null;
  });

  function makeRun(over: Partial<RunRecord>): RunRecord {
    const now = new Date().toISOString();
    return {
      id: over.id ?? "run-1",
      repositoryId: over.repositoryId ?? "repo-1",
      goal: "goal",
      status: over.status ?? "EXECUTING",
      currentIteration: 1,
      maxIterations: 20,
      activeDispatchId: null,
      lastError: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
      drainReason: null
    };
  }

  function seedRepository(id: string): void {
    const now = new Date().toISOString();
    appInstance.dbContext.db.prepare(
      "INSERT INTO repositories (id, display_name, github_remote, local_path, environment, executor_cli, executor_model, sol_conversation_url, max_iterations, max_runtime_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, "Fixture", "https://example.invalid/x.git", "C:/tmp/x", "windows", "kimi", "m", "https://c", 5, 30, now, now);
  }

  it("rejects lifecycle reads without a token (unauthenticated surface is inert)", { timeout: 20_000 }, async () => {
    await boot(true);
    const noHeader = await appInstance.fastify.inject({ method: "GET", url: "/api/system/lifecycle" });
    expect(noHeader.statusCode).toBe(401);

    const wrongToken = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/system/lifecycle",
      headers: { "x-orca-control-token": "not-the-token" }
    });
    expect(wrongToken.statusCode).toBe(401);

    // Shutdown without auth is equally impossible.
    const shutdown = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/system/shutdown"
    });
    expect(shutdown.statusCode).toBe(401);
    expect(control?.requests).toHaveLength(0);
  });

  it(`reports idle quiescence to the authorized caller`, { timeout: 20_000 }, async () => {
    await boot(true);
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/system/lifecycle",
      headers: { "x-orca-control-token": control!.controlToken }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: "idle", activeCampaigns: [], pid: process.pid });
  });

  it(`reports active campaigns truthfully and refuses shutdown while they run`, { timeout: 20_000 }, async () => {
    await boot(true);
    seedRepository("repo-1");
    appInstance.runStore.create(makeRun({ status: "EXECUTING" }));

    const status = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/system/lifecycle",
      headers: { "x-orca-control-token": control!.controlToken }
    });
    const body = status.json() as { state: string; activeCampaigns: unknown[] };
    expect(body.state).toBe("active-campaigns");
    expect(body.activeCampaigns).toHaveLength(1);
    // Safe summary only — ids + loop state.
    expect(body.activeCampaigns[0]).toEqual({
      repositoryId: "repo-1",
      runId: "run-1",
      loopState: "EXECUTING"
    });

    const refused = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/system/shutdown",
      headers: { "x-orca-control-token": control!.controlToken },
      payload: {}
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: "SHUTDOWN_REFUSED_ACTIVE", state: "active-campaigns" });
    expect(control?.requests).toHaveLength(0); // nothing was signalled
  });

  it(`accepts graceful shutdown when idle and triggers the teardown callback exactly once`, { timeout: 20_000 }, async () => {
    await boot(true);
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/system/shutdown",
      headers: { "x-orca-control-token": control!.controlToken },
      payload: {}
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, state: "shutting-down" });
    await new Promise((r) => setImmediate(r));
    expect(control?.requests).toEqual(["CONTROL_SHUTDOWN"]);
  });

  it("without registered control the endpoints stay closed even for guessed tokens", async () => {
    await boot(false);
    for (const request of [
      { method: "GET", url: "/api/system/lifecycle" },
      { method: "POST", url: "/api/system/shutdown" }
    ]) {
      const res = await appInstance.fastify.inject({
        ...request,
        headers: { "x-orca-control-token": "anything" }
      } as never);
      expect(res.statusCode).toBe(401);
    }
  });
});
