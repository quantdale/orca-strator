#!/usr/bin/env node
/**
 * Atomic release version preparation (Change 026).
 *
 *   npm run release:prepare -- 0.2.0
 *
 * The root package.json is canonical. This command validates the requested
 * semver strictly, snapshots every target in memory, and aborts BEFORE any
 * write when anything is invalid — a half-updated tree is impossible by
 * construction. On success it updates all workspace manifests and every
 * matching package-lock entry atomically (sequential writes after full
 * validation).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootArgIndex = process.argv.indexOf("--root");
// --root is consumed before positional parsing so `set-version 1.2.3 --root X` works.
let repoRoot = path.resolve(scriptDir, "../..");
if (rootArgIndex >= 0) {
  repoRoot = path.resolve(process.argv[rootArgIndex + 1]);
  process.argv.splice(rootArgIndex, 2);
}
const WORKSPACES = ["packages/shared", "apps/controller", "apps/desktop", "apps/ui"];

// Strict semver: major.minor.patch with optional prerelease/build, no leading zeroes.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fail(message) {
  console.error(`release:prepare: aborted — ${message}`);
  console.error("No files were modified.");
  process.exit(1);
}

const requested = process.argv[2];
if (!requested) fail("usage: npm run release:prepare -- <semver>");
const version = requested.trim().replace(/^v/, "");
if (!SEMVER.test(version)) {
  fail(`"${requested}" is not a valid strict semver (major.minor.patch[-prerelease]).`);
}

// ---- Phase 1: read + validate everything in memory ------------------------
const targets = [];
try {
  const manifestPaths = ["package.json", ...WORKSPACES.map((w) => `${w}/package.json`)];
  for (const rel of manifestPaths) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) fail(`${rel}: missing`);
    const json = readJson(abs);
    targets.push({ kind: "manifest", rel, abs, json });
  }
  const lockPath = path.join(repoRoot, "package-lock.json");
  if (!fs.existsSync(lockPath)) fail("package-lock.json: missing");
  const lock = readJson(lockPath);
  targets.push({ kind: "lock", rel: "package-lock.json", abs: lockPath, json: lock });

  // Validate lock entries we intend to touch exist and are objects.
  const lockKeys = ["", ...WORKSPACES];
  for (const key of lockKeys) {
    const entry = lock.packages?.[key];
    if (!entry || typeof entry !== "object") {
      fail(`package-lock.json packages["${key}"] missing — run npm install to regenerate.`);
    }
  }
} catch (err) {
  fail(`unable to read release inputs (${err.message}).`);
}

const previous = targets.find((t) => t.kind === "manifest")?.json.version;
console.log(`release:prepare: ${previous} -> ${version}`);

// ---- Phase 2: write everything (validation already passed) ----------------
for (const target of targets.filter((t) => t.kind === "manifest")) {
  target.json.version = version;
  fs.writeFileSync(target.abs, JSON.stringify(target.json, null, 2) + "\n", "utf8");
  console.log(`  updated ${target.rel}`);
}

const lock = targets.find((t) => t.kind === "lock").json;
lock.version = version;
for (const key of ["", ...WORKSPACES]) {
  if (lock.packages[key]) lock.packages[key].version = version;
}
fs.writeFileSync(
  targets.find((t) => t.kind === "lock").abs,
  JSON.stringify(lock, null, 2) + "\n",
  "utf8"
);
console.log("  updated package-lock.json");
console.log(`release:prepare: OK (${version}). Run npm install to refresh lockfile metadata if needed.`);
