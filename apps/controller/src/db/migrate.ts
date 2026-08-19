import { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "001_create_repositories",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repositories (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          github_remote TEXT NOT NULL,
          local_path TEXT NOT NULL,
          environment TEXT NOT NULL CHECK (environment IN ('windows', 'wsl')),
          wsl_distribution TEXT,
          executor_cli TEXT NOT NULL,
          executor_model TEXT NOT NULL,
          sol_conversation_url TEXT NOT NULL,
          max_iterations INTEGER NOT NULL DEFAULT 20 CHECK (max_iterations > 0),
          max_runtime_minutes INTEGER NOT NULL DEFAULT 480 CHECK (max_runtime_minutes > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (environment = 'wsl' AND wsl_distribution IS NOT NULL AND length(trim(wsl_distribution)) > 0)
            OR environment = 'windows'
          )
        );
      `);
    }
  }
];

export function runMigrations(db: DatabaseSync, migrationList: Migration[] = migrations): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all() as {
    version: number;
  }[];
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  for (const migration of migrationList) {
    if (!appliedSet.has(migration.version)) {
      db.exec("BEGIN");
      try {
        migration.up(db);
        const stmt = db.prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        );
        stmt.run(migration.version, migration.name, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
}