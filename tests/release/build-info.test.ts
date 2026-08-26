import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Change 026 §7.3 unit tier: build-info plumbing. Runs the real
 * write-build-info script against a temp output dir (never mutating packaged
 * resources in this tree) and proves the identity fields the desktop
 * supervisor, controller build-identity resolution, and release-manifest
 * generator all correlate on. Harness-level artifact correlation is covered
 * separately by package-smoke and upgrade-preservation.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRITE_BUILD_INFO = path.join(repoRoot, "scripts/release/write-build-info.mjs");

let outDir: string;

function gitHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-build-info-"));
  execFileSync(process.execPath, [WRITE_BUILD_INFO, "--out", outDir], {
    cwd: repoRoot,
    encoding: "utf8"
  });
});

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("Change 026 build-info stamping (unit tier)", () => {
  const info = () => JSON.parse(fs.readFileSync(path.join(outDir, "build-info.json"), "utf8")) as Record<string, unknown>;

  it("stamps a well-formed identity document", () => {
    const parsed = info();
    expect(parsed.kind).toBe("orca-build-info");
    expect(typeof parsed.version).toBe("string");
    expect(parsed.commitSha).toMatch(/^[0-9a-f]{40}$/i);
    expect(Number.isInteger(parsed.maxDbSchemaVersion)).toBe(true);
    expect(Number.isInteger(parsed.protocolVersion)).toBe(true);
  });

  it("correlates with the canonical product version and exact Git HEAD", () => {
    const rootVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version as string;
    const parsed = info();
    expect(parsed.version).toBe(rootVersion);
    expect(parsed.commitSha).toBe(gitHead());
  });

  it("derives max DB schema and protocol from source truth, not literals", () => {
    const migrateSource = fs.readFileSync(path.join(repoRoot, "apps/controller/src/db/migrate.ts"), "utf8");
    const maxSchema = Math.max(...[...migrateSource.matchAll(/^\s{4}version:\s*(\d+),$/gm)].map((m) => Number(m[1])));
    const productSource = fs.readFileSync(path.join(repoRoot, "packages/shared/src/product.ts"), "utf8");
    const protocol = Number(productSource.match(/ORCA_PROTOCOL_VERSION = (\d+)/)?.[1]);

    const parsed = info();
    expect(parsed.maxDbSchemaVersion).toBe(maxSchema);
    expect(parsed.protocolVersion).toBe(protocol);
  });

  it("excludes wall-clock identity by contract", () => {
    const keys = Object.keys(info());
    for (const key of keys) {
      expect(/(time|date|stamp|at)$/i.test(key)).toBe(false);
    }
  });
});
