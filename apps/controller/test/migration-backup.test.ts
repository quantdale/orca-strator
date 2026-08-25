import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { migrations, runMigrations } from "../src/db/migrate.js";
import {
  createPreMigrationSnapshot,
  enforceRetention,
  MigrationBackupFailedError
} from "../src/db/migration-backup.js";
import { MAX_KNOWN_SCHEMA_VERSION } from "../src/db/schema-compat.js";

describe("Change 026 pre-migration recovery snapshots", () => {
  let tempDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-migration-backup-"));
    dbPath = path.join(tempDir, "orca.db");
    backupDir = path.join(tempDir, "backups", "pre-migration");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeOldDatabase(): void {
    const oldMigrations = migrations.slice(0, -1);
    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db, oldMigrations);
    } finally {
      db.close();
    }
  }

  it("creates a verified consistent snapshot with complete metadata before migration", () => {
    makeOldDatabase();

    const meta = createPreMigrationSnapshot({
      dbPath,
      backupDir,
      sourceSchemaVersion: MAX_KNOWN_SCHEMA_VERSION - 1,
      targetSchemaVersion: MAX_KNOWN_SCHEMA_VERSION,
      applicationVersion: "0.1.0"
    });

    expect(fs.existsSync(path.join(backupDir, meta.file))).toBe(true);
    expect(meta.kind).toBe("orca-pre-migration-snapshot");
    expect(meta.sourceSchemaVersion).toBe(MAX_KNOWN_SCHEMA_VERSION - 1);
    expect(meta.targetSchemaVersion).toBe(MAX_KNOWN_SCHEMA_VERSION);
    expect(meta.applicationVersion).toBe("0.1.0");
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.bytes).toBeGreaterThan(0);

    // Sidecar metadata exists and matches.
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(backupDir, `${meta.file}.meta.json`), "utf8")
    );
    expect(sidecar.sha256).toBe(meta.sha256);

    // The snapshot opens and passes integrity verification.
    const verify = new DatabaseSync(path.join(backupDir, meta.file), { readOnly: true });
    try {
      const check = verify.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      expect(check[0]?.quick_check).toBe("ok");
      const rows = verify.prepare("SELECT MAX(version) AS v FROM schema_migrations").all() as {
        v: number;
      }[];
      expect(rows[0].v).toBe(MAX_KNOWN_SCHEMA_VERSION - 1); // snapshot is pre-migration state
    } finally {
      verify.close();
    }
  });

  it("retention keeps only the newest N snapshots", () => {
    makeOldDatabase();
    for (let i = 0; i < 7; i++) {
      createPreMigrationSnapshot({
        dbPath,
        backupDir,
        sourceSchemaVersion: MAX_KNOWN_SCHEMA_VERSION - 1,
        targetSchemaVersion: MAX_KNOWN_SCHEMA_VERSION,
        applicationVersion: "0.1.0"
      });
    }
    const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db"));
    expect(remaining.length).toBeLessThanOrEqual(5);
    enforceRetention(backupDir, 2);
    expect(fs.readdirSync(backupDir).filter((f) => f.endsWith(".db")).length).toBe(2);
  });

  it("fails closed (typed error) when the snapshot cannot be created and cleans partials", () => {
    makeOldDatabase();
    // A FILE where a directory component is required makes every snapshot
    // write fail deterministically.
    const blocker = path.join(tempDir, "blocker.db");
    fs.writeFileSync(blocker, "this is a file, not a directory");
    const blockedDir = path.join(blocker, "pre-migration");

    let caught: unknown;
    try {
      createPreMigrationSnapshot({
        dbPath,
        backupDir: blockedDir,
        sourceSchemaVersion: 22,
        targetSchemaVersion: 23,
        applicationVersion: "0.1.0"
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MigrationBackupFailedError);
    expect((caught as Error).message).toContain("PRE_MIGRATION_BACKUP_FAILED");

    // Source DB untouched.
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
