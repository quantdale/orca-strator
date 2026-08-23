import path from 'node:path';
import { resolveRuntimePaths } from '../runtime/paths.js';

export interface ControllerConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  logDir: string;
  runtimeLockPath: string;
  logLevel: string;
  uiDistDir: string | null;
  nodeEnv: string;
}

export function loadConfig(overrides?: Partial<ControllerConfig>): ControllerConfig {
  const host = overrides?.host ?? process.env.ORCA_HOST ?? '127.0.0.1';
  const rawPort = overrides?.port !== undefined ? overrides.port : (process.env.ORCA_PORT ? Number(process.env.ORCA_PORT) : 47100);
  const nodeEnv = overrides?.nodeEnv ?? process.env.NODE_ENV ?? 'development';

  if (typeof host !== 'string' || host.trim().length === 0) {
    throw new Error(`Invalid configuration: host must be a non-empty string, got "${host}".`);
  }

  if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535) {
    throw new Error(`Invalid configuration: port must be an integer between 1 and 65535, got ${rawPort}.`);
  }

  const port = rawPort;

  const paths = resolveRuntimePaths(
    { dataDir: overrides?.dataDir, dbPath: overrides?.dbPath },
    process.env
  );

  // Test seams keep precedence; the explicit path contract supplies the rest.
  const dataDir = overrides?.dataDir ?? paths.dataDir;
  const dbPath = overrides?.dbPath ?? paths.dbPath;
  const logLevel = overrides?.logLevel ?? process.env.ORCA_LOG_LEVEL ?? (nodeEnv === 'test' ? 'warn' : 'info');
  const uiDistDir =
    overrides?.uiDistDir ??
    (process.env.ORCA_UI_DIST_DIR ? path.resolve(process.env.ORCA_UI_DIST_DIR) : paths.uiDistDir);

  return {
    host,
    port,
    dataDir,
    dbPath,
    logDir: paths.logDir,
    runtimeLockPath: paths.runtimeLockPath,
    logLevel,
    uiDistDir,
    nodeEnv
  };
}
