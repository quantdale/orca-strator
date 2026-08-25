import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrate.js";

/**
 * Highest database schema version this binary knows how to operate.
 * Derived from the migration list so a new migration automatically raises
 * the ceiling and the downgrade guard stays exact.
 */
export const MAX_KNOWN_SCHEMA_VERSION: number =
  migrations.length > 0 ? Math.max(...migrations.map((m) => m.version)) : 0;

/** Typed refusal when the on-disk schema is newer than this binary knows. */
export class DatabaseTooNewError extends Error {
  readonly currentSchema: number;
  readonly maxKnownSchema: number;

  constructor(currentSchema: number, maxKnownSchema: number) {
    super(
      `DATABASE_TOO_NEW: database schema ${currentSchema} is newer than this binary supports ` +
        `(known max ${maxKnownSchema}). Install a matching or newer Orca release or restore a ` +
        `verified pre-upgrade backup. The database was not modified.`
    );
    this.name = "DatabaseTooNewError";
    this.currentSchema = currentSchema;
    this.maxKnownSchema = maxKnownSchema;
  }
}

/**
 * Read the highest applied schema version recorded in the database.
 * Returns 0 for an empty/new database (no schema_migrations table yet).
 */
export function readAppliedSchemaVersion(db: DatabaseSync): number {
  try {
    const rows = db
      .prepare("SELECT MAX(version) AS maxVersion FROM schema_migrations")
      .all() as { maxVersion: number | null }[];
    return rows[0]?.maxVersion ?? 0;
  } catch {
    // Missing table = empty database; forward migrations will create it.
    return 0;
  }
}

/**
 * Strict forward-compatibility preflight (Change 026): fail closed BEFORE any
 * pragma write, migration, or service touches a database that a NEWER binary
 * already upgraded. Reading does not mutate; refusal leaves bytes untouched.
 */
export function preflightSchemaCompatibility(
  db: DatabaseSync,
  maxKnown: number = MAX_KNOWN_SCHEMA_VERSION
): { currentSchema: number; maxKnownSchema: number } {
  const currentSchema = readAppliedSchemaVersion(db);
  if (currentSchema > maxKnown) {
    throw new DatabaseTooNewError(currentSchema, maxKnown);
  }
  return { currentSchema, maxKnownSchema: maxKnown };
}
