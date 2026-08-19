/**
 * Launch-retry handshake tests — item #8.
 * - Missing executable performs exactly 3 launch attempts.
 * - Successfully spawned process that exits nonzero is NOT launched three times.
 * - Completion callback fires once even if child emits error+exit+close combos.
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { ExecutorRunner } from "../src/executor/executor-runner.js";
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
    // Async ENOENT like real spawn failure
    setImmediate(() => (proc as EventEmitter).emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
    return proc;
  }
  async killProcessTree() {}
}

class NonzeroExitAdapter implements ExecutorAdapter {
  spawnCount = 0;
  spawn() {
    this.spawnCount++;
    const proc: any = new EventEmitter();
    proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.exitCode = null; proc.pid = 10001;
    setImmediate(() => { proc.emit("spawn"); });
    // Successful spawn then quick nonzero exit
    setTimeout(() => { proc.exitCode = 1; proc.emit("exit", 1); }, 20);
    return proc as ChildProcess;
  }
  async killProcessTree(child: ChildProcess) { (child as any).kill?.(); }
}

describe("Executor launch retry handshake (#8)", () => {
  it("missing executable is retried exactly 3 times before failing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-launch-retry-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    const dbCtx = initDatabase(dbPath);
    const repoStore = new RepositoryStore(dbCtx.db);
    const dispatchStore = new DispatchStore(dbCtx.db);
    const executorStore = new ExecutorStore(dbCtx.db);
    repoStore.create({
      id: "repo-r", displayName: "R", githubRemote: "https://example.com/r.git",
      localPath: tempDir, environment: "windows", wslDistribution: null,
      executorCli: "missing-cli", executorModel: "m", solConversationUrl: "https://chatgpt.com/c/x",
      maxIterations: 5, maxRuntimeMinutes: 60, enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    dispatchStore.create({ id: "disp-r", dispatchId: "disp-r", repositoryId: "repo-r", runId: "run-r", iteration: 1, commitSha: "a".repeat(40), baseSha: "a".repeat(40), changePath: "openspec/changes/009", goal: "g", instructionsVersion: 1, schemaVersion: 1, type: "dispatch", status: "detected", rejectionReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const adapter = new EnoentAdapter();
    const svc = new ExecutorService({ repoStore, dispatchStore, executorStore, dataDir: tempDir, windowsAdapter: adapter, wslAdapter: adapter });
    await expect(svc.startRun("repo-r", "disp-r")).rejects.toThrow(/after 3 attempts/);
    expect(adapter.spawnCount).toBe(3);
    dbCtx.close(); fs.rmSync(tempDir, { recursive: true, force: true });
  }, 30000);

  it("spawned process that exits nonzero is launched once (no retry)", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-launch-once-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    const dbCtx = initDatabase(dbPath);
    const repoStore = new RepositoryStore(dbCtx.db);
    const dispatchStore = new DispatchStore(dbCtx.db);
    const executorStore = new ExecutorStore(dbCtx.db);
    repoStore.create({
      id: "repo-n", displayName: "N", githubRemote: "https://example.com/r.git",
      localPath: tempDir, environment: "windows", wslDistribution: null,
      executorCli: "orca-test-harness", executorModel: "m", solConversationUrl: "https://chatgpt.com/c/x",
      maxIterations: 5, maxRuntimeMinutes: 60, enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    dispatchStore.create({ id: "disp-n", dispatchId: "disp-n", repositoryId: "repo-n", runId: "run-n", iteration: 1, commitSha: "a".repeat(40), baseSha: "a".repeat(40), changePath: "openspec/changes/009", goal: "g", instructionsVersion: 1, schemaVersion: 1, type: "dispatch", status: "detected", rejectionReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    // Use a generic executorCli so buildTestInvocation is not invoked; we supply our own adapter.
    repoStore.create = repoStore.create.bind(repoStore);
    // patch repo to generic cli
    const repoN = repoStore.get("repo-n")!;
    repoStore.create({ ...repoN, id: "repo-n2", displayName: "N2", executorCli: "fake-generic-cli" } as any);
    // Re-create dispatch under new repo id to avoid harness profile
    dispatchStore.create({ id: "disp-n2", dispatchId: "disp-n2", repositoryId: "repo-n2", runId: "run-n", iteration: 1, commitSha: "a".repeat(40), baseSha: "a".repeat(40), changePath: "openspec/changes/009", goal: "g", instructionsVersion: 1, schemaVersion: 1, type: "dispatch", status: "detected", rejectionReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const adapter = new NonzeroExitAdapter();
    const svc = new ExecutorService({
      repoStore, dispatchStore, executorStore, dataDir: tempDir,
      windowsAdapter: adapter, wslAdapter: adapter,
      onExecutorCompleted: () => {}
    });
    const run = await svc.startRun("repo-n2", "disp-n2");
    expect(adapter.spawnCount).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    const updated = executorStore.getByRepository("repo-n2")[0];
    expect(updated?.status).toBe("failed");
    dbCtx.close(); fs.rmSync(tempDir, { recursive: true, force: true });
  }, 30000);

  it("completion callback fires exactly once even if child emits error+exit+close", async () => {
    const logPath = path.join(os.tmpdir(), `orca-cb-${Date.now()}.log`);
    const onExit = vi.fn();
    const onLog = vi.fn();
    const runner = new ExecutorRunner({
      adapter: {
        spawn() {
          const proc: any = new EventEmitter();
          proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
          proc.exitCode = null; proc.pid = 10002;
          setImmediate(() => proc.emit("spawn"));
          // Fire error then exit then close in quick succession
          setTimeout(() => { proc.emit("error", new Error("transport fail")); proc.emit("exit", 1); proc.emit("close", 1); }, 10);
          return proc as ChildProcess;
        },
        async killProcessTree() {}
      },
      context: { command: "dummy", args: [], cwd: os.tmpdir(), env: {} },
      logPath,
      onLog,
      onExit
    });
    await runner.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(onExit).toHaveBeenCalledTimes(1);
    fs.rmSync(logPath, { force: true });
  });
});
