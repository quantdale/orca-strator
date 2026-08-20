import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import type { RunRecord } from "@orca/shared";

describe("Operational intelligence and Change 011 policy APIs", () => {
  let tempDir: string;
  let app: AppInstance;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-op-api-"));
    app = await buildApp(loadConfig({ dbPath: path.join(tempDir, "orca.sqlite"), dataDir: tempDir, logLevel: "error", nodeEnv: "test" }));
  });

  afterEach(async () => {
    await app.fastify.close();
    app.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("exposes readiness, policy, permission, and campaign history without raw-log parsing", async () => {
    const created = await app.fastify.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        displayName: "Operational Repo",
        githubRemote: "https://example.invalid/repo.git",
        localPath: tempDir,
        environment: "windows",
        executorCli: process.execPath,
        executorModel: "test-model",
        solConversationUrl: "https://chatgpt.com/c/1234567890abcdef"
      }
    });
    expect(created.statusCode).toBe(201);
    const repositoryId = JSON.parse(created.body).repository.id as string;
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: "api-run-1",
      repositoryId,
      goal: "Inspect trace",
      status: "SOL_REVIEWING",
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
    app.runStore.create(run);
    app.eventBus.publish({ type: "loop.state_changed", at: now, repositoryId, data: { runId: run.id, iteration: 1, loopState: "SOL_REVIEWING" } });

    const campaigns = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/campaigns` });
    expect(campaigns.statusCode).toBe(200);
    expect(JSON.parse(campaigns.body).campaigns[0].run.id).toBe(run.id);

    const detail = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/campaigns/${run.id}` });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).campaign.timeline[0].phase).toBe("SOL_REVIEW");

    const permissions = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/permissions` });
    expect(permissions.statusCode).toBe(200);
    expect(JSON.parse(permissions.body).policy.preset).toBe("BALANCED");

    const capabilities = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/executor/capabilities` });
    expect(capabilities.statusCode).toBe(200);
    expect(JSON.parse(capabilities.body).capability).toBeNull();

    const usage = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/usage` });
    expect(usage.statusCode).toBe(200);
    expect(JSON.parse(usage.body).summary.unknownMetricCount).toBe(0);

    const scheduler = await app.fastify.inject({ method: "GET", url: "/api/scheduler/policy" });
    expect(scheduler.statusCode).toBe(200);
    expect(JSON.parse(scheduler.body).policy.totalActiveInferenceSessions).toBeNull();

    const roles = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/role-model-policy` });
    expect(roles.statusCode).toBe(200);
    expect(JSON.parse(roles.body).policy.rules).toHaveLength(0);

    const resolved = await app.fastify.inject({ method: "POST", url: `/api/repositories/${repositoryId}/role-model-policy/resolve`, payload: { role: "PRIMARY" } });
    expect(resolved.statusCode).toBe(200);
    expect(JSON.parse(resolved.body).resolution).toMatchObject({ source: "REPOSITORY_DEFAULT", executorCli: process.execPath, model: "test-model" });

    const packet = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repositoryId}/campaigns/${run.id}/packets`,
      payload: {
        workstream: "api-contract",
        goal: "Exercise typed packet API",
        allowedPaths: ["src/example.ts"],
        executor: { role: "PRIMARY", executorCli: process.execPath, model: "test-model", provider: null, source: "REPOSITORY_DEFAULT" }
      }
    });
    expect(packet.statusCode).toBe(201);
    const packetId = JSON.parse(packet.body).packet.packetId as string;
    const packets = await app.fastify.inject({ method: "GET", url: `/api/repositories/${repositoryId}/campaigns/${run.id}/packets` });
    expect(packets.statusCode).toBe(200);
    expect(JSON.parse(packets.body).packets.find((item: { packetId: string }) => item.packetId === packetId)).toBeTruthy();
  });
});
