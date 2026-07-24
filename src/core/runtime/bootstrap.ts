import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { parse as parseYaml } from 'yaml';
import { Database } from '@/core/db/database.js';
import { resolveEnvVars } from '@/core/config/env-resolver.js';
import { resolveDataDir, resolveUserPath } from '@/core/config/paths.js';
import { SqliteMemoryProvider } from '@/core/memory/sqlite-memory-provider.js';
import type { MemoryProvider } from '@/core/memory/memory-provider.js';
import type { ModelConfig } from '@/types/model.js';

export type RuntimePaths = {
  workspaceRoot: string;
  dataDir: string;
  agentsDir: string;
  skillsDir: string;
  configPath: string;
  target: string;
};

export type RuntimeConfigLoadResult = {
  apiKeys: string[];
  models: ModelConfig[];
  memory?: MemoryProvider;
};

export function resolveRuntimePaths(opts: {
  dataDir?: string;
  agentsDir: string;
  skillsDir: string;
  config: string;
  target?: string;
  cwd?: string;
}): RuntimePaths {
  const workspaceRoot = opts.cwd ?? process.cwd();
  return {
    workspaceRoot,
    dataDir: resolveDataDir(opts.dataDir, workspaceRoot),
    agentsDir: resolveUserPath(opts.agentsDir, workspaceRoot),
    skillsDir: resolveUserPath(opts.skillsDir, workspaceRoot),
    configPath: resolveUserPath(opts.config, workspaceRoot),
    target: opts.target ?? 'local',
  };
}

export function openRuntimeDatabase(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'data.db'));
  db.runMigrations();
  ensureDefaultEnvironment(db);
  return db;
}

export function loadRuntimeConfig(configPath: string, target: string, db: Database): RuntimeConfigLoadResult {
  if (!existsSync(configPath)) {
    return { apiKeys: [], models: [] };
  }

  const config = parseYaml(readFileSync(configPath, 'utf-8')) as any;
  const apiKeys = Array.isArray(config.api_keys)
    ? config.api_keys
      .map((key: unknown) => (typeof key === 'string' ? resolveEnvVars(key, false) : ''))
      .filter(Boolean)
    : [];
  const memory = config.memory?.provider === 'sqlite'
    ? new SqliteMemoryProvider(db)
    : undefined;
  const models = mergeTargetModels(config.models, config.overrides?.[target]?.models);

  seedConfiguredEnvironments(db, config.environments);

  return { apiKeys, models, memory };
}

function ensureDefaultEnvironment(db: Database) {
  const envCheck = db.prepare('SELECT id FROM environments WHERE id = ?').get('env_default');
  if (!envCheck) {
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{"sandbox_provider":"local","timeout":300}')`);
  }
}

function mergeTargetModels(baseValue: unknown, overrideValue: unknown): ModelConfig[] {
  const baseModels = Array.isArray(baseValue) ? baseValue : [];
  const overrideModels = Array.isArray(overrideValue) ? overrideValue : [];
  const merged = new Map<string, any>();
  for (const model of baseModels) {
    if (model && typeof model === 'object' && typeof model.name === 'string') merged.set(model.name, model);
  }
  for (const model of overrideModels) {
    if (model && typeof model === 'object' && typeof model.name === 'string') merged.set(model.name, { ...merged.get(model.name), ...model });
  }
  return [...merged.values()].map((model) => ({
    name: model.name,
    provider: model.provider,
    model: model.model,
    base_url: model.base_url,
    api_key: model.api_key,
    is_default: Boolean(model.is_default),
  }) as ModelConfig);
}

function seedConfiguredEnvironments(db: Database, environments: unknown) {
  if (!environments || typeof environments !== 'object' || Array.isArray(environments)) return;
  for (const [name, envConfig] of Object.entries(environments as Record<string, unknown>)) {
    const existing = db.prepare('SELECT id FROM environments WHERE name = ?').get(name);
    if (existing) continue;
    db.prepare('INSERT INTO environments (id, name, config) VALUES (?, ?, ?)').run(
      `env_${nanoid(18)}`,
      name,
      JSON.stringify(envConfig ?? {}),
    );
  }
}
