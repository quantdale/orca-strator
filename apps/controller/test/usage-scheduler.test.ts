import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { CampaignLedgerStore } from "../src/ledger/campaign-ledger-store.js";
import { CampaignLedgerService } from "../src/ledger/campaign-ledger-service.js";
import { RunPolicyStore } from "../src/loop/run-policy-store.js";
import { UsageTelemetryStore } from "../src/usage/usage-telemetry-store.js";
import { UsageTelemetryService } from "../src/usage/usage-telemetry-service.js";
import { SchedulerPolicyStore } from "../src/scheduler/scheduler-policy-store.js";
import { SchedulerService } from "../src/scheduler/scheduler-service.js";
import { RoleModelPolicyStore } from "../src/scheduler/role-model-policy-store.js";
import { RoleModelPolicyService } from "../src/scheduler/role-model-policy-service.js";
import type { RepositoryRecord, RunRecord } from "@orca/shared";

function repository(id: string, localPath: string): RepositoryRecord {
  const now = "2026-08-20T15:30:00.000Z";
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
    updatedAt: now,
  };
}

function run(repositoryId: string, id = "run-usage"): RunRecord {
  const now = "2026-08-20T15:30:00.000Z";
  return {
    id,
    repositoryId,
    goal: "Measure only trustworthy usage",
    status: "EXECUTING",
    currentIteration: 1,
    maxIterations: 3,
    activeDispatchId: null,
    lastError: null,
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    drainReason: null,
  };
}

