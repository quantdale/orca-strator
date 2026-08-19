import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";

describe("Controller-Served Built SPA (Tests 9)", () => {
  let tempDir: string;
  let uiDistDir: string;
  let dbPath: string;
  let appInstance: AppInstance;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-spa-"));
    dbPath = path.join(tempDir, "test.sqlite");
    uiDistDir = path.join(tempDir, "ui-dist");
    fs.mkdirSync(uiDistDir, { recursive: true });

    fs.writeFileSync(path.join(uiDistDir, "index.html"), "<!DOCTYPE html><html><body><div id=\"root\">SPA Root</div></body></html>");
    fs.mkdirSync(path.join(uiDistDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(uiDistDir, "assets", "app.js"), "console.log(\"mock bundle\");");

    const config = loadConfig({
      dbPath,
      dataDir: tempDir,
      uiDistDir,
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

  it("9.T1 GET / serves the SPA index.html", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/"
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<div id=\"root\">SPA Root</div>");
  });

  it("9.T2 GET /assets/app.js serves static asset correctly", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/assets/app.js"
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("console.log(\"mock bundle\");");
  });

  it("9.T3 GET /repositories/repo-123 client route serves SPA shell fallback", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/repositories/repo-123"
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<div id=\"root\">SPA Root</div>");
  });

  it("9.T4 GET /api/health remains JSON API and is never SPA HTML", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({
      status: "ok",
      service: "orca-controller",
      version: "0.1.0"
    });
  });

  it("9.T5 unknown /api/* returns JSON 404 error envelope and is never SPA HTML", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/unknown-endpoint"
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("REPOSITORY_NOT_FOUND");
  });

  it("9.T6 runtime database file cannot be accessed via static serving", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/../test.sqlite"
    });

    expect(res.body).not.toContain("SQLite format 3");
  });
});
