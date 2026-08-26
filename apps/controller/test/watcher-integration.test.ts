import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";
import { DispatchStore } from "../src/watcher/dispatch-store.js";
import { GitClient } from "../src/watcher/git-client.js";
import { CommitInspector } from "../src/watcher/commit-inspector.js";
import { WatcherService } from "../src/watcher/watcher-service.js";
import type {
  RepositoryMutationEvent,
  DispatchMarker,
  RepositoryRecord,
} from "@orca/shared";

describe("Watcher & Transactional Dispatch Integration (Task 6)", () => {
  let tempBaseDir: string;
  let remoteBareDir: string;
  let workRepoDir: string;
  let dbCtx: DatabaseContext;
  let repoStore: RepositoryStore;
  let dispatchStore: DispatchStore;
  let watcherService: WatcherService;
  const publishedEvents: RepositoryMutationEvent[] = [];

  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  }

  beforeEach(() => {
    publishedEvents.length = 0;
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-watcher-test-"));
    remoteBareDir = path.join(tempBaseDir, "remote.git");
    workRepoDir = path.join(tempBaseDir, "work-repo");
    const dbPath = path.join(tempBaseDir, "test.sqlite");

    // 1. Setup bare remote
    fs.mkdirSync(remoteBareDir);
    git(remoteBareDir, ["init", "--bare", "-b", "main"]);

    // 2. Setup working clone
    fs.mkdirSync(workRepoDir);
    git(workRepoDir, ["init", "-b", "main"]);
    git(workRepoDir, ["config", "user.name", "Test Sol"]);
    git(workRepoDir, ["config", "user.email", "sol@orca.test"]);
    git(workRepoDir, ["config", "commit.gpgsign", "false"]);
    git(workRepoDir, ["remote", "add", "origin", remoteBareDir]);

    // Initial commit on main
    fs.writeFileSync(path.join(workRepoDir, "README.md"), "# Initial Commit\n");
    git(workRepoDir, ["add", "README.md"]);
    git(workRepoDir, ["commit", "-m", "Initial commit"]);
    git(workRepoDir, ["push", "-u", "origin", "main"]);

    // 3. Setup controller database and services
    dbCtx = initDatabase(dbPath);
    repoStore = new RepositoryStore(dbCtx.db);
    dispatchStore = new DispatchStore(dbCtx.db);
    const gitClient = new GitClient();
    const commitInspector = new CommitInspector(gitClient);

    watcherService = new WatcherService({
      repoStore,
      dispatchStore,
      gitClient,
      commitInspector,
      eventPublisher: (event) => publishedEvents.push(event),
    });
  });

  afterEach(() => {
    watcherService.stop();
    dbCtx.close();
    // The watcher's directory watch handle can outlive stop() briefly on
    // Windows; retry the cleanup instead of failing the suite on EPERM.
    fs.rmSync(tempBaseDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });

  it("6.T1 ordinary commit on remote main does not trigger dispatch", { timeout: 30_000 }, async () => {
    const repo: RepositoryRecord = {
      id: "repo-test-1",
      displayName: "Test Repo",
      githubRemote: remoteBareDir,
      localPath: workRepoDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repoStore.create(repo);

    // Make ordinary commit
    fs.writeFileSync(path.join(workRepoDir, "feature.txt"), "some feature\n");
    git(workRepoDir, ["add", "feature.txt"]);
    git(workRepoDir, ["commit", "-m", "feat: ordinary work"]);
    git(workRepoDir, ["push", "origin", "main"]);

    await watcherService.pollRepository(repo.id);

    const dispatches = dispatchStore.getByRepository(repo.id);
    expect(dispatches).toHaveLength(0);

    const watcherStatus = watcherService.getWatcherStatus(repo.id);
    expect(watcherStatus.lastObservedSha).toBeTruthy();
    expect(watcherStatus.lastError).toBeNull();
  });

  it("6.T2 isolated valid dispatch commit detects and records dispatch exactly once", { timeout: 30_000 }, async () => {
    const repo: RepositoryRecord = {
      id: "repo-test-2",
      displayName: "Test Repo 2",
      githubRemote: remoteBareDir,
      localPath: workRepoDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repoStore.create(repo);

    const initialSha = git(workRepoDir, ["rev-parse", "HEAD"]);

    // Create .orca/dispatch directory
    const dispatchDir = path.join(workRepoDir, ".orca", "dispatch");
    fs.mkdirSync(dispatchDir, { recursive: true });

    const dispatchPayload: DispatchMarker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: "run-2026-001",
      dispatchId: "disp-2026-001",
      iteration: 1,
      createdAt: "2026-08-19T12:00:00.000Z",
      baseSha: initialSha,
      changePath: "openspec/changes/002-repository-watch-dispatch",
      goal: "Implement watcher test",
      instructionsVersion: 1,
    };

    fs.writeFileSync(
      path.join(dispatchDir, "disp-2026-001.json"),
      JSON.stringify(dispatchPayload, null, 2),
    );

    git(workRepoDir, ["add", ".orca/dispatch/disp-2026-001.json"]);
    git(workRepoDir, [
      "commit",
      "-m",
      "dispatch(disp-2026-001): isolated dispatch",
    ]);
    git(workRepoDir, ["push", "origin", "main"]);

    await watcherService.pollRepository(repo.id);

    const dispatches = dispatchStore.getByRepository(repo.id);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].id).toBe("disp-2026-001");
    expect(dispatches[0].status).toBe("detected");
    expect(dispatches[0].goal).toBe("Implement watcher test");

    const detectedEvent = publishedEvents.find(
      (e) => e.type === "watcher.dispatch_detected",
    );
    expect(detectedEvent).toBeDefined();
    expect(detectedEvent?.data?.dispatch?.id).toBe("disp-2026-001");
  });

  it("6.T3 repeated polling on the same commit is idempotent", { timeout: 30_000 }, async () => {
    const repo: RepositoryRecord = {
      id: "repo-test-3",
      displayName: "Test Repo 3",
      githubRemote: remoteBareDir,
      localPath: workRepoDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repoStore.create(repo);

    const initialSha = git(workRepoDir, ["rev-parse", "HEAD"]);
    const dispatchDir = path.join(workRepoDir, ".orca", "dispatch");
    fs.mkdirSync(dispatchDir, { recursive: true });

    const dispatchPayload: DispatchMarker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: "run-2026-003",
      dispatchId: "disp-2026-003",
      iteration: 1,
      createdAt: "2026-08-19T12:00:00.000Z",
      baseSha: initialSha,
      changePath: "openspec/changes/002-repository-watch-dispatch",
      goal: "Idempotency check",
      instructionsVersion: 1,
    };

    fs.writeFileSync(
      path.join(dispatchDir, "disp-2026-003.json"),
      JSON.stringify(dispatchPayload, null, 2),
    );
    git(workRepoDir, ["add", ".orca/dispatch/disp-2026-003.json"]);
    git(workRepoDir, [
      "commit",
      "-m",
      "dispatch(disp-2026-003): isolated dispatch",
    ]);
    git(workRepoDir, ["push", "origin", "main"]);

    // Poll 1
    await watcherService.pollRepository(repo.id);
    expect(dispatchStore.getByRepository(repo.id)).toHaveLength(1);

    // Poll 2 (no new commits)
    await watcherService.pollRepository(repo.id);
    expect(dispatchStore.getByRepository(repo.id)).toHaveLength(1);

    const detectedEvents = publishedEvents.filter(
      (e) => e.type === "watcher.dispatch_detected",
    );
    expect(detectedEvents).toHaveLength(1);
  });

  it("unchanged polls stay silent: no poll_completed event, liveness still persisted", { timeout: 30_000 }, async () => {
    const repo: RepositoryRecord = {
      id: "repo-test-3b",
      displayName: "Silent Heartbeat Repo",
      githubRemote: remoteBareDir,
      localPath: workRepoDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repoStore.create(repo);

    await watcherService.pollRepository(repo.id);
    publishedEvents.length = 0;

    // Unchanged remote: no event may be published (a heartbeat here previously
    // produced ~17k permanent ledger rows per watched repository per day).
    await watcherService.pollRepository(repo.id);
    expect(publishedEvents).toHaveLength(0);

    const status = watcherService.getWatcherStatus(repo.id);
    expect(status.lastError).toBeNull();
    expect(status.lastPolledAt).toBeTruthy();
  });

  it("6.T4 mixed commit is rejected with structured reason", { timeout: 30_000 }, async () => {
    const repo: RepositoryRecord = {
      id: "repo-test-4",
      displayName: "Test Repo 4",
      githubRemote: remoteBareDir,
      localPath: workRepoDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repoStore.create(repo);

    const initialSha = git(workRepoDir, ["rev-parse", "HEAD"]);
    const dispatchDir = path.join(workRepoDir, ".orca", "dispatch");
    fs.mkdirSync(dispatchDir, { recursive: true });

    const dispatchPayload: DispatchMarker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: "run-2026-004",
      dispatchId: "disp-2026-004",
      iteration: 1,
      createdAt: "2026-08-19T12:00:00.000Z",
      baseSha: initialSha,
      changePath: "openspec/changes/002-repository-watch-dispatch",
      goal: "Mixed test",
      instructionsVersion: 1,
    };

    fs.writeFileSync(
      path.join(dispatchDir, "disp-2026-004.json"),
      JSON.stringify(dispatchPayload, null, 2),
    );
    fs.writeFileSync(
      path.join(workRepoDir, "src_file.ts"),
      "export const x = 1;\n",
    );

    git(workRepoDir, [
      "add",
      ".orca/dispatch/disp-2026-004.json",
      "src_file.ts",
    ]);
    git(workRepoDir, ["commit", "-m", "dispatch and source changes mixed"]);
    git(workRepoDir, ["push", "origin", "main"]);

    await watcherService.pollRepository(repo.id);

    const dispatches = dispatchStore.getByRepository(repo.id);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].status).toBe("rejected");
    expect(dispatches[0].rejectionReason).toContain("Mixed commit rejected");

    const rejectedEvent = publishedEvents.find(
      (e) => e.type === "watcher.dispatch_rejected",
    );
    expect(rejectedEvent).toBeDefined();
  });

  it("6.T5 two repositories detect dispatches independently", { timeout: 30_000 }, async () => {
    // Setup second bare remote and working clone
    const remoteBareDir2 = path.join(tempBaseDir, "remote2.git");
    const workRepoDir2 = path.join(tempBaseDir, "work-repo2");

    fs.mkdirSync(remoteBareDir2);
    git(remoteBareDir2, ["init", "--bare", "-b", "main"]);

    fs.mkdirSync(workRepoDir2);
    git(workRepoDir2, ["init", "-b", "main"]);
    git(workRepoDir2, ["config", "user.name", "Test Sol 2"]);
    git(workRepoDir2, ["config", "user.email", "sol2@orca.test"]);
    git(workRepoDir2, ["config", "commit.gpgsign", "false"]);
    git(workRepoDir2, ["remote", "add", "origin", remoteBareDir2]);

    fs.writeFileSync(path.join(workRepoDir2, "README.md"), "# Repo 2\n");
    git(workRepoDir2, ["add", "README.md"]);
    git(workRepoDir2, ["commit", "-m", "Initial commit repo 2"]);
    git(workRepoDir2, ["push", "-u", "origin", "main"]);

    const repo1: RepositoryRecord = {
      id: "repo-multi-1",
      displayName: "Multi Repo 1",
      githubRemote: remoteBareDir,
      localPath: workRepoDir,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890ab",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const repo2: RepositoryRecord = {
      id: "repo-multi-2",
      displayName: "Multi Repo 2",
      githubRemote: remoteBareDir2,
      localPath: workRepoDir2,
      environment: "windows",
      wslDistribution: null,
      executorCli: "codex",
      executorModel: "gpt-5.6",
      solConversationUrl:
        "https://chatgpt.com/c/67b5883a-1234-8001-a123-1234567890cd",
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    repoStore.create(repo1);
    repoStore.create(repo2);

    // Create dispatch in repo 2 only
    const initialSha2 = git(workRepoDir2, ["rev-parse", "HEAD"]);
    const dispatchDir2 = path.join(workRepoDir2, ".orca", "dispatch");
    fs.mkdirSync(dispatchDir2, { recursive: true });

    const dispatchPayload2: DispatchMarker = {
      schemaVersion: 1,
      type: "dispatch",
      runId: "run-multi-2",
      dispatchId: "disp-multi-2",
      iteration: 1,
      createdAt: "2026-08-19T12:00:00.000Z",
      baseSha: initialSha2,
      changePath: "openspec/changes/002-repository-watch-dispatch",
      goal: "Repo 2 dispatch",
      instructionsVersion: 1,
    };

    fs.writeFileSync(
      path.join(dispatchDir2, "disp-multi-2.json"),
      JSON.stringify(dispatchPayload2, null, 2),
    );
    git(workRepoDir2, ["add", ".orca/dispatch/disp-multi-2.json"]);
    git(workRepoDir2, ["commit", "-m", "dispatch(disp-multi-2): repo 2"]);
    git(workRepoDir2, ["push", "origin", "main"]);

    // Poll both
    await Promise.all([
      watcherService.pollRepository(repo1.id),
      watcherService.pollRepository(repo2.id),
    ]);

    expect(dispatchStore.getByRepository(repo1.id)).toHaveLength(0);
    expect(dispatchStore.getByRepository(repo2.id)).toHaveLength(1);
    expect(dispatchStore.getByRepository(repo2.id)[0].id).toBe("disp-multi-2");
  }, 30000);
});
