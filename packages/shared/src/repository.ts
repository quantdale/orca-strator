export type ExecutionEnvironment = "windows" | "wsl";

export interface RepositoryRecord {
  id: string;
  displayName: string;
  githubRemote: string;
  localPath: string;
  environment: ExecutionEnvironment;
  wslDistribution: string | null;
  executorCli: string;
  executorModel: string;
  solConversationUrl: string;
  maxIterations: number;
  maxRuntimeMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRepositoryInput {
  displayName: string;
  githubRemote: string;
  localPath: string;
  environment: ExecutionEnvironment;
  wslDistribution?: string | null;
  executorCli: string;
  executorModel: string;
  solConversationUrl: string;
  maxIterations?: number;
  maxRuntimeMinutes?: number;
}

export interface UpdateRepositoryInput {
  displayName?: string;
  githubRemote?: string;
  localPath?: string;
  environment?: ExecutionEnvironment;
  wslDistribution?: string | null;
  executorCli?: string;
  executorModel?: string;
  solConversationUrl?: string;
  maxIterations?: number;
  maxRuntimeMinutes?: number;
}

export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_MAX_RUNTIME_MINUTES = 480;