describe("Change 011 usage, scheduler, and role policy foundations", () => {
  let tempDir: string;
  let dbContext: DatabaseContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-usage-scheduler-"));
    dbContext = initDatabase(path.join(tempDir, "orca.sqlite"));
  });

  afterEach(() => {
    dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists exact, estimated, and unknown usage without fabricating values", async () => {
    const repoStore = new RepositoryStore(dbContext.db);
    const repo = repository("repo-usage", tempDir);
    repoStore.create(repo);
    const runStore = new RunStore(dbContext.db);
    runStore.create(run(repo.id));
    const usageStore = new UsageTelemetryStore(dbContext.db);
    const events: unknown[] = [];
    const service = new UsageTelemetryService(usageStore, (event) =>
      events.push(event),
    );

    service.record({
      repositoryId: repo.id,
      runId: "run-usage",
      iteration: 1,
      executor: "kimi",
      model: "Kimi K3",
      inputTokens: 100,
      outputTokens: 40,
      exactCost: 0.12,
      currency: "USD",
      costStatus: "EXACT",
      source: "PROVIDER_RESPONSE",
    });
    service.record({
      repositoryId: repo.id,
      runId: "run-usage",
      iteration: 1,
      executor: "kimi",
      model: "Kimi K3",
      outputTokens: 20,
      estimatedCost: 0.02,
      currency: "USD",
      costStatus: "ESTIMATED",
      source: "NATIVE_EXECUTOR",
    });
    service.record({
      repositoryId: repo.id,
      runId: "run-usage",
      iteration: 1,
      executor: "kimi",
      model: "Kimi K3",
      source: "UNKNOWN",
    });

    const metrics = service.listByRun("run-usage");
    const summary = service.summarize(metrics);
    expect(metrics).toHaveLength(3);
    expect(summary.inputTokens).toBe(100);
    expect(summary.outputTokens).toBe(60);
    expect(summary.exactCost).toBe(0.12);
    expect(summary.estimatedCost).toBe(0.02);
    expect(summary.unknownMetricCount).toBe(1);
    expect(events).toHaveLength(3);
    new DispatchStore(dbContext.db).create({
      id: "dispatch-usage",
      dispatchId: "dispatch-usage",
      repositoryId: repo.id,
      runId: "run-usage",
      iteration: 1,
      schemaVersion: 1,
      type: "dispatch",
      createdAt: "2026-08-20T15:30:01.000Z",
      baseSha: "a".repeat(40),
      commitSha: "b".repeat(40),
      changePath: "openspec/changes/test",
      goal: "usage",
      instructionsVersion: 1,
      status: "detected",
      rejectionReason: null,
      updatedAt: "2026-08-20T15:30:01.000Z",
    });
    new ExecutorStore(dbContext.db).create({
      id: "executor-usage",
      repositoryId: repo.id,
      dispatchId: "dispatch-usage",
      runId: "run-usage",
      iteration: 1,
      status: "completed",
      exitCode: 0,
      logPath: null,
      errorMessage: null,
      startedAt: "2026-08-20T15:30:01.000Z",
      finishedAt: "2026-08-20T15:30:02.000Z",
      createdAt: "2026-08-20T15:30:01.000Z",
      updatedAt: "2026-08-20T15:30:02.000Z",
    });
    const captured = await service.captureAdapterUsage(
      {
        usage: async () => ({ outputTokens: 5, provider: "kimi" }),
      } as any,
      {
        repositoryId: repo.id,
        runId: "run-usage",
        iteration: 1,
        dispatchId: "dispatch-usage",
        executorRunId: "executor-usage",
        executor: "kimi",
        model: "Kimi K3",
      },
    );
    expect(captured?.source).toBe("NATIVE_EXECUTOR");
    expect(captured?.outputTokens).toBe(5);
    expect(events).toHaveLength(4);
    expect(() =>
      service.record({
        repositoryId: repo.id,
        executor: "kimi",
        model: "Kimi K3",
        exactCost: 1,
        costStatus: "UNKNOWN",
        source: "PROVIDER_RESPONSE",
      }),
    ).toThrow();
  });

  it("correlates usage into the campaign read model and survives a restart", () => {
    const repoStore = new RepositoryStore(dbContext.db);
    const repo = repository("repo-ledger-usage", tempDir);
    repoStore.create(repo);
    const runStore = new RunStore(dbContext.db);
    runStore.create(run(repo.id));
    const usageStore = new UsageTelemetryStore(dbContext.db);
    const usageService = new UsageTelemetryService(usageStore);
    usageService.record({
      repositoryId: repo.id,
      runId: "run-usage",
      iteration: 1,
      executor: "codex",
      model: "gpt",
      outputTokens: 7,
      source: "NATIVE_EXECUTOR",
    });
    const ledger = new CampaignLedgerService(
      dbContext.db,
      repoStore,
      runStore,
      new RunPolicyStore(dbContext.db),
      new CampaignLedgerStore(dbContext.db),
      usageStore,
    );
    const detail = ledger.getDetail(repo.id, "run-usage");
    expect(detail?.usage).toHaveLength(1);
    expect(detail?.iterations).toHaveLength(0);
    expect(detail?.usageSummary.outputTokens).toBe(7);

    const dbPath = path.join(tempDir, "orca.sqlite");
    dbContext.close();
    dbContext = initDatabase(dbPath);
    expect(
      new UsageTelemetryStore(dbContext.db).listByRun("run-usage"),
    ).toHaveLength(1);
  });

  it("keeps independent repositories unrestricted by default and explains explicit queues", () => {
    const repositories = new RepositoryStore(dbContext.db);
    repositories.create(repository("repo-a", tempDir));
    repositories.create(repository("repo-b", tempDir));
    const store = new SchedulerPolicyStore(dbContext.db);
    const scheduler = new SchedulerService(store);
    const base = {
      executor: "kimi",
      provider: "kimi",
      model: "Kimi K3",
      kind: "PRIMARY_EXECUTOR" as const,
    };
    expect(
      scheduler.admit({ ...base, requestId: "repo-a", repositoryId: "repo-a" })
        .status,
    ).toBe("ADMITTED");
    expect(
      scheduler.admit({ ...base, requestId: "repo-b", repositoryId: "repo-b" })
        .status,
    ).toBe("ADMITTED");
    scheduler.release("repo-a");
    scheduler.release("repo-b");

    const policy = {
      ...scheduler.getPolicy(),
      preset: "CUSTOM" as const,
      totalActiveInferenceSessions: 1,
      updatedAt: new Date().toISOString(),
    };
    scheduler.setPolicy(policy);
    expect(
      scheduler.admit({
        ...base,
        requestId: "limited-a",
        repositoryId: "repo-a",
      }).status,
    ).toBe("ADMITTED");
    expect(
      scheduler.admit({
        ...base,
        requestId: "limited-b",
        repositoryId: "repo-b",
      }).status,
    ).toBe("QUEUED");
    const queued = scheduler
      .listDecisions()
      .find((decision) => decision.requestId === "limited-b");
    expect(queued?.blockedBy).toBe("TOTAL_ACTIVE_INFERENCE_SESSIONS");
    expect(queued?.runnableAt).toBeNull();
    scheduler.release("limited-a");
    const admitted = scheduler
      .listDecisions()
      .find((decision) => decision.requestId === "limited-b");
    expect(admitted?.status).toBe("ADMITTED");
    expect(admitted?.runnableAt).toBeTruthy();
  });

  it("marks an unconfirmed admission stale after restart and resolves explicit roles exactly", () => {
    const repositories = new RepositoryStore(dbContext.db);
    repositories.create(repository("repo-a", tempDir));
    const repo = repository("repo-role", tempDir);
    repositories.create(repo);
    const schedulerStore = new SchedulerPolicyStore(dbContext.db);
    const scheduler = new SchedulerService(schedulerStore);
    scheduler.admit({
      requestId: "restart-admission",
      repositoryId: "repo-a",
      executor: "kimi",
      model: "Kimi K3",
      kind: "PRIMARY_EXECUTOR",
    });
    const recovered = new SchedulerService(schedulerStore).recover([]);
    expect(recovered[0]?.status).toBe("STALE_RECOVERABLE");

    const roleService = new RoleModelPolicyService(
      new RoleModelPolicyStore(dbContext.db),
    );
    roleService.set(repo.id, {
      schemaVersion: 1,
      repositoryId: repo.id,
      rules: [
        {
          role: "HARD_DEBUG",
          executorCli: "codex",
          model: "gpt-5",
          provider: "openai",
          description: "Explicit user rule",
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    expect(roleService.resolve(repo, "HARD_DEBUG")).toMatchObject({
      executorCli: "codex",
      model: "gpt-5",
      source: "EXPLICIT_RULE",
    });
    expect(roleService.resolve(repo, "CHEAP_SUBAGENT")).toMatchObject({
      executorCli: "kimi",
      model: "Kimi K3",
      source: "REPOSITORY_DEFAULT",
    });
    expect(roleService.resolve(repo, "PRIMARY")).toMatchObject({
      executorCli: "kimi",
      model: "Kimi K3",
      source: "REPOSITORY_DEFAULT",
    });
    expect(() =>
      roleService.set(repo.id, {
        schemaVersion: 1,
        repositoryId: repo.id,
        rules: [{ role: "PRIMARY", executorCli: "codex", model: "other" }],
        updatedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("closes stale admission leases exactly once during startup reconciliation (Change 019)", () => {
    // scheduler_decisions carries an FK to repositories(id); seed the repo.
    new RepositoryStore(dbContext.db).create(repository("repo-a", tempDir));
    const store = new SchedulerPolicyStore(dbContext.db);
    const scheduler = new SchedulerService(store);
    const base = {
      executor: "kimi",
      provider: "kimi",
      model: "Kimi K3",
      kind: "SUBAGENT" as const,
    };

    // Live strategy lease (stays ADMITTED until restart), a released historical
    // row, and a plain non-strategy requestId.
    scheduler.admit({
      ...base,
      requestId: "strat-1:pk-live",
      repositoryId: "repo-a",
    });
    scheduler.admit({
      ...base,
      requestId: "strat-1:pk-done",
      repositoryId: "repo-a",
    });
    scheduler.release("strat-1:pk-done");
    scheduler.admit({
      ...base,
      requestId: "plain-primary",
      repositoryId: "repo-a",
    });

    // A rejected and a queued row under an explicit limit.
    const limited = {
      ...scheduler.getPolicy(),
      preset: "CUSTOM" as const,
      totalActiveInferenceSessions: 1,
      queueWhenLimited: false,
      updatedAt: new Date().toISOString(),
    };
    scheduler.setPolicy(limited);
    expect(
      scheduler.admit({
        ...base,
        requestId: "strat-1:pk-rej",
        repositoryId: "repo-a",
      }).status,
    ).toBe("REJECTED");
    scheduler.setPolicy({ ...limited, queueWhenLimited: true });
    expect(
      scheduler.admit({
        ...base,
        requestId: "strat-1:pk-q",
        repositoryId: "repo-a",
      }).status,
    ).toBe("QUEUED");

    // Restart simulation: nothing is confirmed active, so persisted ADMITTED
    // rows become STALE_RECOVERABLE; QUEUED rows are left as-is by recover().
    const restarted = new SchedulerService(store);
    expect(
      restarted
        .recover([])
        .map((decision) => decision.requestId)
        .sort(),
    ).toEqual(["plain-primary", "strat-1:pk-live"]);

    const closed = restarted.reconcileStaleLeases();
    expect(closed.map((decision) => decision.requestId).sort()).toEqual([
      "plain-primary",
      "strat-1:pk-live",
    ]);
    for (const decision of closed) {
      expect(decision.status).toBe("RELEASED");
      expect(decision.resolvedAt).toBeTruthy();
      expect(decision.reason).toMatch(/cannot/);
    }
    const strategyRow = closed.find(
      (decision) => decision.requestId === "strat-1:pk-live",
    );
    expect(strategyRow?.reason).toContain("strategy run strat-1");
    const plainRow = closed.find(
      (decision) => decision.requestId === "plain-primary",
    );
    expect(plainRow?.reason).not.toContain("strategy run");

    // Idempotent: a second reconciliation closes nothing.
    expect(restarted.reconcileStaleLeases()).toEqual([]);

    // Non-stale decisions are untouched.
    const statusOf = (requestId: string) =>
      restarted
        .listDecisions()
        .find((decision) => decision.requestId === requestId)?.status;
    expect(statusOf("strat-1:pk-done")).toBe("RELEASED");
    expect(statusOf("strat-1:pk-rej")).toBe("REJECTED");
    expect(statusOf("strat-1:pk-q")).toBe("QUEUED");
  });
});
