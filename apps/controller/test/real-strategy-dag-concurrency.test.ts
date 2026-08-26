/**
 * T3 — Change 018 R3/R4: production buildApp() AUTONOMOUS DAG qualification of
 * (a) serialized integration ownership under SIMULTANEOUS DAG worker completion
 *     (per-strategyRunId promise-chain mutex around the strategy-owned staging
 *     lineage), and
 * (b) STRICT dependency isolation: a node sees ONLY its declared transitive
 *     dependency state — never unrelated sibling output.
 *
 * Production seams only: buildApp lifecycle, REST via app.fastify.inject,
 * durable Git pushes to the bare remote, read-only store inspection, and git
 * object reads against the clone directory (node/staging worktrees are linked
 * worktrees of that repository, so their SHAs resolve from its shared odb).
 *
 * Qualified W2 implementation facts (merged tree):
 *   - DAG nodes allocate at the immutable strategyBaseSha (= dispatch.baseSha),
 *     then REPLAY the ORIGINAL staged commits of the node's TRANSITIVE
 *     dependencies (completion order) into the node branch
 *     (swarm-execution-service.ts:1182-1217 -> worktree-isolation-service.ts
 *     replayCommits). The persisted WorktreeProvenance.baseSha is the
 *     POST-REPLAY HEAD the worker actually derived from
 *     (worktree-isolation-service.ts:110-154); dependencyInputShas keep the
 *     ORIGINAL staged worker SHAs.
 *   - Completed node commits are cherry-picked into the strategy-owned staging
 *     checkout <dataDir>/staging/<repoId>/<runId>/<strategyRunId> on branch
 *     orca/staging/<strategyRunId> under a per-strategyRunId promise-chain
 *     mutex (withIntegrationLock swarm-execution-service.ts:707-727,
 *     stageNodeCommit :785-838). Persistent user main is untouched until
 *     terminal.
 *   - Final integration at terminal: clean-main check -> ff-only staging into
 *     persistent main, else rebase staging onto main then ff; conflicts ->
 *     INTEGRATION_CONFLICT; dirty main -> FINAL_INTEGRATION_DIRTY_MAIN blocked
 *     (landStagingLineage, swarm-execution-service.ts:862-933).
 *
 * ----------------------------------------------------------------------------
 * nodeBaseSha provenance (OpenSpec 018 task 3.3): FOUND AND FIXED during this
 * qualification — DagExecutionService.onNodeAllocated originally dropped the
 * post-replay baseSha; production now persists it
 * (dag-execution-service.ts onNodeAllocated -> dag-node-store) and the
 * dedicated test at the bottom runs enabled. Isolation proofs below assert
 * against both the persisted nodeBaseSha and the equivalent
 * WorktreeProvenance.baseSha.
 * ----------------------------------------------------------------------------
 *
 * Run: cd apps/controller && npx vitest run test/real-strategy-dag-concurrency.test.ts --no-file-parallelism
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
vi.setConfig({ hookTimeout: 60_000, testTimeout: 240_000 });
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { buildApp, type AppInstance } from "../src/app.js";
import { loadConfig } from "../src/config/load-config.js";
import { MockBrowserDriver } from "./fixtures/mock-browser-driver.js";

const SWARM_HARNESS_PATH = path.resolve(__dirname, "fixtures", "swarm-worker-harness.mjs");
const oldHarnessEnv = process.env.ORCA_SWARM_TEST_HARNESS;
if (!process.env.ORCA_SWARM_TEST_HARNESS) process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function waitForCondition(fn: () => boolean, timeoutMs: number, everyMs = 150): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = fn(); } catch { ok = false; }
      if (ok) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error(`waitForCondition timed out after ${timeoutMs}ms`)); return; }
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

const STRATEGY_TERMINAL = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED", "RECOVERY_REQUIRED"];

type PacketIdByNode = Record<string, string>;

interface NodeSpec {
  nodeId: string;
  workstream: string;
  goal: string;
  allowedPaths: string[];
  dependsOn: string[];
}

describe("Real Strategy Change 018 T3 — buildApp DAG concurrency + strict dependency isolation", () => {
  let tempDir: string;
  let bareDir: string;
  let cloneDir: string;
  let app: AppInstance;
  let mockBrowser: MockBrowserDriver;

  beforeEach(async () => {
    // Re-arm the deterministic worker harness every test: afterEach restores
    // the original environment, which would otherwise leave later tests in
    // this file without a harness.
    if (!process.env.ORCA_SWARM_TEST_HARNESS) process.env.ORCA_SWARM_TEST_HARNESS = SWARM_HARNESS_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-dag-concurrency-"));
    bareDir = path.join(tempDir, "remote.git");
    cloneDir = path.join(tempDir, "clone");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.mkdirSync(cloneDir, { recursive: true });
    git(bareDir, ["init", "--bare", "-b", "main"]);
    git(cloneDir, ["init", "-b", "main"]);
    git(cloneDir, ["config", "user.email", "orca-dag-concurrency@example.com"]);
    git(cloneDir, ["config", "user.name", "Orca DAG Concurrency Qual"]);
    git(cloneDir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(cloneDir, "README.md"), "# T3 DAG concurrency + isolation fixture\n");
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", "initial"]);
    git(cloneDir, ["remote", "add", "origin", bareDir]);
    git(cloneDir, ["push", "-u", "origin", "main"]);

    const config = loadConfig({
      dbPath: path.join(tempDir, "test.sqlite"),
      dataDir: tempDir,
      logLevel: "silent",
      uiDistDir: null
    });
    mockBrowser = new MockBrowserDriver();
    app = await buildApp(config, { browserDriver: mockBrowser });
    // buildApp auto-starts watcherService; do NOT call watcherService.start()
  });

  afterEach(async () => {
    try { await app.fastify.close(); } catch {}
    try { app.dbContext.close(); } catch {}
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    delete process.env.ORCA_REQUIRE_FILE;
    delete process.env.ORCA_REQUIRE_CONTENT;
    delete process.env.ORCA_REQUIRE_PACKETS;
    delete process.env.ORCA_SWARM_WAIT_FILE;
    if (oldHarnessEnv === undefined) delete process.env.ORCA_SWARM_TEST_HARNESS;
    else process.env.ORCA_SWARM_TEST_HARNESS = oldHarnessEnv;
  });

  // ------------------------------------------------------------------ helpers

  function createRepo(goalHint: string) {
    return app.repositoryService.createRepository({
      displayName: `T3 DAG Concurrency Repo (${goalHint})`,
      githubRemote: bareDir,
      localPath: cloneDir,
      environment: "windows",
      wslDistribution: null,
      // Must resolve the "swarm-test" profile so workers run the swarm harness.
      executorCli: "orca-swarm-test-harness",
      executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/t3-dag-concurrency",
      maxIterations: 5,
      maxRuntimeMinutes: 480,
      enabled: true
    });
  }

  async function startRun(repoId: string, goal: string) {
    const startRes = await app.fastify.inject({
      method: "POST",
      url: `/api/repositories/${repoId}/runs/start`,
      payload: { goal, maxIterations: 5 }
    });
    expect(startRes.statusCode).toBe(201);
    return startRes.json().run as {
      id: string;
      currentIteration: number;
      [key: string]: unknown;
    };
  }

  function packetExecutorFor(created: ReturnType<typeof createRepo>) {
    return {
      role: "PRIMARY" as const,
      executorCli: created.executorCli,
      model: created.executorModel,
      provider: null,
      source: "REPOSITORY_DEFAULT" as const
    };
  }

  /**
   * Push an isolated DAG dispatch marker commit to the remote. The watcher
   * (auto-started by buildApp) picks it up and starts exactly one DAG strategy
   * run through LoopService -> IterationExecutionCoordinator.
   */
  function pushDagDispatch(options: {
    runId: string;
    goal: string;
    maxConcurrency: number;
    dagNodes: { nodeId: string; packetId: string; dependsOn: string[] }[];
  }): { dispatchId: string; baseSha: string } {
    const dispatchId = `disp-dag-${crypto.randomUUID().slice(0, 8)}`;
    const baseSha = git(cloneDir, ["rev-parse", "HEAD"]);
    const marker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: options.runId,
      dispatchId,
      iteration: 1,
      createdAt: new Date().toISOString(),
      baseSha,
      changePath: "openspec/changes/018-strategy-postflight-and-concurrency-hardening",
      goal: options.goal,
      instructionsVersion: 1,
      strategy: "DAG",
      executionPlan: {
        dagNodes: options.dagNodes,
        maxConcurrency: options.maxConcurrency
      }
    };
    fs.mkdirSync(path.join(cloneDir, ".orca", "dispatch"), { recursive: true });
    fs.writeFileSync(
      path.join(cloneDir, ".orca", "dispatch", `${dispatchId}.json`),
      JSON.stringify(marker, null, 2)
    );
    git(cloneDir, ["add", "-A"]);
    git(cloneDir, ["commit", "-m", `chore(sol): dispatch ${dispatchId}`]);
    git(cloneDir, ["push", "origin", "main"]);
    return { dispatchId, baseSha };
  }

  /**
   * Full campaign fixture: repo + run + typed packets (created in topological
   * order so packet.dependencies can reference upstream packetIds) + optional
   * dependency-state requirement env (scoped to the given node ids) + optional
   * hold-and-release gate env + durable DAG dispatch push.
   */
  async function setupDagCampaign(options: {
    goal: string;
    maxConcurrency: number;
    /** Must be listed in topological order (dependencies before dependents). */
    nodes: NodeSpec[];
    require?: { file: string; content: string; nodeIds: string[] };
    waitGateFile?: string;
  }): Promise<{
    repoId: string;
    runId: string;
    dispatchId: string;
    baseSha: string;
    packetIdByNode: PacketIdByNode;
  }> {
    const created = createRepo("campaign");
    const repoId = created.id;
    const runRecord = await startRun(repoId, options.goal);
    const runId = runRecord.id;
    const executor = packetExecutorFor(created);

    const packetIdByNode: PacketIdByNode = {};
    for (const node of options.nodes) {
      for (const dep of node.dependsOn) {
        expect(
          packetIdByNode[dep],
          `node ${node.nodeId} depends on ${dep}; nodes must be listed in topological order`
        ).toBeTruthy();
      }
      const packet = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
        workstream: node.workstream,
        goal: node.goal,
        allowedPaths: node.allowedPaths,
        dependencies: node.dependsOn.map((dep) => packetIdByNode[dep]),
        executor
      });
      packetIdByNode[node.nodeId] = packet.packetId;
    }

    if (options.require) {
      // Dependency-state requirement applies ONLY to the listed nodes' workers
      // (ORCA_REQUIRE_PACKETS scoping in the harness).
      process.env.ORCA_REQUIRE_FILE = options.require.file;
      process.env.ORCA_REQUIRE_CONTENT = options.require.content;
      process.env.ORCA_REQUIRE_PACKETS = options.require.nodeIds
        .map((nodeId) => packetIdByNode[nodeId])
        .join(",");
    }
    if (options.waitGateFile) process.env.ORCA_SWARM_WAIT_FILE = options.waitGateFile;

    const { dispatchId, baseSha } = pushDagDispatch({
      runId,
      goal: options.goal,
      maxConcurrency: options.maxConcurrency,
      dagNodes: options.nodes.map((node) => ({
        nodeId: node.nodeId,
        packetId: packetIdByNode[node.nodeId],
        dependsOn: node.dependsOn
      }))
    });

    return { repoId, runId, dispatchId, baseSha, packetIdByNode };
  }

  function dagStrategyRuns(runId: string) {
    return app.strategyRunStore.listByRun(runId).filter((r) => r.strategy === "DAG");
  }

  /** One-line durable-state dump used in assertion messages on unexpected outcomes. */
  function strategyDiagnostics(runId: string): string {
    const parts: string[] = [];
    for (const s of app.strategyRunStore.listByRun(runId)) {
      const nodes = app.dagNodeStore
        .list(s.strategyRunId)
        .map((n) => {
          const nResult = app.workPacketService.getResult(n.packetId);
          const commitTree =
            nResult?.worktree?.commitSha && /^[0-9a-f]{40}$/.test(nResult.worktree.commitSha)
              ? lsTreeNames(nResult.worktree.commitSha).join("+")
              : "none";
          return (
            `${n.nodeId}:${n.status}` +
            `${n.waitingReason ? `(${n.waitingReason})` : ""}` +
            ` start=${n.startedAt ? n.startedAt.slice(11, 23) : "-"}` +
            ` deps=[${n.dependencyInputShas.map((sha) => sha.slice(0, 8)).join(",")}]` +
            ` commitTree=${commitTree}`
          );
        });
      const results = s.packetIds
        .map((packetId) => app.workPacketService.getResult(packetId))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => {
          let extra = "";
          if (r.worktree) {
            extra += ` base=${r.worktree.baseSha.slice(0, 8)}` +
              `/tree=${lsTreeNames(r.worktree.baseSha).join("+")}` +
              ` commit=${r.worktree.commitSha?.slice(0, 8) ?? "null"} wt=${r.worktree.path}`;
            const marker = path.join(
              r.worktree.path,
              ".orca",
              `dependency-failure-${r.packetId}.txt`
            );
            try {
              extra += ` FAIL_MARKER=${fs.readFileSync(marker, "utf8").trim()}`;
            } catch {}
          }
          return `${r.packetId.slice(0, 8)}:${r.status}${r.blocker ? `(${r.blocker})` : ""}${extra}`;
        });
      parts.push(
        `strategy=${s.strategy}/${s.status} blocker=${s.lastError ?? "-"} ` +
          `nodes=[${nodes.join(", ")}] results=[${results.join(", ")}]`
      );
    }
    return parts.join(" | ") || "no strategy records";
  }

  async function waitForTerminalDagStrategy(runId: string, timeoutMs = 120000) {
    await waitForCondition(() => {
      return dagStrategyRuns(runId).some((r) => STRATEGY_TERMINAL.includes(r.status));
    }, timeoutMs);
    const strategy = dagStrategyRuns(runId).find((r) => STRATEGY_TERMINAL.includes(r.status));
    expect(strategy, "a terminal DAG strategy run must exist").toBeTruthy();
    return strategy!;
  }

  /** The completion handoff (publish + result manifest + loop transition) is asynchronous. */
  async function waitForCompletionHandoff(runId: string, dispatchId: string, timeoutMs = 90000) {
    await waitForCondition(() => {
      return (
        app.dispatchStore.get(dispatchId)?.status === "consumed" &&
        app.runStore.get(runId)?.status === "SOL_REVIEWING"
      );
    }, timeoutMs);
  }

  function resultOf(packetId: string) {
    const result = app.workPacketService.getResult(packetId);
    expect(result, `result for packet ${packetId} must exist`).toBeTruthy();
    return result!;
  }

  function nodeOf(strategyRunId: string, nodeId: string) {
    const node = app.dagNodeStore.list(strategyRunId).find((n) => n.nodeId === nodeId);
    expect(node, `dag node ${nodeId} must exist`).toBeTruthy();
    return node!;
  }

  function remoteFileAtHead(filePath: string): string | null {
    const remoteHead = git(bareDir, ["rev-parse", "HEAD"]);
    try {
      return git(bareDir, ["show", `${remoteHead}:${filePath}`]);
    } catch {
      return null;
    }
  }

  /** Top-level tree entries of a SHA, sorted. The clone shares the odb with all node/staging worktrees. */
  function lsTreeNames(sha: string): string[] {
    return git(cloneDir, ["ls-tree", "--name-only", sha])
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();
  }

  // ------------------------------------------------------------------ scenario 1

  /**
   * SWARM-shaped flat DAG stress body shared by the natural-race and the
   * gate-released variants. Asserts serialized integration ownership under
   * simultaneous completion: exactly one strategy record, all nodes COMPLETED,
   * all outputs integrated on remote main, clean handoff to Sol.
   */
  async function runFlatFourStress(options: { waitGateFile?: string }) {
    const nodes: NodeSpec[] = [
      { nodeId: "n1", workstream: "alpha", goal: "write alpha-out.txt", allowedPaths: ["alpha-out.txt"], dependsOn: [] },
      { nodeId: "n2", workstream: "beta", goal: "write beta-out.txt", allowedPaths: ["beta-out.txt"], dependsOn: [] },
      { nodeId: "n3", workstream: "gamma", goal: "write gamma-out.txt", allowedPaths: ["gamma-out.txt"], dependsOn: [] },
      { nodeId: "n4", workstream: "delta", goal: "write delta-out.txt", allowedPaths: ["delta-out.txt"], dependsOn: [] }
    ];
    const { repoId, runId, dispatchId, baseSha, packetIdByNode } = await setupDagCampaign({
      goal: "T3 simultaneous-completion stress: four independent nodes integrate without cross-talk",
      maxConcurrency: 4,
      nodes,
      waitGateFile: options.waitGateFile
    });

    if (options.waitGateFile) {
      // Hold-and-release sharpening: every worker blocks inside the harness
      // until the gate file appears, so releasing it lets all four completions
      // collide deliberately in stageNodeCommit's integration mutex.
      await waitForCondition(() => {
        const strategy = dagStrategyRuns(runId)[0];
        if (!strategy) return false;
        const dagNodes = app.dagNodeStore.list(strategy.strategyRunId);
        return dagNodes.length === 4 && dagNodes.every((n) => n.status === "RUNNING");
      }, 60000);
      fs.writeFileSync(options.waitGateFile, "release\n");
    }

    const strategy = await waitForTerminalDagStrategy(runId);

    // Exactly ONE strategy record for the whole run (no duplicate engine
    // starts under the completion race), and it is the DAG run we authorized.
    expect(app.strategyRunStore.listByRun(runId)).toHaveLength(1);
    expect(strategy.status, strategyDiagnostics(runId)).toBe("COMPLETED");
    // One immutable base: every node and the staging lineage derive from the
    // pushed dispatch baseSha.
    expect(strategy.strategyBaseSha).toBe(baseSha);

    const dagNodes = app.dagNodeStore.list(strategy.strategyRunId);
    expect(dagNodes).toHaveLength(4);
    for (const node of dagNodes) expect(node.status).toBe("COMPLETED");

    // No FAILED/BLOCKED results anywhere in the aggregate.
    for (const nodeId of Object.keys(packetIdByNode)) {
      expect(resultOf(packetIdByNode[nodeId]).status).toBe("COMPLETED");
    }

    // Completion handoff is asynchronous — wait for durable evidence before
    // asserting remote state.
    await waitForCompletionHandoff(runId, dispatchId);

    // All four outputs integrated on remote main with exact worker markers.
    for (const node of nodes) {
      const content = remoteFileAtHead(node.allowedPaths[0]);
      expect(content, `${node.allowedPaths[0]} must be integrated on remote main`).toBeTruthy();
      expect(content).toContain(`swarm worker ${node.workstream} (${packetIdByNode[node.nodeId]})`);
    }
    // Canonical durable result manifest pushed to the remote.
    expect(remoteFileAtHead(`.orca/results/${dispatchId}.json`)).toBeTruthy();

    // Run handed to Sol for review + COMPLETED wake text present.
    const statusRes = await app.fastify.inject({
      method: "GET",
      url: `/api/repositories/${repoId}/runs/active`
    });
    expect(statusRes.json().status.state).toBe("SOL_REVIEWING");
    const page = mockBrowser.history.get(repoId);
    expect(page, "sol wake page should exist").toBeTruthy();
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);
    expect(app.runStore.get(runId)?.status).toBe("SOL_REVIEWING");
  }

  it.each([1, 2, 3])(
    "stress %d/3: four independent nodes completing near-simultaneously serialize under the per-run integration mutex",
    async () => {
      await runFlatFourStress({});
    },
    240000
  );

  it("gate-released collision: all four workers held, then released at once so integrations collide deliberately", async () => {
    await runFlatFourStress({ waitGateFile: path.join(tempDir, "release-gate.txt") });
  }, 240000);

  // ------------------------------------------------------------------ scenario 2

  it("dependency isolation: dependent C sees ONLY A's staged state, never unrelated sibling B", async () => {
    const { repoId, runId, dispatchId, baseSha, packetIdByNode } = await setupDagCampaign({
      goal: "T3 falsification: C may only pass by materializing A's committed state",
      maxConcurrency: 3,
      nodes: [
        { nodeId: "a", workstream: "alpha", goal: "write a-out.txt", allowedPaths: ["a-out.txt"], dependsOn: [] },
        { nodeId: "b", workstream: "beta", goal: "write b-out.txt", allowedPaths: ["b-out.txt"], dependsOn: [] },
        { nodeId: "c", workstream: "gamma", goal: "consume a-out.txt into c-out.txt", allowedPaths: ["c-out.txt"], dependsOn: ["a"] }
      ],
      // C's worker FAILS (exit 31) unless a-out.txt exists in ITS OWN worktree
      // base carrying A's marker — scheduling order alone cannot satisfy this.
      require: { file: "a-out.txt", content: "swarm worker alpha", nodeIds: ["c"] }
    });

    const strategy = await waitForTerminalDagStrategy(runId);
    expect(app.strategyRunStore.listByRun(runId)).toHaveLength(1);
    expect(strategy.status, strategyDiagnostics(runId)).toBe("COMPLETED");

    const nodeA = nodeOf(strategy.strategyRunId, "a");
    const nodeB = nodeOf(strategy.strategyRunId, "b");
    const nodeC = nodeOf(strategy.strategyRunId, "c");
    expect(nodeA.status).toBe("COMPLETED");
    expect(nodeB.status).toBe("COMPLETED");
    expect(nodeC.status).toBe("COMPLETED");

    const aCommitSha = resultOf(packetIdByNode.a).worktree?.commitSha ?? null;
    expect(aCommitSha, "A must have a worker commit SHA").toBeTruthy();

    // Provenance falsification: C's declared inputs are EXACTLY [A] — B's
    // original staged SHA must never appear even though B ran concurrently.
    expect(nodeC.dependencyInputShas).toEqual([aCommitSha]);

    // C's input snapshot: the persisted post-replay HEAD (nodeBaseSha is
    // persisted production behavior — see header note; DagNodeRecord.nodeBaseSha
    // and WorktreeProvenance.baseSha carry the same value and both are asserted).
    const cBase = resultOf(packetIdByNode.c).worktree?.baseSha ?? "";
    expect(cBase).toMatch(/^[0-9a-f]{40}$/);
    // Replay happened: C's base advanced beyond the raw strategy base.
    // NOTE: we deliberately do NOT assert cBase !== aCommitSha — A's commit
    // parent IS the strategy base, so when the replay cherry-pick lands in the
    // same epoch second as A's original commit, git produces a byte-identical
    // (same-SHA) rewrite. Harmless: the exact-tree proof below still holds.
    expect(cBase).not.toBe(baseSha);
    // nodeBaseSha is persisted production behavior (OpenSpec 018 task 3.3).
    expect(nodeC.nodeBaseSha).toBe(cBase);
    // ISOLATION PROOF on C's exact input tree: base + A's file ONLY.
    // b-out.txt must be absent even though B completed concurrently and its
    // commit lives in the same object database.
    expect(lsTreeNames(cBase)).toEqual(["README.md", "a-out.txt"]);
    expect(git(cloneDir, ["show", `${cBase}:a-out.txt`])).toContain(
      `swarm worker alpha (${packetIdByNode.a})`
    );

    await waitForCompletionHandoff(runId, dispatchId);

    // Remote aggregate: everyone integrated...
    const bOut = remoteFileAtHead("b-out.txt");
    expect(bOut, "b-out.txt must be integrated on remote main").toBeTruthy();
    expect(bOut).toContain(`swarm worker beta (${packetIdByNode.b})`);
    const cOut = remoteFileAtHead("c-out.txt");
    expect(cOut, "c-out.txt must be integrated on remote main").toBeTruthy();
    expect(cOut).toContain(`swarm worker gamma (${packetIdByNode.c})`);
    expect(cOut).toContain("derived-from:");
    expect(cOut).toContain(`swarm worker alpha (${packetIdByNode.a})`);
    // ...but C's consumed input NEVER contains B's output bytes or id.
    expect(cOut).not.toContain("swarm worker beta");
    expect(cOut).not.toContain(packetIdByNode.b);

    expect(app.runStore.get(runId)?.status).toBe("SOL_REVIEWING");
    const page = mockBrowser.history.get(repoId);
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);
  }, 240000);

  // ------------------------------------------------------------------ scenario 3

  it("transitive chain isolation A->B->C: C's snapshot contains BOTH ancestors and nothing else", async () => {
    const { repoId, runId, dispatchId, packetIdByNode } = await setupDagCampaign({
      goal: "T3 transitive isolation: C consumes B which consumed A",
      maxConcurrency: 3,
      nodes: [
        { nodeId: "a", workstream: "alpha", goal: "write a-out.txt", allowedPaths: ["a-out.txt"], dependsOn: [] },
        { nodeId: "b", workstream: "beta", goal: "write b-out.txt after a", allowedPaths: ["b-out.txt"], dependsOn: ["a"] },
        { nodeId: "c", workstream: "gamma", goal: "consume b-out.txt into c-out.txt", allowedPaths: ["c-out.txt"], dependsOn: ["b"] }
      ],
      // C can only pass if B's file was materialized into ITS base — which in
      // turn required A's replay into B's base (transitive closure).
      require: { file: "b-out.txt", content: "swarm worker beta", nodeIds: ["c"] }
    });

    const strategy = await waitForTerminalDagStrategy(runId);
    expect(strategy.status, strategyDiagnostics(runId)).toBe("COMPLETED");

    const nodeC = nodeOf(strategy.strategyRunId, "c");
    expect(nodeC.status).toBe("COMPLETED");

    const aCommitSha = resultOf(packetIdByNode.a).worktree?.commitSha ?? null;
    const bCommitSha = resultOf(packetIdByNode.b).worktree?.commitSha ?? null;
    expect(aCommitSha, "A must have a worker commit SHA").toBeTruthy();
    expect(bCommitSha, "B must have a worker commit SHA").toBeTruthy();

    // Transitive provenance: EXACTLY the two original ancestor SHAs, no more.
    expect(nodeC.dependencyInputShas).toHaveLength(2);
    expect(new Set(nodeC.dependencyInputShas)).toEqual(new Set([aCommitSha, bCommitSha]));

    const cBase = resultOf(packetIdByNode.c).worktree?.baseSha ?? "";
    expect(cBase).toMatch(/^[0-9a-f]{40}$/);
    expect(nodeC.nodeBaseSha).toBe(cBase);

    // ISOLATION PROOF: C's exact input tree contains BOTH transitive ancestors'
    // files and nothing else (no c-out.txt itself, no unrelated files).
    expect(lsTreeNames(cBase)).toEqual(["README.md", "a-out.txt", "b-out.txt"]);
    expect(git(cloneDir, ["show", `${cBase}:a-out.txt`])).toContain(
      `swarm worker alpha (${packetIdByNode.a})`
    );
    expect(git(cloneDir, ["show", `${cBase}:b-out.txt`])).toContain(
      `swarm worker beta (${packetIdByNode.b})`
    );

    await waitForCompletionHandoff(runId, dispatchId);

    // C's derived-from bridge on remote main carries B's bytes. Note the
    // bridge is ONE level deep by harness design (it reads only the required
    // file, and B — with no requirement scoped to it — writes plain output);
    // A's TRANSITIVE presence is proven at the snapshot level above
    // (exact ls-tree set + git show) and by A's own integration here.
    const cOut = remoteFileAtHead("c-out.txt");
    expect(cOut, "c-out.txt must be integrated on remote main").toBeTruthy();
    expect(cOut).toContain(`swarm worker gamma (${packetIdByNode.c})`);
    expect(cOut).toContain("derived-from:");
    expect(cOut).toContain(`swarm worker beta (${packetIdByNode.b})`);
    const aOut = remoteFileAtHead("a-out.txt");
    expect(aOut, "a-out.txt must be integrated on remote main").toBeTruthy();
    expect(aOut).toContain(`swarm worker alpha (${packetIdByNode.a})`);

    expect(app.runStore.get(runId)?.status).toBe("SOL_REVIEWING");
    const page = mockBrowser.history.get(repoId);
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);
  }, 240000);

  // ------------------------------------------------------------------ scenario 4

  it("staging-order leakage regression: unrelated sibling B stages BEFORE A, C still sees only A", async () => {
    // Explicit phases (not setupDagCampaign) because roles are assigned AFTER
    // packet creation: with maxConcurrency 1 the engine launches pending
    // packets sorted by packetId, so assigning the INDEPENDENT sibling role to
    // the smaller packetId deterministically forces B to complete AND stage
    // before upstream A even starts.
    const created = createRepo("staging-order");
    const repoId = created.id;
    const goal = "T3 staging-order leakage regression: B stages first, C must still see only A";
    const runRecord = await startRun(repoId, goal);
    const runId = runRecord.id;
    const executor = packetExecutorFor(created);

    const packetP = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "alpha",
      goal: "write a-out.txt",
      allowedPaths: ["a-out.txt"],
      dependencies: [],
      executor
    });
    const packetQ = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "beta",
      goal: "write b-out.txt",
      allowedPaths: ["b-out.txt"],
      dependencies: [],
      executor
    });
    const ordered = [packetP, packetQ].sort((x, y) => x.packetId.localeCompare(y.packetId));
    const packetB = ordered[0]; // independent sibling — launched, completed and STAGED first
    const packetA = ordered[1]; // upstream of C — launched second
    // File names and workstreams belong to the PHYSICAL packets; the A/B roles
    // are assigned by packetId sort. Derive every expectation from the role
    // mapping — hardcoding "a-out.txt" here would break whenever packetP sorts
    // first (the alpha writer would be B, and A would write b-out.txt).
    const aWorkstream = packetA === packetP ? "alpha" : "beta";
    const aFile = packetA === packetP ? "a-out.txt" : "b-out.txt";
    const bWorkstream = packetB === packetP ? "alpha" : "beta";
    const bFile = packetB === packetP ? "a-out.txt" : "b-out.txt";
    const packetC = app.workPacketService.create(created, { ...runRecord, currentIteration: 1 }, {
      workstream: "gamma",
      goal: `consume ${aFile} into c-out.txt`,
      allowedPaths: ["c-out.txt"],
      dependencies: [packetA.packetId],
      executor
    });

    // C may only pass by seeing A's materialized state in its own base.
    process.env.ORCA_REQUIRE_FILE = aFile;
    process.env.ORCA_REQUIRE_CONTENT = `swarm worker ${aWorkstream}`;
    process.env.ORCA_REQUIRE_PACKETS = packetC.packetId;

    const { dispatchId, baseSha } = pushDagDispatch({
      runId,
      goal,
      maxConcurrency: 1,
      dagNodes: [
        { nodeId: "a", packetId: packetA.packetId, dependsOn: [] },
        { nodeId: "b", packetId: packetB.packetId, dependsOn: [] },
        { nodeId: "c", packetId: packetC.packetId, dependsOn: ["a"] }
      ]
    });

    const strategy = await waitForTerminalDagStrategy(runId);
    expect(app.strategyRunStore.listByRun(runId)).toHaveLength(1);
    expect(strategy.status, strategyDiagnostics(runId)).toBe("COMPLETED");
    expect(strategy.strategyBaseSha).toBe(baseSha);

    const nodeA = nodeOf(strategy.strategyRunId, "a");
    const nodeB = nodeOf(strategy.strategyRunId, "b");
    const nodeC = nodeOf(strategy.strategyRunId, "c");
    expect(nodeA.status).toBe("COMPLETED");
    expect(nodeB.status).toBe("COMPLETED");
    expect(nodeC.status).toBe("COMPLETED");

    // PRECONDITION PROOF: the staging lineage (branch retained as provenance)
    // received B's commit BEFORE A's — the exact ordering under which a naive
    // "replay everything staged" implementation would leak B into C. Only the
    // staged worker commits are compared (log otherwise walks the full
    // inherited ancestry: initial + dispatch commit); C stages last.
    const stagingSubjects = git(cloneDir, [
      "log",
      "--format=%s",
      "--reverse",
      `orca/staging/${strategy.strategyRunId}`
    ])
      .split("\n")
      .map((value) => value.trim())
      .filter((value) => value.startsWith("swarm worker "));
    expect(stagingSubjects).toEqual([
      `swarm worker ${bWorkstream}`,
      `swarm worker ${aWorkstream}`,
      "swarm worker gamma"
    ]);

    // C's declared inputs remain EXACTLY [A] despite B staging earlier.
    const aCommitSha = resultOf(packetA.packetId).worktree?.commitSha ?? null;
    expect(aCommitSha, "A must have a worker commit SHA").toBeTruthy();
    expect(nodeC.dependencyInputShas).toEqual([aCommitSha]);

    const cBase = resultOf(packetC.packetId).worktree?.baseSha ?? "";
    expect(cBase).toMatch(/^[0-9a-f]{40}$/);
    // nodeBaseSha is persisted production behavior (OpenSpec 018 task 3.3),
    // asserted unconditionally like the sibling scenarios above.
    expect(nodeC.nodeBaseSha).toBe(cBase);

    // ISOLATION PROOF on C's exact input tree: B's earlier-staged output is
    // absent; only A's file was replayed onto the immutable base.
    expect(lsTreeNames(cBase)).toEqual(["README.md", aFile]);
    expect(git(cloneDir, ["show", `${cBase}:${aFile}`])).toContain(
      `swarm worker ${aWorkstream} (${packetA.packetId})`
    );

    await waitForCompletionHandoff(runId, dispatchId);

    const cOut = remoteFileAtHead("c-out.txt");
    expect(cOut, "c-out.txt must be integrated on remote main").toBeTruthy();
    expect(cOut).toContain(`swarm worker gamma (${packetC.packetId})`);
    expect(cOut).toContain("derived-from:");
    expect(cOut).toContain(`swarm worker ${aWorkstream} (${packetA.packetId})`);
    // B's bytes and identity never reached C's consumed input.
    expect(cOut).not.toContain(`swarm worker ${bWorkstream}`);
    expect(cOut).not.toContain(packetB.packetId);
    // Both producers integrated normally on remote main under their own names.
    const aOutRemote = remoteFileAtHead(aFile);
    expect(aOutRemote, `${aFile} must be integrated on remote main`).toBeTruthy();
    expect(aOutRemote).toContain(`swarm worker ${aWorkstream} (${packetA.packetId})`);
    const bOutRemote = remoteFileAtHead(bFile);
    expect(bOutRemote, `${bFile} must be integrated on remote main`).toBeTruthy();
    expect(bOutRemote).toContain(`swarm worker ${bWorkstream} (${packetB.packetId})`);

    expect(app.runStore.get(runId)?.status).toBe("SOL_REVIEWING");
    const page = mockBrowser.history.get(repoId);
    expect((page?.typedMessages ?? []).map((m) => m.text).join("\n")).toMatch(/COMPLETED/);
  }, 240000);

  // ------------------------------------------------- nodeBaseSha provenance

  it(
    "persists DagNodeRecord.nodeBaseSha as the post-replay snapshot HEAD (OpenSpec 018 task 3.3)",
    async () => {
      // Full scenario-2 shape; once production persists nodeBaseSha these
      // assertions must hold verbatim.
      const { runId, packetIdByNode } = await setupDagCampaign({
        goal: "T3 nodeBaseSha persistence follow-up",
        maxConcurrency: 3,
        nodes: [
          { nodeId: "a", workstream: "alpha", goal: "write a-out.txt", allowedPaths: ["a-out.txt"], dependsOn: [] },
          { nodeId: "b", workstream: "beta", goal: "write b-out.txt", allowedPaths: ["b-out.txt"], dependsOn: [] },
          { nodeId: "c", workstream: "gamma", goal: "consume a-out.txt into c-out.txt", allowedPaths: ["c-out.txt"], dependsOn: ["a"] }
        ],
        require: { file: "a-out.txt", content: "swarm worker alpha", nodeIds: ["c"] }
      });
      const strategy = await waitForTerminalDagStrategy(runId);
      expect(strategy.status, strategyDiagnostics(runId)).toBe("COMPLETED");
      const nodeC = nodeOf(strategy.strategyRunId, "c");
      const provenanceBase = resultOf(packetIdByNode.c).worktree?.baseSha ?? "";
      expect(typeof nodeC.nodeBaseSha).toBe("string");
      expect(nodeC.nodeBaseSha).toMatch(/^[0-9a-f]{40}$/);
      expect(nodeC.nodeBaseSha).toBe(provenanceBase);
    },
    240000
  );
});
