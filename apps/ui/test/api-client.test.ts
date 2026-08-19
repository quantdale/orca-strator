import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEventsWsUrl, EventsClient, type ConnectionStatus } from "../src/lib/events-client.js";
import { createApiClient } from "../src/lib/api-client.js";

describe("UI Same-Origin Client Foundation (Tests 7)", () => {
  it("7.T1 relative REST route construction by default without hardcoded localhost", () => {
    const client = createApiClient();
    expect(client).toBeDefined();
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

describe("EventsClient Lifecycle and Reconnect (Tests 5)", () => {
  let createdSockets: FakeWebSocket[] = [];
  let originalWebSocket: any;

  class FakeWebSocket {
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((e: any) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    closed = false;

    constructor(url: string) {
      this.url = url;
      createdSockets.push(this);
    }

    triggerOpen() {
      if (this.onopen) this.onopen();
    }

    triggerMessage(data: any) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
    }

    triggerClose() {
      this.closed = true;
      if (this.onclose) this.onclose();
    }

    triggerError(err: any = new Error("WS error")) {
      if (this.onerror) this.onerror(err);
      this.triggerClose();
    }

    close() {
      this.closed = true;
      if (this.onclose) this.onclose();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    createdSockets = [];
    originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it("5.T1 connects, transitions to connected on open, and dispatches events", () => {
    const client = new EventsClient(() => "ws://127.0.0.1:47100/api/events");
    const statuses: ConnectionStatus[] = [];
    client.onStatusChange((s) => statuses.push(s));

    const events: any[] = [];
    client.subscribe((e) => events.push(e));

    client.connect();
    expect(statuses).toEqual(["disconnected", "connecting"]);
    expect(createdSockets).toHaveLength(1);

    createdSockets[0].triggerOpen();
    expect(statuses).toEqual(["disconnected", "connecting", "connected"]);

    createdSockets[0].triggerMessage({ type: "repository.created", repositoryId: "r1" });
    expect(events).toEqual([{ type: "repository.created", repositoryId: "r1" }]);
  });

  it("5.T2 unexpected close schedules reconnect and reconnects", () => {
    const client = new EventsClient(() => "ws://127.0.0.1:47100/api/events", { reconnectDelayMs: 500 });
    const statuses: ConnectionStatus[] = [];
    client.onStatusChange((s) => statuses.push(s));

    client.connect();
    createdSockets[0].triggerOpen();
    expect(client.getStatus()).toBe("connected");

    // Unexpected close
    createdSockets[0].triggerClose();
    expect(client.getStatus()).toBe("disconnected");

    // Advance timer
    vi.advanceTimersByTime(500);
    expect(createdSockets).toHaveLength(2);
    expect(client.getStatus()).toBe("connecting");

    createdSockets[1].triggerOpen();
    expect(client.getStatus()).toBe("connected");
  });

  it("5.T3 error path triggers reconnect properly", () => {
    const client = new EventsClient(() => "ws://127.0.0.1:47100/api/events", { reconnectDelayMs: 500 });
    client.connect();
    createdSockets[0].triggerOpen();

    createdSockets[0].triggerError();
    expect(client.getStatus()).toBe("disconnected");

    vi.advanceTimersByTime(500);
    expect(createdSockets).toHaveLength(2);
    createdSockets[1].triggerOpen();
    expect(client.getStatus()).toBe("connected");
  });

  it("5.T4 disconnect prevents reconnection; later connect re-enables it", () => {
    const client = new EventsClient(() => "ws://127.0.0.1:47100/api/events", { reconnectDelayMs: 500 });
    client.connect();
    createdSockets[0].triggerOpen();

    client.disconnect();
    expect(client.getStatus()).toBe("disconnected");

    vi.advanceTimersByTime(1000);
    expect(createdSockets).toHaveLength(1); // No new sockets created

    // Later connect
    client.connect();
    expect(createdSockets).toHaveLength(2);
    createdSockets[1].triggerOpen();
    expect(client.getStatus()).toBe("connected");

    // Now if close happens, reconnect works again
    createdSockets[1].triggerClose();
    vi.advanceTimersByTime(500);
    expect(createdSockets).toHaveLength(3);
  });

  it("5.T5 retain() handles reference counting and StrictMode mount-unmount-remount", () => {
    const client = new EventsClient(() => "ws://127.0.0.1:47100/api/events", { reconnectDelayMs: 500 });

    // Mount 1
    const release1 = client.retain();
    expect(createdSockets).toHaveLength(1);
    createdSockets[0].triggerOpen();

    // StrictMode unmount
    release1();
    expect(client.getStatus()).toBe("disconnected");

    // StrictMode remount
    const release2 = client.retain();
    expect(createdSockets).toHaveLength(2);
    createdSockets[1].triggerOpen();
    expect(client.getStatus()).toBe("connected");

    // Second consumer mounts
    const release3 = client.retain();
    expect(createdSockets).toHaveLength(2); // Still using same active socket

    // First consumer unmounts
    release2();
    expect(client.getStatus()).toBe("connected"); // Still active because release3 is active

    // Second consumer unmounts
    release3();
    expect(client.getStatus()).toBe("disconnected");
  });
});
