import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createStateBackup, restoreStateBackup, ORCA_DB_FILENAME } from "../src/runtime/state-backup.js";
import { MAX_KNOWN_SCHEMA_VERSION } from "../src/db/schema-compat.js";
import { migrations, runMigrations } from "../src/db/migrate.js";

describe("Change 026 durable-state backup bundles", () => {
  let tempDir: string;
  let dataDir: string;
  let outDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orca-backup-"));
    dataDir = path.join(tempDir, "data");
    outDir = path.join(tempDir, "backups");
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeDurableDb(): void {
    const dbPath = path.join(dataDir, ORCA_DB_FILENAME);
    const db = new DatabaseSync(dbPath);
    try {
      runMigrations(db, migrations);
      db.prepare(
        "INSERT INTO repositories (id, display_name, github_remote, local_path, environment, executor_cli, executor_model, sol_conversation_url, max_iterations, max_runtime_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("repo-1", "Fixture", "https://example.invalid/x.git", "C:/tmp/x", "windows", "kimi", "m", "https://c", 5, 30, new Date().toISOString(), new Date().toISOString());
    } finally {
      db.close();
    }
  }

  it("bundle contains exactly manifest + checksummed SQLite image", () => {
    makeDurableDb();
    const { bundleDir, manifest } = createStateBackup({
      dbPath: path.join(dataDir, ORCA_DB_FILENAME),
      outDir,
      applicationVersion: "0.1.0"
    });
    expect(manifest.kind).toBe("orca-state-backup");
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.applicationVersion).toBe("0.1.0");
    expect(manifest.sourceSchemaVersion).toBe(MAX_KNOWN_SCHEMA_VERSION);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]).toMatchObject({ path: "state/orca.db" });
    expect(fs.existsSync(path.join(bundleDir, "state/orca.db"))).toBe(true);
    // Structural exclusion proof: nothing else was written.
    const entries = fs.readdirSync(bundleDir);
    expect(entries.sort()).toEqual(["manifest.json", "state"]);
    expect(fs.readdirSync(path.join(bundleDir, "state"))).toEqual(["orca.db"]);
  });

  function restoreWith(options?: { lockPayload?: unknown; corrupt?: "checksum" | "traversal" | "schema" }) {
    makeDurableDb();
    const created = createStateBackup({
      dbPath: path.join(dataDir, ORCA_DB_FILENAME),
      outDir,
      applicationVersion: "0.1.0"
    });
    if (options?.corrupt === "checksum") {
      const dbTarget = path.join(created.bundleDir, "state/orca.db");
      fs.writeFileSync(dbTarget, Buffer.concat([fs.readFileSync(dbTarget), Buffer.from("tampered")]));
    }
    if (options?.corrupt === "traversal") {
      const manifestPath = path.join(created.bundleDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.files.push({ path: "../../../escape.db", bytes: 1, sha256: "0".repeat(64) });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    if (options?.corrupt === "schema") {
      const manifestPath = path.join(created.bundleDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.sourceSchemaVersion = MAX_KNOWN_SCHEMA_VERSION + 10;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    }
    return created.bundleDir;
  }

  it("successful quiescent restore round-trips durable state and preserves prior copy", () => {
    const bundleDir = restoreWith();
    // Replace the live DB with different content so the restore has real work.
    fs.rmSync(path.join(dataDir, ORCA_DB_FILENAME), { force: true });
    const fresh = new DatabaseSync(path.join(dataDir, ORCA_DB_FILENAME));
    fresh.exec("CREATE TABLE marker(x)");
    fresh.close();

    const result = restoreStateBackup({
      bundleDir,
      dataDir,
      maxKnownSchemaVersion: MAX_KNOWN_SCHEMA_VERSION
    });

    expect(result.restoredSchemaVersion).toBe(MAX_KNOWN_SCHEMA_VERSION);
    expect(fs.existsSync(result.recoveryCopyDir)).toBe(true);

    // Restored image contains the original fixture row.
    const verify = new DatabaseSync(path.join(dataDir, ORCA_DB_FILENAME), { readOnly: true });
    try {
      const rows = verify.prepare("SELECT COUNT(*) AS n FROM repositories").all() as { n: number }[];
      expect(rows[0].n).toBe(1);
      const check = verify.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
      expect(check[0].integrity_check).toBe("ok");
    } finally {
      verify.close();
    }
  });

  it("refuses restore while a live controller owns the data directory", () => {
    const bundleDir = restoreWith();
    fs.writeFileSync(
      path.join(dataDir, "controller.lock"),
      JSON.stringify({ service: "orca-controller", pid: process.pid })
    );
    expect(() =>
      restoreStateBackup({ bundleDir, dataDir, maxKnownSchemaVersion: MAX_KNOWN_SCHEMA_VERSION })
    ).toThrowError(/live Orca controller/);
  });

  it("rejects tampered payload before any mutation", () => {
    const bundleDir = restoreWith({ corrupt: "checksum" });
    const liveDb = path.join(dataDir, ORCA_DB_FILENAME);
    const before = fs.readFileSync(liveDb).toString("hex");
    expect(() =>
      restoreStateBackup({ bundleDir, dataDir, maxKnownSchemaVersion: MAX_KNOWN_SCHEMA_VERSION })
    ).toThrowError(/SHA-256|size mismatch/);
    expect(fs.readFileSync(liveDb).toString("hex")).toBe(before);
  });

  it("rejects traversal entries in the manifest", () => {
    const bundleDir = restoreWith({ corrupt: "traversal" });
    expect(() =>
      restoreStateBackup({ bundleDir, dataDir, maxKnownSchemaVersion: MAX_KNOWN_SCHEMA_VERSION })
    ).toThrowError(/disallowed entry/);
  });

  it("rejects backups whose schema exceeds what this binary knows", () => {
    const bundleDir = restoreWith({ corrupt: "schema" });
    expect(() =>
      restoreStateBackup({ bundleDir, dataDir, maxKnownSchemaVersion: MAX_KNOWN_SCHEMA_VERSION })
    ).toThrowError(/newer than this binary knows/);
  });
});
