#!/usr/bin/env node
/**
 * Tag / version integrity gate (Change 026).
 *
 *   node scripts/release/verify-tag.mjs v1.2.3 [--allow-dirty]
 *
 * A release tag vX.Y.Z must exactly match the canonical product version; the
 * tree must be clean and package metadata coherent. Any mismatch fails BEFORE
 * artifacts are built — a tag named v1.2.3 against version 1.2.4 can never
 * produce a release, and release jobs never rewrite version metadata.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const allowDirty = process.argv.includes("--allow-dirty");

const tag = process.argv[2];
if (!tag) {
  console.error("verify-tag: usage: verify-tag.mjs <tag> [--allow-dirty]");
  process.exit(1);
}
const m = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-.+)?$/.exec(tag);
if (!m) {
  console.error(`verify-tag: "${tag}" is not a vX.Y.Z release tag.`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const canonical = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
if (tag !== `v${canonical}`) {
  console.error(`verify-tag: FAILED — tag ${tag} does not match canonical product version ${canonical}.`);
  process.exit(1);
}

if (!allowDirty) {
  const status = git(["status", "--porcelain"]);
  if (status.length > 0) {
    console.error("verify-tag: FAILED — working tree is dirty; refusing to build a release from it.");
    process.exit(1);
  }
}

console.log(`verify-tag: OK (${tag} == product version ${canonical}, tree clean).`);
