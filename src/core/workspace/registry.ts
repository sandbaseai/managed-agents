import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { defaultRuntimeHome, resolveUserPath, workspaceDataSlug } from '@/core/config/paths.js';

export type WorkspaceRegistryEntry = {
  id: string;
  name: string;
  root: string;
  data_dir: string;
  created_at: string;
  last_opened_at: string;
};

export type WorkspaceRegistryFile = {
  version: 1;
  workspaces: WorkspaceRegistryEntry[];
};

export function workspaceRegistryPath(home = defaultRuntimeHome()): string {
  return join(home, 'workspaces.json');
}

export function listRegisteredWorkspaces(opts: { home?: string } = {}): WorkspaceRegistryEntry[] {
  return readRegistry(opts.home).workspaces.sort((a, b) => b.last_opened_at.localeCompare(a.last_opened_at));
}

export function registerWorkspace(input: { root: string; name?: string; dataDir?: string; home?: string; now?: Date }): WorkspaceRegistryEntry {
  const root = resolveUserPath(input.root);
  const home = input.home ?? defaultRuntimeHome();
  const now = (input.now ?? new Date()).toISOString();
  const registry = readRegistry(home);
  const existing = registry.workspaces.find((workspace) => workspace.root === root);
  const entry: WorkspaceRegistryEntry = {
    id: workspaceDataSlug(root),
    name: cleanName(input.name) ?? (basename(root) || 'workspace'),
    root,
    data_dir: input.dataDir ? resolveUserPath(input.dataDir, root) : join(home, workspaceDataSlug(root)),
    created_at: existing?.created_at ?? now,
    last_opened_at: now,
  };
  registry.workspaces = [entry, ...registry.workspaces.filter((workspace) => workspace.root !== root && workspace.id !== entry.id)];
  writeRegistry(registry, home);
  return entry;
}

export function createRegisteredWorkspace(input: { root: string; name?: string; dataDir?: string; home?: string; now?: Date }): WorkspaceRegistryEntry {
  const root = resolveUserPath(input.root);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  mkdirSync(join(root, 'skills'), { recursive: true });
  const configPath = join(root, 'managed-agents.config.yaml');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, defaultWorkspaceConfig(), 'utf8');
  }
  return registerWorkspace({ ...input, root });
}

export function removeRegisteredWorkspace(idOrNameOrRoot: string, opts: { home?: string } = {}): boolean {
  const home = opts.home ?? defaultRuntimeHome();
  const registry = readRegistry(home);
  const before = registry.workspaces.length;
  registry.workspaces = registry.workspaces.filter((workspace) => !matchesWorkspace(workspace, idOrNameOrRoot));
  writeRegistry(registry, home);
  return registry.workspaces.length !== before;
}

export function resolveRegisteredWorkspace(idOrNameOrRoot: string, opts: { home?: string; now?: Date } = {}): WorkspaceRegistryEntry | undefined {
  const home = opts.home ?? defaultRuntimeHome();
  const registry = readRegistry(home);
  const entry = registry.workspaces.find((workspace) => matchesWorkspace(workspace, idOrNameOrRoot));
  if (!entry) return undefined;
  entry.last_opened_at = (opts.now ?? new Date()).toISOString();
  writeRegistry(registry, home);
  return entry;
}

function readRegistry(home = defaultRuntimeHome()): WorkspaceRegistryFile {
  const path = workspaceRegistryPath(home);
  if (!existsSync(path)) return { version: 1, workspaces: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceRegistryFile;
    return {
      version: 1,
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.filter(isEntry) : [],
    };
  } catch {
    return { version: 1, workspaces: [] };
  }
}

function writeRegistry(registry: WorkspaceRegistryFile, home = defaultRuntimeHome()) {
  const path = workspaceRegistryPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, workspaces: registry.workspaces }, null, 2)}\n`, 'utf8');
}

function matchesWorkspace(workspace: WorkspaceRegistryEntry, value: string): boolean {
  const candidate = value.trim();
  return workspace.id === candidate
    || workspace.name === candidate
    || workspace.root === resolve(candidate)
    || workspace.root === resolveUserPath(candidate);
}

function isEntry(value: unknown): value is WorkspaceRegistryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.root === 'string'
    && typeof record.data_dir === 'string'
    && typeof record.created_at === 'string'
    && typeof record.last_opened_at === 'string';
}

function cleanName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function defaultWorkspaceConfig(): string {
  return `# managed-agents workspace configuration
models: []

environments:
  local:
    sandbox_provider: local
    timeout: 300
`;
}
