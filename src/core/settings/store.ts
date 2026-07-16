import type { Database } from '@/core/db/database.js';
import type { RuntimeSettings } from './schema.js';
import { encryptSecret } from '@/core/security/secrets.js';

export type RuntimeSettingsRecord = {
  schema_version: 1;
  revision: number;
  saved_config: RuntimeSettings;
  effective_config: RuntimeSettings;
  restart_required: boolean;
};

export type RuntimeSettingsSecretStates = {
  model: { api_key: 'configured' | 'missing_env' | 'not_set' };
};

export type SaveRuntimeSettingsResult =
  | { ok: true; record: RuntimeSettingsRecord }
  | { ok: false; reason: 'revision_conflict'; record: RuntimeSettingsRecord };

const STORED_SECRET_PREFIX = '__managed_secret__:';

export type RuntimeSettingsSeed = {
  memoryEnabled?: boolean;
};

type SettingsRow = {
  schema_version: number;
  config: string;
  effective_config: string;
  revision: number;
  effective_revision: number;
  restart_required: number;
};

export function getOrSeedRuntimeSettings(db: Database, seed: RuntimeSettingsSeed = {}): RuntimeSettingsRecord {
  const existing = readSettingsRow(db);
  if (existing) return rowToRecord(existing);

  const config = legacySettingsSeed(db, seed);
  const serialized = JSON.stringify(config);
  db.prepare(`
    INSERT INTO runtime_settings (
      id, schema_version, config, effective_config, revision, effective_revision, restart_required
    ) VALUES ('default', 1, ?, ?, 1, 1, 0)
  `).run(serialized, serialized);
  return rowToRecord(readSettingsRow(db)!);
}

/** Apply the last validated saved revision during process startup. */
export function activateRuntimeSettings(db: Database, seed: RuntimeSettingsSeed = {}): RuntimeSettingsRecord {
  const current = getOrSeedRuntimeSettings(db, seed);
  if (!current.restart_required) return current;
  db.prepare(`
    UPDATE runtime_settings
    SET effective_config = config,
        effective_revision = revision,
        restart_required = 0,
        updated_at = datetime('now')
    WHERE id = 'default'
  `).run();
  return getOrSeedRuntimeSettings(db, seed);
}

export function maskRuntimeSettings(config: RuntimeSettings): RuntimeSettings {
  return {
    ...config,
    model: {
      ...config.model,
      api_key: config.model.api_key ? maskedSecret(config.model.api_key) : undefined,
      options: maskObjectSecrets(config.model.options),
    },
    loop_engine: { ...config.loop_engine, options: maskObjectSecrets(config.loop_engine.options) },
    storage: {
      metadata: { ...config.storage.metadata, options: maskObjectSecrets(config.storage.metadata.options) },
      artifacts: { ...config.storage.artifacts, options: maskObjectSecrets(config.storage.artifacts.options) },
    },
    memory: { ...config.memory, options: maskObjectSecrets(config.memory.options) },
    sandbox: { ...config.sandbox, options: maskObjectSecrets(config.sandbox.options) },
  };
}

export function runtimeSettingsSecretStates(db: Database, config: RuntimeSettings): RuntimeSettingsSecretStates {
  const model = db.prepare(`
    SELECT api_key FROM models
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `).get() as { api_key: string | null } | undefined;
  const stored = getStoredSecret(db, 'model.api_key');
  const value = stored ? STORED_SECRET_PREFIX : config.model.api_key ?? model?.api_key ?? undefined;
  return { model: { api_key: secretState(value) } };
}

export function saveRuntimeSettings(
  db: Database,
  config: RuntimeSettings,
  expectedRevision: number,
  dataDir?: string,
): SaveRuntimeSettingsResult {
  const current = getOrSeedRuntimeSettings(db);
  if (current.revision !== expectedRevision) {
    return { ok: false, reason: 'revision_conflict', record: current };
  }

  const persisted = persistSecrets(db, current.saved_config, config, dataDir);
  const nextRevision = current.revision + 1;
  db.prepare(`
    UPDATE runtime_settings
    SET config = ?, revision = ?, restart_required = 1, updated_at = datetime('now')
    WHERE id = 'default'
  `).run(JSON.stringify(persisted), nextRevision);
  return { ok: true, record: getOrSeedRuntimeSettings(db) };
}

function readSettingsRow(db: Database): SettingsRow | undefined {
  return db.prepare(`
    SELECT schema_version, config, effective_config, revision, effective_revision, restart_required
    FROM runtime_settings WHERE id = 'default'
  `).get() as SettingsRow | undefined;
}

