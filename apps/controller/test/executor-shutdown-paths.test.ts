/**
 * Executor shutdown-path unit tests (Change 021).
 *
 * Pins the lifecycle paths that previously only had integration/real-tier
 * coverage (recorded follow-up from the Change 018 hardening wave):
 *
 * 1. `shutdown()` terminates a launch-intent runner whose child already
 *    spawned but never graduated — no orphaned spawned child.
 * 2. One failed process-tree termination does not abort the shutdown sweep;
 *    every targeted runner receives a kill attempt and the sweep resolves.
 * 3. An emergency `killRun` during the launch-retry sleep prevents any later
 *    spawn attempt and leaves the persisted run terminal.
 *
 * Startup orphan truth repair (persisted running/pending executor rows →
 * failed) is covered in `startup-reconciler.test.ts` (Change 021 cases).
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import type {
  ExecutorAdapter,
  ExecutionContext,
} from "../src/executor/adapters/executor-adapter.js";

/**
 * Child that emits NOTHING: no "spawn", no "error", no "exit". The runner
 * stays inside its launch window (awaitSpawn pending) with an already-created
 * child object — the deterministic way to observe the registration ->
 * graduation window from the public API.
 */
class HungChild extends EventEmitter {
  pid = 4242;
  stdout: PassThrough | null = new PassThrough();
  stderr: PassThrough | null = new PassThrough();
  exitCode: number | null = null;
}

/** Spawn succeeds silently; the handshake never resolves. Kill is observable. */
class HungHandshakeAdapter implements ExecutorAdapter {
  children: HungChild[] = [];
  killedChildren: unknown[] = [];
  killAttempts = 0;

  spawn(_context: ExecutionContext): ChildProcess {
    const child = new HungChild();
    this.children.push(child);
    return child as unknown as ChildProcess;
  }

  async killProcessTree(child: ChildProcess): Promise<void> {
    this.killAttempts++;
    this.killedChildren.push(child);
  }
}

/** Child emits "spawn" immediately but never exits: a live graduated runner. */
class NeverExitingAdapter implements ExecutorAdapter {
  children: ChildProcess[] = [];
  killAttempts = 0;
  killedChildren: unknown[] = [];
  /** Kill calls for children at these indexes reject (sweep-isolation fixture). */
  rejectKillIndexes = new Set<number>();

  spawn(_context: ExecutionContext): ChildProcess {
    const proc: any = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.exitCode = null;
    proc.pid = 10001 + this.children.length;
    setImmediate(() => proc.emit("spawn"));
    this.children.push(proc as ChildProcess);
    return proc as ChildProcess;
  }

  async killProcessTree(child: ChildProcess): Promise<void> {
    const index = this.children.indexOf(child);
    this.killAttempts++;
    if (this.rejectKillIndexes.has(index))
      throw new Error("simulated kill failure");
    this.killedChildren.push(child);
    (child as any).exitCode = 137;
    (child as any).emit("exit", 137);
  }
}

/** First attempt fails async like a missing CLI; later attempts never happen if killed. */
class EnoentOnceAdapter implements ExecutorAdapter {
  spawnCount = 0;

  spawn(): ChildProcess {
    this.spawnCount++;
    const proc = new EventEmitter() as unknown as ChildProcess;
    (proc as any).stdout = null;
    (proc as any).stderr = null;
    (proc as any).exitCode = null;
    (proc as any).pid = 9999;
    setImmediate(() =>
      (proc as EventEmitter).emit(
        "error",
        Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
      ),
    );
    return proc;
  }

  async killProcessTree() {}
}

