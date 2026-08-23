import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReadinessCheck } from "@orca/shared";
import { initDatabase, type DatabaseContext } from "../src/db/database.js";
import { buildSystemReadiness, type ReadinessDeps } from "../src/runtime/readiness-service.js";
import { RepositoryStore } from "../src/repositories/repository-store.js";

function baseDeps(dataDir: string, db: DatabaseContext["db"], repos: RepositoryStore): ReadinessDeps {
  return {
    identity: { service: "orca-controller", version: "0.1.0-test", protocol: 1, pid: process.pid },
    dataDir,
    port: 47100,
    db,
    repositoryStore: repos,
    browserManager: null,
    discoverChrome: async () => ({ status: "FOUND", executablePath: "chrome.exe", version: "999", source: "test" }),
    detectTailscale: async () => ({ status: "not_installed", details: "Tailscale not installed" }),
    runGitVersion: async () => "git version 2.99.0.test"
  };
}

let repoSeq = 0;

function seedRepo(store: RepositoryStore, overrides: Partial<Record<string, unknown>> = {}) {
  const id = `test-repo-${++repoSeq}`;
  store.create({
    id,
    displayName: (overrides.displayName as string) ?? `Repo ${repoSeq}`,
    githubRemote: "https://github.com/example/r.git",
    localPath: "/definitely/not/a/real/path",
    environment: "windows",
    wslDistribution: null,
    executorCli: "kimi",
    executorModel: "kimi-latest",
    solConversationUrl: "https://chatgpt.com/c/test",
    maxIterations: 20,
    maxRuntimeMinutes: 480,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  } as never);
}

describe("Change 025 system readiness doctor (9.8)", () => {
  let dataDir: string;
  let dbContext: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-readiness-"));
    dbContext = initDatabase(path.join(dataDir, "readiness.sqlite"));
  });

  afterEach(() => {
    dbContext.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("fresh machine with no repositories is ready; externals stay optional", async () => {
    const result = await buildSystemReadiness(baseDeps(dataDir, dbContext.db, new RepositoryStore(dbContext.db)));

    expect(result.ready).toBe(true);
    expect(result.identity.service).toBe("orca-controller");
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c])) as Record<string, ReadinessCheck>;
    expect(byId["writable-data-dir"].status).toBe("READY");
    expect(byId["database"].status).toBe("READY");
    expect(byId["git"].status).toBe("READY");
    // Available Chrome is truthfully READY even before any repository exists.
    expect(byId["chrome"].status).toBe("READY");
    expect(byId["repositories"].status).toBe("OPTIONAL");
    // Tailscale/OpenCode never block
    expect(byId["tailscale"].blocking).toBe(false);
    expect(["OPTIONAL", "UNKNOWN"]).toContain(byId["tailscale"].status);
    expect(byId["opencode"].status).toBe("OPTIONAL");
    // WSL irrelevant without WSL repositories
    expect(byId["wsl"].status).toBe("OPTIONAL");
  });

  it("missing Git becomes a blocking ACTION_REQUIRED check", async () => {
    const deps = {
      ...baseDeps(dataDir, dbContext.db, new RepositoryStore(dbContext.db)),
      runGitVersion: async () => {
        throw new Error("git not found");
      }
    };
    const result = await buildSystemReadiness(deps);
    const git = result.checks.find((c) => c.id === "git")!;
    expect(git.status).toBe("ACTION_REQUIRED");
    expect(git.blocking).toBe(true);
    expect(result.ready).toBe(false);
  });

  it("unwritable data directory blocks readiness with remediation", async () => {
    fs.writeFileSync(path.join(dataDir, "blocked"), "x");
    const deps = {
      ...baseDeps(dataDir, dbContext.db, new RepositoryStore(dbContext.db)),
      dataDir: path.join(dataDir, "blocked", "nested")
    };
    const result = await buildSystemReadiness(deps);
    const probe = result.checks.find((c) => c.id === "writable-data-dir")!;
    expect(probe.status).toBe("ACTION_REQUIRED");
    expect(probe.blocking).toBe(true);
    expect(result.ready).toBe(false);
    expect(probe.remediation).toBeTruthy();
  });

  it("configured repositories make missing Chrome blocking", async () => {
    const store = new RepositoryStore(dbContext.db);
    seedRepo(store);
    const deps = {
      ...baseDeps(dataDir, dbContext.db, store),
      discoverChrome: async () =>
        ({ status: "NOT_FOUND", executablePath: null, version: null, source: "test" })
    };
    const result = await buildSystemReadiness(deps);
    const chrome = result.checks.find((c) => c.id === "chrome")!;
    expect(chrome.status).toBe("ACTION_REQUIRED");
    expect(chrome.blocking).toBe(true);
    expect(result.ready).toBe(false);
  });

  it("missing Chrome without repositories stays optional", async () => {
    const deps = {
      ...baseDeps(dataDir, dbContext.db, new RepositoryStore(dbContext.db)),
      discoverChrome: async () => ({ status: "NOT_FOUND", executablePath: null, version: null, source: "test" })
    };
    const result = await buildSystemReadiness(deps);
    const chrome = result.checks.find((c) => c.id === "chrome")!;
    expect(chrome.status).toBe("OPTIONAL");
    expect(chrome.blocking).toBe(false);
    expect(result.ready).toBe(true);
  });

  it("existing repository paths report READY; missing paths block", async () => {
    const store = new RepositoryStore(dbContext.db);
    const realPath = fs.mkdtempSync(path.join(os.tmpdir(), "orca-real-repo-"));
    try {
      seedRepo(store, { localPath: realPath });
      const ok = await buildSystemReadiness(baseDeps(dataDir, dbContext.db, store));
      expect(ok.checks.find((c) => c.id === "repositories")!.status).toBe("READY");

      seedRepo(store, { displayName: "Ghost", localPath: path.join(os.tmpdir(), "orca-missing-repo-zzz") });
      const bad = await buildSystemReadiness(baseDeps(dataDir, dbContext.db, store));
      const repoCheck = bad.checks.find((c) => c.id === "repositories")!;
      expect(repoCheck.status).toBe("ACTION_REQUIRED");
      expect(repoCheck.blocking).toBe(true);
      expect(repoCheck.detail).toContain("Ghost");
    } finally {
      fs.rmSync(realPath, { recursive: true, force: true });
    }
  });

  it("WSL is never silently optional while WSL repositories exist", async () => {
    const store = new RepositoryStore(dbContext.db);
    seedRepo(store, { localPath: os.tmpdir() });
    seedRepo(store, { localPath: os.tmpdir(), environment: "wsl", wslDistribution: "Ubuntu" });
    const result = await buildSystemReadiness(baseDeps(dataDir, dbContext.db, store));
    const wslCheck = result.checks.find((c) => c.id === "wsl")!;
    if (wslCheck.status === "ACTION_REQUIRED") {
      expect(wslCheck.blocking).toBe(true);
    } else {
      expect(wslCheck.status).toBe("READY");
    }
  });
});

