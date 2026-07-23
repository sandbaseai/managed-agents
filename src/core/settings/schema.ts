import type { Database } from '@/core/db/database.js';
import { resolveEnvVars } from '@/core/config/env-resolver.js';
import { listModelProviders } from '@/core/model/providers.js';
import { listMemoryProviders } from '@/core/memory/providers.js';
import { listStorageProviders } from '@/core/storage/providers.js';

export type SettingsState = 'configured' | 'missing_env' | 'not_set';
export type ValidationStatus = 'ok' | 'warning' | 'error';

export type ValidationCheck = {
  key: string;
  label: string;
  status: ValidationStatus;
  message: string;
};

export type RuntimeSettings = {
  type: 'settings';
  model_provider: {
    vendor: string;
    base_url?: string;
    api_key_env?: string;
    api_key_state: SettingsState;
    configured: boolean;
  };
  loop_engine: {
    type: 'managed-agents' | 'harness' | 'codex' | 'claude';
    implemented: boolean;
    config: Record<string, unknown>;
  };
  storage: {
    metadata: {
      type: string;
      path?: string;
      connection_url?: string;
      state: SettingsState;
      implemented: boolean;
    };
    artifacts: {
      type: string;
      path?: string;
      bucket?: string;
      region?: string;
      state: SettingsState;
      implemented: boolean;
    };
  };
  memory: {
    backend: {
      type: string;
      connection_url?: string;
      api_key_state: SettingsState;
      implemented: boolean;
    };
  };
  sandbox: {
    type: string;
    implemented: boolean;
    available: boolean;
    providers: string[];
    config: Record<string, unknown>;
  };
  validation: {
    status: ValidationStatus;
    checks: ValidationCheck[];
  };
};

export type RuntimeSettingsPatch = {
  model_provider?: {
    vendor?: unknown;
    base_url?: unknown;
    api_key_env?: unknown;
  };
  loop_engine?: {
    type?: unknown;
    config?: unknown;
  };
  storage?: {
    metadata?: {
      type?: unknown;
      path?: unknown;
      connection_url?: unknown;
    };
    artifacts?: {
      type?: unknown;
      path?: unknown;
      bucket?: unknown;
      region?: unknown;
    };
  };
  memory?: {
    backend?: {
      type?: unknown;
      connection_url?: unknown;
      api_key_env?: unknown;
    };
  };
  sandbox?: {
    type?: unknown;
    config?: unknown;
  };
};

export type RuntimeSettingsContext = {
  sandboxProviders?: string[];
  dataDir?: string;
};

const ENV_PLACEHOLDER = /\$\{([^}]+)\}/;
const IMPLEMENTED_LOOP_ENGINES = new Set(['managed-agents']);
const IMPLEMENTED_MEMORY_BACKENDS = new Set(['sqlite', 'in_memory']);
const IMPLEMENTED_METADATA_STORAGE = new Set(['sqlite']);
const IMPLEMENTED_ARTIFACT_STORAGE = new Set(['local_filesystem']);
const IMPLEMENTED_SANDBOXES = new Set(['local', 'docker', 'self_hosted']);