function setup(name: string) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `orca-shutdown-paths-${name}-`),
  );
  const dbCtx: DatabaseContext = initDatabase(
    path.join(tempDir, "test.sqlite"),
  );
  const repoStore = new RepositoryStore(dbCtx.db);
  const dispatchStore = new DispatchStore(dbCtx.db);
  const executorStore = new ExecutorStore(dbCtx.db);
  let counter = 0;

  const createRepoWithDispatch = () => {
    counter++;
    const repoId = `repo-${name}-${counter}`;
    const dispatchId = `disp-${name}-${counter}`;
    repoStore.create({
      id: repoId,
      displayName: repoId,
      githubRemote: "https://example.com/x.git",
      localPath: tempDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "fake-generic-cli",
      executorModel: "m",
      solConversationUrl: "https://chatgpt.com/c/x",
      maxIterations: 5,
      maxRuntimeMinutes: 60,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    dispatchStore.create({
      id: dispatchId,
      dispatchId,
      repositoryId: repoId,
      runId: `run-${counter}`,
      iteration: 1,
      commitSha: "a".repeat(40),
      baseSha: "a".repeat(40),
      changePath: "openspec/changes/021",
      goal: "g",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { repoId, dispatchId };
  };

  const cleanup = () => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  return {
    tempDir,
    repoStore,
    dispatchStore,
    executorStore,
    createRepoWithDispatch,
    cleanup,
  };
}

describe("Executor shutdown sweep coverage (Change 021)", () => {
  it("shutdown terminates a launch-intent runner whose child already spawned without graduating", async () => {
    const {
      tempDir,
      repoStore,
      dispatchStore,
      executorStore,
      createRepoWithDispatch,
      cleanup,
    } = setup("hungchild");
    const adapter = new HungHandshakeAdapter();
    const svc = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: adapter,
      wslAdapter: adapter,
    });

    const { repoId, dispatchId } = createRepoWithDispatch();
    // Intentionally un-awaited: the launch window hangs on the silent child.
    void svc.startRun(repoId, dispatchId);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(adapter.children.length).toBe(1);

    // The sweep must route the kill at the exact spawned child instead of
    // orphaning it between registration and graduation.
    await svc.shutdown();

    expect(adapter.killAttempts).toBe(1);
    expect(adapter.killedChildren[0]).toBe(adapter.children[0]);

    // A later start refuses truthfully because of shutdown, not a stale intent.
    await expect(svc.startRun(repoId, dispatchId)).rejects.toThrow(
      /shutting down/,
    );

    cleanup();
  }, 30000);

  it("one failed kill does not abort the shutdown sweep; every runner receives a kill attempt", async () => {
    const {
      tempDir,
      repoStore,
      dispatchStore,
      executorStore,
      createRepoWithDispatch,
      cleanup,
    } = setup("sweepisolation");
    // One service, one sweep, two live runners: the first repository's
    // process-tree termination rejects, the second must still be attempted.
    const adapter = new NeverExitingAdapter();
    adapter.rejectKillIndexes.add(0);
    const svc = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: adapter,
      wslAdapter: adapter,
    });

    const first = createRepoWithDispatch();
    const second = createRepoWithDispatch();
    await Promise.all([
      svc.startRun(first.repoId, first.dispatchId),
      svc.startRun(second.repoId, second.dispatchId),
    ]);
    expect(adapter.children.length).toBe(2);

    // Must resolve despite the rejecting kill, and must attempt BOTH kills.
    await svc.shutdown();

    expect(adapter.killAttempts).toBe(2);
    expect(adapter.killedChildren).toContain(adapter.children[1]);

    cleanup();
  }, 30000);

  it("emergency killRun during the retry sleep prevents further spawns and leaves the run terminal", async () => {
    const {
      tempDir,
      repoStore,
      dispatchStore,
      executorStore,
      createRepoWithDispatch,
      cleanup,
    } = setup("retrysleepkill");
    const adapter = new EnoentOnceAdapter();
    const svc = new ExecutorService({
      repoStore,
      dispatchStore,
      executorStore,
      dataDir: tempDir,
      windowsAdapter: adapter,
      wslAdapter: adapter,
    });

    const { repoId, dispatchId } = createRepoWithDispatch();
    const startPromise = svc.startRun(repoId, dispatchId).catch((err) => err);

    // Attempt 1 fails async (~immediately); the runner then sleeps
    // LAUNCH_RETRY_BASE_MS * 1 = 1500ms before attempt 2. Kill inside that
    // window: attempt 2 must never spawn.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(adapter.spawnCount).toBe(1);
    await svc.killRun(repoId);

    const outcome = (await startPromise) as Error;
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.message).toMatch(/failed to start|aborted/i);
    expect(adapter.spawnCount).toBe(1);

    const rows = executorStore.getByRepository(repoId);
    expect(rows.length).toBe(1);
    expect(["failed", "killed"]).toContain(rows[0]!.status);
    expect(rows[0]!.finishedAt).toBeTruthy();

    cleanup();
  }, 30000);
});
