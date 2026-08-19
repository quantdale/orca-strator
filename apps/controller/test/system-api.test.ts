import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";

describe("System & Tailscale API (Task 1)", () => {
  let tempDir: string;
  let appInstance: AppInstance;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-system-api-test-"));
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      port: 8765
    });

    appInstance = await buildApp(config, {
      browserDriver: new MockBrowserDriver()
    });
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("1.T1 GET /api/system/tailscale returns loopback port and CLI instructions", async () => {
    const res = await appInstance.fastify.inject({
      method: "GET",
      url: "/api/system/tailscale"
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tailscale.loopbackPort).toBe(8765);
    expect(body.tailscale.loopbackUrl).toBe("http://127.0.0.1:8765");
    expect(body.tailscale.command).toContain("tailscale serve --bg https / http://127.0.0.1:8765");
    expect(body.tailscale.instructions.length).toBeGreaterThan(0);
  });
});
