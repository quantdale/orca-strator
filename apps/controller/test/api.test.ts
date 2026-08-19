import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";

describe("Controller REST API (Tests 5)", () => {
  let tempDir: string;
  let dbPath: string;
  let appInstance: AppInstance;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-api-"));
    dbPath = path.join(tempDir, "test.sqlite");
    const config = loadConfig({
      dbPath,
      dataDir: tempDir,
      logLevel: "error",
      nodeEnv: "test"
    });
    appInstance = await buildApp(config);
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("5.T1 GET /api/health returns ok after DB readiness", async () => {
    const response = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      status: "ok",
      service: "orca-controller",
      version: "0.1.0"
    });
  });

  it("5.T2 GET /api/repositories returns empty array initially", async () => {
    const response = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/repositories"
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ repositories: [] });
  });

  it("5.T3 POST /api/repositories creates Windows repository with defaults", async () => {
    const payload = {
      displayName: "TabDock",
      githubRemote: "https://github.com/quantdale/tabdock.git",
      localPath: "D:\\Projects\\TabDock",
      environment: "windows",
      executorCli: "codex",
      executorModel: "gpt-5.6-luna-xhigh",
      solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
    };

    const createRes = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/repositories",
      payload
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = JSON.parse(createRes.body);
    const repo = createBody.repository;
    expect(repo.id).toBeDefined();
    expect(repo.displayName).toBe("TabDock");
    expect(repo.environment).toBe("windows");
    expect(repo.wslDistribution).toBeNull();
    expect(repo.maxIterations).toBe(20);
    expect(repo.maxRuntimeMinutes).toBe(480);
    expect(repo.createdAt).toBeDefined();
    expect(repo.updatedAt).toBeDefined();

    const getRes = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${repo.id}`
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).repository).toEqual(repo);
  });

  it("5.T4 POST /api/repositories rejects invalid WSL configuration", async () => {
    const payload = {
      displayName: "Nightwatch",
      githubRemote: "https://github.com/quantdale/nightwatch.git",
      localPath: "/home/dale/projects/nightwatch",
      environment: "wsl",
      executorCli: "kimi",
      executorModel: "deepseek-v4-flash",
      solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
    };

    const res = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/repositories",
      payload
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "wslDistribution",
          message: expect.stringContaining("WSL distribution is required")
        })
      ])
    );
  });

  it("5.T5 PATCH /api/repositories/:id updates fields and revalidates", async () => {
    const createRes = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        displayName: "TabDock",
        githubRemote: "https://github.com/quantdale/tabdock.git",
        localPath: "D:\\Projects\\TabDock",
        environment: "windows",
        executorCli: "codex",
        executorModel: "gpt-5.6-luna-xhigh",
        solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
      }
    });
    const repoId = JSON.parse(createRes.body).repository.id;

    const patchRes = await appInstance.fastify.inject({
      method: "PATCH",
      url: `/api/repositories/${repoId}`,
      payload: {
        executorModel: "gpt-5.6-luna-max",
        maxRuntimeMinutes: 600
      }
    });
    expect(patchRes.statusCode).toBe(200);
    const updated = JSON.parse(patchRes.body).repository;
    expect(updated.executorModel).toBe("gpt-5.6-luna-max");
    expect(updated.maxRuntimeMinutes).toBe(600);

    const invalidPatchRes = await appInstance.fastify.inject({
      method: "PATCH",
      url: `/api/repositories/${repoId}`,
      payload: {
        maxIterations: -1
      }
    });
    expect(invalidPatchRes.statusCode).toBe(422);
  });

  it("5.T6 GET /api/repositories/:id returns 404 for unknown repository", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/repositories/non-existent-id"
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("REPOSITORY_NOT_FOUND");
  });

  it("5.T7 DELETE /api/repositories/:id removes record and returns 204", async () => {
    const createRes = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        displayName: "To Delete",
        githubRemote: "https://github.com/quantdale/todelete.git",
        localPath: "D:\\Projects\\ToDelete",
        environment: "windows",
        executorCli: "codex",
        executorModel: "gpt-5.6",
        solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
      }
    });
    const repoId = JSON.parse(createRes.body).repository.id;

    const delRes = await appInstance.fastify.inject({
      method: "DELETE",
      url: `/api/repositories/${repoId}`
    });
    expect(delRes.statusCode).toBe(204);

    const getRes = await appInstance.fastify.inject({
      method: "GET",
      url: `/api/repositories/${repoId}`
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("5.T9 branch field is rejected under strict V1 validation", async () => {
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/repositories",
      payload: {
        displayName: "TabDock",
        githubRemote: "https://github.com/quantdale/tabdock.git",
        localPath: "D:\\Projects\\TabDock",
        environment: "windows",
        executorCli: "codex",
        executorModel: "gpt-5.6",
        solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
        branch: "main"
      }
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("5.T10 loadConfig validates port and host", () => {
    expect(() =>
      loadConfig({ port: -1 })
    ).toThrow(/Invalid configuration: port must be an integer between 1 and 65535/);

    expect(() =>
      loadConfig({ port: 70000 })
    ).toThrow(/Invalid configuration: port must be an integer between 1 and 65535/);

    expect(() =>
      loadConfig({ port: NaN as any })
    ).toThrow(/Invalid configuration: port must be an integer between 1 and 65535/);

    expect(() =>
      loadConfig({ host: "" })
    ).toThrow(/Invalid configuration: host must be a non-empty string/);
  });
});
