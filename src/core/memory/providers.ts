import type { Database } from '@/core/db/database.js';
import { resolveEnvVars } from '@/core/config/env-resolver.js';

export type MemoryProviderKind = 'in_memory' | 'sqlite' | 'database' | 'mem0' | 'memu';
export type MemoryProviderStatus = 'active' | 'adapter_required';
export type MemoryProviderConfigState = 'configured' | 'missing_env' | 'not_set';

export type MemoryProviderRecord = {
  name: string;
  provider: MemoryProviderKind;
  connection_url?: string;
  api_key?: string;
  config: Record<string, unknown>;
  is_default: boolean;
  status: MemoryProviderStatus;
  created_at: string;
  updated_at: string;
};

export type RuntimeMemoryProviderInfo = {
  name: string;
  provider: MemoryProviderKind;
  provider_label: string;
  connection_url?: string;
  connection_url_state: MemoryProviderConfigState;
  api_key_state: MemoryProviderConfigState;
  is_default: boolean;
  status: MemoryProviderStatus;
  runtime_capable: boolean;
  created_at: string;
  updated_at: string;
};

const RUNTIME_CAPABLE_PROVIDERS = new Set<MemoryProviderKind>(['in_memory', 'sqlite']);
const PROVIDER_LABELS: Record<MemoryProviderKind, string> = {
  in_memory: 'In-memory',
  sqlite: 'SQLite',
  database: 'External database',
  mem0: 'mem0',
  memu: 'MemU',
};

export function listMemoryProviders(db: Database): MemoryProviderRecord[] {
  const rows = db.prepare(`
    SELECT name, provider, connection_url, api_key, config, is_default, status, created_at, updated_at
    FROM memory_providers
    ORDER BY is_default DESC, created_at DESC, name ASC
  `).all() as Array<{
    name: string;
    provider: string;
    connection_url: string | null;
    api_key: string | null;
    config: string | null;
    is_default: number;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => {
    const provider = normalizeProvider(row.provider);
    return {
      name: row.name,
      provider,
      connection_url: row.connection_url ?? undefined,
      api_key: row.api_key ?? undefined,
      config: parseConfig(row.config),
      is_default: row.is_default === 1,
      status: normalizeStatus(row.status, provider),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });
}

export function toRuntimeMemoryProviderInfo(record: MemoryProviderRecord): RuntimeMemoryProviderInfo {
  return {
    name: record.name,
    provider: record.provider,
    provider_label: PROVIDER_LABELS[record.provider],
    connection_url: publicConnectionUrl(record.connection_url),
    connection_url_state: configState(record.connection_url),
    api_key_state: configState(record.api_key),
    is_default: record.is_default,
    status: record.status,
    runtime_capable: RUNTIME_CAPABLE_PROVIDERS.has(record.provider),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function normalizeProvider(value: string): MemoryProviderKind {
  if (value === 'in_memory' || value === 'sqlite' || value === 'database' || value === 'mem0' || value === 'memu') {
    return value;
  }
  throw new Error(`unsupported memory provider: ${value}`);
}

function normalizeStatus(value: string, provider: MemoryProviderKind): MemoryProviderStatus {
  if (value === 'active' || value === 'adapter_required') return value;
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

function configState(value?: string): MemoryProviderConfigState {
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
