/**
 * Permission ask-resolution end-to-end flow tests (Change 020).
 * - Resolving the last unresolved actionable ask of a run parked in
 *   ATTENTION_REQUIRED emits exactly one permission.resolved event and
 *   re-drives the campaign toward Sol review through the existing recovery
 *   path (mock browser driver proves the deterministic Sol handoff).
 * - A sibling pending ask keeps the campaign parked until every ask resolves.
 * - Resolution while an actor is active records evidence only.
 * - Failed (409) resolutions emit no additional resolved event.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { PermissionDecision, RunRecord } from "@orca/shared";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";

describe("Permission ask-resolution flow (Change 020)", () => {
  let tempDir: string;
  let appInstance: AppInstance;
  let mockDriver: MockBrowserDriver;
  let repoId: string;

  const waitForRunStatus = async (
    runId: string,
    statuses: string[],
    timeoutMs = 5000
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = appInstance.runStore.get(runId)?.status ?? "";
      if (statuses.includes(status)) return status;
      if (Date.now() > deadline) return status;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-perm-resolution-"));
    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent"
    });
    mockDriver = new MockBrowserDriver();
    appInstance = await buildApp(config, { browserDriver: mockDriver });
    const created = appInstance.repositoryService.createRepository({
      displayName: "Perm Resolution Repo",
      githubRemote: "https://github.com/quantdale/perm-resolution.git",
      localPath: path.join(tempDir, "repo"),
      environment: "windows",
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl: "https://chatgpt.com/c/perm-resolution"
    });
    repoId = created.id;
  });

  afterEach(async () => {
    await appInstance.fastify.close();
    appInstance.dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const createRun = async (status: RunRecord["status"]): Promise<RunRecord> => {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: crypto.randomUUID(),
      repositoryId: repoId,
      goal: "attention resolution qualification",
      status,
      currentIteration: 1,
      maxIterations: 20,
      activeDispatchId: null,
      lastError: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
      drainReason: null
    };
    appInstance.runStore.create(run);
    return run;
  };

  const askDecision = (run: RunRecord): PermissionDecision => ({
    id: crypto.randomUUID(),
    repositoryId: repoId,
    runId: run.id,
    iteration: 1,
    action: "REPOSITORY_FILE_WRITE",
    outcome: "ASK",
    enforcement: "ADVISORY_ONLY",
    rationale: "policy requires attention",
    actionable: true,
    createdAt: new Date().toISOString(),
    resolvedAt: null
  });

  const resolve = (decisionId: string, outcome: string) =>
    appInstance.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/permissions/decisions/${decisionId}/resolve`,
      payload: { outcome }
    });

  it("resolving the last ask emits one event and re-drives the parked campaign toward Sol", async () => {
    const run = await createRun("ATTENTION_REQUIRED");
    const decision = askDecision(run);
    appInstance.permissionStore.saveDecision(decision);

    const events: any[] = [];
    appInstance.eventBus.subscribe((event) => events.push(event));

    const res = await resolve(decision.id, "ALLOW");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).decision.outcome).toBe("ALLOW");

    const resolvedEvents = events.filter((event) => event.type === "permission.resolved");
    expect(resolvedEvents).toHaveLength(1);
    expect(resolvedEvents[0].repositoryId).toBe(repoId);
    expect(resolvedEvents[0].data.decisionId).toBe(decision.id);
    expect(resolvedEvents[0].data.outcome).toBe("ALLOW");

    const status = await waitForRunStatus(run.id, ["SOL_PENDING", "SOL_REVIEWING"]);
    expect(["SOL_PENDING", "SOL_REVIEWING"]).toContain(status);
    expect(
      events.some(
        (event) =>
          event.type === "loop.state_changed" &&
          event.data?.runId === run.id &&
          event.data?.loopState === "SOL_PENDING"
      )
    ).toBe(true);
  }, 15000);

  it("a sibling pending ask keeps the campaign parked until every ask resolves", async () => {
    const run = await createRun("ATTENTION_REQUIRED");
    const first = askDecision(run);
    const second = askDecision(run);
    appInstance.permissionStore.saveDecision(first);
    appInstance.permissionStore.saveDecision(second);

    const firstRes = await resolve(first.id, "DENY");
    expect(firstRes.statusCode).toBe(200);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    expect(appInstance.runStore.get(run.id)?.status).toBe("ATTENTION_REQUIRED");

    const secondRes = await resolve(second.id, "ALLOW_ONCE");
    expect(secondRes.statusCode).toBe(200);
    const status = await waitForRunStatus(run.id, ["SOL_PENDING", "SOL_REVIEWING"]);
    expect(["SOL_PENDING", "SOL_REVIEWING"]).toContain(status);
  }, 15000);

  it("resolution while an actor is active records evidence without contradicting the actor", async () => {
    const run = await createRun("EXECUTING");
    const decision = askDecision(run);
    appInstance.permissionStore.saveDecision(decision);

    const events: any[] = [];
    appInstance.eventBus.subscribe((event) => events.push(event));

    const res = await resolve(decision.id, "DENY");
    expect(res.statusCode).toBe(200);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    expect(appInstance.runStore.get(run.id)?.status).toBe("EXECUTING");
    expect(events.filter((event) => event.type === "permission.resolved")).toHaveLength(1);
  }, 15000);

  it("a failed duplicate resolution emits no additional resolved event", async () => {
    const run = await createRun("EXECUTING");
    const decision = askDecision(run);
    appInstance.permissionStore.saveDecision(decision);

    const events: any[] = [];
    appInstance.eventBus.subscribe((event) => events.push(event));

    const firstRes = await resolve(decision.id, "ALLOW_ONCE");
    expect(firstRes.statusCode).toBe(200);
    const secondRes = await resolve(decision.id, "DENY");
    expect(secondRes.statusCode).toBe(409);
    expect(secondRes.json().error.code).toBe("PERMISSION_DECISION_ALREADY_RESOLVED");
    expect(events.filter((event) => event.type === "permission.resolved")).toHaveLength(1);
  }, 15000);
});
