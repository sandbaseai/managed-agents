import type { Database } from '@/core/db/database.js';
import { resolveEnvVars } from '@/core/config/env-resolver.js';
import { nanoid } from 'nanoid';

export type StorageProviderRole = 'metadata' | 'artifact';
export type StorageProviderKind = 'sqlite' | 'postgres' | 'mysql' | 'local_filesystem' | 's3';
export type StorageProviderStatus = 'active' | 'init_required' | 'adapter_required';
export type StorageProviderConfigState = 'configured' | 'missing_env' | 'not_set';

export type StorageProviderRecord = {
  name: string;
  role: StorageProviderRole;
  provider: StorageProviderKind;
  connection_url?: string;
  bucket?: string;
  region?: string;
  base_path?: string;
  access_key?: string;
  secret_key?: string;
  config: Record<string, unknown>;
  is_default: boolean;
  status: StorageProviderStatus;
  initialized_at?: string;
  created_at: string;
  updated_at: string;
};

export type StorageProviderInput = {
  name?: unknown;
  role?: unknown;
  provider?: unknown;
  connection_url?: unknown;
  bucket?: unknown;
  region?: unknown;
  base_path?: unknown;
  access_key?: unknown;
  secret_key?: unknown;
  config?: unknown;
  is_default?: unknown;
};

export type RuntimeStorageProviderInfo = {
  name: string;
  role: StorageProviderRole;
  provider: StorageProviderKind;
  provider_label: string;
  connection_url?: string;
  connection_url_state: StorageProviderConfigState;
  bucket?: string;
  region?: string;
  base_path?: string;
  access_key_state: StorageProviderConfigState;
  secret_key_state: StorageProviderConfigState;
  is_default: boolean;
  status: StorageProviderStatus;
  runtime_capable: boolean;
  initialized_at?: string;
  created_at: string;
  updated_at: string;
};

const RUNTIME_CAPABLE_PROVIDERS = new Set<StorageProviderKind>(['sqlite', 'local_filesystem']);
const METADATA_PROVIDERS = new Set<StorageProviderKind>(['sqlite', 'postgres', 'mysql']);
const ARTIFACT_PROVIDERS = new Set<StorageProviderKind>(['local_filesystem', 's3']);

const PROVIDER_LABELS: Record<StorageProviderKind, string> = {
  sqlite: 'SQLite',
  postgres: 'Postgres',
  mysql: 'MySQL',
  local_filesystem: 'Local filesystem',
  s3: 'S3-compatible',
};

