#!/usr/bin/env node
/**
 * Release version coherence check (Change 026).
 *
 * The root package.json is the single canonical product version. Every
 * workspace manifest and every matching package-lock entry must agree.
 * Exit 0 = coherent; exit 1 = drift (lists each mismatch).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootArgIndex = process.argv.indexOf("--root");
const repoRoot = rootArgIndex >= 0 ? path.resolve(process.argv[rootArgIndex + 1]) : path.resolve(scriptDir, "../..");

const WORKSPACES = ["packages/shared", "apps/controller", "apps/desktop", "apps/ui"];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const problems = [];

const rootPkg = readJson(path.join(repoRoot, "package.json"));
const canonical = rootPkg.version;
if (typeof canonical !== "string" || canonical.length === 0) {
  console.error("version:check: root package.json has no version.");
  process.exit(1);
}

for (const ws of WORKSPACES) {
  const pkgPath = path.join(repoRoot, ws, "package.json");
  if (!fs.existsSync(pkgPath)) {
    problems.push(`${ws}/package.json: missing`);
    continue;
  }
  const pkg = readJson(pkgPath);
  if (pkg.version !== canonical) {
    problems.push(`${ws}/package.json: ${pkg.version} != canonical ${canonical}`);
  }
}

// package-lock coherence: root + every workspace entry must carry the version.
const lockPath = path.join(repoRoot, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = readJson(lockPath);
  if (lock.version !== canonical) {
    problems.push(`package-lock.json (root): ${lock.version} != canonical ${canonical}`);
  }
  const lockPackages = lock.packages ?? {};
  for (const key of ["", ...WORKSPACES.map((w) => `${w}`)]) {
    const entry = lockPackages[key === "" ? "" : key];
    if (entry && typeof entry.version === "string" && entry.version !== canonical) {
      const label = key === "" ? "packages[\"\"]" : `packages["${key}"]`;
      problems.push(`package-lock.json ${label}: ${entry.version} != canonical ${canonical}`);
    }
  }
} else {
  problems.push("package-lock.json: missing");
}

if (problems.length > 0) {
  console.error(`version:check: FAILED — product version drifted from canonical ${canonical}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`version:check: OK (${canonical} coherent across manifests and lockfile).`);
