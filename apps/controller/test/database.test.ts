import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDatabase, type DatabaseContext } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrate.js';
import { RepositoryStore } from '../src/repositories/repository-store.js';
import type { RepositoryRecord } from '@orca/shared';

describe('SQLite Migration & Storage Layer (Tests 4)', () => {
  let tempDir: string;
  let dbPath: string;
  let dbCtx: DatabaseContext;
  let store: RepositoryStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-test-db-'));
    dbPath = path.join(tempDir, 'test.sqlite');
    dbCtx = initDatabase(dbPath);
    store = new RepositoryStore(dbCtx.db);
  });

  afterEach(() => {
    dbCtx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('4.T1 fresh temp DB migrates and creates schema_migrations', () => {
    const rows = dbCtx.db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as any[];
    expect(rows).toHaveLength(21);
    expect(rows[0].version).toBe(1);
    expect(rows[0].name).toBe('001_create_repositories');
    expect(rows[1].version).toBe(2);
    expect(rows[1].name).toBe('002_create_dispatches');
    expect(rows[2].version).toBe(3);
    expect(rows[2].name).toBe('003_create_executor_runs');
    expect(rows[3].version).toBe(4);
    expect(rows[3].name).toBe('004_create_sol_wakes');
    expect(rows[4].version).toBe(5);
    expect(rows[4].name).toBe('005_create_runs');
    expect(rows[5].version).toBe(6);
    expect(rows[5].name).toBe('006_add_repository_enabled');
    expect(rows[6].version).toBe(7);
    expect(rows[6].name).toBe('007_create_sol_controls');
    expect(rows[7].version).toBe(8);
    expect(rows[7].name).toBe('008_add_drain_reason');
    expect(rows[8].version).toBe(9);
    expect(rows[8].name).toBe('009_create_sol_operations');
    expect(rows[9].version).toBe(10);
    expect(rows[9].name).toBe('010_create_campaign_trace_and_run_policies');
    expect(rows[10].version).toBe(11);
    expect(rows[10].name).toBe('011_create_executor_capability_probes');
    expect(rows[11].version).toBe(12);
    expect(rows[11].name).toBe('012_create_permission_policies_and_decisions');
    expect(rows[12].version).toBe(13);
    expect(rows[12].name).toBe('013_add_sol_operation_completion_budget');
    expect(rows[13].version).toBe(14);
    expect(rows[13].name).toBe('014_create_usage_metrics');
    expect(rows[14].version).toBe(15);
    expect(rows[14].name).toBe('015_create_scheduler_policy_and_decisions');
    expect(rows[15].version).toBe(16);
    expect(rows[15].name).toBe('016_create_role_model_policies');
    expect(rows[16].version).toBe(17);
    expect(rows[16].name).toBe('017_create_work_packets_and_isolated_worktrees');
    expect(rows[17].version).toBe(18);
    expect(rows[17].name).toBe('018_create_integration_reports');
    expect(rows[18].version).toBe(19);
    expect(rows[18].name).toBe('019_create_execution_strategy_runs_and_controls');
    expect(rows[19].version).toBe(20);
    expect(rows[19].name).toBe('020_allow_dag_execution_strategy');
    expect(rows[20].version).toBe(21);
    expect(rows[20].name).toBe('021_create_execution_dag_nodes');
  });

  it('4.T2 reopen is idempotent and does not fail or duplicate migrations', () => {
    dbCtx.close();
    const reopened = initDatabase(dbPath);
    dbCtx = reopened;
    const rows = reopened.db.prepare('SELECT version, name FROM schema_migrations ORDER BY version ASC').all() as any[];
    expect(rows).toHaveLength(21);
  });

  it('4.T3 CRUD round-trips and supports multiple records', () => {
    const repo1: RepositoryRecord = {
      id: 'repo-1',
      displayName: 'Repo One',
      githubRemote: 'https://github.com/quantdale/repo1.git',
      localPath: 'D:\\Projects\\Repo1',
      environment: 'windows',
      wslDistribution: null,
      executorCli: 'codex',
      executorModel: 'gpt-5.6',
      solConversationUrl: 'https://chatgpt.com/c/111',
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      enabled: true,
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z'
    };

    const repo2: RepositoryRecord = {
      id: 'repo-2',
      displayName: 'Repo Two',
      githubRemote: 'https://github.com/quantdale/repo2.git',
      localPath: '/home/user/repo2',
      environment: 'wsl',
      wslDistribution: 'Ubuntu-24.04',
      executorCli: 'kimi',
      executorModel: 'deepseek-v4',
      solConversationUrl: 'https://chatgpt.com/c/222',
      maxIterations: 10,
      maxRuntimeMinutes: 300,
      enabled: true,
      createdAt: '2026-08-19T11:00:00.000Z',
      updatedAt: '2026-08-19T11:00:00.000Z'
    };

    store.create(repo1);
    store.create(repo2);

    const list = store.list();
    expect(list).toHaveLength(2);

    const fetched1 = store.get('repo-1');
    expect(fetched1).toEqual(repo1);

    const fetched2 = store.get('repo-2');
    expect(fetched2).toEqual(repo2);
  });

  it('4.T4 update preserves id and createdAt, updates other fields', () => {
    const repo: RepositoryRecord = {
      id: 'repo-1',
      displayName: 'Old Name',
      githubRemote: 'https://github.com/quantdale/repo1.git',
      localPath: 'D:\\Projects\\Repo1',
      environment: 'windows',
      wslDistribution: null,
      executorCli: 'codex',
      executorModel: 'gpt-5.6',
      solConversationUrl: 'https://chatgpt.com/c/111',
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      enabled: true,
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z'
    };
    store.create(repo);

    const updated: RepositoryRecord = {
      ...repo,
      displayName: 'New Name',
      executorModel: 'gpt-5.6-luna',
      updatedAt: '2026-08-19T12:00:00.000Z'
    };
    store.update(updated);

    const fetched = store.get('repo-1');
    expect(fetched?.displayName).toBe('New Name');
    expect(fetched?.executorModel).toBe('gpt-5.6-luna');
    expect(fetched?.createdAt).toBe('2026-08-19T10:00:00.000Z');
    expect(fetched?.updatedAt).toBe('2026-08-19T12:00:00.000Z');
  });

  it('4.T5 delete removes record and returns false for unknown id', () => {
    const repo: RepositoryRecord = {
      id: 'repo-1',
      displayName: 'To Delete',
      githubRemote: 'https://github.com/quantdale/repo1.git',
      localPath: 'D:\\Projects\\Repo1',
      environment: 'windows',
      wslDistribution: null,
      executorCli: 'codex',
      executorModel: 'gpt-5.6',
      solConversationUrl: 'https://chatgpt.com/c/111',
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      enabled: true,
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z'
    };
    store.create(repo);

    expect(store.delete('repo-1')).toBe(true);
    expect(store.get('repo-1')).toBeNull();
    expect(store.delete('repo-1')).toBe(false);
  });

  it('4.T6 close/reopen preserves records', () => {
    const repo: RepositoryRecord = {
      id: 'repo-1',
      displayName: 'Persistent Repo',
      githubRemote: 'https://github.com/quantdale/repo1.git',
      localPath: 'D:\\Projects\\Repo1',
      environment: 'windows',
      wslDistribution: null,
      executorCli: 'codex',
      executorModel: 'gpt-5.6',
      solConversationUrl: 'https://chatgpt.com/c/111',
      maxIterations: 20,
      maxRuntimeMinutes: 480,
      enabled: true,
      createdAt: '2026-08-19T10:00:00.000Z',
      updatedAt: '2026-08-19T10:00:00.000Z'
    };
    store.create(repo);

    dbCtx.close();
    const reopened = initDatabase(dbPath);
    const reopenedStore = new RepositoryStore(reopened.db);

    const fetched = reopenedStore.get('repo-1');
    expect(fetched).toEqual(repo);
    reopened.close();
  });

  it('4.T8 schema inspection proves no branch or run-state columns exist', () => {
    const columns = dbCtx.db.prepare('PRAGMA table_info(repositories)').all() as any[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).not.toContain('branch');
    expect(columnNames).not.toContain('current_actor');
    expect(columnNames).not.toContain('current_iteration');
    expect(columnNames).not.toContain('run_goal');
    expect(columnNames).not.toContain('status');
  });

  it('4.T9 migration body failure rolls back and records no migration metadata', () => {
    const testDbPath = path.join(tempDir, 'fail_body.sqlite');
    const db = new (dbCtx.db.constructor as any)(testDbPath);
    try {
      const failingMigrations = [
        {
          version: 1,
          name: 'failing_migration',
          up: (d: any) => {
            d.exec('CREATE TABLE test_partial (id TEXT PRIMARY KEY);');
            throw new Error('Injected migration failure');
          }
        }
      ];

      expect(() => {
        runMigrations(db, failingMigrations);
      }).toThrow('Injected migration failure');

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_partial'").all();
      expect(tables).toHaveLength(0);

      const migrationsApplied = db.prepare('SELECT * FROM schema_migrations').all();
      expect(migrationsApplied).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
