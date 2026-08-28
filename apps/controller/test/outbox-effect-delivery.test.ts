import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { SolWakeStore } from "../src/browser/sol-wake-store.js";
import { RunStore } from "../src/loop/run-store.js";
import { ExecutorService } from "../src/executor/executor-service.js";
import { BrowserManager } from "../src/browser/browser-manager.js";
import { LoopService } from "../src/loop/loop-service.js";
import { OrchestrationTransitionService } from "../src/ownership/transition-service.js";
import { FakeExecutorAdapter } from "./fixtures/fake-executor.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";
import type { IterationExecutionCoordinator } from "../src/loop/iteration-execution-coordinator.js";
import type { DispatchRecord, RepositoryRecord, RunRecord } from "@orca/shared";

/**
 * Change 028 (D9.5) regression guard.
 *
 * A committed transition may enqueue an outbox effect that the deliverer does
 * not handle. Because an unhandled kind simply falls off the end of the
 * if-chain and returns normally, the item is marked DELIVERED and the effect is
 * lost silently — a consumed source with its required effect never performed.
 * That is exactly how START_EXECUTION_ACTOR was dropped: every autonomous turn
 * consumed its dispatch and then stalled in EXECUTOR_PENDING forever.
 *
 * The first test is structural so the defect class cannot return: any new
 * `effectKind` enqueued in src must have a delivery branch. The rest prove the
 * actor start actually happens and that replay cannot start a second actor.
 */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const REPO: RepositoryRecord = {
  id: "repo-outbox-1",
  displayName: "Outbox Repo",
  githubRemote: "https://github.com/quantdale/outbox.git",
  localPath: "D:\\Projects\\Outbox",
  environment: "windows",
  wslDistribution: null,
  executorCli: "codex",
  executorModel: "gpt-5.6",
  solConversationUrl: "https://chatgpt.com/c/67b5883a-7777-8001-a123-1234567890ab",
  maxIterations: 5,
  maxRuntimeMinutes: 480,
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z"
};

describe("Change 028 D9.5 — every enqueued outbox effect has a deliverer", () => {
  it("no effectKind is enqueued without a matching branch in deliverOutboxEffect", () => {
    const files = walk(SRC_DIR);
    const enqueued = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/effectKind:\s*"([A-Z_]+)"/g)) enqueued.add(m[1]!);
    }
    // The enqueue sites are the authority; if this is empty the scan broke.
    expect(enqueued.size).toBeGreaterThan(0);

    const loopSource = fs.readFileSync(path.join(SRC_DIR, "loop", "loop-service.ts"), "utf8");
    const start = loopSource.indexOf("private async deliverOutboxEffect");
    expect(start).toBeGreaterThan(-1);
    // Bound the scan to the deliverer body so an enqueue site cannot satisfy it.
    const body = loopSource.slice(start, loopSource.indexOf("\n  }\n", start));
    const handled = new Set(
      [...body.matchAll(/item\.effectKind === "([A-Z_]+)"/g)].map((m) => m[1]!)
    );

    const undelivered = [...enqueued].filter((kind) => !handled.has(kind));
    expect(
      undelivered,
      `outbox effect kinds enqueued but never delivered: ${undelivered.join(", ")}`
    ).toEqual([]);
  });
});

