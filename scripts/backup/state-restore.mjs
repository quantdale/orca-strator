#!/usr/bin/env node
/**
 * Orca durable-state restore CLI (Change 026).
 *
 *   node scripts/backup/state-restore.mjs --bundle <bundleDir> --data-dir <dir>
 *
 * Validates the bundle (format, entry allowlist, SHA-256 checksums, schema
 * compatibility), refuses while a live controller owns the target data
 * directory, preserves the replaced state as a recovery copy, then installs
 * the verified image.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const bundleDir = argValue("--bundle");
const dataDir = argValue("--data-dir");
if (!bundleDir || !dataDir) {
  console.error("usage: state-restore.mjs --bundle <orcaBackupBundle> --data-dir <orcaDataDir>");
  process.exit(1);
}

let mod;
try {
  mod = await import(
    pathToFileURL(path.join(repoRoot, "apps/controller/dist/runtime/state-backup.js")).href
  );
} catch {
  console.error("state-restore: controller runtime not built. Run: npm run build:controller");
  process.exit(1);
}
const { restoreStateBackup } = mod;

// The restore downgrade guard uses the same ceiling as the controller binary.
let maxKnownSchemaVersion = 0;
try {
  const schemaMod = await import(
    pathToFileURL(path.join(repoRoot, "apps/controller/dist/db/schema-compat.js")).href
  );
  maxKnownSchemaVersion = schemaMod.MAX_KNOWN_SCHEMA_VERSION;
} catch {
  console.error("state-restore: controller runtime not built. Run: npm run build:controller");
  process.exit(1);
}

try {
  const result = mod.restoreStateBackup({ bundleDir: path.resolve(bundleDir), dataDir: path.resolve(dataDir), maxKnownSchemaVersion });
  console.log(`state-restore: restored ${result.restoredFrom}`);
  console.log(`  schema=${result.restoredSchemaVersion}`);
  console.log(`  recovery copy of previous state: ${result.recoveryCopyDir}`);
} catch (err) {
  console.error(`state-restore: FAILED (${err.reason ?? "error"}): ${err.message}`);
  process.exit(1);
}
