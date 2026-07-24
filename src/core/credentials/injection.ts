import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';
import { decryptSecret } from '@/core/security/secrets.js';

export type CredentialInjectionBundle = {
  sessionId: string;
  vaultIds: string[];
  environment: Record<string, string>;
  request_headers: Record<string, string>;
  request_body: Record<string, unknown>;
  credentials: Array<{
    id: string;
    vault_id: string;
    name: string;
    auth_type: string;
    variable_name: string | null;
    injection_locations: string[];
    value_hint: string;
  }>;
};

export function resolveSessionCredentialInjections(
  db: Database,
  sessionId: string,
  opts: { dataDir?: string; actor?: string; metadata?: Record<string, string> } = {},
): CredentialInjectionBundle {
  const session = db.prepare('SELECT id, vault_ids FROM sessions WHERE id = ?').get(sessionId) as { id: string; vault_ids: string } | undefined;
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const vaultIds = parseVaultIds(session.vault_ids);
  const bundle: CredentialInjectionBundle = {
    sessionId,
    vaultIds,
    environment: {},
    request_headers: {},
    request_body: {},
    credentials: [],
  };
  if (vaultIds.length === 0) return bundle;

  const rows = db.prepare(
    `SELECT *
     FROM credential_records
     WHERE vault_id IN (${vaultIds.map(() => '?').join(',')})
       AND archived_at IS NULL
       AND status != 'deleted'
     ORDER BY created_at ASC`,
  ).all(...vaultIds) as CredentialRecordRow[];

  for (const row of rows) {
    const secret = decryptCredential(row, opts.dataDir);
    const locations = parseStringArray(row.injection_locations);
    if (row.auth_type === 'environment_variable' && row.variable_name && secret) {
      bundle.environment[row.variable_name] = secret;
    }
    if (row.auth_type === 'bearer_token' && secret) {
      if (locations.includes('request_headers')) {
        bundle.request_headers.Authorization = `Bearer ${secret}`;
      }
      if (locations.includes('request_body')) {
        bundle.request_body[row.name || row.id] = secret;
      }
    }
    bundle.credentials.push({
      id: row.id,
      vault_id: row.vault_id,
      name: row.name,
      auth_type: row.auth_type,
      variable_name: row.variable_name,
      injection_locations: locations,
      value_hint: row.value_hint,
    });
    markUsed(db, row, opts);
  }

  return bundle;
}

function decryptCredential(row: CredentialRecordRow, dataDir?: string): string {
  if (!row.secret_ciphertext || !row.secret_nonce || !row.secret_tag) return '';
  return decryptSecret({
    ciphertext: row.secret_ciphertext,
    nonce: row.secret_nonce,
    tag: row.secret_tag,
  }, dataDir);
}

function markUsed(db: Database, row: CredentialRecordRow, opts: { actor?: string; metadata?: Record<string, string> }) {
  db.prepare(
    `UPDATE credential_records
     SET last_used_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND vault_id = ?`,
  ).run(row.id, row.vault_id);
  db.prepare(
    `INSERT INTO credential_audit_events (id, vault_id, credential_id, action, actor, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    `caud_${nanoid(18)}`,
    row.vault_id,
    row.id,
    'runtime_inject',
    opts.actor ?? 'runtime',
    JSON.stringify(opts.metadata ?? {}),
  );
}

function parseVaultIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.startsWith('vlt_')) : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

type CredentialRecordRow = {
  id: string;
  vault_id: string;
  name: string;
  auth_type: string;
  variable_name: string | null;
  value_hint: string;
  injection_locations: string;
  secret_ciphertext: string;
  secret_nonce: string;
  secret_tag: string;
};
