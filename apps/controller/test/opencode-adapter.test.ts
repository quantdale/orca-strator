import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { OpenCodeAdapter } from "../src/executor/adapters/opencode-adapter.js";
import { buildExecutorInvocation, resolveProfile } from "../src/executor/profiles.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

const hybridPaths = {
  "/api/global/health": { get: {} },
  "/global/event": { get: {} },
  "/api/event": { get: {} },
  "/api/session": { post: {} },
  "/api/session/{sessionID}/prompt": { post: {} },
  "/api/session/{sessionID}/wait": { post: {} },
  "/api/session/{sessionID}/abort": { post: {} },
  "/api/session/{sessionID}/message": { get: {} },
  "/api/permission": { get: {} },
  "/api/permission/{permissionID}/reply": { post: {} },
  "/api/provider": { get: {} },
  "/api/subagent": { get: {} }
};

describe("optional OpenCode adapter", () => {
  it("does not contact a server when no endpoint is configured", async () => {
    let calls = 0;
    const adapter = new OpenCodeAdapter({
      endpoint: null,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("should not be called");
      }
    });

    const result = await adapter.probeServer();

    expect(calls).toBe(0);
    expect(result.details.endpoint).toBeNull();
    expect(result.details.experimental).toBe(true);
    expect(result.issues[0]?.class).toBe("OPENCODE_ENDPOINT_NOT_CONFIGURED");
  });

  it("feature-detects a hybrid server and consumes only structured native data", async () => {
    const calls: string[] = [];
    const endpoint = await startServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      if (request.url === "/api/global/health") return sendJson(response, 200, { version: "1.15.11" });
      if (request.url === "/global/health") return sendJson(response, 404, { error: "legacy health absent" });
      if (request.url === "/doc") return sendJson(response, 200, { openapi: "3.1.0", paths: hybridPaths });
      if (request.url === "/api/session" && request.method === "POST") return sendJson(response, 200, { sessionID: "session-1" });
      if (request.url === "/api/session/session-1/prompt") return sendJson(response, 202, { accepted: true });
      if (request.url === "/api/session/session-1/wait") return sendJson(response, 200, { status: "idle" });
      if (request.url === "/api/session/session-1/abort") return sendJson(response, 200, { aborted: true });
      if (request.url === "/api/session/session-1/message") {
        return sendJson(response, 200, [{
          info: {
            role: "assistant",
            model: { providerID: "provider-a", modelID: "model-a" },
            tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3 } },
            cost: 0.25,
            time: { created: 1000, completed: 1250 }
          }
        }]);
      }
      if (request.url === "/api/permission/p-1/reply") return sendJson(response, 200, { ok: true });
      if (request.url === "/api/provider") return sendJson(response, 200, [{ id: "provider-a" }]);
      if (request.url === "/api/subagent") return sendJson(response, 200, [{ id: "build" }]);
      if (request.url === "/api/event") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/event-stream");
        response.end("data: {\"type\":\"session.updated\"}\n\n");
        return;
      }
      sendJson(response, 404, { error: "not found" });
    });
    const adapter = new OpenCodeAdapter({ endpoint, requestTimeoutMs: 1000 });

    const probe = await adapter.probeServer();

    expect(probe.details.apiGeneration).toBe("HYBRID");
    expect(probe.details.serverVersion).toBe("1.15.11");
    expect(probe.details.routes.events).toBe("READY");
    expect(probe.details.routes.permissions).toBe("READY");
    expect(probe.details.routes.subagents).toBe("READY");
    expect(probe.capabilities.structuredEvents).toBe("READY");
    expect(probe.capabilities.permissionApi).toBe("READY");
    expect(calls).toEqual(["GET /api/global/health", "GET /doc"]);

    const session = await adapter.createSession({ directory: "C:\\repo" });
    expect(session).toEqual({ sessionID: "session-1" });
    await adapter.prompt("session-1", "inspect the repository", { providerID: "provider-a", modelID: "model-a" });
    await adapter.wait("session-1");
    await adapter.cancelSession("session-1");
    await adapter.replyPermission("p-1", { reply: "once" });
    expect(await adapter.listProviders()).toEqual([{ id: "provider-a" }]);
    expect(await adapter.listSubagents()).toEqual([{ id: "build" }]);
    const usage = await adapter.readSessionUsage("session-1");
    expect(usage.inputTokens).toBe(10);
    expect(usage.cachedInputTokens).toBe(3);
    expect(usage.outputTokens).toBe(4);
    expect(usage.reasoningTokens).toBe(2);
    expect(usage.exactCost).toBe(0.25);
    expect(usage.provider).toBe("provider-a");
    expect(usage.model).toBe("model-a");

    const events: unknown[] = [];
    await adapter.subscribeEvents((event) => events.push(event));
    expect(events).toEqual([{ type: "session.updated" }]);
    expect(calls).toContain("POST /api/session/session-1/prompt");
    expect(calls).toContain("GET /api/session/session-1/message");
  });

  it("keeps native calls unsupported when health is up but the API document is unavailable", async () => {
    const endpoint = await startServer((request, response) => {
      if (request.url === "/api/global/health") return sendJson(response, 200, { version: "unknown" });
      sendJson(response, 404, { error: "not found" });
    });
    const adapter = new OpenCodeAdapter({ endpoint, requestTimeoutMs: 1000 });

    const probe = await adapter.probeServer();

    expect(probe.details.routes.health).toBe("READY");
    expect(probe.details.routes.sessions).toBe("UNKNOWN");
    await expect(adapter.createSession()).rejects.toMatchObject({ code: "OPENCODE_API_UNSUPPORTED" });
  });

  it("classifies malformed OpenAPI responses as experimental API drift", async () => {
    const endpoint = await startServer((request, response) => {
      if (request.url === "/api/global/health") return sendJson(response, 200, { version: "dev" });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end("not-json");
    });
    const adapter = new OpenCodeAdapter({ endpoint, requestTimeoutMs: 1000 });

    const probe = await adapter.probeServer();

    expect(probe.issues.some((issue) => issue.class === "OPENCODE_API_DRIFT")).toBe(true);
    expect(probe.details.experimental).toBe(true);
  });

  it("exposes the documented headless invocation without changing the configured model", async () => {
    const adapter = new OpenCodeAdapter({ endpoint: null });
    expect(adapter.capabilities({ env: { ORCA_ENVIRONMENT: "windows" } }).headless).toBe("READY");
    expect(adapter.capabilities({ wslDistribution: "Ubuntu" }).environment).toBe("wsl");
    expect(resolveProfile("opencode")).toBe("opencode");
    expect(buildExecutorInvocation("opencode", {
      cli: "opencode",
      model: "provider/model",
      prompt: "inspect the repository"
    })).toEqual({
      command: "opencode",
      args: ["run", "--model", "provider/model", "inspect the repository"]
    });
  });
});
