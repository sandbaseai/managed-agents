import type { Database } from '@/core/db/database.js';
import { decryptSecret, encryptSecret } from '@/core/security/secrets.js';
import type { RuntimeSettings } from './schema.js';

const STORED_SECRET_PREFIX = '__managed_secret__:';

export type RuntimeSettingsSecretStates = {
  model: { api_key: 'configured' | 'missing_env' | 'not_set' };
};

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
  return { model: { api_key: secretState(db, 'model.api_key', config.model.api_key) } };
}

export function hasRuntimeSettingsSecret(db: Database, path: string): boolean {
  return Boolean(getStoredSecret(db, path));
}

export function persistRuntimeSettingsSecrets(
  db: Database,
  current: RuntimeSettings,
  candidate: RuntimeSettings,
  dataDir?: string,
  effective?: RuntimeSettings,
): RuntimeSettings {
  const preservedPaths = new Set<string>();
  if (effective) collectSecretReferences(effective, preservedPaths);
  const persisted = walkSecrets(candidate, current, '', db, dataDir, preservedPaths) as RuntimeSettings;
  cleanupUnreferencedRuntimeSettingsSecrets(db, persisted, effective);
  return persisted;
}

export function cleanupUnreferencedRuntimeSettingsSecrets(db: Database, ...configs: Array<RuntimeSettings | undefined>): void {
  const referenced = new Set<string>();
  for (const config of configs) {
    if (config) collectSecretReferences(config, referenced);
  }
  const rows = db.prepare('SELECT path FROM runtime_settings_secrets').all() as Array<{ path: string }>;
  for (const row of rows) {
    if (!referenced.has(row.path)) db.prepare('DELETE FROM runtime_settings_secrets WHERE path = ?').run(row.path);
  }
}

export function resolveRuntimeSettingsModelApiKey(db: Database, value: string | undefined, dataDir?: string): string | undefined {
  if (value !== `${STORED_SECRET_PREFIX}model.api_key`) return value;
  const row = db.prepare('SELECT ciphertext, nonce, tag FROM runtime_settings_secrets WHERE path = ?').get('model.api_key') as
    | { ciphertext: string; nonce: string; tag: string }
    | undefined;
  return row ? decryptSecret(row, dataDir) : undefined;
}

function maskedSecret(value: string): string {
  return /^\$\{[^}]+\}$/.test(value) ? value : '********';
}

function secretState(db: Database, path: string, value?: string): RuntimeSettingsSecretStates['model']['api_key'] {
  if (!value) return 'not_set';
  if (value === `${STORED_SECRET_PREFIX}${path}`) {
    return getStoredSecret(db, path) ? 'configured' : 'not_set';
  }
  const match = /^\$\{([^}]+)\}$/.exec(value);
  if (match && !process.env[match[1]]) return 'missing_env';
  return 'configured';
}

function collectSecretReferences(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string' && value.startsWith(STORED_SECRET_PREFIX)) {
    paths.add(value.slice(STORED_SECRET_PREFIX.length));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecretReferences(item, paths);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectSecretReferences(item, paths);
  }
}

function walkSecrets(
  candidate: unknown,
  current: unknown,
  path: string,
  db: Database,
  dataDir?: string,
  preservedPaths: Set<string> = new Set(),
): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  return Object.fromEntries(Object.entries(candidate as Record<string, unknown>).map(([key, value]) => {
    const childPath = path ? `${path}.${key}` : key;
    const currentValue = current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)[key]
      : undefined;
    if (isSecretPath(childPath) && (typeof value === 'string' || value === undefined)) {
      return [key, persistSecretValue(db, childPath, value, currentValue, dataDir, preservedPaths)];
    }
    return [key, walkSecrets(value, currentValue, childPath, db, dataDir, preservedPaths)];
  }));
}

function isSecretPath(path: string): boolean {
  if (path === 'model.api_key') return true;
  const key = path.split('.').at(-1) ?? '';
  return /(api[_-]?key|secret|token|password|credential|access[_-]?key)/i.test(key);
}

function persistSecretValue(
  db: Database,
  path: string,
  value: string | undefined,
  current: unknown,
  dataDir?: string,
  preservedPaths: Set<string> = new Set(),
): unknown {
  if (value === '********') return current;
  if (!value || /^\$\{[^}]+\}$/.test(value)) {
    if (!preservedPaths.has(path)) {
      db.prepare('DELETE FROM runtime_settings_secrets WHERE path = ?').run(path);
    }
    return value;
  }
  if (value === `${STORED_SECRET_PREFIX}${path}`) return value;
  const encrypted = encryptSecret(value, dataDir);
  db.prepare(`
    INSERT INTO runtime_settings_secrets (path, ciphertext, nonce, tag, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce,
      tag = excluded.tag, updated_at = datetime('now')
  `).run(path, encrypted.ciphertext, encrypted.nonce, encrypted.tag);
  return `${STORED_SECRET_PREFIX}${path}`;
}

function getStoredSecret(db: Database, path: string): boolean {
  return Boolean(db.prepare('SELECT path FROM runtime_settings_secrets WHERE path = ?').get(path));
}

function maskObjectSecrets<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const secret = /(api[_-]?key|access[_-]?key|secret|token|password|credential)/i.test(key);
    if (secret && typeof item === 'string') return [key, maskedSecret(item)];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return [key, maskObjectSecrets(item as Record<string, unknown>)];
    }
    return [key, item];
  })) as T;
}
