import type { Database } from '@/core/db/database.js';
import { relative, resolve, sep } from 'node:path';
import { runtimeSettingsSchema, type RuntimeSettings } from './schema.js';
import { decryptSecret, encryptSecret } from '@/core/security/secrets.js';
import type { ModelConfig } from '@/types/model.js';

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

export function getOrSeedRuntimeSettings(db: Database, seed: RuntimeSettingsSeed = {}, dataDir?: string): RuntimeSettingsRecord {
  const existing = readSettingsRow(db);
  if (existing) return rowToRecord(existing);

  const legacyConfig = legacySettingsSeed(db, seed);
  const config = persistSecrets(db, legacyConfig, legacyConfig, dataDir);
  // Settings V2 is now the secret authority. Do not preserve literal secrets
  // in the compatibility models table after importing an existing workspace.
  if (legacyConfig.model.api_key && !/^\$\{[^}]+\}$/.test(legacyConfig.model.api_key)) {
    db.prepare('UPDATE models SET api_key = NULL WHERE api_key IS NOT NULL').run();
  }
  const serialized = JSON.stringify(config);
  db.prepare(`
    INSERT INTO runtime_settings (
      id, schema_version, config, effective_config, revision, effective_revision, restart_required
    ) VALUES ('default', 1, ?, ?, 1, 1, 0)
  `).run(serialized, serialized);
  return rowToRecord(readSettingsRow(db)!);
}

/** Apply the last validated saved revision during process startup. */
export function activateRuntimeSettings(db: Database, seed: RuntimeSettingsSeed = {}, dataDir?: string): RuntimeSettingsRecord {
  const current = getOrSeedRuntimeSettings(db, seed, dataDir);
  if (!current.restart_required) return current;
  db.prepare(`
    UPDATE runtime_settings
    SET effective_config = config,
        effective_revision = revision,
        restart_required = 0,
        updated_at = datetime('now')
    WHERE id = 'default'
  `).run();
  return getOrSeedRuntimeSettings(db, seed, dataDir);
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
  const stored = getStoredSecret(db, 'model.api_key');
  const value = stored ? STORED_SECRET_PREFIX : config.model.api_key;
  return { model: { api_key: secretState(value) } };
}

export function saveRuntimeSettings(
  db: Database,
  config: RuntimeSettings,
  expectedRevision: number,
  dataDir?: string,
): SaveRuntimeSettingsResult {
  const current = getOrSeedRuntimeSettings(db, {}, dataDir);
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
  return { ok: true, record: getOrSeedRuntimeSettings(db, {}, dataDir) };
}

/**
 * Builds the one runtime model configuration from the effective Settings V2
 * document. Model IDs remain adapter implementation details rather than a
 * Dashboard setting; the resolved ID can be surfaced as diagnostics only.
 */
export function modelConfigFromRuntimeSettings(
  db: Database,
  config: RuntimeSettings,
  dataDir?: string,
): ModelConfig {
  return {
    name: 'default',
    provider: config.model.vendor,
    model: defaultModelForVendor(config.model.vendor),
    base_url: config.model.base_url,
    api_key: resolveModelApiKey(db, config.model.api_key, dataDir),
    is_default: true,
  };
}

/** Resolve the active local artifact directory without permitting data-dir escapes. */
export function localArtifactStorageDir(dataDir: string, config: RuntimeSettings): string {
  if (config.storage.artifacts.provider !== 'local') {
    throw new Error(`Artifact provider "${config.storage.artifacts.provider}" is not available`);
  }
  const configured = config.storage.artifacts.options.base_path;
  const basePath = typeof configured === 'string' && configured.trim() ? configured.trim() : 'files';
  const root = resolve(dataDir);
  const target = resolve(root, basePath);
  const relativePath = relative(root, target);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.includes(`${sep}..${sep}`)) {
    throw new Error('Artifact base_path must be a non-empty path inside the runtime data directory');
  }
  return target;
}

function readSettingsRow(db: Database): SettingsRow | undefined {
  return db.prepare(`
    SELECT schema_version, config, effective_config, revision, effective_revision, restart_required
    FROM runtime_settings WHERE id = 'default'
  `).get() as SettingsRow | undefined;
}

function rowToRecord(row: SettingsRow): RuntimeSettingsRecord {
  const saved = parseRuntimeSettings(row.config);
  const effective = parseRuntimeSettings(row.effective_config);
  if (!saved && !effective) {
    throw new Error('Runtime settings contain no valid saved or effective configuration.');
  }
  const effectiveConfig = effective ?? saved!;
  const savedConfig = saved ?? effectiveConfig;
  return {
    schema_version: 1,
    revision: row.revision,
    saved_config: savedConfig,
    effective_config: effectiveConfig,
    restart_required: Boolean(saved) && (row.restart_required === 1 || row.revision !== row.effective_revision),
  };
}

function parseRuntimeSettings(value: string): RuntimeSettings | undefined {
  try {
    const parsed = JSON.parse(value);
    const result = runtimeSettingsSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
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

function resolveModelApiKey(db: Database, value: string | undefined, dataDir?: string): string | undefined {
  if (value !== `${STORED_SECRET_PREFIX}model.api_key`) return value;
  const row = db.prepare('SELECT ciphertext, nonce, tag FROM runtime_settings_secrets WHERE path = ?').get('model.api_key') as
    | { ciphertext: string; nonce: string; tag: string }
    | undefined;
  return row ? decryptSecret(row, dataDir) : undefined;
}

function defaultModelForVendor(vendor: RuntimeSettings['model']['vendor']): string {
  switch (vendor) {
    case 'anthropic': return 'claude-sonnet-4-20250514';
    case 'openai': return 'gpt-4.1';
    case 'openai_compatible': return 'gpt-4.1';
  }
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