export function getRuntimeSettings(db: Database, context: RuntimeSettingsContext = {}): RuntimeSettings {
  const models = listModelProviders(db);
  const defaultModel = models.find((model) => model.is_default) ?? models[0];
  const memoryProviders = listMemoryProviders(db);
  const defaultMemory = memoryProviders.find((provider) => provider.is_default) ?? memoryProviders[0];
  const metadata = listStorageProviders(db, 'metadata').find((provider) => provider.is_default)
    ?? listStorageProviders(db, 'metadata')[0];
  const artifacts = listStorageProviders(db, 'artifact').find((provider) => provider.is_default)
    ?? listStorageProviders(db, 'artifact')[0];
  const sandboxProviders = context.sandboxProviders ?? ['local'];
  const storedLoop = readRuntimeSetting(db, 'loop_engine');
  const storedSandbox = readRuntimeSetting(db, 'sandbox');
  const loopType = cleanString(storedLoop.type) ?? 'managed-agents';
  const sandboxType = cleanString(storedSandbox.type) ?? sandboxProviders[0] ?? 'local';

  const settings: RuntimeSettings = {
    type: 'settings',
    model_provider: {
      vendor: defaultModel?.provider ?? 'openai-compatible',
      base_url: publicResolved(defaultModel?.base_url),
      api_key_env: envName(defaultModel?.api_key),
      api_key_state: stateForSecretRef(defaultModel?.api_key),
      configured: Boolean(defaultModel),
    },
    loop_engine: {
      type: loopType as RuntimeSettings['loop_engine']['type'],
      implemented: IMPLEMENTED_LOOP_ENGINES.has(loopType),
      config: isPlainObject(storedLoop.config) ? storedLoop.config : {},
    },
    storage: {
      metadata: {
        type: metadata?.provider ?? 'sqlite',
        path: metadata?.provider === 'sqlite' ? (metadata.connection_url ?? `${context.dataDir ?? '~/.managed-agents'}/data.db`) : undefined,
        connection_url: metadata?.provider !== 'sqlite' ? publicResolved(metadata?.connection_url) : undefined,
        state: metadata ? stateForSecretRef(metadata.connection_url) : 'not_set',
        implemented: metadata ? IMPLEMENTED_METADATA_STORAGE.has(metadata.provider) : true,
      },
      artifacts: {
        type: artifacts?.provider ?? 'local_filesystem',
        path: artifacts?.base_path ?? `${context.dataDir ?? '~/.managed-agents'}/files`,
        bucket: artifacts?.bucket,
        region: artifacts?.region,
        state: artifacts ? stateForSecretRef(artifacts.secret_key ?? artifacts.access_key) : 'not_set',
        implemented: artifacts ? IMPLEMENTED_ARTIFACT_STORAGE.has(artifacts.provider) : true,
      },
    },
    memory: {
      backend: {
        type: defaultMemory?.provider ?? 'sqlite',
        connection_url: publicResolved(defaultMemory?.connection_url),
        api_key_state: stateForSecretRef(defaultMemory?.api_key),
        implemented: defaultMemory ? IMPLEMENTED_MEMORY_BACKENDS.has(defaultMemory.provider) : true,
      },
    },
    sandbox: {
      type: sandboxType,
      implemented: IMPLEMENTED_SANDBOXES.has(sandboxType),
      available: sandboxProviders.includes(sandboxType),
      providers: sandboxProviders,
      config: isPlainObject(storedSandbox.config) ? storedSandbox.config : {},
    },
    validation: {
      status: 'ok',
      checks: [],
    },
  };
  settings.validation = validateRuntimeSettings(settings);
  return settings;
}

