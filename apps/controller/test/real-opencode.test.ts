import { describe, expect, it } from "vitest";
import { OpenCodeAdapter } from "../src/executor/adapters/opencode-adapter.js";

const endpoint = process.env.ORCA_OPENCODE_QUALIFY_URL?.trim() || null;
if (!endpoint) {
  console.warn("OpenCode real qualification UNQUALIFIED: set ORCA_OPENCODE_QUALIFY_URL to an authorized local server endpoint.");
}

describe("Real optional OpenCode qualification", () => {
  it.skipIf(!endpoint)("probes the configured OpenCode server without inference", async () => {
    const result = await new OpenCodeAdapter({ endpoint, requestTimeoutMs: 10_000 }).probeServer();
    expect(result.details.routes.health).toBe("READY");
    expect(result.details.experimental).toBe(true);
    expect(result.details.endpoint).toBe(new URL(endpoint!).origin);
  }, 30_000);
});