describe("Change 028 D9.5 — START_EXECUTION_ACTOR delivery and replay", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let runStore: RunStore;
  let dispatchStore: DispatchStore;
  let loopService: LoopService;
  let transition: OrchestrationTransitionService;
  let starts: Array<{ runId: string; dispatchId: string | null }>;

  function makeDispatch(dispatchId: string, runId: string): void {
    const dispatch: DispatchRecord = {
      id: dispatchId,
      dispatchId,
      repositoryId: REPO.id,
      runId,
      iteration: 1,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      baseSha: "1123456789abcdef0123456789abcdef01234567",
      changePath: "openspec/changes/028-durable-execution-ownership-and-crash-consistency",
      goal: "outbox delivery",
      instructionsVersion: 1,
      schemaVersion: 1,
      type: "dispatch",
      status: "detected",
      rejectionReason: null,
      createdAt: "2026-08-28T10:00:00.000Z",
      updatedAt: "2026-08-28T10:00:00.000Z"
    };
    dispatchStore.create(dispatch);
  }

  function makeRun(status: RunRecord["status"], activeDispatchId: string | null): RunRecord {
    const run: RunRecord = {
      id: "run-outbox-1",
      repositoryId: REPO.id,
      goal: "outbox delivery",
      status,
      currentIteration: 1,
      maxIterations: 5,
      activeDispatchId,
      lastError: null,
      startedAt: "2026-08-28T10:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-08-28T10:00:00.000Z",
      updatedAt: "2026-08-28T10:00:00.000Z",
      drainReason: null
    };
    runStore.create(run);
    return run;
  }

  function enqueueActorStart(runId: string, dispatchId: string): Promise<unknown> {
    return transition.enqueueAndApply({
      sourceKind: "DISPATCH",
      sourceId: dispatchId,
      operation: "DISPATCH_START",
      repositoryId: REPO.id,
      runId,
      payloadJson: "{}",
      apply: ({ enqueueOutbox }) => {
        enqueueOutbox({
          effectKey: `start-actor-${runId}-${dispatchId}`,
          effectKind: "START_EXECUTION_ACTOR",
          repositoryId: REPO.id,
          runId,
          payloadJson: JSON.stringify({ dispatchId, strategy: "SINGLE_AGENT" })
        });
      }
    });
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-outbox-"));
    dbCtx = initDatabase(path.join(tempDir, "test.sqlite"));
    const repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    const executorStore = new ExecutorStore(dbCtx.db);
    const wakeStore = new SolWakeStore(dbCtx.db);
    runStore = new RunStore(dbCtx.db);
    repoStore.create(REPO);

    starts = [];
    const coordinator = {
      start: async (_repositoryId: string, run: RunRecord, dispatch: { dispatchId?: string } | null) => {
        starts.push({ runId: run.id, dispatchId: dispatch?.dispatchId ?? null });
        runStore.updateStatus(run.id, "EXECUTING");
        return undefined;
      },
      resolveStrategy: () => "SINGLE_AGENT" as const,
      assertCampaignIterationOwnership: () => {}
    } as unknown as IterationExecutionCoordinator;

    transition = new OrchestrationTransitionService(dbCtx.db);
    loopService = new LoopService({
      repoStore,
      dispatchStore,
      runStore,
      executorService: new ExecutorService({
        repoStore,
        dispatchStore,
        executorStore,
        dataDir: tempDir,
        windowsAdapter: new FakeExecutorAdapter({ durationMs: 5 })
      }),
      browserManager: new BrowserManager({
        dataDir: tempDir,
        driver: new MockBrowserDriver(),
        wakeStore
      }),
      coordinator,
      transition
    });
  });

  afterEach(() => {
    try {
      loopService.shutdown();
    } catch {}
    try {
      dbCtx.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("delivers the actor start committed with the dispatch transition", async () => {
    const run = makeRun("EXECUTOR_PENDING", null);
    makeDispatch("disp-outbox-1", run.id);
    runStore.updateStatus(run.id, "EXECUTOR_PENDING", { activeDispatchId: "disp-outbox-1" });
    await enqueueActorStart(run.id, "disp-outbox-1");

    expect(starts).toEqual([]);
    await loopService.replayPendingTransitionOutbox();

    expect(starts).toEqual([{ runId: run.id, dispatchId: "disp-outbox-1" }]);
    expect(runStore.get(run.id)?.status).toBe("EXECUTING");
    expect(transition.listPendingOutbox()).toEqual([]);
  });

  it("replay does not spawn a second actor once the run has advanced", async () => {
    const run = makeRun("EXECUTOR_PENDING", null);
    makeDispatch("disp-outbox-2", run.id);
    runStore.updateStatus(run.id, "EXECUTOR_PENDING", { activeDispatchId: "disp-outbox-2" });
    await enqueueActorStart(run.id, "disp-outbox-2");
    await loopService.replayPendingTransitionOutbox();
    expect(starts).toHaveLength(1);

    // Simulate a crash before the delivery acknowledgement: the effect is
    // pending again, but the run already advanced past EXECUTOR_PENDING.
    await enqueueActorStart(run.id, "disp-outbox-2");
    await loopService.replayPendingTransitionOutbox();

    expect(starts).toHaveLength(1);
  });

  it("does not start an actor for a dispatch the run no longer points at", async () => {
    const run = makeRun("EXECUTOR_PENDING", null);
    makeDispatch("disp-current", run.id);
    makeDispatch("disp-superseded", run.id);
    runStore.updateStatus(run.id, "EXECUTOR_PENDING", { activeDispatchId: "disp-current" });
    await enqueueActorStart(run.id, "disp-superseded");
    await loopService.replayPendingTransitionOutbox();

    expect(starts).toEqual([]);
    expect(runStore.get(run.id)?.status).toBe("EXECUTOR_PENDING");
  });
});
