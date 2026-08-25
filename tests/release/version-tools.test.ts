import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Change 026 release-tooling tests. Each case runs the real scripts against a
 * synthetic repository fixture in a temp directory (never mutating this repo's
 * own version metadata).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERSION_CHECK = path.join(repoRoot, "scripts/release/version-check.mjs");
const SET_VERSION = path.join(repoRoot, "scripts/release/set-version.mjs");

interface Fixture {
  root: string;
}

function makeVersionFixture(rootVersion: string, workspaces: Record<string, string>): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orca-version-fixture-"));
  const write = (rel: string, json: unknown) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(json, null, 2) + "\n", "utf8");
  };
  const lockPackages: Record<string, { version?: string }> = {
    "": { version: rootVersion },
    ...Object.fromEntries(Object.keys(workspaces).map((w) => [w, { version: workspaces[w] }]))
  };
  write("package.json", { name: "fixture", version: rootVersion });
  for (const [ws, v] of Object.entries(workspaces)) {
    write(`${ws}/package.json`, { name: ws, version: v });
  }
  write("package-lock.json", {
    name: "fixture",
    version: rootVersion,
    packages: lockPackages
  });
  return { root };
}

function runScript(script: string, args: string[], cwd: string): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8"
    });
    return { status: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

let coherent: Fixture;
let drifted: Fixture;

beforeAll(() => {
  coherent = makeVersionFixture("1.4.5", {
    "packages/shared": "1.4.5",
    "apps/controller": "1.4.5",
    "apps/desktop": "1.4.5",
    "apps/ui": "1.4.5"
  });
  drifted = makeVersionFixture("1.4.5", {
    "packages/shared": "1.4.5",
    "apps/controller": "9.9.9",
    "apps/desktop": "1.4.5",
    "apps/ui": "1.4.5"
  });
});

describe("Change 026 release versioning tools", () => {
  it("version-check passes a coherent tree and detects drift precisely", () => {
    expect(runScript(VERSION_CHECK, ["--root", coherent.root], repoRoot).status).toBe(0);

    const driftedRun = runScript(VERSION_CHECK, ["--root", drifted.root], repoRoot);
    expect(driftedRun.status).toBe(1);
    expect(driftedRun.out).toContain("apps/controller/package.json: 9.9.9 != canonical 1.4.5");
  });

  it("release:prepare updates every manifest + lock atomically on valid input", () => {
    const result = runScript(
      SET_VERSION,
      ["2.0.0", "--root", coherent.root],
      repoRoot
    );
    expect(result.status).toBe(0);

    const read = (rel: string) =>
      JSON.parse(fs.readFileSync(path.join(coherent.root, rel), "utf8")).version as string;
    expect(read("package.json")).toBe("2.0.0");
    for (const ws of ["packages/shared", "apps/controller", "apps/desktop", "apps/ui"]) {
      expect(read(`${ws}/package.json`)).toBe("2.0.0");
    }
    const lock = JSON.parse(fs.readFileSync(path.join(coherent.root, "package-lock.json"), "utf8"));
    expect(lock.version).toBe("2.0.0");
    expect(lock.packages[""].version).toBe("2.0.0");
    expect(lock.packages["apps/ui"].version).toBe("2.0.0");

    // The updated tree passes the coherence gate.
    expect(runScript(VERSION_CHECK, ["--root", coherent.root], repoRoot).status).toBe(0);
  });

  it("release:prepare aborts without writing on invalid semver", () => {
    const before = fs.readFileSync(path.join(drifted.root, "package.json"), "utf8");
    const result = runScript(SET_VERSION, ["not-a-version", "--root", drifted.root], repoRoot);
    expect(result.status).toBe(1);
    expect(result.out).toContain("No files were modified");
    expect(fs.readFileSync(path.join(drifted.root, "package.json"), "utf8")).toBe(before);
  });

  it("release:prepare rejects loose versions", () => {
    for (const bad of ["01.2.3", "1.2", "1.2.3.4", "latest"]) {
      const result = runScript(SET_VERSION, [bad, "--root", drifted.root], repoRoot);
      expect(result.status).toBe(1);
    }
  });

  it("this repository itself is currently coherent (canonical 0.1.0)", () => {
    expect(runScript(VERSION_CHECK, [], repoRoot).status).toBe(0);
  });
});
