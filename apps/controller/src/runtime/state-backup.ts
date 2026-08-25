import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isPidAlive } from "./singleton-lock.js";

/**
 * Durable-state backup bundles (Change 026).
 *
 * The bundle format is a directory (dependency-free, traversal-controlled by
 * construction):
 *
 *   <outDir>/orca-backup-<appVersion>-<UTCts>/
 *     manifest.json    # format/kind/version/createdAt + checksummed file list
 *     state/orca.db    # consistent VACUUM INTO image of the durable SQLite DB
 *
 * Exclusions are structural: the writer only ever emits the DB image plus the
 * manifest, so ChatGPT cookies/browser profiles, executor credentials,
 * repository working directories, temporary worktrees, runtime locks/PIDs, and
 * logs can never be included. Restore validates format, entry allowlist,
 * checksums, and schema compatibility; requires controller quiescence; and
 * preserves the replaced state as a recovery copy before mutating anything.
 */

export const BACKUP_MANIFEST_FORMAT = 1;

/** Canonical filenames inside the Orca data directory. */
export const CONTROLLER_LOCK_FILENAME = "controller.lock";
export const ORCA_DB_FILENAME = "orca-strator.sqlite";

/** Only entry name a manifest may ever reference. */
const ALLOWED_ENTRIES = new Set<string>(["state/orca.db"]);

export class StateBackupError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "StateBackupError";
    this.reason = reason;
  }
}

export interface BackupManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  kind: "orca-state-backup";
  formatVersion: typeof BACKUP_MANIFEST_FORMAT;
  applicationVersion: string;
  sourceSchemaVersion: number;
  createdAt: string;
  files: BackupManifestFile[];
}