export function listStorageProviders(db: Database, role?: StorageProviderRole): StorageProviderRecord[] {
  const rows = role
    ? db.prepare(`
      SELECT name, role, provider, connection_url, bucket, region, base_path, access_key, secret_key,
             config, is_default, status, initialized_at, created_at, updated_at
      FROM storage_providers
      WHERE role = ?
      ORDER BY is_default DESC, created_at DESC, name ASC
    `).all(role)
    : db.prepare(`
      SELECT name, role, provider, connection_url, bucket, region, base_path, access_key, secret_key,
             config, is_default, status, initialized_at, created_at, updated_at
      FROM storage_providers
      ORDER BY role ASC, is_default DESC, created_at DESC, name ASC
    `).all();

  return (rows as StorageProviderRow[]).map((row) => {
    const normalizedRole = normalizeRole(row.role);
    const provider = normalizeProvider(row.provider);
    return {
      name: row.name,
      role: normalizedRole,
      provider,
      connection_url: row.connection_url ?? undefined,
      bucket: row.bucket ?? undefined,
      region: row.region ?? undefined,
      base_path: row.base_path ?? undefined,
      access_key: row.access_key ?? undefined,
      secret_key: row.secret_key ?? undefined,
      config: parseConfig(row.config),
      is_default: row.is_default === 1,
      status: normalizeStatus(row.status, provider),
      initialized_at: row.initialized_at ?? undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

export function createStorageProvider(db: Database, input: StorageProviderInput): StorageProviderRecord {
  const record = normalizeInput(input);
  if (record.is_default) {
    throw new Error('storage providers must be initialized before they can be default');
  }
  const now = new Date().toISOString();

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO storage_providers (
        name, role, provider, connection_url, bucket, region, base_path, access_key, secret_key,
        config, is_default, status, initialized_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.name,
      record.role,
      record.provider,
      record.connection_url ?? null,
      record.bucket ?? null,
      record.region ?? null,
      record.base_path ?? null,
      record.access_key ?? null,
      record.secret_key ?? null,
      JSON.stringify(record.config ?? {}),
      0,
      record.status,
      record.initialized_at ?? null,
      now,
      now,
    );
    return getStorageProvider(db, record.name) as StorageProviderRecord;
  });
}

export function initializeStorageProvider(db: Database, name: string): StorageProviderRecord | undefined {
  const existing = getStorageProvider(db, name);
  if (!existing) return undefined;
  if (!RUNTIME_CAPABLE_PROVIDERS.has(existing.provider)) {
    throw new Error(`${PROVIDER_LABELS[existing.provider]} requires an installed runtime adapter before it can be initialized`);
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE storage_providers SET status = ?, initialized_at = COALESCE(initialized_at, ?), updated_at = ? WHERE name = ?')
    .run('active', now, now, name);
  return getStorageProvider(db, name);
}

export function setDefaultStorageProvider(db: Database, name: string): StorageProviderRecord | undefined {
  const existing = getStorageProvider(db, name);
  if (!existing) return undefined;
  if (!RUNTIME_CAPABLE_PROVIDERS.has(existing.provider)) {
    throw new Error(`${PROVIDER_LABELS[existing.provider]} requires an installed runtime adapter before it can be default`);
  }
  if (existing.status !== 'active') {
    throw new Error(`${PROVIDER_LABELS[existing.provider]} must be initialized before it can be default`);
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE storage_providers SET is_default = 0, updated_at = ? WHERE role = ?').run(now, existing.role);
    db.prepare('UPDATE storage_providers SET is_default = 1, updated_at = ? WHERE name = ?').run(now, name);
  });
  return getStorageProvider(db, name);
}

export function toRuntimeStorageProviderInfo(record: StorageProviderRecord): RuntimeStorageProviderInfo {
  return {
    name: record.name,
    role: record.role,
    provider: record.provider,
    provider_label: PROVIDER_LABELS[record.provider],
    connection_url: publicConnectionUrl(record.connection_url),
    connection_url_state: configState(record.connection_url),
    bucket: record.bucket,
    region: record.region,
    base_path: record.base_path,
    access_key_state: configState(record.access_key),
    secret_key_state: configState(record.secret_key),
    is_default: record.is_default,
    status: record.status,
    runtime_capable: RUNTIME_CAPABLE_PROVIDERS.has(record.provider),
    initialized_at: record.initialized_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

type StorageProviderRow = {
  name: string;
  role: string;
  provider: string;
  connection_url: string | null;
  bucket: string | null;
  region: string | null;
  base_path: string | null;
  access_key: string | null;
  secret_key: string | null;
  config: string | null;
  is_default: number;
  status: string;
  initialized_at: string | null;
  created_at: string;
  updated_at: string;
};

function getStorageProvider(db: Database, name: string): StorageProviderRecord | undefined {
  return listStorageProviders(db).find((provider) => provider.name === name);
}

function normalizeInput(input: StorageProviderInput): StorageProviderRecord {
  const role = normalizeRole(cleanString(input.role) ?? 'metadata');
  const fallbackProvider: StorageProviderKind = role === 'metadata' ? 'sqlite' : 'local_filesystem';
  const provider = normalizeProvider(cleanString(input.provider) ?? fallbackProvider);
  validateProviderRole(role, provider);

  const name = cleanString(input.name) ?? `${role}-${provider}-${nanoid(8)}`;
  if (name.length > 80) {
    throw new Error('name must be 80 characters or fewer');
  }

  const connection_url = cleanString(input.connection_url);
  if ((provider === 'postgres' || provider === 'mysql') && !connection_url) {
    throw new Error('connection_url is required for external metadata storage providers');
  }

  const bucket = cleanString(input.bucket);
  if (provider === 's3' && !bucket) {
    throw new Error('bucket is required for S3 artifact storage providers');
  }

  const runtimeCapable = RUNTIME_CAPABLE_PROVIDERS.has(provider);
  return {
    name,
    role,
    provider,
    connection_url,
    bucket,
    region: cleanString(input.region),
    base_path: cleanString(input.base_path),
    access_key: cleanString(input.access_key),
    secret_key: cleanString(input.secret_key),
    config: isPlainObject(input.config) ? input.config : {},
    is_default: Boolean(input.is_default),
    status: runtimeCapable ? 'init_required' : 'adapter_required',
    initialized_at: undefined,
    created_at: '',
    updated_at: '',
  };
}

function validateProviderRole(role: StorageProviderRole, provider: StorageProviderKind): void {
  if (role === 'metadata' && !METADATA_PROVIDERS.has(provider)) {
    throw new Error(`${PROVIDER_LABELS[provider]} is not a metadata storage provider`);
  }
  if (role === 'artifact' && !ARTIFACT_PROVIDERS.has(provider)) {
    throw new Error(`${PROVIDER_LABELS[provider]} is not an artifact storage provider`);
  }
}

function normalizeRole(value: string): StorageProviderRole {
  if (value === 'metadata' || value === 'artifact') return value;
  throw new Error(`unsupported storage role: ${value}`);
}

function normalizeProvider(value: string): StorageProviderKind {
  if (value === 'sqlite' || value === 'postgres' || value === 'mysql' || value === 'local_filesystem' || value === 's3') {
    return value;
  }
  throw new Error(`unsupported storage provider: ${value}`);
}

function normalizeStatus(value: string, provider: StorageProviderKind): StorageProviderStatus {
  if (value === 'active' || value === 'init_required' || value === 'adapter_required') return value;
  return RUNTIME_CAPABLE_PROVIDERS.has(provider) ? 'active' : 'adapter_required';
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseConfig(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const ENV_PLACEHOLDER = /\$\{[^}]+\}/;

function configState(value?: string): StorageProviderConfigState {
  if (!value) return 'not_set';
  const resolved = resolveEnvVars(value, false);
  return ENV_PLACEHOLDER.test(resolved) ? 'missing_env' : 'configured';
}

function publicConnectionUrl(value?: string): string | undefined {
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
