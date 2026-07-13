import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_HOME_DIR = '.managed-agents';

export function defaultRuntimeHome(): string {
  const configured = process.env.MANAGED_AGENTS_HOME;
  return configured ? resolveUserPath(configured) : join(homedir(), DEFAULT_HOME_DIR);
}

export function workspaceDataSlug(workspaceRoot: string): string {
  const root = resolve(workspaceRoot);
  const name = sanitizeSegment(basename(root) || 'workspace');
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

export function defaultDataDir(workspaceRoot = process.cwd()): string {
  return join(defaultRuntimeHome(), workspaceDataSlug(workspaceRoot));
}

export function defaultTemplateCacheDir(): string {
  return join(defaultRuntimeHome(), 'templates-cache');
}

export function resolveDataDir(dataDir: string | undefined, workspaceRoot = process.cwd()): string {
  return dataDir ? resolveUserPath(dataDir, workspaceRoot) : defaultDataDir(workspaceRoot);
}

export function resolveUserPath(path: string, baseDir = process.cwd()): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  return resolve(baseDir, path);
}

function sanitizeSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return sanitized || 'workspace';
}
