import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import { RepositoryActorLeaseService } from "../src/ownership/actor-lease-service.js";
import { RepositoryActorLeaseStore, ProcessOwnershipStore } from "../src/ownership/ownership-store.js";
import { PortableProcessProbe } from "../src/ownership/process-probe.js";
import type { RepositoryRecord, DispatchRecord } from "@orca/shared";

const REPO = "repo-own-exec";
const DISPATCH = "disp-own-exec-01";
const C1 = "controller-instance-exec-1";

const mockRepo: RepositoryRecord = {
  id: REPO,
  displayName: "Ownership Repo",
  githubRemote: "https://github.com/quantdale/own.git",
  localPath: "D:\\Projects\\Own",
  environment: "windows",
  wslDistribution: null,
  executorCli: "codex",
  executorModel: "gpt-5.6",
  solConversationUrl: "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
  maxIterations: 20,
  maxRuntimeMinutes: 480,
  createdAt: "2026-08-19T10:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z"
};

const mockDispatch: DispatchRecord = {
  id: DISPATCH,
  dispatchId: DISPATCH,
  repositoryId: REPO,
  runId: "run-own-01",
  iteration: 1,
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  baseSha: "1123456789abcdef0123456789abcdef01234567",
  changePath: "openspec/changes/028-foo",
  goal: "Ownership test",
  instructionsVersion: 1,
  schemaVersion: 1,
  type: "dispatch",
  status: "detected",
  rejectionReason: null,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:00:00.000Z"
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("Change 028 direct-executor durable ownership (D4/D5.2)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;
  let leaseService: RepositoryActorLeaseService;
  let processStore: ProcessOwnershipStore;
  let probe: PortableProcessProbe;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-exec-own-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    executorStore = new ExecutorStore(dbCtx.db);
    repoStore.create(mockRepo);
    dispatchStore.create(mockDispatch);
    probe = new PortableProcessProbe();
    leaseService = new RepositoryActorLeaseService(dbCtx.db, probe);
    processStore = new ProcessOwnershipStore(dbCtx.db);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeService(): ExecutorService {
    return new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: new FakeExecutorAdapter({ durationMs: 60, exitCode: 0 }),
      ownership: {
        leaseService,
        processStore,
        probe,
        controllerInstanceId: C1
      }
    });
  }

  it("acquires a SINGLE_AGENT lease and persists process ownership on spawn, releases on exit", async () => {
    const service = makeService();
    const runRecord = await service.startRun(REPO, DISPATCH);
    expect(runRecord.status).toBe("running");

    // Lease is active and the spawned child has a durable ownership record.
    const lease = leaseService.getLease(REPO);
    expect(lease?.state).toBe("ACTIVE");
    expect(lease?.actorKind).toBe("SINGLE_AGENT");
    expect(lease?.actorId).toBe(runRecord.id);

    const procs = processStore.listByRepository(REPO);
    expect(procs).toHaveLength(1);
    expect(procs[0].state).toBe("RUNNING");
    expect(procs[0].actorId).toBe(runRecord.id);
    expect(procs[0].hostPid).toBeGreaterThan(0);
    expect(procs[0].controllerInstanceId).toBe(C1);

    // A second service instance sharing the same durable lease MUST be refused
    // at the ownership boundary (F1: no second writer while prior is live).
    const secondService = makeService();
    await expect(secondService.startRun(REPO, DISPATCH)).rejects.toThrow(
      /execution actor is conflict/
    );

    // After the child exits, the process record is terminal and the lease released.
    await delay(150);
    const after = processStore.listByRepository(REPO);
    expect(after[0].state).toBe("EXITED");
    expect(leaseService.getLease(REPO)).toBeNull();
  });

  it("allows a fresh start after the prior actor released its lease", async () => {
    const service = makeService();
    const r1 = await service.startRun(REPO, DISPATCH);
    await delay(150);
    expect(leaseService.getLease(REPO)).toBeNull();

    // The lease PK boundary reset, so a new actor may start.
    const r2 = await service.startRun(REPO, DISPATCH);
    expect(r2.id).not.toBe(r1.id);
    expect(leaseService.getLease(REPO)?.actorId).toBe(r2.id);
    await delay(150);
  });

  it("refuses a start blocked by a quarantined prior lease", async () => {
    // Simulate a prior (different) controller that left a quarantined lease.
    new RepositoryActorLeaseStore(dbCtx.db).insert({
      repositoryId: REPO,
      leaseId: "prior-lease",
      controllerInstanceId: "C0",
      runId: "run-own-01",
      iteration: 1,
      actorKind: "SINGLE_AGENT",
      actorId: "prior-actor",
      state: "QUARANTINED"
    });
    const service = makeService();
    await expect(service.startRun(REPO, DISPATCH)).rejects.toThrow(/execution actor is quarantined/);
  });
});
