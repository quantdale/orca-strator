import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * Pre-migration recovery snapshots (Change 026).
 *
 * Before a persistent database receives schema-changing migrations, create a
 * transactionally consistent image with SQLite's online `VACUUM INTO`, verify
 * it reopens cleanly, record metadata + SHA-256, and keep bounded retention.
 * Snapshots live only under the writable Orca backup directory — never under
 * application resources — and contain exactly one SQLite image (no cookies,
 * credentials, repository contents, or logs).
 */

export class MigrationBackupFailedError extends Error {
  readonly backupDir: string;
  constructor(backupDir: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `PRE_MIGRATION_BACKUP_FAILED: refusing to migrate without a verified recovery snapshot (${reason}).`
    );
    this.name = "MigrationBackupFailedError";
    this.backupDir = backupDir;
  }
}

export interface MigrationSnapshotMetadata {
  kind: "orca-pre-migration-snapshot";
  formatVersion: 1;
  applicationVersion: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  createdAt: string;
  file: string;
  bytes: number;
  sha256: string;
}

const DEFAULT_RETENTION = 5;

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Create + verify the pre-migration snapshot. Throws MigrationBackupFailedError
 * on any failure so callers can fail closed before migrating.
 */
export function createPreMigrationSnapshot(options: {
  dbPath: string;
  backupDir: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  applicationVersion: string;
  retention?: number;
  now?: () => Date;
}): MigrationSnapshotMetadata {
  const { dbPath, backupDir, sourceSchemaVersion, targetSchemaVersion, applicationVersion } =
    options;
  const retention = options.retention ?? DEFAULT_RETENTION;
  const now = options.now ?? (() => new Date());
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const fileName = `pre-migration-schema-${sourceSchemaVersion}-to-${targetSchemaVersion}-${stamp}.db`;
  const targetPath = path.join(backupDir, fileName);

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    // VACUUM INTO produces a compact, transactionally consistent online
    // snapshot; the target must not pre-exist (SQLite requirement).
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    // Verify the snapshot actually opens and passes quick_check before we
    // trust it as a recovery artifact.
    const verify = new DatabaseSync(targetPath, { readOnly: true });
    try {
      const check = verify.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      if (!check.length || check[0]?.quick_check !== "ok") {
        throw new Error(`snapshot quick_check reported ${check[0]?.quick_check ?? "no rows"}`);
      }
    } finally {
      verify.close();
    }

    const meta: MigrationSnapshotMetadata = {
      kind: "orca-pre-migration-snapshot",
      formatVersion: 1,
      applicationVersion,
      sourceSchemaVersion,
      targetSchemaVersion,
      createdAt: now().toISOString(),
      file: fileName,
      bytes: fs.statSync(targetPath).size,
      sha256: sha256File(targetPath)
    };
    fs.writeFileSync(path.join(backupDir, `${fileName}.meta.json`), JSON.stringify(meta, null, 2), "utf8");

    enforceRetention(backupDir, retention);
    return meta;
  } catch (err) {
    // Never leave a partial/unverified snapshot behind to masquerade as recovery state.
    try {
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
      const sidecar = path.join(backupDir, `${fileName}.meta.json`);
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw new MigrationBackupFailedError(backupDir, err);
  }
}

/** Keep only the newest N verified snapshots (+ their sidecars). */
export function enforceRetention(backupDir: string, retention: number = DEFAULT_RETENTION): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(backupDir);
  } catch {
    return;
  }
  const snapshots = entries
    .filter((name) => name.endsWith(".db") && name.startsWith("pre-migration-"))
    .map((name) => {
      const full = path.join(backupDir, name);
      return { name, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of snapshots.slice(retention)) {
    try {
      fs.rmSync(path.join(backupDir, stale.name), { force: true });
      fs.rmSync(path.join(backupDir, `${stale.name}.meta.json`), { force: true });
    } catch {
      /* best-effort */
    }
  }
}
