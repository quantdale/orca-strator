import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface ControllerConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  logLevel: string;
  uiDistDir: string | null;
  nodeEnv: string;
}

export function loadConfig(overrides?: Partial<ControllerConfig>): ControllerConfig {
  const host = overrides?.host ?? process.env.ORCA_HOST ?? '127.0.0.1';
  const port = overrides?.port ?? Number(process.env.ORCA_PORT || '47100');
  const nodeEnv = overrides?.nodeEnv ?? process.env.NODE_ENV ?? 'development';

  const defaultDataDir =
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Orca-Strator')
      : path.join(os.homedir(), '.orca-strator');

  const dataDir = overrides?.dataDir ?? process.env.ORCA_DATA_DIR ?? defaultDataDir;
  const dbPath = overrides?.dbPath ?? path.join(dataDir, 'orca-strator.sqlite');
  const logLevel = overrides?.logLevel ?? process.env.ORCA_LOG_LEVEL ?? (nodeEnv === 'test' ? 'warn' : 'info');

  let uiDistDir = overrides?.uiDistDir ?? process.env.ORCA_UI_DIST_DIR ?? null;
  if (!uiDistDir) {
    const candidate = path.resolve(process.cwd(), 'apps/ui/dist');
    if (fs.existsSync(candidate)) {
      uiDistDir = candidate;
    }
  }

  return {
    host,
    port,
    dataDir,
    dbPath,
    logLevel,
    uiDistDir,
    nodeEnv
  };
}
