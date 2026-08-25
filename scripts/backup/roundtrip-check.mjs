#!/usr/bin/env node
/**
 * Backup/restore round-trip gate (Change 026).
 *
 *   node scripts/backup/roundtrip-check.mjs
 *
 * Builds a synthetic durable state in a temp data dir, creates a real bundle
 * through the production module, corrupts nothing, restores into a second
 * data dir, verifies integrity + record counts. Exit 0 = BACKUP_RESTORE
 * pipeline mechanically sound (unit suites cover tamper/traversal cases).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = (rel) => pathToFileURL(path.join(repoRoot, "apps/controller/dist", rel)).href;

let backupMod, schemaMod;
try {
  backupMod = await import(dist("runtime/state-backup.js"));
  schemaMod = await import(dist("db/schema-compat.js"));
} catch {
  console.error("roundtrip: controller runtime not built. Run: npm run build:controller");
  process.exit(1);
}

const { DatabaseSync } = await import("node:sqlite");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "orca-backup-roundtrip-"));
const sourceData = path.join(work, "source");
const restoreData = path.join(work, "restored");
fs.mkdirSync(sourceData, { recursive: true });
fs.mkdirSync(restoreData, { recursive: true });

function seed(dataDir, markerName) {
  const db = new DatabaseSync(path.join(dataDir, backupMod.ORCA_DB_FILENAME));
  try {
    const migrationsMod = null; // migrations already implied by schema version below
    void migrationsMod;
    // Minimal durable-looking schema + row.
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      schemaMod.MAX_KNOWN_SCHEMA_VERSION,
      "synthetic",
      new Date().toISOString()
    );
    db.exec("CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, display_name TEXT NOT NULL)");
    db.prepare("INSERT INTO repositories (id, display_name) VALUES (?, ?)").run("r1", markerName);
  } finally {
    db.close();
  }
}

try {
  seed(sourceData, "RoundTrip Fixture");
  const created = backupMod.createStateBackup({
    dbPath: path.join(sourceData, backupMod.ORCA_DB_FILENAME),
    outDir: path.join(work, "backups"),
    applicationVersion: JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version
  });
  console.log(`roundtrip: bundle ${created.bundleDir}`);

  const result = backupMod.restoreStateBackup({
    bundleDir: created.bundleDir,
    dataDir: restoreData,
    maxKnownSchemaVersion: schemaMod.MAX_KNOWN_SCHEMA_VERSION
  });

  const verify = new DatabaseSync(path.join(restoreData, backupMod.ORCA_DB_FILENAME), { readOnly: true });
  try {
    const rows = verify.prepare("SELECT COUNT(*) AS n FROM repositories WHERE display_name = 'RoundTrip Fixture'").all();
    if (rows[0].n !== 1) throw new Error("marker row missing after restore");
    const integrity = verify.prepare("PRAGMA integrity_check").all();
    if (integrity[0]?.integrity_check !== "ok") throw new Error(`integrity=${integrity[0]?.integrity_check}`);
  } finally {
    verify.close();
  }
  console.log(`roundtrip: OK (recovery copy at ${result.recoveryCopyDir})`);
  process.exit(0);
} catch (err) {
  console.error(`roundtrip: FAILED (${err.reason ?? "error"}): ${err.message}`);
  process.exit(1);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
