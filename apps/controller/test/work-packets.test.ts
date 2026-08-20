import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { WorkPacketStore } from "../src/packets/work-packet-store.js";
import { WorkPacketService } from "../src/packets/work-packet-service.js";
import type { RepositoryRecord, RunRecord } from "@orca/shared";

function repository(id: string, localPath: string): RepositoryRecord {
  const now = "2026-08-20T16:00:00.000Z";
  return {
    id,
    displayName: id,
    githubRemote: "https://example.invalid/repo.git",
    localPath,
    environment: "windows",
    wslDistribution: null,
    executorCli: "kimi",
    executorModel: "Kimi K3",
    solConversationUrl: "https://chatgpt.com/c/test",
    maxIterations: 3,
    maxRuntimeMinutes: 2,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

function run(repositoryId: string): RunRecord {
  const now = "2026-08-20T16:00:00.000Z";
  return {
    id: "run-packets",
    repositoryId,
    goal: "Packet qualification",
    status: "EXECUTING",
    currentIteration: 1,
    maxIterations: 3,
    activeDispatchId: null,
    lastError: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    drainReason: null
  };
}

describe("Change 012 typed packet contracts", () => {
  let tempDir: string;
  let dbContext: DatabaseContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-packets-"));
    dbContext = initDatabase(path.join(tempDir, "orca.sqlite"));
  });

  afterEach(() => {
    dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists versioned packets/results and rejects unsafe paths", () => {
    const repo = repository("repo-packets", tempDir);
    new RepositoryStore(dbContext.db).create(repo);
    const campaign = run(repo.id);
    new RunStore(dbContext.db).create(campaign);
    const service = new WorkPacketService(new WorkPacketStore(dbContext.db));
    const packet = service.create(repo, campaign, {
      workstream: "api",
      goal: "Implement a bounded packet",
      requirements: ["Keep the packet structured"],
      allowedPaths: ["src/api.ts"],
      readPaths: ["README.md"],
      executor: { role: "PRIMARY", executorCli: "kimi", model: "Kimi K3", provider: null, source: "REPOSITORY_DEFAULT" },
      verificationExpectations: ["npm test"]
    });
    expect(packet.schemaVersion).toBe(1);
    expect(service.list(campaign.id)).toHaveLength(1);
    const result = service.recordResult(repo, packet, {
      schemaVersion: 1,
      packetId: packet.packetId,
      campaignId: packet.campaignId,
      runId: packet.runId,
      iteration: packet.iteration,
      status: "BLOCKED",
      worktree: null,
      filesChanged: [],
      verification: ["not run"],
      findings: [],
      risks: ["qualification only"],
      artifacts: [],
      dependenciesAffected: [],
      usageMetricIds: [],
      summary: "Waiting for permission",
      blocker: "PERMISSION_REQUIRED",
      createdAt: new Date().toISOString()
    });
    expect(result.status).toBe("BLOCKED");
    expect(service.get(packet.packetId)?.status).toBe("BLOCKED");
    expect(service.getResult(packet.packetId)?.blocker).toBe("PERMISSION_REQUIRED");
    expect(() => service.create(repo, campaign, {
      workstream: "unsafe",
      goal: "reject",
      allowedPaths: ["../outside"],
      executor: packet.executor
    })).toThrow();
  });

  it("retains packet and worktree provenance after reopening SQLite", () => {
    const repo = repository("repo-restart-packets", tempDir);
    new RepositoryStore(dbContext.db).create(repo);
    const campaign = run(repo.id);
    new RunStore(dbContext.db).create(campaign);
    const service = new WorkPacketService(new WorkPacketStore(dbContext.db));
    const packet = service.create(repo, campaign, {
      workstream: "restart",
      goal: "survive restart",
      executor: { role: "PRIMARY", executorCli: "codex", model: "gpt", provider: null, source: "REPOSITORY_DEFAULT" }
    });
    const dbPath = path.join(tempDir, "orca.sqlite");
    dbContext.close();
    dbContext = initDatabase(dbPath);
    expect(new WorkPacketStore(dbContext.db).get(packet.packetId)?.goal).toBe("survive restart");
  });
});
