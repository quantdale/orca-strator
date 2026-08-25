#!/usr/bin/env node
/**
 * Stamp immutable build identity into packaged resources (Change 026).
 *
 *   node scripts/release/write-build-info.mjs [--out apps/desktop/resources]
 *
 * Writes build-info.json {version, commitSha, maxDbSchemaVersion} consumed by:
 *  - the desktop supervisor (exact-build pairing + ORCA_BUILD_COMMIT env);
 *  - generate-release-manifest.mjs (identity <-> manifest correlation).
 * Wall-clock timestamps are deliberately excluded from identity.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const argOut = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : path.join(repoRoot, "apps/desktop/resources");

const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

let commitSha;
try {
  commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim();
} catch {
  console.error("write-build-info: unable to resolve Git HEAD; refusing to fabricate identity.");
  process.exit(1);
}
if (!/^[0-9a-f]{40}$/i.test(commitSha ?? "")) {
  console.error(`write-build-info: "${commitSha}" is not a full commit SHA.`);
  process.exit(1);
}

// Highest DB schema the controller knows, parsed strictly from migrate.ts so
// the ceiling in build-info can never silently diverge from shipped migrations.
const migrateSource = fs.readFileSync(
  path.join(repoRoot, "apps/controller/src/db/migrate.ts"),
  "utf8"
);
const versions = [...migrateSource.matchAll(/^\s{4}version:\s*(\d+),$/gm)].map((m) =>
  Number(m[1])
);
if (versions.length === 0) {
  console.error("write-build-info: could not parse any migration versions from migrate.ts.");
  process.exit(1);
}
const maxDbSchemaVersion = Math.max(...versions);

const protocolMatch = fs
  .readFileSync(path.join(repoRoot, "packages/shared/src/product.ts"), "utf8")
  .match(/ORCA_PROTOCOL_VERSION = (\d+)/);
if (!protocolMatch) {
  console.error("write-build-info: could not parse ORCA_PROTOCOL_VERSION.");
  process.exit(1);
}

const info = {
  kind: "orca-build-info",
  version: rootPkg.version,
  commitSha,
  maxDbSchemaVersion,
  protocolVersion: Number(protocolMatch[1])
};

fs.mkdirSync(argOut, { recursive: true });
const outPath = path.join(argOut, "build-info.json");
fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + "\n", "utf8");
console.log(`write-build-info: ${outPath}`);
console.log(`  version=${info.version} commit=${info.commitSha.slice(0, 12)} maxSchema=${info.maxDbSchemaVersion}`);