function rowToRecord(row: SettingsRow): RuntimeSettingsRecord {
  return {
    schema_version: 1,
    revision: row.revision,
    saved_config: JSON.parse(row.config) as RuntimeSettings,
    effective_config: JSON.parse(row.effective_config) as RuntimeSettings,
    restart_required: row.restart_required === 1 || row.revision !== row.effective_revision,
  };
}

function legacySettingsSeed(db: Database, seed: RuntimeSettingsSeed): RuntimeSettings {
  const model = db.prepare(`
    SELECT provider, base_url, api_key
    FROM models
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `).get() as { provider: string; base_url: string | null; api_key: string | null } | undefined;
  const environment = db.prepare(`
    SELECT config FROM environments
    WHERE archived_at IS NULL
    ORDER BY CASE WHEN id = 'env_default' THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
  `).get() as { config: string } | undefined;
  const envConfig = parseObject(environment?.config);
  const vendor = normalizeVendor(model?.provider);
  const sandbox = envConfig.sandbox_provider === 'docker'
    ? 'docker'
    : envConfig.sandbox_provider === 'self_hosted'
      ? 'remote'
      : 'local';
  const memoryEnabled = seed.memoryEnabled === true;

  return {
    schema_version: 1,
    model: {
      vendor,
      ...(model?.base_url ? { base_url: model.base_url } : {}),
      ...(model?.api_key && /^\$\{[^}]+\}$/.test(model.api_key) ? { api_key: model.api_key } : {}),
      options: {},
    },
    loop_engine: { provider: 'builtin', options: { default_max_steps: 25 } },
    storage: {
      metadata: { provider: 'sqlite', options: {} },
      artifacts: { provider: 'local', options: { base_path: 'files' } },
    },
    memory: { enabled: memoryEnabled, provider: 'sqlite', options: {} },
    sandbox: {
      provider: sandbox,
      options: { timeout_seconds: numberValue(envConfig.timeout) ?? 300 },
    },
  };
}

function normalizeVendor(provider?: string): RuntimeSettings['model']['vendor'] {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  return 'openai_compatible';
}

function parseObject(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function maskedSecret(value: string): string {
  return /^\$\{[^}]+\}$/.test(value) ? value : '********';
}

function secretState(value?: string): RuntimeSettingsSecretStates['model']['api_key'] {
  if (!value) return 'not_set';
  const match = /^\$\{([^}]+)\}$/.exec(value);
  if (match && !process.env[match[1]]) return 'missing_env';
  return 'configured';
}

function persistSecrets(
  db: Database,
  current: RuntimeSettings,
  candidate: RuntimeSettings,
  dataDir?: string,
): RuntimeSettings {
  const apiKey = candidate.model.api_key;
  const currentApiKey = current.model.api_key;
  const preserve = apiKey === '********' || apiKey === maskedSecret(STORED_SECRET_PREFIX);
  if (preserve) {
    return {
      ...candidate,
      model: { ...candidate.model, ...(currentApiKey ? { api_key: currentApiKey } : {}), options: candidate.model.options },
    };
  }
  if (!apiKey) {
    db.prepare('DELETE FROM runtime_settings_secrets WHERE path = ?').run('model.api_key');
    return candidate;
  }
  if (/^\$\{[^}]+\}$/.test(apiKey)) {
    db.prepare('DELETE FROM runtime_settings_secrets WHERE path = ?').run('model.api_key');
    return candidate;
  }
  const encrypted = encryptSecret(apiKey, dataDir);
  db.prepare(`
    INSERT INTO runtime_settings_secrets (path, ciphertext, nonce, tag, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET
      ciphertext = excluded.ciphertext,
      nonce = excluded.nonce,
      tag = excluded.tag,
      updated_at = datetime('now')
  `).run('model.api_key', encrypted.ciphertext, encrypted.nonce, encrypted.tag);
  return {
    ...candidate,
    model: { ...candidate.model, api_key: `${STORED_SECRET_PREFIX}model.api_key`, options: candidate.model.options },
  };
}

function getStoredSecret(db: Database, path: string): boolean {
  return Boolean(db.prepare('SELECT path FROM runtime_settings_secrets WHERE path = ?').get(path));
}

function maskObjectSecrets<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const secret = /(api[_-]?key|secret|token|password|credential)/i.test(key);
    if (secret && typeof item === 'string') return [key, maskedSecret(item)];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return [key, maskObjectSecrets(item as Record<string, unknown>)];
    }
    return [key, item];
  })) as T;
}
