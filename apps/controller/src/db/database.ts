import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, migrations } from './migrate.js';
import {
  MAX_KNOWN_SCHEMA_VERSION,
  preflightSchemaCompatibility,
  readAppliedSchemaVersion,
} from './schema-compat.js';
import { createPreMigrationSnapshot } from './migration-backup.js';

export interface DatabaseContext {
  db: DatabaseSync;
  close: () => void;
}

function resolveApplicationVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
  } catch {
    /* truthful fallback below */
  }
  return '0.0.0-unknown';
}

export function initDatabase(dbPath: string, options?: { backupDir?: string }): DatabaseContext {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Change 026: strict forward-compatibility preflight BEFORE any pragma,
  // migration, or service touches the database. Refusal leaves it untouched
  // and closes this connection so no file handles are held on refusal.
  try {
    preflightSchemaCompatibility(db, MAX_KNOWN_SCHEMA_VERSION);
  } catch (err) {
    try { db.close(); } catch { /* already closed */ }
    throw err;
  }

  // Enable WAL and foreign keys
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Change 026: protect an existing persistent database with a verified
  // recovery snapshot before applying schema-changing migrations. A brand-new
  // (never-migrated) database has nothing to lose and skips snapshots.
  const currentSchema = readAppliedSchemaVersion(db);
  const pendingMigrations =
    currentSchema > 0 && dbPath !== ':memory:'
      ? migrations.filter((m) => m.version > currentSchema)
      : [];
  if (pendingMigrations.length > 0) {
    createPreMigrationSnapshot({
      dbPath,
      backupDir:
        options?.backupDir ?? path.join(path.dirname(dbPath), 'backups', 'pre-migration'),
      sourceSchemaVersion: currentSchema,
      targetSchemaVersion: Math.max(...pendingMigrations.map((m) => m.version)),
      applicationVersion: resolveApplicationVersion(),
    });
  }

  runMigrations(db);

  return {
    db,
    close: () => {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  };
}