function sha256Bytes(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export interface CreateBackupOptions {
  dbPath: string;
  outDir: string;
  applicationVersion: string;
  now?: () => Date;
}

export interface CreatedBackup {
  bundleDir: string;
  manifest: BackupManifest;
}

/**
 * Create a verified state backup bundle. Opens its own connection to the live
 * database and uses VACUUM INTO so the image is transactionally consistent
 * even while other connections are active.
 */
export function createStateBackup(options: CreateBackupOptions): CreatedBackup {
  const { dbPath, outDir, applicationVersion } = options;
  const now = options.now ?? (() => new Date());
  if (!fs.existsSync(dbPath)) {
    throw new StateBackupError("source-missing", `Source database does not exist: ${dbPath}`);
  }

  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const bundleDir = path.join(outDir, `orca-backup-${applicationVersion}-${stamp}`);
  const stateDir = path.join(bundleDir, "state");

  let sourceSchemaVersion = 0;
  try {
    const probe = new DatabaseSync(dbPath);
    try {
      const rows = probe.prepare("SELECT MAX(version) AS v FROM schema_migrations").all() as {
        v: number | null;
      }[];
      sourceSchemaVersion = rows[0]?.v ?? 0;
    } finally {
      probe.close();
    }
  } catch {
    sourceSchemaVersion = 0; // empty/new database backs up as an empty image
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const dbTarget = path.join(stateDir, "orca.db");
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`VACUUM INTO '${dbTarget.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  } catch (err) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
    throw new StateBackupError(
      "snapshot-failed",
      `VACUUM INTO failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Verify the image opens and passes quick_check before trusting it.
  try {
    const verify = new DatabaseSync(dbTarget, { readOnly: true });
    try {
      const check = verify.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      if (!check.length || check[0]?.quick_check !== "ok") {
        throw new Error(`quick_check=${check[0]?.quick_check ?? "no rows"}`);
      }
    } finally {
      verify.close();
    }
  } catch (err) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
    throw new StateBackupError(
      "verify-failed",
      `Backup image failed verification: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const payload = fs.readFileSync(dbTarget);
  const manifest: BackupManifest = {
    kind: "orca-state-backup",
    formatVersion: BACKUP_MANIFEST_FORMAT,
    applicationVersion,
    sourceSchemaVersion,
    createdAt: now().toISOString(),
    files: [
      {
        path: "state/orca.db",
        bytes: payload.byteLength,
        sha256: sha256Bytes(payload)
      }
    ]
  };
  fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { bundleDir, manifest };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  bundleDir: string;
  dataDir: string;
  /** Highest DB schema this binary supports (downgrade guard for backups too). */
  maxKnownSchemaVersion: number;
  now?: () => Date;
}

export interface RestoreResult {
  restoredFrom: string;
  recoveryCopyDir: string;
  restoredSchemaVersion: number;
}

function validateManifestShape(manifest: unknown, bundleDir: string): asserts manifest is BackupManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new StateBackupError("bad-manifest", `manifest.json in ${bundleDir} is not an object.`);
  }
  const m = manifest as Partial<BackupManifest>;
  if (m.kind !== "orca-state-backup" || m.formatVersion !== BACKUP_MANIFEST_FORMAT) {
    throw new StateBackupError(
      "unsupported-format",
      `Bundle is not an orca-state-backup v${BACKUP_MANIFEST_FORMAT} bundle.`
    );
  }
  if (typeof m.applicationVersion !== "string" || !m.applicationVersion) {
    throw new StateBackupError("bad-manifest", "manifest.applicationVersion missing.");
  }
  if (typeof m.sourceSchemaVersion !== "number") {
    throw new StateBackupError("bad-manifest", "manifest.sourceSchemaVersion missing.");
  }
  if (!Array.isArray(m.files) || m.files.length === 0) {
    throw new StateBackupError("bad-manifest", "manifest.files empty.");
  }
  for (const file of m.files) {
    if (typeof file?.path !== "string" || !ALLOWED_ENTRIES.has(file.path)) {
      throw new StateBackupError(
        "path-traversal-rejected",
        `manifest references disallowed entry "${String(file?.path)}". Only state/orca.db is permitted.`
      );
    }
    if (
      typeof file.bytes !== "number" ||
      typeof file.sha256 !== "string" ||
      file.sha256.length !== 64
    ) {
      throw new StateBackupError(
        "bad-manifest",
        `entry "${file.path}" has invalid size/checksum metadata.`
      );
    }
  }
}

interface ResolvedEntry {
  rel: string;
  buf: Buffer;
}

/**
 * Restore a validated backup bundle into a data directory.
 * Refuses while a controller owns the target (runtime lock present + owner
 * alive), refuses corrupt/tampered/incompatible bundles BEFORE touching disk,
 * and preserves the replaced state as a timestamped recovery copy.
 */
export function restoreStateBackup(options: RestoreOptions): RestoreResult {
  const { bundleDir, dataDir, maxKnownSchemaVersion } = options;
  const now = options.now ?? (() => new Date());

  // Quiescence first: refuse when a live controller owns the target DB.
  const lockPath = path.join(dataDir, CONTROLLER_LOCK_FILENAME);
  if (fs.existsSync(lockPath)) {
    let ownerAlive = false;
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: number; service?: string };
      if (
        lock &&
        lock.service === "orca-controller" &&
        typeof lock.pid === "number" &&
        isPidAlive(lock.pid)
      ) {
        ownerAlive = true;
      }
    } catch {
      // Unreadable lock: cannot prove quiescence — refuse conservatively.
      throw new StateBackupError(
        "controller-lock-unreadable",
        "Runtime lock exists but cannot be validated; refusing to restore against unknown ownership."
      );
    }
    if (ownerAlive) {
      throw new StateBackupError(
        "controller-active",
        "A live Orca controller owns this data directory. Quit it before restoring."
      );
    }
  }

  const manifestPath = path.join(bundleDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new StateBackupError("bad-bundle", `${bundleDir} has no manifest.json.`);
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new StateBackupError(
      "bad-manifest",
      `manifest.json unparseable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  validateManifestShape(manifestRaw, bundleDir);
  const manifest: BackupManifest = manifestRaw;

  if (manifest.sourceSchemaVersion > maxKnownSchemaVersion) {
    throw new StateBackupError(
      "backup-too-new",
      `Backup schema ${manifest.sourceSchemaVersion} is newer than this binary knows (${maxKnownSchemaVersion}).`
    );
  }

  // Verify every referenced file byte-for-byte BEFORE any mutation.
  const resolvedFiles: ResolvedEntry[] = [];
  for (const file of manifest.files) {
    const abs = path.join(bundleDir, ...file.path.split("/"));
    if (!fs.existsSync(abs)) {
      throw new StateBackupError("missing-entry", `Bundle entry "${file.path}" is absent on disk.`);
    }
    const buf = fs.readFileSync(abs);
    if (buf.byteLength !== file.bytes) {
      throw new StateBackupError(
        "checksum-mismatch",
        `Entry "${file.path}" size mismatch (${buf.byteLength} != ${file.bytes}).`
      );
    }
    if (sha256Bytes(buf) !== file.sha256.toLowerCase()) {
      throw new StateBackupError(
        "checksum-mismatch",
        `Entry "${file.path}" failed SHA-256 verification.`
      );
    }
    resolvedFiles.push({ rel: file.path, buf });
  }

  // Open the image and confirm integrity + schema ceiling.
  if (resolvedFiles.length === 0 || !resolvedFiles[0]) {
    throw new StateBackupError("bad-manifest", "No restorable payload resolved from the manifest.");
  }
  const primaryImage = resolvedFiles[0];
  const tempVerifyPath = path.join(dataDir, `.restore-verify-${Date.now()}.db`);
  try {
    fs.mkdirSync(path.dirname(tempVerifyPath), { recursive: true });
    fs.writeFileSync(tempVerifyPath, primaryImage.buf);
    const probe = new DatabaseSync(tempVerifyPath);
    let schema = 0;
    try {
      const check = probe.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      if (!check.length || check[0]?.quick_check !== "ok") {
        throw new Error(`quick_check=${check[0]?.quick_check ?? "no rows"}`);
      }
      try {
        const rows = probe.prepare("SELECT MAX(version) AS v FROM schema_migrations").all() as {
          v: number | null;
        }[];
        schema = rows[0]?.v ?? 0;
      } catch {
        schema = 0;
      }
      if (schema > maxKnownSchemaVersion) {
        throw new Error(`image schema ${schema} exceeds known ${maxKnownSchemaVersion}`);
      }
    } finally {
      probe.close();
    }
  } catch (err) {
    try {
      fs.rmSync(tempVerifyPath, { force: true });
    } catch {
      /* best effort */
    }
    throw new StateBackupError(
      "image-invalid",
      `Backup image failed verification: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  try {
    fs.rmSync(tempVerifyPath, { force: true });
  } catch {
    /* best effort */
  }

  // Preserve current state as a recovery copy before replacement.
  const dbPath = path.join(dataDir, ORCA_DB_FILENAME);
  const hadLiveDb = fs.existsSync(dbPath);
  const recoveryCopyDir = path.join(
    dataDir,
    `pre-restore-${now().toISOString().replace(/[:.]/g, "-")}`
  );
  if (hadLiveDb) {
    fs.mkdirSync(recoveryCopyDir, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = `${dbPath}${suffix}`;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(recoveryCopyDir, `orca.db${suffix}`));
      }
    }
  }

  // Install the restored image.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const suffix of ["-wal", "-shm"]) {
    try {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      /* best effort */
    }
  }
  fs.writeFileSync(dbPath, primaryImage.buf);

  return {
    restoredFrom: bundleDir,
    recoveryCopyDir,
    restoredSchemaVersion: manifest.sourceSchemaVersion
  };
}
