#!/usr/bin/env node
/**
 * Orca durable-state backup CLI (Change 026).
 *
 *   node scripts/backup/state-backup.mjs --data-dir <dir> --out <dir>
 *
 * Creates a verified backup bundle (manifest + checksummed SQLite image) of
 * Orca's durable application state. Structurally excludes browser profiles/
 * cookies, executor credentials, repositories, worktrees, runtime locks, and
 * logs — only permitted payload can ever be written.
 */
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dataDir = argValue("--data-dir");
const outDir = argValue("--out");
if (!dataDir || !outDir) {
  console.error("usage: state-backup.mjs --data-dir <orcaDataDir> --out <backupTargetDir>");
  process.exit(1);
}

let mod;
try {
  mod = await import(
    pathToFileURL(path.join(repoRoot, "apps/controller/dist/runtime/state-backup.js")).href
  );
} catch {
  console.error("state-backup: controller runtime not built. Run: npm run build:controller");
  process.exit(1);
}
const { createStateBackup, ORCA_DB_FILENAME } = mod;

const rootPkg = (await import(pathToFileURL(path.join(repoRoot, "package.json")).href)).default;
try {
  const { bundleDir, manifest } = createStateBackup({
    dbPath: path.join(dataDir, ORCA_DB_FILENAME),
    outDir,
    applicationVersion: rootPkg.version
  });
  console.log(`state-backup: created ${bundleDir}`);
  console.log(`  appVersion=${manifest.applicationVersion} schema=${manifest.sourceSchemaVersion}`);
  for (const f of manifest.files) {
    console.log(`  ${f.path} bytes=${f.bytes} sha256=${f.sha256}`);
  }
} catch (err) {
  console.error(`state-backup: FAILED (${err.reason ?? "error"}): ${err.message}`);
  process.exit(1);
}
