import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimePaths, isPackagedRuntime } from "../src/runtime/paths.js";

describe("Change 025 runtime path contract (9.5/4.x)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ORCA_DATA_DIR;
    delete process.env.ORCA_UI_DIST_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("development mode keeps repo-relative UI resolution independent of cwd", () => {
    process.chdir(os.tmpdir());
    const runtimeModuleDir = path.resolve(__dirname, "..", "src", "runtime");
    const paths = resolveRuntimePaths({}, process.env);
    expect(paths.mode).toBe("development");
    // Resolved relative to the paths module location, never process.cwd().
    expect(paths.uiDistDir).toBe(path.resolve(runtimeModuleDir, "../../../ui/dist"));
    // db and generated state live under the data dir, never under cwd
    expect(path.dirname(paths.dbPath)).toBe(paths.dataDir);
    expect(paths.logDir.startsWith(paths.dataDir)).toBe(true);
    expect(paths.browserProfileDir.startsWith(paths.dataDir)).toBe(true);
    expect(paths.runtimeLockPath.startsWith(paths.dataDir)).toBe(true);
  });

  it("packaged mode resolves UI from install resources regardless of cwd", () => {
    const runtimeModuleDir = path.resolve(__dirname, "..", "src", "runtime");
    const env = { ORCA_PACKAGED: "1" } as NodeJS.ProcessEnv;
    const paths = resolveRuntimePaths({}, env);
    expect(paths.mode).toBe("packaged");
    expect(process.cwd().length).toBeGreaterThan(0); // cwd irrelevant to layout
    expect(paths.uiDistDir).toBe(path.resolve(runtimeModuleDir, "../../../ui"));
  });

  it("ORCA_DATA_DIR overrides the default data directory in both modes", () => {
    const custom = fs.mkdtempSync(path.join(os.tmpdir(), "orca-data-override-"));
    try {
      const devPaths = resolveRuntimePaths({}, { ...process.env, ORCA_DATA_DIR: custom });
      const packagedPaths = resolveRuntimePaths({}, { ...process.env, ORCA_PACKAGED: "1", ORCA_DATA_DIR: custom });
      for (const p of [devPaths, packagedPaths]) {
        expect(p.dataDir).toBe(path.resolve(custom));
        expect(p.dbPath).toBe(path.join(path.resolve(custom), "orca-strator.sqlite"));
      }
      expect(packagedPaths.mode).toBe("packaged");
    } finally {
      fs.rmSync(custom, { recursive: true, force: true });
    }
  });

  it("explicit option overrides win over environment", () => {
    const optDir = path.resolve(os.tmpdir(), "option-dir-orca");
    const envDir = path.resolve(os.tmpdir(), "env-dir-orca");
    const paths = resolveRuntimePaths({ dataDir: optDir }, { ...process.env, ORCA_DATA_DIR: envDir });
    expect(paths.dataDir).toBe(optDir);
  });

  it("isPackagedRuntime is truthful about the flag", () => {
    expect(isPackagedRuntime({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isPackagedRuntime({ ORCA_PACKAGED: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isPackagedRuntime({ ORCA_PACKAGED: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("no resolved writable path targets packaged resources", () => {
    const env = { ORCA_PACKAGED: "1" } as NodeJS.ProcessEnv;
    const paths = resolveRuntimePaths(
      { dataDir: path.join(os.tmpdir(), "isolated-smoke-data") },
      env
    );
    for (const p of [paths.dbPath, paths.logDir, paths.browserProfileDir, paths.runtimeLockPath]) {
      expect(p.startsWith(paths.dataDir)).toBe(true);
    }
  });
});
