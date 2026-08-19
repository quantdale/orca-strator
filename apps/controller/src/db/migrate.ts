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
  },
  {
    version: 2,
    name: "002_create_dispatches",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dispatches (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          iteration INTEGER NOT NULL,
          commit_sha TEXT NOT NULL,
          base_sha TEXT NOT NULL,
          change_path TEXT NOT NULL,
          goal TEXT NOT NULL,
          instructions_version INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('detected', 'consumed', 'rejected')),
          rejection_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_dispatches_repo ON dispatches(repository_id);
        CREATE INDEX IF NOT EXISTS idx_dispatches_commit ON dispatches(commit_sha);

        CREATE TABLE IF NOT EXISTS watcher_state (
          repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
          last_observed_sha TEXT,
          last_polled_at TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 3,
    name: "003_create_executor_runs",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS executor_runs (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          iteration INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'paused', 'failed', 'killed', 'timed_out')),
          exit_code INTEGER,
          log_path TEXT,
          error_message TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_executor_runs_repo ON executor_runs(repository_id);
        CREATE INDEX IF NOT EXISTS idx_executor_runs_dispatch ON executor_runs(dispatch_id);
      `);
    }
  },
  {
    version: 4,
    name: "004_create_sol_wakes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sol_wakes (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
          conversation_url TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'failed', 'busy')),
          error_message TEXT,
          submitted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sol_wakes_repo ON sol_wakes(repository_id);
        CREATE INDEX IF NOT EXISTS idx_sol_wakes_dispatch ON sol_wakes(dispatch_id);
      `);
    }
  },
  {
    version: 5,
    name: "005_create_runs",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          goal TEXT NOT NULL,
          status TEXT NOT NULL,
          current_iteration INTEGER NOT NULL DEFAULT 0,
          max_iterations INTEGER NOT NULL DEFAULT 20,
          active_dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
          last_error TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_runs_repo ON runs(repository_id);
      `);
    }
  },
  {
    version: 6,
    name: "006_add_repository_enabled",
    up: (db) => {
      db.exec(`
        ALTER TABLE repositories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
      `);
    }
  },
  {
    version: 7,
    name: "007_create_sol_controls",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sol_controls (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          control_id TEXT NOT NULL,
          decision TEXT NOT NULL CHECK (decision IN ('GOAL_COMPLETE', 'BLOCKED', 'NEEDS_HUMAN', 'PAUSED')),
          iteration INTEGER NOT NULL,
          commit_sha TEXT NOT NULL,
          related_dispatch_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('detected', 'consumed', 'rejected')),
          rejection_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sol_controls_repo ON sol_controls(repository_id);
        CREATE INDEX IF NOT EXISTS idx_sol_controls_control ON sol_controls(control_id);
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