import { existsSync, readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { parse as parseYaml } from 'yaml';
import type { Database } from '@/core/db/database.js';
import { resolveEnvVars } from '@/core/config/env-resolver.js';
import type { MemoryProvider } from '@/core/memory/memory-provider.js';
import { SqliteMemoryProvider } from '@/core/memory/sqlite-memory-provider.js';
import type { ModelConfig } from '@/types/model.js';

export type RuntimeConfigBootstrap = {
  apiKeys: string[];
  models: ModelConfig[];
  memory?: MemoryProvider;
};

export function ensureDefaultEnvironment(db: Database): void {
  const envCheck = db.prepare('SELECT id FROM environments WHERE id = ?').get('env_default');
  if (!envCheck) {
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{"sandbox_provider":"local","timeout":300}')`);
  }
}

export function loadRuntimeConfigBootstrap({
  db,
  configPath,
  target,
}: {
  db: Database;
  configPath: string;
  target: string;
}): RuntimeConfigBootstrap {
  if (!existsSync(configPath)) return { apiKeys: [], models: [] };

  const configContent = readFileSync(configPath, 'utf-8');
  const config = parseYaml(configContent) as any;
  const apiKeys = readConfigApiKeys(config);
  const memory = config.memory?.provider === 'sqlite' ? new SqliteMemoryProvider(db) : undefined;
  const models = readConfigModels(config, target);

  seedConfigEnvironments(db, config);

  return { apiKeys, models, memory };
}

function readConfigApiKeys(config: any): string[] {
  if (!Array.isArray(config.api_keys)) return [];
  return config.api_keys
    .map((key: string) => (typeof key === 'string' ? resolveEnvVars(key, false) : ''))
    .filter(Boolean);
}

function readConfigModels(config: any, target: string): ModelConfig[] {
  const baseModels: any[] = Array.isArray(config.models) ? config.models : [];
  const overrideModels: any[] = config.overrides?.[target]?.models ?? [];
  const merged = new Map<string, any>();
  for (const model of baseModels) merged.set(model.name, model);
  for (const model of overrideModels) merged.set(model.name, { ...merged.get(model.name), ...model });
  return [...merged.values()].map((model) => ({
    name: model.name,
    provider: model.provider,
    model: model.model,
    base_url: model.base_url,
    api_key: model.api_key,
    is_default: Boolean(model.is_default),
  }) as ModelConfig);
}

function seedConfigEnvironments(db: Database, config: any): void {
  if (!config.environments || typeof config.environments !== 'object') return;
  for (const [name, envConfig] of Object.entries(config.environments as Record<string, any>)) {
    const envId = `env_${nanoid(18)}`;
    const existing = db.prepare('SELECT id FROM environments WHERE name = ?').get(name);
    if (!existing) {
      db.prepare('INSERT INTO environments (id, name, config) VALUES (?, ?, ?)').run(
        envId,
        name,
        JSON.stringify(envConfig),
      );
    }
  }
}
