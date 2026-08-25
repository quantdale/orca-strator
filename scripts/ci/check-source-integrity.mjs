#!/usr/bin/env node
/**
 * Repository source-truth integrity guard.
 *
 * Fails when a relative import inside tracked TypeScript source resolves to a
 * file that is missing from disk, ignored by .gitignore, or otherwise not
 * tracked in Git. This guards against the P0 defect class where an unanchored
 * `.gitignore` rule (`runtime/`) suppressed `apps/controller/src/runtime/**`
 * while committed code imported it: every local check stayed green because
 * ignored files rescued the build, but a fresh clone of the pushed repository
 * could not compile.
 *
 * Dependency-free; safe to run from any clean checkout.
 * Exit 0 = coherent, exit 1 = at least one required production source is not
 * Git truth.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8"
}).trim();

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd: repoRoot });
  } catch {
    return "";
  }
}

/**
 * Tracked files whose relative imports must resolve to Git truth.
 * ":(glob)" gives ** real recursive semantics (zero or more directories),
 * so sources sitting DIRECTLY under src/ are scanned too.
 */
const SCAN_GLOBS = [
  ":(glob)packages/*/src/**/*.ts",
  ":(glob)packages/*/test/**/*.ts",
  ":(glob)apps/*/src/**/*.ts",
  ":(glob)apps/*/test/**/*.ts"
];

function listTrackedSources() {
  return git(["ls-files", "--", ...SCAN_GLOBS])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip line + block comments so prose can never fake an import. */
function stripComments(sourceText) {
  return sourceText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function extractRelativeImports(sourceText) {
  const text = stripComments(sourceText);
  const found = new Set();
  const patterns = [
    /\bfrom\s*['"](\.[^'"]+)['"]/g,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /(?:^|\n)[ \t]*import\s*['"](\.[^'"]+)['"]/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return [...found];
}

/**
 * Resolve every candidate exactly as Node ESM + TypeScript would, including
 * the TS convention where "./x.js" may mean "./x.ts".
 */
function resolveCandidates(importerRelFile, spec) {
  const importerPosix = importerRelFile.split(path.sep).join("/");
  const base = path.posix.join(path.posix.dirname(importerPosix), spec);
  if (/\.(js|mjs|cjs|json)$/.test(base)) {
    const candidates = [base];
    if (base.endsWith(".js")) {
      candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
    }
    return candidates;
  }
  if (/\.(ts|tsx)$/.test(base)) return [base];
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}/index.ts`,
    `${base}/index.js`
  ];
}

const trackedSet = new Set(
  git(["ls-files"]).split("\n").map((s) => s.trim()).filter(Boolean)
);

const failures = [];
let checkedFiles = 0;
let checkedImports = 0;
const suspects = new Map(); // relPath -> { file, spec }

for (const relFile of listTrackedSources()) {
  const abs = path.join(repoRoot, relFile);
  if (!fs.existsSync(abs)) {
    failures.push({ file: relFile, spec: "(file itself)", reason: "tracked in index but absent on disk" });
    continue;
  }
  checkedFiles += 1;
  const text = fs.readFileSync(abs, "utf8");
  for (const spec of extractRelativeImports(text)) {
    checkedImports += 1;
    const candidates = resolveCandidates(relFile, spec);
    const present = candidates.filter((c) => fs.existsSync(path.join(repoRoot, c)));
    if (present.length === 0) {
      failures.push({
        file: relFile,
        spec,
        reason: `resolves to none of: ${candidates.join(", ")}`
      });
      continue;
    }
    const winner = present[0].split(path.sep).join("/");
    if (!trackedSet.has(winner)) {
      failures.push({ file: relFile, spec, reason: "", _suspect: winner });
      suspects.set(winner, failures[failures.length - 1]);
    }
  }
}

if (suspects.size > 0) {
  // Authoritative ignore classification straight from Git.
  let out = "";
  try {
    out = execFileSync("git", ["check-ignore", "--stdin"], {
      encoding: "utf8",
      cwd: repoRoot,
      input: [...suspects.keys()].join("\n")
    });
  } catch (err) {
    // exit code 1 = none ignored; other codes also mean no matches printed.
    out = err && typeof err.stdout === "string" ? err.stdout : "";
  }
  const ignoredSet = new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
  for (const f of failures) {
    if (!f._suspect) continue;
    f.reason = ignoredSet.has(f._suspect)
      ? `${f._suspect} exists locally but is IGNORED_BY_GITIGNORE; a fresh clone will not have it`
      : `${f._suspect} exists locally but is UNTRACKED; a fresh clone will not have it`;
    delete f._suspect;
  }
}

if (failures.length > 0) {
  console.error(`source-integrity: ${failures.length} broken relative import(s):`);
  for (const f of failures) {
    console.error(`  ${f.file}: "${f.spec}" -> ${f.reason}`);
  }
  process.exit(1);
}

console.log(
  `source-integrity: OK — ${checkedFiles} tracked source files, ${checkedImports} relative imports all resolve to Git-tracked modules`
);
