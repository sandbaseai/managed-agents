import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_HOME_DIR = '.managed-agents';
export const WORKSPACE_STATE_DIR = '.managed-agents';

export function defaultRuntimeHome(): string {
  const configured = process.env.MANAGED_AGENTS_HOME;
  return configured ? resolveUserPath(configured) : join(homedir(), DEFAULT_HOME_DIR);
}

export function resolveWorkspaceRoot(workspace: string | undefined, baseDir = process.cwd()): string {
  return resolveUserPath(workspace ?? baseDir, baseDir);
}

export function defaultWorkspaceStateDir(workspaceRoot = process.cwd()): string {
  return join(resolveUserPath(workspaceRoot), WORKSPACE_STATE_DIR);
}

export function defaultDataDir(workspaceRoot = process.cwd()): string {
  return defaultWorkspaceStateDir(workspaceRoot);
}

export function defaultConfigPath(workspaceRoot = process.cwd()): string {
  return join(defaultWorkspaceStateDir(workspaceRoot), 'config.yaml');
}

export function defaultLogsDir(workspaceRoot = process.cwd()): string {
  return join(defaultWorkspaceStateDir(workspaceRoot), 'logs');
}

export function defaultLogFile(workspaceRoot = process.cwd()): string {
  return join(defaultLogsDir(workspaceRoot), 'runtime.log');
}

export function defaultTemplateCacheDir(): string {
  return join(defaultRuntimeHome(), 'templates-cache');
}

export function resolveDataDir(dataDir: string | undefined, workspaceRoot = process.cwd()): string {
  return dataDir ? resolveUserPath(dataDir, workspaceRoot) : defaultDataDir(workspaceRoot);
}

export function resolveConfigPath(configPath: string | undefined, workspaceRoot = process.cwd()): string {
  return configPath ? resolveUserPath(configPath, workspaceRoot) : defaultConfigPath(workspaceRoot);
}

export function resolveLogFile(logFile: string | undefined, workspaceRoot = process.cwd()): string {
  return logFile ? resolveUserPath(logFile, workspaceRoot) : defaultLogFile(workspaceRoot);
}

export function logDirForFile(logFile: string): string {
  return dirname(logFile);
}

export function resolveUserPath(path: string, baseDir = process.cwd()): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  return resolve(baseDir, path);
}
