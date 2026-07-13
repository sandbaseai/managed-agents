import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';

export type ApiKeySource = 'managed' | 'config_env';

export interface ApiKeyRecord {
  id: string;
  type: 'api_key';
  name: string;
  source: ApiKeySource;
  key_prefix: string;
  status: 'active' | 'archived';
  created_at: string | null;
  updated_at: string | null;
  last_used_at: string | null;
  archived_at: string | null;
}

export interface CreatedApiKeyRecord extends ApiKeyRecord {
  secret_key: string;
}

type ApiKeyRow = {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
};

export function listManagedApiKeys(db: Database): ApiKeyRecord[] {
  const rows = db.prepare(
    `SELECT *
     FROM api_keys
     ORDER BY created_at DESC`,
  ).all() as unknown as ApiKeyRow[];
  return rows.map(toApiKeyRecord);
}

export function configuredApiKeyRecords(keys: string[]): ApiKeyRecord[] {
  return keys.filter(Boolean).map((key, index) => ({
    id: `key_config_${hashApiKey(key).slice(0, 16)}`,
    type: 'api_key',
    name: index === 0 ? 'Configured API key' : `Configured API key ${index + 1}`,
    source: 'config_env',
    key_prefix: keyPrefix(key),
    status: 'active',
    created_at: null,
    updated_at: null,
    last_used_at: null,
    archived_at: null,
  }));
}

export function createManagedApiKey(db: Database, name: string): CreatedApiKeyRecord {
  const trimmedName = name.trim();
  const secret = generateApiKeySecret();
  const id = `key_${nanoid(18)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO api_keys (
      id, name, key_hash, key_prefix, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    trimmedName,
    hashApiKey(secret),
    keyPrefix(secret),
    now,
    now,
  );
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as unknown as ApiKeyRow;
  return { ...toApiKeyRecord(row), secret_key: secret };
}

export function archiveManagedApiKey(db: Database, id: string): ApiKeyRecord | null {
  const existing = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow | undefined;
  if (!existing) return null;
  db.prepare(
    `UPDATE api_keys
     SET status = 'archived', archived_at = COALESCE(archived_at, ?), updated_at = ?
     WHERE id = ?`,
  ).run(new Date().toISOString(), new Date().toISOString(), id);
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as unknown as ApiKeyRow;
  return toApiKeyRecord(row);
}

export function countActiveManagedApiKeys(db: Database): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM api_keys
     WHERE status = 'active' AND archived_at IS NULL`,
  ).get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function validateManagedApiKey(db: Database, secret: string): boolean {
  if (!secret) return false;
  const hash = hashApiKey(secret);
  const row = db.prepare(
    `SELECT id
     FROM api_keys
     WHERE key_hash = ? AND status = 'active' AND archived_at IS NULL`,
  ).get(hash) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id);
  return true;
}

function toApiKeyRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    type: 'api_key',
    name: row.name,
    source: 'managed',
    key_prefix: row.key_prefix,
    status: row.archived_at || row.status === 'archived' ? 'archived' : 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at ?? null,
    archived_at: row.archived_at ?? null,
  };
}

function generateApiKeySecret(): string {
  return `ma_${randomBytes(32).toString('base64url')}`;
}

function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function keyPrefix(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 14) return `${trimmed.slice(0, 4)}...`;
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-4)}`;
}
