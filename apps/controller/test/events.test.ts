import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocket } from "ws";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import type { RepositoryMutationEvent } from "@orca/shared";

describe("Real-time Event Foundation (Tests 6)", () => {
  let tempDir: string;
  let dbPath: string;
  let appInstance: AppInstance;
  let port: number;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-test-events-"));
    dbPath = path.join(tempDir, "test.sqlite");
    port = 48000 + Math.floor(Math.random() * 1000);
    const config = loadConfig({
      host: "127.0.0.1",
      port,
      dbPath,
      dataDir: tempDir,
      logLevel: "error",
      nodeEnv: "test"
    });
    appInstance = await buildApp(config);
    await appInstance.fastify.listen({ host: "127.0.0.1", port });
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("6.T1 receives repository.created and repository.deleted events via WebSocket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const receivedEvents: RepositoryMutationEvent[] = [];
    ws.on("message", (data) => {
      receivedEvents.push(JSON.parse(data.toString()));
    });

    const created = appInstance.repositoryService.createRepository({
      displayName: "Event Repo",
      githubRemote: "https://github.com/quantdale/event.git",
      localPath: "D:\\Projects\\Event",
      environment: "windows",
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab"
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].type).toBe("repository.created");
    expect(receivedEvents[0].repositoryId).toBe(created.id);
    expect(receivedEvents[0].data?.repository?.displayName).toBe("Event Repo");

    appInstance.repositoryService.deleteRepository(created.id);
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[1].type).toBe("repository.deleted");
    expect(receivedEvents[1].repositoryId).toBe(created.id);

    ws.close();
  });

  it("6.T2 failed mutation emits no false success event", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events`);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    const receivedEvents: RepositoryMutationEvent[] = [];
    ws.on("message", (data) => {
      receivedEvents.push(JSON.parse(data.toString()));
    });

    try {
      appInstance.repositoryService.createRepository({
        displayName: "",
        environment: "windows"
      });
    } catch {
      // Expected validation error
    }

    await new Promise((r) => setTimeout(r, 100));
    expect(receivedEvents).toHaveLength(0);

    ws.close();
  });
});
