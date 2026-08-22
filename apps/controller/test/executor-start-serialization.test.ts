/**
 * Executor start serialization tests (Change 019).
 * - Two overlapping startRun calls for one repository: exactly one launches,
 *   the other is refused with a structured "already in progress" validation
 *   error (concurrent-start TOCTOU closure).
 * - A failed/aborted start never leaks the per-repository start intent.
 * - Shutdown during the launch window aborts cleanly and later starts refuse
 *   truthfully because of shutdown, not a stale intent.
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { initDatabase } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExecutorAdapter } from "../src/executor/adapters/executor-adapter.js";

class EnoentAdapter implements ExecutorAdapter {
  spawnCount = 0;
  spawn() {
    this.spawnCount++;
    const proc = new EventEmitter() as unknown as ChildProcess;
    (proc as any).stdout = null;
    (proc as any).stderr = null;
    (proc as any).exitCode = null;
    (proc as any).pid = 9999;
    setImmediate(() => (proc as EventEmitter).emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
    return proc;
  }
  async killProcessTree() {}
}

class SingleExitAdapter implements ExecutorAdapter {
  spawnCount = 0;
  spawn() {
    this.spawnCount++;
    const proc: any = new EventEmitter();
    proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.exitCode = null; proc.pid = 10001;
    setImmediate(() => { proc.emit("spawn"); });
    setTimeout(() => { proc.exitCode = 1; proc.emit("exit", 1); }, 20);
    return proc as ChildProcess;
  }
  async killProcessTree(child: ChildProcess) { (child as any).kill?.(); }
}

function setup(name: string) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `orca-start-ser-${name}-`));
  const dbCtx = initDatabase(path.join(tempDir, "test.sqlite"));
  const repoStore = new RepositoryStore(dbCtx.db);
  const dispatchStore = new DispatchStore(dbCtx.db);
  const executorStore = new ExecutorStore(dbCtx.db);
  repoStore.create({
    id: "repo-cs", displayName: "CS", githubRemote: "https://example.com/cs.git",
    localPath: tempDir, environment: "windows", wslDistribution: null,
    executorCli: "fake-generic-cli", executorModel: "m", solConversationUrl: "https://chatgpt.com/c/x",
    maxIterations: 5, maxRuntimeMinutes: 60, enabled: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  dispatchStore.create({
    id: "disp-cs", dispatchId: "disp-cs", repositoryId: "repo-cs", runId: "run-cs", iteration: 1,
    commitSha: "a".repeat(40), baseSha: "a".repeat(40), changePath: "openspec/changes/009", goal: "g",
    instructionsVersion: 1, schemaVersion: 1, type: "dispatch", status: "detected",
    rejectionReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  });
  const cleanup = () => { dbCtx.close(); fs.rmSync(tempDir, { recursive: true, force: true }); };
  return { tempDir, repoStore, dispatchStore, executorStore, cleanup };
}

describe("Executor start serialization (Change 019)", () => {
  it("refuses an overlapping concurrent start and launches exactly one executor", async () => {
    const { tempDir, repoStore, dispatchStore, executorStore, cleanup } = setup("concurrent");
    const adapter = new SingleExitAdapter();
    const svc = new ExecutorService({
      repoStore, dispatchStore, executorStore, dataDir: tempDir,
      windowsAdapter: adapter, wslAdapter: adapter,
      onExecutorCompleted: () => {}
    });

    const first = svc.startRun("repo-cs", "disp-cs");
    const second = svc.startRun("repo-cs", "disp-cs");

    await expect(second).rejects.toThrow(/already in progress/);
    const run = await first;
    expect(run.status).toBe("running");
    expect(adapter.spawnCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(executorStore.getByRepository("repo-cs")).toHaveLength(1);

    cleanup();
  }, 30000);

  it("releases the start intent when the launch exhausts retries", async () => {
    const { tempDir, repoStore, dispatchStore, executorStore, cleanup } = setup("retry-release");
    const adapter = new EnoentAdapter();
    const svc = new ExecutorService({
      repoStore, dispatchStore, executorStore, dataDir: tempDir,
      windowsAdapter: adapter, wslAdapter: adapter
    });

    await expect(svc.startRun("repo-cs", "disp-cs")).rejects.toThrow(/after 3 attempts/);

    let secondError: unknown;
    try {
      await svc.startRun("repo-cs", "disp-cs");
    } catch (err) {
      secondError = err;
    }
    expect((secondError as Error).message).toMatch(/after 3 attempts/);
    expect((secondError as Error).message).not.toMatch(/already in progress/);

    cleanup();
  }, 40000);

  it("aborts cleanly when shutdown lands during the launch window and refuses later starts truthfully", async () => {
    const { tempDir, repoStore, dispatchStore, executorStore, cleanup } = setup("shutdown-window");
    const adapter = new EnoentAdapter();
    const svc = new ExecutorService({
      repoStore, dispatchStore, executorStore, dataDir: tempDir,
      windowsAdapter: adapter, wslAdapter: adapter
    });

    const first = svc.startRun("repo-cs", "disp-cs").catch((err) => err);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await svc.shutdown();

    const firstError = (await first) as Error;
    expect(firstError).toBeInstanceOf(Error);
    expect(firstError.message).toMatch(/failed to start/);
    expect(adapter.spawnCount).toBeLessThan(3);

    let nextError: unknown;
    try {
      await svc.startRun("repo-cs", "disp-cs");
    } catch (err) {
      nextError = err;
    }
    expect((nextError as Error).message).toMatch(/shutting down/);
    expect((nextError as Error).message).not.toMatch(/already in progress/);

    cleanup();
  }, 40000);

  it("releases the start intent when validation throws before any spawn", async () => {
    const { tempDir, repoStore, dispatchStore, executorStore, cleanup } = setup("validation-release");
    const adapter = new EnoentAdapter();
    const svc = new ExecutorService({
      repoStore, dispatchStore, executorStore, dataDir: tempDir,
      windowsAdapter: adapter, wslAdapter: adapter
    });

    await expect(svc.startRun("repo-cs", "missing-dispatch")).rejects.toThrow(/Dispatch missing-dispatch not found/);

    let secondError: unknown;
    try {
      await svc.startRun("repo-cs", "missing-dispatch");
    } catch (err) {
      secondError = err;
    }
    expect((secondError as Error).message).toMatch(/Dispatch missing-dispatch not found/);
    expect((secondError as Error).message).not.toMatch(/already in progress/);
    expect(adapter.spawnCount).toBe(0);

    cleanup();
  }, 30000);
});
