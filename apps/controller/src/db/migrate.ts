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
  },
  {
    version: 8,
    name: "008_add_drain_reason",
    up: (db) => {
      db.exec(`
        ALTER TABLE runs ADD COLUMN drain_reason TEXT CHECK (drain_reason IN ('USER_STOP','WALL_CLOCK_CEILING','ITERATION_CEILING'));
      `);
    }
  },
  {
    version: 9,
    name: "009_create_sol_operations",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sol_operations (
          repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          iteration INTEGER NOT NULL,
          wake_id TEXT NOT NULL,
          dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
          conversation_url TEXT NOT NULL,
          repository_name TEXT NOT NULL,
          result_status TEXT NOT NULL,
          message TEXT NOT NULL,
          submitted_at TEXT,
          deadline INTEGER NOT NULL,
          timeout_retry_count INTEGER NOT NULL DEFAULT 0,
          busy_retry_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK (status IN ('active','stalled','completed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sol_operations_run ON sol_operations(run_id);
      `);
    }
  },
  {
    version: 10,
    name: "010_create_campaign_trace_and_run_policies",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS campaign_trace_events (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          iteration INTEGER,
          phase TEXT NOT NULL,
          event_type TEXT NOT NULL,
          dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
          result_id TEXT,
          control_id TEXT REFERENCES sol_controls(id) ON DELETE SET NULL,
          at TEXT NOT NULL,
          duration_ms INTEGER,
          status TEXT NOT NULL,
          failure_reason TEXT,
          data_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_campaign_trace_repo_at
          ON campaign_trace_events(repository_id, at DESC);
        CREATE INDEX IF NOT EXISTS idx_campaign_trace_run_iteration
          ON campaign_trace_events(run_id, iteration, at ASC);

        CREATE TABLE IF NOT EXISTS run_policies (
          run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
          policy_json TEXT NOT NULL,
          captured_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 11,
    name: "011_create_executor_capability_probes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS executor_capability_probes (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          cli TEXT NOT NULL,
          model TEXT NOT NULL,
          environment TEXT NOT NULL CHECK (environment IN ('windows', 'wsl')),
          probe_level TEXT NOT NULL CHECK (probe_level IN ('STATIC', 'NON_INFERENCE', 'INFERENCE')),
          overall TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          probed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_capability_probes_repo_time
          ON executor_capability_probes(repository_id, probed_at DESC);
      `);
    }
  },
  {
    version: 12,
    name: "012_create_permission_policies_and_decisions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS permission_policies (
          repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
          preset TEXT NOT NULL CHECK (preset IN ('CONSERVATIVE', 'BALANCED', 'UNATTENDED', 'CUSTOM')),
          policy_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS permission_decisions (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          iteration INTEGER,
          action TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('ALLOW', 'ALLOW_ONCE', 'ASK', 'DENY')),
          enforcement TEXT NOT NULL CHECK (enforcement IN ('NATIVE_EXECUTOR', 'ORCA_ENFORCED', 'ADVISORY_ONLY', 'UNSUPPORTED')),
          rationale TEXT NOT NULL,
          actionable INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_permission_decisions_repo_time
          ON permission_decisions(repository_id, created_at DESC);
      `);
    }
  },
  {
    version: 13,
    name: "013_add_sol_operation_completion_budget",
    up: (db) => {
      db.exec(`
        ALTER TABLE sol_operations
          ADD COLUMN completion_wait_ms INTEGER NOT NULL DEFAULT 1200000;
      `);
    }
  },
  {
    version: 14,
    name: "014_create_usage_metrics",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS usage_metrics (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          iteration INTEGER,
          dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
          executor_run_id TEXT REFERENCES executor_runs(id) ON DELETE SET NULL,
          executor TEXT NOT NULL,
          provider TEXT,
          model TEXT NOT NULL,
          input_tokens REAL,
          cached_input_tokens REAL,
          output_tokens REAL,
          reasoning_tokens REAL,
          request_count REAL,
          latency_ms REAL,
          retry_count REAL,
          rate_limit_events REAL,
          exact_cost REAL,
          estimated_cost REAL,
          currency TEXT,
          cost_status TEXT NOT NULL CHECK (cost_status IN ('EXACT', 'ESTIMATED', 'UNKNOWN')),
          source TEXT NOT NULL CHECK (source IN ('NATIVE_EXECUTOR', 'PROVIDER_RESPONSE', 'STRUCTURED_RESULT', 'UNKNOWN')),
          recorded_at TEXT NOT NULL,
          notes TEXT,
          CHECK (NOT (exact_cost IS NOT NULL AND estimated_cost IS NOT NULL)),
          CHECK (cost_status != 'EXACT' OR exact_cost IS NOT NULL),
          CHECK (cost_status != 'ESTIMATED' OR estimated_cost IS NOT NULL),
          CHECK (cost_status != 'UNKNOWN' OR (exact_cost IS NULL AND estimated_cost IS NULL))
        );

        CREATE INDEX IF NOT EXISTS idx_usage_metrics_repo_time
          ON usage_metrics(repository_id, recorded_at DESC);
        CREATE INDEX IF NOT EXISTS idx_usage_metrics_run_iteration
          ON usage_metrics(run_id, iteration, recorded_at ASC);
      `);
    }
  },
  {
    version: 15,
    name: "015_create_scheduler_policy_and_decisions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduler_policies (
          id TEXT PRIMARY KEY CHECK (id = 'default'),
          policy_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scheduler_decisions (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          iteration INTEGER,
          executor TEXT NOT NULL,
          provider TEXT,
          model TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('PRIMARY_EXECUTOR', 'SUBAGENT')),
          status TEXT NOT NULL CHECK (status IN ('ADMITTED', 'QUEUED', 'REJECTED', 'RELEASED', 'STALE_RECOVERABLE')),
          blocked_by TEXT,
          reason TEXT NOT NULL,
          queued_at TEXT,
          runnable_at TEXT,
          resolved_at TEXT,
          policy_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scheduler_decisions_created
          ON scheduler_decisions(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scheduler_decisions_request
          ON scheduler_decisions(request_id, created_at DESC);
      `);
    }
  },
  {
    version: 16,
    name: "016_create_role_model_policies",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS role_model_policies (
          repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
          policy_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }
  },
  {
    version: 17,
    name: "017_create_work_packets_and_isolated_worktrees",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS work_packets (
          packet_id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          parent_dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL,
          workstream TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_PERMISSION', 'RETRYING', 'COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED_DEPENDENCY', 'CANCELLED')),
          packet_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_packets_run_iteration
          ON work_packets(run_id, iteration, created_at ASC);

        CREATE TABLE IF NOT EXISTS work_packet_results (
          packet_id TEXT PRIMARY KEY REFERENCES work_packets(packet_id) ON DELETE CASCADE,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'SKIPPED', 'SKIPPED_DEPENDENCY', 'INTEGRATION_CONFLICT')),
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_packet_results_run
          ON work_packet_results(run_id, iteration, created_at ASC);

        CREATE TABLE IF NOT EXISTS isolated_worktrees (
          worktree_id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          packet_id TEXT NOT NULL REFERENCES work_packets(packet_id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          path TEXT NOT NULL UNIQUE,
          branch TEXT NOT NULL UNIQUE,
          environment TEXT NOT NULL CHECK (environment IN ('windows', 'wsl')),
          wsl_distribution TEXT,
          base_sha TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ALLOCATED', 'ACTIVE', 'RELEASED', 'STALE', 'CLEANUP_REQUIRED', 'ORPHANED')),
          created_at TEXT NOT NULL,
          released_at TEXT,
          last_error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_isolated_worktrees_repo_status
          ON isolated_worktrees(repository_id, status, created_at DESC);
      `);
    }
  },
  {
    version: 18,
    name: "018_create_integration_reports",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS integration_reports (
          id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'PARTIAL', 'INTEGRATION_CONFLICT', 'BLOCKED')),
          report_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_integration_reports_run
          ON integration_reports(run_id, iteration, created_at DESC);
      `);
    }
  },
  {
    version: 19,
    name: "019_create_execution_strategy_runs_and_controls",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_strategy_runs (
          strategy_run_id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          strategy TEXT NOT NULL CHECK (strategy IN ('SINGLE_AGENT', 'SWARM')),
          status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'PAUSED', 'STOPPING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED')),
          max_concurrency INTEGER NOT NULL CHECK (max_concurrency > 0 AND max_concurrency <= 32),
          packet_ids_json TEXT NOT NULL,
          control_state TEXT NOT NULL CHECK (control_state IN ('NONE', 'PAUSE_REQUESTED', 'STOP_REQUESTED', 'KILL_REQUESTED')),
          started_at TEXT,
          finished_at TEXT,
          last_error TEXT,
          report_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_execution_strategy_runs_run_iteration
          ON execution_strategy_runs(run_id, iteration, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_strategy_runs_repo_status
          ON execution_strategy_runs(repository_id, status, created_at DESC);

        CREATE TABLE IF NOT EXISTS execution_strategy_controls (
          control_id TEXT PRIMARY KEY,
          strategy_run_id TEXT NOT NULL REFERENCES execution_strategy_runs(strategy_run_id) ON DELETE CASCADE,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          decision TEXT NOT NULL CHECK (decision IN ('PAUSE', 'STOP', 'KILL', 'RESUME')),
          reason TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_execution_strategy_controls_strategy_time
          ON execution_strategy_controls(strategy_run_id, created_at ASC);
      `);
    }
  },
  {
    version: 20,
    name: "020_allow_dag_execution_strategy",
    up: (db) => {
      db.exec(`
        CREATE TEMP TABLE strategy_controls_v20 AS
          SELECT control_id, strategy_run_id, repository_id, run_id, iteration,
                 decision, reason, created_at
          FROM execution_strategy_controls;
        DROP TABLE execution_strategy_controls;
        ALTER TABLE execution_strategy_runs RENAME TO execution_strategy_runs_v19;

        CREATE TABLE execution_strategy_runs (
          strategy_run_id TEXT PRIMARY KEY,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          strategy TEXT NOT NULL CHECK (strategy IN ('SINGLE_AGENT', 'SWARM', 'DAG')),
          status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'PAUSED', 'STOPPING', 'COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED')),
          max_concurrency INTEGER NOT NULL CHECK (max_concurrency > 0 AND max_concurrency <= 32),
          packet_ids_json TEXT NOT NULL,
          control_state TEXT NOT NULL CHECK (control_state IN ('NONE', 'PAUSE_REQUESTED', 'STOP_REQUESTED', 'KILL_REQUESTED')),
          started_at TEXT,
          finished_at TEXT,
          last_error TEXT,
          report_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO execution_strategy_runs (
          strategy_run_id, repository_id, campaign_id, run_id, iteration,
          strategy, status, max_concurrency, packet_ids_json, control_state,
          started_at, finished_at, last_error, report_json, created_at, updated_at
        )
        SELECT strategy_run_id, repository_id, campaign_id, run_id, iteration,
               strategy, status, max_concurrency, packet_ids_json, control_state,
               started_at, finished_at, last_error, report_json, created_at, updated_at
        FROM execution_strategy_runs_v19;

        DROP TABLE execution_strategy_runs_v19;

        CREATE INDEX idx_execution_strategy_runs_run_iteration
          ON execution_strategy_runs(run_id, iteration, created_at DESC);
        CREATE INDEX idx_execution_strategy_runs_repo_status
          ON execution_strategy_runs(repository_id, status, created_at DESC);

        CREATE TABLE execution_strategy_controls (
          control_id TEXT PRIMARY KEY,
          strategy_run_id TEXT NOT NULL REFERENCES execution_strategy_runs(strategy_run_id) ON DELETE CASCADE,
          repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          iteration INTEGER NOT NULL,
          decision TEXT NOT NULL CHECK (decision IN ('PAUSE', 'STOP', 'KILL', 'RESUME')),
          reason TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO execution_strategy_controls (
          control_id, strategy_run_id, repository_id, run_id, iteration,
          decision, reason, created_at
        )
        SELECT control_id, strategy_run_id, repository_id, run_id, iteration,
               decision, reason, created_at
        FROM strategy_controls_v20;
        DROP TABLE strategy_controls_v20;

        CREATE INDEX idx_execution_strategy_controls_strategy_time
          ON execution_strategy_controls(strategy_run_id, created_at ASC);
      `);
    }
  },
  {
    version: 21,
    name: "021_create_execution_dag_nodes",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS execution_dag_nodes (
          strategy_run_id TEXT NOT NULL REFERENCES execution_strategy_runs(strategy_run_id) ON DELETE CASCADE,
          node_id TEXT NOT NULL,
          packet_id TEXT NOT NULL REFERENCES work_packets(packet_id) ON DELETE CASCADE,
          depends_on_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_DEPENDENCY', 'WAITING_PERMISSION', 'RETRYING', 'COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED', 'CANCELLED', 'INTEGRATING')),
          budget_json TEXT NOT NULL,
          attempt INTEGER NOT NULL CHECK (attempt >= 0),
          max_retries INTEGER NOT NULL CHECK (max_retries >= 0),
          waiting_reason TEXT,
          started_at TEXT,
          finished_at TEXT,
          result_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (strategy_run_id, node_id),
          UNIQUE (strategy_run_id, packet_id)
        );

        CREATE INDEX IF NOT EXISTS idx_execution_dag_nodes_strategy_status
          ON execution_dag_nodes(strategy_run_id, status, updated_at ASC);
        CREATE INDEX IF NOT EXISTS idx_execution_dag_nodes_packet
          ON execution_dag_nodes(packet_id);
      `);
    }
  },
  {
    version: 22,
    name: "022_execution_strategy_loop_integration",
    up: (db) => {
      db.exec(`
        ALTER TABLE execution_strategy_runs
          ADD COLUMN dispatch_id TEXT REFERENCES dispatches(id) ON DELETE SET NULL;
        ALTER TABLE execution_strategy_runs
          ADD COLUMN strategy_base_sha TEXT;
        CREATE INDEX IF NOT EXISTS idx_execution_strategy_runs_dispatch
          ON execution_strategy_runs(dispatch_id);
      `);
      db.exec(`
        ALTER TABLE execution_dag_nodes
          ADD COLUMN dependency_input_shas_json TEXT NOT NULL DEFAULT '[]';
      `);
      db.exec(`
        ALTER TABLE isolated_worktrees
          ADD COLUMN dependency_input_shas_json TEXT NOT NULL DEFAULT '[]';
      `);
      db.exec(`
        ALTER TABLE dispatches
          ADD COLUMN strategy TEXT;
        ALTER TABLE dispatches
          ADD COLUMN execution_plan_json TEXT;
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
