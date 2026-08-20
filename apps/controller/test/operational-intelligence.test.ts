import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { RunPolicyStore } from "../src/loop/run-policy-store.js";
import { CampaignLedgerStore } from "../src/ledger/campaign-ledger-store.js";
import { CampaignLedgerService } from "../src/ledger/campaign-ledger-service.js";
import { CapabilityStore } from "../src/executor/capability-store.js";
import { CapabilityProbeService } from "../src/executor/capability-probe-service.js";
import { PermissionStore } from "../src/permissions/permission-store.js";
import { PermissionPolicyService } from "../src/permissions/permission-policy-service.js";
import { EventBus } from "../src/events/event-bus.js";
import type { RepositoryRecord, RunRecord } from "@orca/shared";

function repository(id: string, localPath: string, cli = process.execPath): RepositoryRecord {
  const now = "2026-08-20T10:00:00.000Z";
  return {
    id,
    displayName: id,
    githubRemote: "https://example.invalid/repo.git",
    localPath,
    environment: "windows",
    wslDistribution: null,
    executorCli: cli,
    executorModel: "test-model",
    solConversationUrl: "https://chatgpt.com/c/test",
    maxIterations: 3,
    maxRuntimeMinutes: 2,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

function run(repositoryId: string, id = "run-1"): RunRecord {
  const now = "2026-08-20T10:00:00.000Z";
  return {
    id,
    repositoryId,
    goal: "Trace this campaign",
    status: "SOL_PENDING",
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

describe("Change 010 operational intelligence foundations", () => {
  let tempDir: string;
  let dbContext: DatabaseContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-op-intel-"));
    dbContext = initDatabase(path.join(tempDir, "orca.sqlite"));
  });

  afterEach(() => {
    dbContext.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists redacted event references and reconstructs a campaign detail", () => {
    const repoStore = new RepositoryStore(dbContext.db);
    const runStore = new RunStore(dbContext.db);
    const policyStore = new RunPolicyStore(dbContext.db);
    const ledgerStore = new CampaignLedgerStore(dbContext.db);
    const repo = repository("repo-a", tempDir);
    repoStore.create(repo);
    const campaign = run(repo.id);
    runStore.create(campaign);

    const service = new CampaignLedgerService(dbContext.db, repoStore, runStore, policyStore, ledgerStore);
    const eventBus = new EventBus();
    eventBus.subscribe((event) => service.recordEvent(event));
    eventBus.publish({
      type: "loop.state_changed",
      at: "2026-08-20T10:00:01.000Z",
      repositoryId: repo.id,
      data: { runId: campaign.id, iteration: 1, loopState: "SOL_REVIEWING", secretToken: "should-not-be-secret" }
    });
    eventBus.publish({
      type: "watcher.dispatch_detected",
      at: "2026-08-20T10:00:03.000Z",
      repositoryId: repo.id,
      data: { runId: campaign.id, iteration: 1 }
    });

    const detail = service.getDetail(repo.id, campaign.id);
    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timeline[0]?.phase).toBe("SOL_REVIEW");
    expect(detail?.timeline[1]?.phase).toBe("DISPATCH");
    expect(detail?.timeline[0]?.data.secretToken).toBe("***redacted***");
    expect(detail?.summary.durationMs).toBe(3000);
    expect(detail?.iterations[0]?.iteration).toBe(1);
  });

  it("captures an effective policy independently of later repository settings", () => {
    const repoStore = new RepositoryStore(dbContext.db);
    const repo = repository("repo-policy", tempDir);
    repoStore.create(repo);
    const runStore = new RunStore(dbContext.db);
    runStore.create(run(repo.id, "run-policy"));
    const store = new RunPolicyStore(dbContext.db);
    const policy = {
      schemaVersion: 1 as const,
      campaign: { maxRuntimeMinutes: 2, maxIterations: 3 },
      sol: { profileAcquisitionMs: 10, wakeSubmissionMs: 20, busyRetryMax: 1, busyRetryDelayMs: 30, completionWaitMs: 40, completionRetryCount: 1 },
      executor: { launchAttempts: 3, startTimeoutMs: 50, contactTimeoutMs: 60, watchdogMs: 0, pauseGraceMs: 70, killGraceMs: 80 },
      git: { commandTimeoutMs: 90, preflightTimeoutMs: 100, postflightTimeoutMs: 110 },
      recovery: { retryCeiling: 3 }
    };
    store.save("run-policy", policy, "2026-08-20T10:00:00.000Z");
    expect(store.get("run-policy")).toEqual(policy);
  });

  it("probes a harmless CLI without claiming auth or inference readiness", async () => {
    const repo = repository("repo-probe", tempDir);
    new RepositoryStore(dbContext.db).create(repo);
    const capabilityStore = new CapabilityStore(dbContext.db);
    const gitClient = {
      getCurrentSha: async () => "a".repeat(40),
      getRemoteHeadSha: async () => "b".repeat(40),
      fetch: async () => undefined
    } as any;
    const service = new CapabilityProbeService({ store: capabilityStore, gitClient });
    const result = await service.probe(repo, { level: "STATIC" });
    expect(result.snapshot.probeLevel).toBe("STATIC");
    expect(result.snapshot.installed).toBe(true);
    expect(result.snapshot.authStatus).toBe("UNKNOWN");
    expect(result.snapshot.modelRecognition).toBe("UNKNOWN");
    expect(result.snapshot.overall).toBe("UNKNOWN");
    expect(capabilityStore.latest(repo.id)?.snapshot.cli).toBe(process.execPath);
  });

  it("keeps static probes non-inferential and avoids Git access", async () => {
    const repo = repository("repo-static-probe", tempDir);
    new RepositoryStore(dbContext.db).create(repo);
    let gitCalls = 0;
    const capabilityStore = new CapabilityStore(dbContext.db);
    const gitClient = {
      getCurrentSha: async () => { gitCalls += 1; return "a".repeat(40); },
      getRemoteHeadSha: async () => { gitCalls += 1; return "b".repeat(40); },
      fetch: async () => { gitCalls += 1; }
    } as any;
    const service = new CapabilityProbeService({ store: capabilityStore, gitClient });

    const result = await service.probe(repo, { level: "STATIC" });

    expect(gitCalls).toBe(0);
    expect(result.snapshot.workingDirectoryAccessible).toBe("UNKNOWN");
    expect(result.snapshot.gitAvailable).toBe("UNKNOWN");
    expect(result.snapshot.remoteMainUsable).toBe("UNKNOWN");
  });

  it("requires explicit inference authorization and records honest ASK/DENY decisions", () => {
    const repo = repository("repo-perm", tempDir);
    new RepositoryStore(dbContext.db).create(repo);
    const store = new PermissionStore(dbContext.db);
    const events: unknown[] = [];
    const service = new PermissionPolicyService({
      store,
      eventPublisher: (event) => events.push(event)
    });
    expect(() => service.setPolicy("repo-perm", {
      schemaVersion: 1,
      preset: "CUSTOM",
      rules: [{ action: "GIT_FORCE_PUSH", outcome: "ALLOW" }],
      updatedAt: new Date().toISOString()
    })).not.toThrow();
    const forcePush = service.evaluate({ repositoryId: "repo-perm", action: "GIT_FORCE_PUSH" });
    expect(forcePush.outcome).toBe("DENY");
    expect(forcePush.enforcement).toBe("ORCA_ENFORCED");
    const network = service.evaluate({ repositoryId: "repo-perm", action: "NETWORK_ACCESS" });
    expect(network.enforcement).toBe("ADVISORY_ONLY");
    expect(events).toHaveLength(2);
    expect(service.listDecisions("repo-perm")).toHaveLength(2);
  });
});