export function validateRuntimeSettings(settings: RuntimeSettings | RuntimeSettingsPatch): RuntimeSettings['validation'] {
  const checks: ValidationCheck[] = [];
  const current = normalizeSettingsLike(settings);

  checks.push({
    key: 'model_provider',
    label: 'Model provider',
    status: current.model_provider.configured ? stateStatus(current.model_provider.api_key_state) : 'warning',
    message: current.model_provider.configured
      ? `Active provider: ${current.model_provider.vendor}`
      : 'No active model provider is configured.',
  });

  checks.push({
    key: 'loop_engine',
    label: 'Loop engine',
    status: IMPLEMENTED_LOOP_ENGINES.has(current.loop_engine.type) ? 'ok' : 'error',
    message: IMPLEMENTED_LOOP_ENGINES.has(current.loop_engine.type)
      ? 'Managed Agents loop engine is available.'
      : `${current.loop_engine.type} loop engine is not implemented yet.`,
  });

  checks.push({
    key: 'storage.metadata',
    label: 'Metadata storage',
    status: current.storage.metadata.implemented ? 'ok' : 'error',
    message: current.storage.metadata.implemented
      ? `${current.storage.metadata.type} metadata storage is available.`
      : `${current.storage.metadata.type} metadata storage needs an adapter.`,
  });

  checks.push({
    key: 'storage.artifacts',
    label: 'Artifact storage',
    status: current.storage.artifacts.implemented ? 'ok' : 'error',
    message: current.storage.artifacts.implemented
      ? `${current.storage.artifacts.type} artifact storage is available.`
      : `${current.storage.artifacts.type} artifact storage needs an adapter.`,
  });

  checks.push({
    key: 'memory.backend',
    label: 'Memory backend',
    status: current.memory.backend.implemented ? 'ok' : 'error',
    message: current.memory.backend.implemented
      ? `${current.memory.backend.type} memory backend is available.`
      : `${current.memory.backend.type} memory backend needs an adapter.`,
  });

  checks.push({
    key: 'sandbox',
    label: 'Sandbox',
    status: current.sandbox.available && current.sandbox.implemented ? 'ok' : 'warning',
    message: current.sandbox.available
      ? `Active sandbox: ${current.sandbox.type}`
      : 'No sandbox provider is currently available.',
  });

  return {
    status: checks.some((check) => check.status === 'error')
      ? 'error'
      : checks.some((check) => check.status === 'warning')
        ? 'warning'
        : 'ok',
    checks,
  };
}

export function updateRuntimeSettings(
  db: Database,
  patch: RuntimeSettingsPatch,
  context: RuntimeSettingsContext = {},
): RuntimeSettings {
  if (patch.model_provider) {
    upsertDefaultModelProvider(db, patch.model_provider);
  }
  if (patch.loop_engine) {
    upsertRuntimeSetting(db, 'loop_engine', {
      type: cleanString(patch.loop_engine.type) ?? 'managed-agents',
      config: isPlainObject(patch.loop_engine.config) ? patch.loop_engine.config : {},
    });
  }
  if (patch.memory?.backend) {
    upsertDefaultMemoryBackend(db, patch.memory.backend);
  }
  if (patch.storage?.metadata) {
    upsertDefaultStorage(db, 'metadata', patch.storage.metadata);
  }
  if (patch.storage?.artifacts) {
    upsertDefaultStorage(db, 'artifact', patch.storage.artifacts);
  }
  if (patch.sandbox) {
    upsertRuntimeSetting(db, 'sandbox', {
      type: cleanString(patch.sandbox.type) ?? 'local',
      config: isPlainObject(patch.sandbox.config) ? patch.sandbox.config : {},
    });
  }
  return getRuntimeSettings(db, context);
}

function readRuntimeSetting(db: Database, key: 'loop_engine' | 'sandbox'): Record<string, unknown> {
  const row = db.prepare('SELECT value FROM runtime_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function upsertRuntimeSetting(db: Database, key: 'loop_engine' | 'sandbox', value: Record<string, unknown>) {
  db.prepare(`
    INSERT INTO runtime_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

function upsertDefaultModelProvider(db: Database, input: NonNullable<RuntimeSettingsPatch['model_provider']>) {
  const vendor = cleanString(input.vendor) ?? 'openai-compatible';
  const baseUrl = cleanString(input.base_url);
  const apiKey = envRef(cleanString(input.api_key_env));
  const existing = listModelProviders(db).find((model) => model.is_default) ?? listModelProviders(db)[0];
  const now = new Date().toISOString();
  const name = existing?.name ?? 'default-provider';

  db.transaction(() => {
    db.prepare('UPDATE models SET is_default = 0, updated_at = ?').run(now);
    if (existing) {
      db.prepare(`
        UPDATE models
        SET provider = ?, model = ?, base_url = ?, api_key = ?, is_default = 1, updated_at = ?
        WHERE name = ?
      `).run(vendor, vendor, baseUrl ?? null, apiKey ?? null, now, name);
    } else {
      db.prepare(`
        INSERT INTO models (name, provider, model, base_url, api_key, config, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(name, vendor, vendor, baseUrl ?? null, apiKey ?? null, '{}', now, now);
    }
  });
}

