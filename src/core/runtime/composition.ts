import type { Database } from '@/core/db/database.js';
import type { MemoryProvider } from '@/core/memory/memory-provider.js';
import { SqliteMemoryProvider } from '@/core/memory/sqlite-memory-provider.js';
import { activateRuntimeSettings, localArtifactStorageDir, modelConfigFromRuntimeSettings, type RuntimeSettingsRecord } from '@/core/settings/store.js';
import { LocalArtifactStore } from '@/core/storage/artifact-store.js';
import type { ModelRegistry } from '@/model/registry.js';
import type { EnvironmentConfig, SandboxProviderType } from '@/types/sandbox.js';

export interface RuntimeComposition {
  settings: RuntimeSettingsRecord;
  memory?: MemoryProvider;
  artifactStore: LocalArtifactStore;
  resolveEnvironmentConfig(environmentId: string): EnvironmentConfig | undefined;
}

export function composeRuntimeFromSettings({
  db,
  dataDir,
  modelRegistry,
  memorySeedEnabled,
  sandboxProviders = ['local'],
}: {
  db: Database;
  dataDir: string;
  modelRegistry: ModelRegistry;
  memorySeedEnabled: boolean;
  sandboxProviders?: string[];
}): RuntimeComposition {
  const settings = activateRuntimeSettings(db, { memoryEnabled: memorySeedEnabled }, dataDir, sandboxProviders);
  const effectiveSettings = settings.effective_config;

  modelRegistry.clear();
  modelRegistry.register(modelConfigFromRuntimeSettings(db, effectiveSettings, dataDir));

  const memory = effectiveSettings.memory.enabled && effectiveSettings.memory.provider === 'sqlite'
    ? new SqliteMemoryProvider(db)
    : undefined;
  const artifactStore = new LocalArtifactStore(localArtifactStorageDir(dataDir, effectiveSettings));

  return {
    settings,
    memory,
    artifactStore,
    resolveEnvironmentConfig(environmentId: string): EnvironmentConfig | undefined {
      const row = db.prepare('SELECT id, name, config FROM environments WHERE id = ? AND archived_at IS NULL').get(environmentId) as
        | { id: string; name: string; config: string }
        | undefined;
      if (!row) return undefined;
      const environment = normalizeRuntimeEnvironment(row);
      // env_default is the workspace fallback; named Environments remain
      // explicit session-level sandbox overrides.
      if (row.id !== 'env_default') return environment;
      return {
        ...environment,
        sandbox_provider: effectiveSettings.sandbox.provider === 'remote'
          ? 'self_hosted'
          : effectiveSettings.sandbox.provider,
        timeout: effectiveSettings.sandbox.options.timeout_seconds,
      } as EnvironmentConfig;
    },
  };
}

export function normalizeRuntimeEnvironment(row: { id: string; name: string; config: string }): EnvironmentConfig {
  const parsed = parseJsonObject(row.config);
  const sandboxProvider = parseSandboxProvider(parsed.sandbox_provider)
    ?? (parsed.hosting_type === 'self_hosted' ? 'self_hosted' : 'local');

  return {
    ...parsed,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : row.name || row.id,
    sandbox_provider: sandboxProvider,
    timeout: typeof parsed.timeout === 'number' ? parsed.timeout : 300,
  };
}

function parseSandboxProvider(value: unknown): SandboxProviderType | undefined {
  return value === 'local'
    || value === 'docker'
    || value === 'e2b'
    || value === 'daytona'
    || value === 'self_hosted'
    ? value
    : undefined;
}

function parseJsonObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
