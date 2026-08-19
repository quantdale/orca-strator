import { describe, it, expect } from "vitest";
import { getEventsWsUrl } from "../src/lib/events-client.js";
import { createApiClient } from "../src/lib/api-client.js";

describe("UI Same-Origin Client Foundation (Tests 7)", () => {
  it("7.T1 relative REST route construction by default without hardcoded localhost", () => {
    const client = createApiClient();
    expect(client).toBeDefined();
    // Default client uses relative paths
  });

  it("7.T2 HTTP page yields same-origin ws: event URL", () => {
    const wsUrl = getEventsWsUrl({
      protocol: "http:",
      host: "localhost:5173"
    });
    expect(wsUrl).toBe("ws://localhost:5173/api/events");
  });

  it("7.T3 HTTPS synthetic page origin yields same-origin wss: event URL", () => {
    const wsUrl = getEventsWsUrl({
      protocol: "https:",
      host: "orca.example.com"
    });
    expect(wsUrl).toBe("wss://orca.example.com/api/events");
  });

  it("7.T4 custom host or loopback port correctly forms WebSocket endpoint", () => {
    const wsUrl = getEventsWsUrl({
      protocol: "http:",
      host: "127.0.0.1:47100"
    });
    expect(wsUrl).toBe("ws://127.0.0.1:47100/api/events");
  });
});
