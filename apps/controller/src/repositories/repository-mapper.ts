import type { RepositoryRecord, ExecutionEnvironment } from '@orca/shared';

export interface RepositoryRow {
  id: string;
  display_name: string;
  github_remote: string;
  local_path: string;
  environment: string;
  wsl_distribution: string | null;
  executor_cli: string;
  executor_model: string;
  sol_conversation_url: string;
  max_iterations: number;
  max_runtime_minutes: number;
  created_at: string;
  updated_at: string;
}

export function toRepositoryRecord(row: RepositoryRow): RepositoryRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    githubRemote: row.github_remote,
    localPath: row.local_path,
    environment: row.environment as ExecutionEnvironment,
    wslDistribution: row.wsl_distribution,
    executorCli: row.executor_cli,
    executorModel: row.executor_model,
    solConversationUrl: row.sol_conversation_url,
    maxIterations: Number(row.max_iterations),
    maxRuntimeMinutes: Number(row.max_runtime_minutes),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
