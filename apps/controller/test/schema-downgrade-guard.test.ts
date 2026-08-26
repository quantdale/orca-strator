import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { initDatabase } from "../src/db/database.js";
import { migrations, runMigrations } from "../src/db/migrate.js";
import {
  MAX_KNOWN_SCHEMA_VERSION,
  preflightSchemaCompatibility,
  readAppliedSchemaVersion,
  DatabaseTooNewError
} from "../src/db/schema-compat.js";

describe("Change 026 database downgrade guard", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-schema-guard-"));
    dbPath = path.join(tempDir, "orca.db");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function snapshotDb(): string {
    return fs.readFileSync(dbPath).toString("hex");
  }

  it("empty database passes the preflight with schema 0", () => {
    const db = new DatabaseSync(dbPath);
    try {
      expect(readAppliedSchemaVersion(db)).toBe(0);
      const result = preflightSchemaCompatibility(db, MAX_KNOWN_SCHEMA_VERSION);
      expect(result).toEqual({ currentSchema: 0, maxKnownSchema: MAX_KNOWN_SCHEMA_VERSION });
    } finally {
      db.close();
    }
  });

  it("current-schema database passes", () => {
    initDatabase(dbPath).close();
    const db = new DatabaseSync(dbPath);
    try {
      expect(preflightSchemaCompatibility(db, MAX_KNOWN_SCHEMA_VERSION).currentSchema).toBe(
        MAX_KNOWN_SCHEMA_VERSION
      );
    } finally {
      db.close();
    }
  });

  it("old database forward-migrates to current", { timeout: 30_000 }, () => {
    // Build an old (version-1) database by applying all but the last migration.
    const oldMigrations = migrations.slice(0, -1);
    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db, oldMigrations);
    } finally {
      db.close();
    }
    const checkDb = new DatabaseSync(dbPath);
    try {
      expect(readAppliedSchemaVersion(checkDb)).toBe(MAX_KNOWN_SCHEMA_VERSION - 1);
    } finally {
      checkDb.close();
    }

    const ctx = initDatabase(dbPath); // runs remaining migration after passing preflight
    try {
      const applied = ctx.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
      expect(applied.n).toBe(MAX_KNOWN_SCHEMA_VERSION);
    } finally {
      ctx.close();
    }
  });

  function makeTooNewDatabase(overshoot: number): void {
    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db, migrations);
      db.exec("BEGIN");
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        MAX_KNOWN_SCHEMA_VERSION + overshoot,
        `future_migration_${overshoot}`,
        new Date().toISOString()
      );
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  }

  it("one-version-newer database refuses startup without mutating anything", { timeout: 30_000 }, () => {
    makeTooNewDatabase(1);
    const before = snapshotDb();
    expect(() => initDatabase(dbPath)).toThrow(DatabaseTooNewError);
    expect(fs.readFileSync(dbPath).toString("hex")).toBe(before);

    try {
      initDatabase(dbPath);
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseTooNewError);
      const typed = err as DatabaseTooNewError;
      expect(typed.currentSchema).toBe(MAX_KNOWN_SCHEMA_VERSION + 1);
      expect(typed.maxKnownSchema).toBe(MAX_KNOWN_SCHEMA_VERSION);
      expect(typed.message).toContain("DATABASE_TOO_NEW");
      expect(typed.message).toContain("was not modified");
    }
    expect(fs.readFileSync(dbPath).toString("hex")).toBe(before);
  });

  it("much-newer database also refuses", { timeout: 30_000 }, () => {
    makeTooNewDatabase(50);
    expect(() => initDatabase(dbPath)).toThrow(DatabaseTooNewError);
  });

  it("preflight itself never writes (read-only refusal)", { timeout: 30_000 }, () => {
    makeTooNewDatabase(3);
    const before = snapshotDb();
    const db = new DatabaseSync(dbPath);
    try {
      expect(() => preflightSchemaCompatibility(db, MAX_KNOWN_SCHEMA_VERSION)).toThrow(
        DatabaseTooNewError
      );
    } finally {
      db.close();
    }
    expect(fs.readFileSync(dbPath).toString("hex")).toBe(before);
  });
});
