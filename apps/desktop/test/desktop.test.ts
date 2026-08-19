import { describe, it, expect } from "vitest";
import { getAppUrl } from "../src/main.js";

describe("Electron Windows Shell (Tests 10)", () => {
  it("10.T1 getAppUrl resolves default controller endpoint 127.0.0.1:47100", () => {
    const originalHost = process.env.ORCA_HOST;
    const originalPort = process.env.ORCA_PORT;
    const originalDevUrl = process.env.ORCA_UI_DEV_URL;

    delete process.env.ORCA_HOST;
    delete process.env.ORCA_PORT;
    delete process.env.ORCA_UI_DEV_URL;

    expect(getAppUrl()).toBe("http://127.0.0.1:47100");

    if (originalHost) process.env.ORCA_HOST = originalHost;
    if (originalPort) process.env.ORCA_PORT = originalPort;
    if (originalDevUrl) process.env.ORCA_UI_DEV_URL = originalDevUrl;
  });

  it("10.T2 getAppUrl respects ORCA_UI_DEV_URL in development mode", () => {
    process.env.ORCA_UI_DEV_URL = "http://localhost:5173";
    expect(getAppUrl()).toBe("http://localhost:5173");
    delete process.env.ORCA_UI_DEV_URL;
  });
});
