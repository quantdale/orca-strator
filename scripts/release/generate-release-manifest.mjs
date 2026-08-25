#!/usr/bin/env node
/**
 * Release provenance manifest generator (Change 026).
 *
 *   node scripts/release/generate-release-manifest.mjs \
 *     --artifact <file> [--artifact <file> ...] \
 *     [--build-info apps/desktop/resources/build-info.json] \
 *     [--out <dir>] [--qualification-tier PACKAGE_BUILT]
 *
 * Emits release-manifest.json (machine-readable provenance; no secrets, no
 * machine-local absolute paths) plus SHA256SUMS.txt (standard format). The
 * signing status is DERIVED from actual Authenticode verification of every
 * produced .exe — never from configuration intent.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const artifactArgs = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--artifact") artifactArgs.push(process.argv[i + 1]);
}
const outDir = path.resolve(argValue("--out", path.join(repoRoot, "apps/desktop/release")));
const qualificationTier = argValue("--qualification-tier", "PACKAGE_BUILT");
const buildInfoPath = path.resolve(
  argValue("--build-info", path.join(repoRoot, "apps/desktop/resources/build-info.json"))
);

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function authenticodeStatus(exePath) {
  try {
    return execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `(Get-AuthenticodeSignature -FilePath '${exePath.replace(/'/g, "''")}').Status`],
      { encoding: "utf8" }
    ).trim();
  } catch {
    return "UNVERIFIABLE";
  }
}

// ---- Inputs ----------------------------------------------------------------
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
let buildInfo = {};
try {
  buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
} catch {
  console.error("generate-release-manifest: build-info.json missing — run write-build-info first.");
  process.exit(1);
}

const gitSha = git(["rev-parse", "HEAD"]);
if (buildInfo.commitSha && buildInfo.commitSha !== gitSha) {
  console.error(
    `generate-release-manifest: build-info commit ${buildInfo.commitSha.slice(0, 12)} does not match HEAD ${gitSha.slice(0, 12)}.`
  );
  process.exit(1);
}

const desktopPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "apps/desktop/package.json"), "utf8"));
const electronVersion = desktopPkg.devDependencies?.electron ?? "unknown";

// Protocol version parsed strictly from shared source (single source of truth).
const productSource = fs.readFileSync(path.join(repoRoot, "packages/shared/src/product.ts"), "utf8");
const protocolMatch = productSource.match(/ORCA_PROTOCOL_VERSION = (\d+)/);
if (!protocolMatch) {
  console.error("generate-release-manifest: cannot parse ORCA_PROTOCOL_VERSION.");
  process.exit(1);
}

// ---- Artifacts --------------------------------------------------------------
const artifacts = [];
for (const candidate of artifactArgs) {
  const resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    console.error(`generate-release-manifest: artifact not found: ${candidate}`);
    process.exit(1);
  }
  artifacts.push({
    filename: path.basename(resolved),
    bytes: fs.statSync(resolved).size,
    sha256: sha256File(resolved),
    path: resolved
  });
}
if (artifacts.length === 0) {
  console.error("generate-release-manifest: no --artifact inputs provided.");
  process.exit(1);
}

// ---- Derived signing truth ---------------------------------------------------
const exeArtifacts = artifacts.filter((a) => a.filename.toLowerCase().endsWith(".exe"));
let signingStatus = "UNSIGNED";
if (exeArtifacts.length > 0) {
  const statuses = exeArtifacts.map((a) => ({ file: a.filename, status: authenticodeStatus(a.path) }));
  if (statuses.every((s) => s.status === "Valid")) {
    signingStatus = "SIGNED";
  } else {
    signingStatus = "UNSIGNED";
    for (const s of statuses) {
      console.log(`  signature[${s.file}] = ${s.status}`);
    }
  }
} else {
  signingStatus = "UNSIGNED"; // no executable payload to verify
}

// ---- CI provenance (runner-provided only; never machine-local paths) --------
const ci =
  process.env.GITHUB_RUN_ID &&
  process.env.GITHUB_REPOSITORY === git(["config", "--get", "remote.origin.url"]).replace(/.*github\.com[:/]/, "").replace(/\.git$/, "")
    ? {
        workflow: process.env.GITHUB_WORKFLOW,
        runId: process.env.GITHUB_RUN_ID,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        repository: process.env.GITHUB_REPOSITORY
      }
    : undefined;

const manifest = {
  kind: "orca-release-provenance",
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  productName: "Orca-Strator",
  semanticVersion: rootPkg.version,
  gitCommitSha: gitSha,
  protocolVersion: Number(protocolMatch[1]),
  maxDbSchemaVersion: buildInfo.maxDbSchemaVersion ?? null,
  architecture: argValue("--arch", "x64"),
  electronVersion,
  nodeVersion: process.version,
  signingStatus,
  artifacts: artifacts.map(({ filename, bytes, sha256 }) => ({ filename, bytes, sha256 })),
  qualificationTier,
  sourceRepository: git(["config", "--get", "remote.origin.url"]),
  ...(ci ? { ci } : {})
};

fs.mkdirSync(outDir, { recursive: true });

const manifestPath = path.join(outDir, "release-manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

// Standard checksums file covering every artifact + the manifest itself.
const checksumLines = artifacts.map((a) => `${a.sha256}  ${a.filename}`);
checksumLines.push(`${sha256File(manifestPath)}  release-manifest.json`);
const sumsPath = path.join(outDir, "SHA256SUMS.txt");
fs.writeFileSync(sumsPath, checksumLines.join("\n") + "\n", "utf8");

console.log(`generate-release-manifest: ${manifestPath}`);
console.log(`generate-release-manifest: ${sumsPath}`);
console.log(`  version=${manifest.semanticVersion} commit=${gitSha.slice(0, 12)} signing=${signingStatus} tier=${qualificationTier}`);