function upsertDefaultMemoryBackend(db: Database, input: NonNullable<RuntimeSettingsPatch['memory']>['backend']) {
  const provider = cleanString(input?.type) ?? 'sqlite';
  const connectionUrl = cleanString(input?.connection_url);
  const apiKey = envRef(cleanString(input?.api_key_env));
  const existing = listMemoryProviders(db).find((item) => item.is_default) ?? listMemoryProviders(db)[0];
  const now = new Date().toISOString();
  const name = existing?.name ?? 'context-memory';
  const status = IMPLEMENTED_MEMORY_BACKENDS.has(provider) ? 'active' : 'adapter_required';

  db.transaction(() => {
    db.prepare('UPDATE memory_providers SET is_default = 0, updated_at = ?').run(now);
    if (existing) {
      db.prepare(`
        UPDATE memory_providers
        SET provider = ?, connection_url = ?, api_key = ?, config = ?, is_default = ?, status = ?, updated_at = ?
        WHERE name = ?
      `).run(provider, connectionUrl ?? null, apiKey ?? null, '{}', status === 'active' ? 1 : 0, status, now, name);
    } else {
      db.prepare(`
        INSERT INTO memory_providers (name, provider, connection_url, api_key, config, is_default, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, provider, connectionUrl ?? null, apiKey ?? null, '{}', status === 'active' ? 1 : 0, status, now, now);
    }
  });
}

function upsertDefaultStorage(
  db: Database,
  role: 'metadata' | 'artifact',
  input: NonNullable<NonNullable<RuntimeSettingsPatch['storage']>['metadata']>,
) {
  const fallbackType = role === 'metadata' ? 'sqlite' : 'local_filesystem';
  const provider = cleanString(input.type) ?? fallbackType;
  const existing = listStorageProviders(db, role).find((item) => item.is_default) ?? listStorageProviders(db, role)[0];
  const now = new Date().toISOString();
  const name = existing?.name ?? (role === 'metadata' ? 'metadata-sqlite' : 'local-artifacts');
  const implemented = role === 'metadata' ? IMPLEMENTED_METADATA_STORAGE.has(provider) : IMPLEMENTED_ARTIFACT_STORAGE.has(provider);
  const status = implemented ? 'active' : 'adapter_required';

  db.transaction(() => {
    db.prepare('UPDATE storage_providers SET is_default = 0, updated_at = ? WHERE role = ?').run(now, role);
    if (existing) {
      db.prepare(`
        UPDATE storage_providers
        SET provider = ?, connection_url = ?, bucket = ?, region = ?, base_path = ?,
            is_default = ?, status = ?, initialized_at = COALESCE(initialized_at, ?), updated_at = ?
        WHERE name = ?
      `).run(
        provider,
        cleanString(input.connection_url) ?? null,
        cleanString((input as any).bucket) ?? null,
        cleanString((input as any).region) ?? null,
        cleanString(input.path) ?? null,
        implemented ? 1 : 0,
        status,
        implemented ? now : null,
        now,
        name,
      );
    } else {
      db.prepare(`
        INSERT INTO storage_providers (
          name, role, provider, connection_url, bucket, region, base_path, access_key, secret_key,
          config, is_default, status, initialized_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, '{}', ?, ?, ?, ?, ?)
      `).run(
        name,
        role,
        provider,
        cleanString(input.connection_url) ?? null,
        cleanString((input as any).bucket) ?? null,
        cleanString((input as any).region) ?? null,
        cleanString(input.path) ?? null,
        implemented ? 1 : 0,
        status,
        implemented ? now : null,
        now,
        now,
      );
    }
  });
}

function normalizeSettingsLike(settings: RuntimeSettings | RuntimeSettingsPatch): RuntimeSettings {
  if ((settings as RuntimeSettings).type === 'settings') return settings as RuntimeSettings;
  const patch = settings as RuntimeSettingsPatch;
  const memoryType = cleanString(patch.memory?.backend?.type) ?? 'sqlite';
  const metadataType = cleanString(patch.storage?.metadata?.type) ?? 'sqlite';
  const artifactType = cleanString(patch.storage?.artifacts?.type) ?? 'local_filesystem';
  const sandboxType = cleanString(patch.sandbox?.type) ?? 'local';
  const loopType = cleanString(patch.loop_engine?.type) ?? 'managed-agents';
  return {
    type: 'settings',
    model_provider: {
      vendor: cleanString(patch.model_provider?.vendor) ?? 'openai-compatible',
      base_url: cleanString(patch.model_provider?.base_url),
      api_key_env: cleanString(patch.model_provider?.api_key_env),
      api_key_state: cleanString(patch.model_provider?.api_key_env) ? stateForSecretRef(envRef(cleanString(patch.model_provider?.api_key_env))) : 'not_set',
      configured: Boolean(cleanString(patch.model_provider?.vendor)),
    },
    loop_engine: {
      type: loopType as RuntimeSettings['loop_engine']['type'],
      implemented: IMPLEMENTED_LOOP_ENGINES.has(loopType),
      config: isPlainObject(patch.loop_engine?.config) ? patch.loop_engine.config : {},
    },
    storage: {
      metadata: {
        type: metadataType,
        path: cleanString(patch.storage?.metadata?.path),
        connection_url: cleanString(patch.storage?.metadata?.connection_url),
        state: stateForSecretRef(cleanString(patch.storage?.metadata?.connection_url)),
        implemented: IMPLEMENTED_METADATA_STORAGE.has(metadataType),
      },
      artifacts: {
        type: artifactType,
        path: cleanString(patch.storage?.artifacts?.path),
        bucket: cleanString(patch.storage?.artifacts?.bucket),
        region: cleanString(patch.storage?.artifacts?.region),
        state: 'not_set',
        implemented: IMPLEMENTED_ARTIFACT_STORAGE.has(artifactType),
      },
    },
    memory: {
      backend: {
        type: memoryType,
        connection_url: cleanString(patch.memory?.backend?.connection_url),
        api_key_state: cleanString(patch.memory?.backend?.api_key_env) ? stateForSecretRef(envRef(cleanString(patch.memory?.backend?.api_key_env))) : 'not_set',
        implemented: IMPLEMENTED_MEMORY_BACKENDS.has(memoryType),
      },
    },
    sandbox: {
      type: sandboxType,
      implemented: IMPLEMENTED_SANDBOXES.has(sandboxType),
      available: true,
      providers: [sandboxType],
      config: isPlainObject(patch.sandbox?.config) ? patch.sandbox.config : {},
    },
    validation: { status: 'ok', checks: [] },
  };
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function envRef(name?: string): string | undefined {
  if (!name) return undefined;
  if (name.startsWith('${') && name.endsWith('}')) return name;
  return `\${${name}}`;
}

function envName(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(ENV_PLACEHOLDER);
  return match?.[1] ?? undefined;
}

function stateForSecretRef(value?: string): SettingsState {
  if (!value) return 'not_set';
  const resolved = resolveEnvVars(value, false);
  return ENV_PLACEHOLDER.test(resolved) ? 'missing_env' : 'configured';
}

function stateStatus(state: SettingsState): ValidationStatus {
  if (state === 'missing_env') return 'warning';
  return 'ok';
}

function publicResolved(value?: string): string | undefined {
  if (!value) return undefined;
  const resolved = resolveEnvVars(value, false);
  if (ENV_PLACEHOLDER.test(resolved)) return undefined;
  try {
    const url = new URL(resolved);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return resolved;
  }
}
