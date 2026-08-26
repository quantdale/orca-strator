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

  // The route shells out to the tailscale CLI with its own 8s-per-probe bound;
  // on a loaded machine (full parallel suite, process-spawn contention) a
  // not_installed ENOENT probe can legitimately exceed vitest's 5s default.
  // Keep the production bound and give the test room for two worst-case probes.
  it("1.T1 GET /api/system/tailscale returns loopback port and CLI instructions", { timeout: 20_000 }, async () => {
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

  // Change 026 §5: Settings Create-Backup action. The controller writes the
  // bundle under its own data dir; the request supplies no paths.
  it("1.T2 POST /api/system/backup creates a verified bundle under the data dir", async () => {
    const res = await appInstance.fastify.inject({
      method: "POST",
      url: "/api/system/backup",
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bundleDir.startsWith(tempDir.replace(/\\/g, "/")) || body.bundleDir.startsWith(tempDir)).toBe(true);
    expect(body.manifest.kind).toBe("orca-state-backup");
    expect(body.manifest.files.map((f: { path: string }) => f.path)).toEqual(["state/orca.db"]);
    for (const file of body.manifest.files) {
      expect(fs.existsSync(path.join(body.bundleDir, file.path))).toBe(true);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
