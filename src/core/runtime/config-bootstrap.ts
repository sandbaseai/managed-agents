import { existsSync, readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { parse as parseYaml } from 'yaml';
import type { Database } from '@/core/db/database.js';
import type { RuntimeSettings, RuntimeSettingsSeed } from '@/core/settings/store.js';
import type { ModelConfig } from '@/types/model.js';

export type RuntimeConfigBootstrap = {
  models: ModelConfig[];
  settingsSeed: RuntimeSettingsSeed;
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
  if (!existsSync(configPath)) return { models: [], settingsSeed: {} };

  const configContent = readFileSync(configPath, 'utf-8');
  const config = parseYaml(configContent) as any;
  const models = readConfigModels(config, target);
  const settingsSeed = readConfigSettingsSeed(config);

  seedConfigEnvironments(db, config);

  return { models, settingsSeed };
}

function readConfigModels(config: any, target: string): ModelConfig[] {
  const baseModel = config.model && typeof config.model === 'object' ? config.model : undefined;
  const overrideModel = config.overrides?.[target]?.model && typeof config.overrides[target].model === 'object'
    ? config.overrides[target].model
    : undefined;
  const model = { ...baseModel, ...overrideModel };
  if (!model.provider && !model.vendor && !model.base_url && !model.api_key) return [];
  return [{
    name: 'default',
    provider: model.provider ?? model.vendor ?? 'openai',
    base_url: model.base_url,
    api_key: model.api_key,
    is_default: true,
  } as ModelConfig];
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

function readConfigSettingsSeed(config: any): RuntimeSettingsSeed {
  const seed: RuntimeSettingsSeed = {};
  const storage = readStorageSeed(config.storage);
  if (storage) seed.storage = storage;
  const memory = readMemorySeed(config.memory);
  if (memory) seed.memory = memory;
  return seed;
}

function readStorageSeed(value: unknown): RuntimeSettings['storage'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const config = value as Record<string, any>;
  const metadata = config.metadata && typeof config.metadata === 'object' ? config.metadata : {};
  const artifacts = config.artifacts && typeof config.artifacts === 'object' ? config.artifacts : {};
  const metadataProvider = metadata.provider === 'postgres' || metadata.provider === 'mysql' ? metadata.provider : 'sqlite';
  const artifactProvider = artifacts.provider === 's3' ? 's3' : 'local';
  return {
    metadata: {
      provider: metadataProvider,
      options: plainOptions(metadata.options),
    },
    artifacts: {
      provider: artifactProvider,
      options: {
        ...(artifactProvider === 'local' ? { base_path: 'files' } : {}),
        ...plainOptions(artifacts.options),
      },
    },
  };
}

function readMemorySeed(value: unknown): RuntimeSettings['memory'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const config = value as Record<string, any>;
  const provider = config.provider === 'memu' || config.provider === 'mem0' ? config.provider : 'sqlite';
  return {
    enabled: config.enabled !== false,
    provider,
    options: plainOptions(config.options),
  };
}

function plainOptions(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
