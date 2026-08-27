import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { FakeExecutorAdapter, FakeChildProcess } from "./fixtures/fake-executor.js";
import { RepositoryActorLeaseService } from "../src/ownership/actor-lease-service.js";
import { RepositoryActorLeaseStore, ProcessOwnershipStore } from "../src/ownership/ownership-store.js";
import { PortableProcessProbe } from "../src/ownership/process-probe.js";
import type { RepositoryRecord, DispatchRecord } from "@orca/shared";
import type { ExecutorAdapter, ExecutionContext } from "../src/executor/adapters/executor-adapter.js";

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
describe("Change 028 D4.6-D4.9 launch-retry and ownership persistence invariants", () => {
  let tempDir: string;
  let dbCtx: ReturnType<typeof initDatabase>;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;
  let leaseService: RepositoryActorLeaseService;
  let processStore: ProcessOwnershipStore;
  let probe: PortableProcessProbe;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-exec-d4-"));
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

  it("D4.8: every real spawn gets a distinct durable attempt identity correlated to the run", async () => {
    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: new FakeExecutorAdapter({ durationMs: 60, exitCode: 0 }),
      ownership: { leaseService, processStore, probe, controllerInstanceId: C1 }
    });
    const run1 = await service.startRun(REPO, DISPATCH);
    // Process ownership id must be distinct from the run id and be a UUID
    const procs1 = processStore.listByRepository(REPO);
    expect(procs1).toHaveLength(1);
    expect(procs1[0].id).not.toBe(run1.id);
    expect(procs1[0].actorId).toBe(run1.id);
    expect(procs1[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    await delay(150);
    // Second run after prior released must have a different process attempt id
    const run2 = await service.startRun(REPO, DISPATCH);
    const procsAll = processStore.listByRepository(REPO);
    expect(procsAll).toHaveLength(2);
    const ids = procsAll.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(procsAll.find((p) => p.actorId === run2.id)?.id).not.toBe(procs1[0].id);
    await delay(150);
  });

  it("D4.6: post-spawn ownership persistence failure quarantines and does NOT retry into a second writer", async () => {
    let spawnCount = 0;
    class CountingAdapter extends FakeExecutorAdapter {
      override spawn(context: ExecutionContext): ChildProcess {
        spawnCount++;
        return super.spawn(context);
      }
    }
    const adapter = new CountingAdapter({ durationMs: 60, exitCode: 0 });
    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: adapter,
      ownership: { leaseService, processStore, probe, controllerInstanceId: C1 }
    });
    // Force process ownership insert to fail to simulate persistence failure after spawn
    const origInsert = processStore.insert.bind(processStore);
    let shouldFail = true;
    processStore.insert = ((rec: Parameters<typeof origInsert>[0]) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("simulated ownership persistence failure");
      }
      return origInsert(rec);
    }) as typeof origInsert;

    await expect(service.startRun(REPO, DISPATCH)).rejects.toThrow(/ownership persistence failed/);
    // Only one OS spawn must have occurred; generic retry must NOT spawn a second child
    expect(spawnCount).toBe(1);
    const lease = leaseService.getLease(REPO);
    expect(lease?.state).toBe("QUARANTINED");
    // A second start must be blocked while quarantined (no second writer)
    await expect(service.startRun(REPO, DISPATCH)).rejects.toThrow(/quarantined|conflict/);
    // No additional spawn for the blocked second start
    expect(spawnCount).toBe(1);
    processStore.insert = origInsert;
  });

  it("D4.9: all pre-spawn failures release the STARTING lease so a later start can succeed", async () => {
    const enoentAdapter = {
      spawnCount: 0,
      spawn(): ChildProcess {
        (enoentAdapter as unknown as { spawnCount: number }).spawnCount++;
        const proc = new EventEmitter() as unknown as ChildProcess;
        (proc as unknown as { stdout: null; stderr: null; exitCode: null }).stdout = null;
        (proc as unknown as { stdout: null; stderr: null; exitCode: null }).stderr = null;
        (proc as unknown as { exitCode: null }).exitCode = null;
        (proc as unknown as { pid: number }).pid = 9999;
        setImmediate(() => (proc as unknown as EventEmitter).emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
        return proc;
      },
      async killProcessTree(): Promise<void> {}
    } as unknown as ExecutorAdapter & { spawnCount: number };
    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: enoentAdapter,
      ownership: { leaseService, processStore, probe, controllerInstanceId: C1 }
    });
    await expect(service.startRun(REPO, DISPATCH)).rejects.toThrow(/failed to start.*after 3 attempts/);
    expect((enoentAdapter as unknown as { spawnCount: number }).spawnCount).toBe(3);
    // No process record must have been created for pure pre-spawn failures
    expect(processStore.listByRepository(REPO)).toHaveLength(0);
    // Lease must have been released (not quarantined) so a later healthy start can succeed
    expect(leaseService.getLease(REPO)).toBeNull();
    // Now a healthy adapter should be able to start
    const healthy = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: new FakeExecutorAdapter({ durationMs: 40, exitCode: 0 }),
      ownership: { leaseService, processStore, probe, controllerInstanceId: C1 }
    });
    const run = await healthy.startRun(REPO, DISPATCH);
    expect(run.status).toBe("running");
    await delay(100);
  });

  it("D4.7: short-lived child exiting while onSpawn awaits is observed exactly once and terminal state is persisted before lease release", async () => {
    class FastExitAdapter implements ExecutorAdapter {
      spawn(): ChildProcess {
        const proc = new FakeChildProcess({ durationMs: 10, exitCode: 0 });
        setImmediate(() => (proc as unknown as EventEmitter).emit("spawn"));
        setImmediate(() => proc.run());
        return proc as unknown as ChildProcess;
      }
      async killProcessTree(child: ChildProcess): Promise<void> {
        (child as unknown as FakeChildProcess).kill();
      }
    }
    // Delay process ownership persistence to widen the race: child will exit (10ms)
    // while onSpawn is still awaiting the insert (50ms busy wait). The buffered
    // exit path must preserve exactly-once delivery and terminal lease release.
    const origInsert = processStore.insert.bind(processStore);
    const captureDelay = 50;
    processStore.insert = ((rec: Parameters<typeof origInsert>[0]) => {
      const start = Date.now();
      while (Date.now() - start < captureDelay) { /* busy wait */ }
      return origInsert(rec);
    }) as typeof origInsert;

    const service = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: new FastExitAdapter(),
      ownership: { leaseService, processStore, probe, controllerInstanceId: C1 }
    });
    const run = await service.startRun(REPO, DISPATCH);
    expect(run.status).toBe("running");
    await delay(250);
    const procs = processStore.listByRepository(REPO);
    expect(procs).toHaveLength(1);
    expect(procs[0].state).toBe("EXITED");
    expect(leaseService.getLease(REPO)).toBeNull();
    const stored = executorStore.get(run.id);
    expect(stored?.status).toBe("completed");
    processStore.insert = origInsert;
  });
});
