import type { Database } from '@/core/db/database.js';
import { resolveEnvVars } from '@/core/config/env-resolver.js';

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
