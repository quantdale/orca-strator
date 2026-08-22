/**
 * Negative validation corpus — item #6 + nonzero exit handling item #7.
 * Uses a stub GitClient to prove ExecutorService.readAndValidateResult rejects mismatched
 * runId, dispatchId, iteration, model, environment, resultSha, and unpushed result.
 * Also proves nonzero exit with valid manifest is preserved (item #7).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { ExecutorStore } from "../src/executor/executor-store.js";
import { ExecutorService, executorIdentityMatches } from "../src/executor/executor-service.js";
import type { GitClient } from "../src/watcher/git-client.js";
import type { ExecutorResult } from "@orca/shared";

const VALID_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const HEAD_SHA = "c".repeat(40);

function makeValidResult(overrides: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    schemaVersion: 1 as const,
    type: "executor-result" as const,
    runId: "run-1",
    dispatchId: "disp-1",
    iteration: 1,
    status: "COMPLETED" as const,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    baseSha: VALID_SHA,
    resultSha: VALID_SHA,
    executor: { cli: "orca-test-harness", model: "test-model", environment: "windows" as const },
    verification: [{ name: "smoke", status: "PASS" as const, summary: "ok" }],
    blockers: [],
    summary: "ok",
    ...overrides
  } as ExecutorResult;
}

function stubGitClient(result: ExecutorResult, opts: { headSha?: string; isAncestor?: boolean; remoteOk?: boolean; fileAtCommit?: boolean } = {}): GitClient {
  const headSha = opts.headSha ?? HEAD_SHA;
  const anc = opts.isAncestor ?? true;
  const remoteOk = opts.remoteOk ?? true;
  return {
    readWorkingTreeFile: async () => JSON.stringify(result),
    getCurrentSha: async () => headSha,
    isAncestor: async () => anc,
    getFileContentAtCommit: async () => { if (!opts.fileAtCommit && opts.fileAtCommit !== undefined) throw new Error("missing"); return JSON.stringify(result); },
    fetch: async () => { if (!remoteOk) throw new Error("fetch fail"); },
    getRemoteHeadSha: async () => headSha,
  } as unknown as GitClient;
}

describe("Executor result semantic validation (negative corpus)", () => {
  let tempDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let executorStore: ExecutorStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-validation-"));
    dbCtx = initDatabase(path.join(tempDir, "test.sqlite"));
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    executorStore = new ExecutorStore(dbCtx.db);
    repoStore.create({
      id: "repo-v", displayName: "V", githubRemote: "https://example.com/r.git",
      localPath: tempDir, environment: "windows", wslDistribution: null,
      executorCli: "orca-test-harness", executorModel: "test-model",
      solConversationUrl: "https://chatgpt.com/c/x",
      maxIterations: 5, maxRuntimeMinutes: 60, enabled: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    dispatchStore.create({
      id: "disp-1", dispatchId: "disp-1", repositoryId: "repo-v", runId: "run-1", iteration: 1,
      commitSha: VALID_SHA, baseSha: VALID_SHA, changePath: "openspec/changes/009", goal: "g",
      instructionsVersion: 1, schemaVersion: 1, type: "dispatch",
      status: "detected", rejectionReason: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
  });
  afterEach(() => { dbCtx.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

  async function validateWith(result: ExecutorResult, gitOpts: any = {}) {
    const gitClient = stubGitClient(result, gitOpts);
    const svc = new ExecutorService({ repoStore, dispatchStore, executorStore, gitClient, dataDir: tempDir });
    const fn = (svc as any).readAndValidateResult.bind(svc);
    return fn("repo-v", "disp-1");
  }

  it("rejects mismatched runId", async () => { expect(await validateWith(makeValidResult({ runId: "other" }))).toBeNull(); });
  it("rejects mismatched dispatchId", async () => { expect(await validateWith(makeValidResult({ dispatchId: "other" }))).toBeNull(); });
  it("rejects mismatched iteration", async () => { expect(await validateWith(makeValidResult({ iteration: 99 }))).toBeNull(); });
  it("rejects mismatched model", async () => { expect(await validateWith(makeValidResult({ executor: { cli: "orca-test-harness", model: "other", environment: "windows" } }))).toBeNull(); });
  it("rejects mismatched environment", async () => { expect(await validateWith(makeValidResult({ executor: { cli: "orca-test-harness", model: "test-model", environment: "wsl" } }))).toBeNull(); });
  it("rejects resultSha not ancestor of HEAD", async () => { expect(await validateWith(makeValidResult(), { isAncestor: false })).toBeNull(); });
  it("rejects when manifest not committed (getFileContentAtCommit fails)", async () => { expect(await validateWith(makeValidResult(), { fileAtCommit: false } as any)).toBeNull(); });
  it("rejects when fetch fails (unverified remote)", async () => { expect(await validateWith(makeValidResult(), { remoteOk: false })).toBeNull(); });
  it("rejects mismatched baseSha", async () => { expect(await validateWith(makeValidResult({ baseSha: OTHER_SHA }))).toBeNull(); });

  it("nonzero exit with valid manifest is still consumed (item #7)", async () => {
    // readAndValidateResult itself is exitCode-agnostic; nonzero is handled in handleTurnCompletion to still inspect.
    // Prove the validator does not discard valid manifest merely because exitCode nonzero (caller decides to call it).
    const gitClient = stubGitClient(makeValidResult({ status: "FAILED" }));
    const svc = new ExecutorService({ repoStore, dispatchStore, executorStore, gitClient, dataDir: tempDir });
    const result = await (svc as any).readAndValidateResult("repo-v", "disp-1", { exitCode: 1 });
    expect(result).not.toBeNull();
    expect(result.status).toBe("FAILED");
  });

  function configureExecutorCli(executorCli: string) {
    const current = repoStore.get("repo-v");
    if (!current) throw new Error("repo-v missing");
    repoStore.update({ ...current, executorCli });
  }

  it("accepts manifest cli echoing the exact configured path (Change 023 real-dogfood finding)", async () => {
    configureExecutorCli("C:\\Users\\palac\\.kimi-code\\bin\\kimi.exe");
    const result = await validateWith(
      makeValidResult({ executor: { cli: "C:\\Users\\palac\\.kimi-code\\bin\\kimi.exe", model: "test-model", environment: "windows" } })
    );
    expect(result).not.toBeNull();
  });

  it("accepts manifest cli using a descriptive harness name for a path-configured executor", async () => {
    configureExecutorCli("C:\\Users\\palac\\.kimi-code\\bin\\kimi.exe");
    const result = await validateWith(
      makeValidResult({ executor: { cli: "kimi-code-cli", model: "test-model", environment: "windows" } })
    );
    expect(result).not.toBeNull();
  });

  it("rejects a manifest from an unrelated harness even when names are descriptive", async () => {
    configureExecutorCli("C:\\Users\\palac\\.kimi-code\\bin\\kimi.exe");
    expect(await validateWith(
      makeValidResult({ executor: { cli: "codex-cli", model: "test-model", environment: "windows" } })
    )).toBeNull();
  });
});

describe("executorIdentityMatches (real-world result correlation)", () => {
  const KIMI_PATH = "C:\\Users\\palac\\.kimi-code\\bin\\kimi.exe";

  it("exact raw echo matches", () => {
    expect(executorIdentityMatches(KIMI_PATH, KIMI_PATH)).toBe(true);
  });
  it("bare basename matches configured path", () => {
    expect(executorIdentityMatches(KIMI_PATH, "kimi.exe")).toBe(true);
  });
  it("stem without extension matches", () => {
    expect(executorIdentityMatches(KIMI_PATH, "Kimi")).toBe(true);
  });
  it("descriptive harness name containing the stem matches", () => {
    expect(executorIdentityMatches(KIMI_PATH, "kimi-code-cli")).toBe(true);
  });
  it("unrelated harness name is rejected", () => {
    expect(executorIdentityMatches(KIMI_PATH, "codex-cli")).toBe(false);
  });
  it("empty or garbage reports are rejected", () => {
    expect(executorIdentityMatches(KIMI_PATH, "")).toBe(false);
    expect(executorIdentityMatches(KIMI_PATH, "***")).toBe(false);
  });
});
