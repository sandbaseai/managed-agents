import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';
import { encryptSecret } from '@/core/security/secrets.js';
import {
  archiveResource,
  arrayOfStrings,
  conflict,
  invalid,
  notFound,
  objectField,
  parseObject,
  parseStringArray,
  readObjectBody,
  stringField,
  stringRecordField,
} from './resource-utils.js';

type ResourceKind = 'credential_vault';

export function credentialVaultRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/credential-vaults', (c) => {
    const rows = deps.db.prepare(`${vaultSelect('WHERE v.archived_at IS NULL')} ORDER BY v.created_at DESC`).all() as unknown as VaultRow[];
    return c.json(pageOf(rows.map((row) => toVault(row, deps))));
  });

  app.post('/credential-vaults', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = `vlt_${nanoid(18)}`;
    try {
      deps.db.prepare(
        'INSERT INTO credential_vaults (id, name, description, metadata) VALUES (?, ?, ?, ?)',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare(vaultSelect('WHERE v.id = ? AND v.archived_at IS NULL')).get(id) as unknown as VaultRow;
      return c.json(toVault(row, deps), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, 'Credential vault id already exists');
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/credential-vaults/:id', (c) => {
    const row = deps.db.prepare(vaultSelect('WHERE v.id = ? AND v.archived_at IS NULL')).get(c.req.param('id')) as VaultRow | undefined;
    return row ? c.json(toVault(row, deps)) : notFound(c, 'Credential vault not found');
  });

  app.get('/credential-vaults/:id/credentials', (c) => {
    const vault = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ? AND archived_at IS NULL').get(c.req.param('id'));
    if (!vault) return notFound(c, 'Credential vault not found');
    return c.json(pageOf(listCredentials(deps, c.req.param('id'))));
  });

  app.post('/credential-vaults/:id/credentials', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const vaultId = c.req.param('id');
    const vault = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ? AND archived_at IS NULL').get(vaultId);
    if (!vault) return notFound(c, 'Credential vault not found');

    const authType = stringField(body.value.auth_type);
    if (!isCredentialAuthType(authType)) return invalid(c, 'auth_type must be one of mcp_oauth, bearer_token, environment_variable');

    const mcpServerUrl = stringField(body.value.mcp_server_url);
    const variableName = stringField(body.value.variable_name);
    const secretValue = typeof body.value.value === 'string' ? body.value.value : '';
    if (authType === 'mcp_oauth' && !mcpServerUrl) return invalid(c, 'mcp_server_url is required');
    if (authType === 'bearer_token' && !secretValue) return invalid(c, 'value is required');
    if (authType === 'environment_variable' && (!variableName || !secretValue)) return invalid(c, 'variable_name and value are required');

    const injectionLocations = parseCredentialInjectionLocations(body.value.injection_locations);
    if (!injectionLocations.ok) return invalid(c, injectionLocations.message);
    const encryptedSecret = secretValue ? encryptSecret(secretValue, deps.workspace?.dataDir) : { ciphertext: '', nonce: '', tag: '' };
    const id = `vcrd_${nanoid(18)}`;
    const now = new Date().toISOString();
    deps.db.prepare(
      `INSERT INTO credential_records (
        id, vault_id, name, auth_type, mcp_server_url, variable_name, value_hint,
        network, injection_locations, metadata, secret_ciphertext, secret_nonce, secret_tag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      vaultId,
      stringField(body.value.name) ?? '',
      authType,
      mcpServerUrl ?? null,
      variableName ?? null,
      secretHint(secretValue),
      JSON.stringify(normalizeCredentialNetwork(body.value.network)),
      JSON.stringify(injectionLocations.value),
      JSON.stringify(stringRecordField(body.value.metadata)),
      encryptedSecret.ciphertext,
      encryptedSecret.nonce,
      encryptedSecret.tag,
      now,
      now,
    );
    deps.db.prepare('UPDATE credential_vaults SET updated_at = datetime(\'now\') WHERE id = ?').run(vaultId);
    const row = deps.db.prepare('SELECT * FROM credential_records WHERE id = ?').get(id) as unknown as CredentialRow;
    return c.json(toCredential(row), 201);
  });

  app.post('/credential-vaults/:id/credentials/:credentialId/archive', (c) => updateCredentialState(c, deps, 'archived'));

  app.delete('/credential-vaults/:id/credentials/:credentialId', (c) => updateCredentialState(c, deps, 'deleted'));

  app.post('/credential-vaults/:id/archive', (c) => archiveResource(c, deps, 'credential_vaults', (row) => toVault(row, deps)));

  return app;
}

function vaultSelect(where = '') {
  return `
    SELECT v.*,
      (
        SELECT COUNT(*)
        FROM credential_records cr
        WHERE cr.vault_id = v.id AND cr.archived_at IS NULL AND cr.status != 'deleted'
      ) AS credential_count
    FROM credential_vaults v
    ${where}
  `;
}

function toVault(row: VaultRow, deps?: ServerDeps) {
  return {
    id: row.id,
    type: 'credential_vault' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    status: row.archived_at ? 'archived' : row.status,
    credential_count: Number(row.credential_count ?? 0),
    credentials: deps ? listCredentials(deps, row.id) : [],
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function listCredentials(deps: ServerDeps, vaultId: string) {
  const rows = deps.db.prepare(
    `SELECT *
     FROM credential_records
     WHERE vault_id = ? AND archived_at IS NULL AND status != 'deleted'
     ORDER BY created_at DESC`,
  ).all(vaultId) as unknown as CredentialRow[];
  return rows.map(toCredential);
}

function toCredential(row: CredentialRow) {
  return {
    id: row.id,
    type: 'credential',
    vault_id: row.vault_id,
    name: row.name ?? '',
    auth_type: row.auth_type,
    mcp_server_url: row.mcp_server_url ?? '',
    variable_name: row.variable_name ?? '',
    value_hint: row.value_hint ?? '',
    network: parseObject(row.network),
    injection_locations: parseStringArray(row.injection_locations),
    status: row.status === 'deleted' ? 'deleted' : row.archived_at ? 'archived' : row.status,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at ?? null,
    archived_at: row.archived_at ?? null,
  };
}

function parseCredentialInjectionLocations(value: unknown): { ok: true; value: string[] } | { ok: false; message: string } {
  const locations = arrayOfStrings(value);
  const allowed = new Set(['request_headers', 'request_body']);
  const invalidLocation = locations.find((location) => !allowed.has(location));
  if (invalidLocation) {
    return { ok: false, message: 'injection_locations must contain only request_headers or request_body' };
  }
  return { ok: true, value: Array.from(new Set(locations)) };
}

function isCredentialAuthType(value: unknown): value is 'mcp_oauth' | 'bearer_token' | 'environment_variable' {
  return value === 'mcp_oauth' || value === 'bearer_token' || value === 'environment_variable';
}

function normalizeCredentialNetwork(value: unknown) {
  const record = objectField(value);
  return {
    type: record.type === 'unrestricted' ? 'unrestricted' : 'limited',
    allowed_hosts: arrayOfStrings(record.allowed_hosts),
  };
}

function secretHint(value: string) {
  if (!value) return '';
  const visible = value.slice(-4);
  return visible ? `••••${visible}` : '••••';
}

function updateCredentialState(c: any, deps: ServerDeps, status: 'archived' | 'deleted') {
  const vaultId = c.req.param('id');
  const credentialId = c.req.param('credentialId');
  const vault = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ? AND archived_at IS NULL').get(vaultId);
  if (!vault) return notFound(c, 'Credential vault not found');
  const existing = status === 'deleted'
    ? deps.db.prepare('SELECT * FROM credential_records WHERE id = ? AND vault_id = ? AND status != ?').get(credentialId, vaultId, 'deleted') as CredentialRow | undefined
    : deps.db.prepare('SELECT * FROM credential_records WHERE id = ? AND vault_id = ? AND archived_at IS NULL AND status != ?').get(credentialId, vaultId, 'deleted') as CredentialRow | undefined;
  if (!existing) return notFound(c, 'Credential not found');
  deps.db.prepare(
    'UPDATE credential_records SET status = ?, archived_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND vault_id = ?',
  ).run(status, credentialId, vaultId);
  deps.db.prepare('UPDATE credential_vaults SET updated_at = datetime(\'now\') WHERE id = ?').run(vaultId);
  const row = deps.db.prepare('SELECT * FROM credential_records WHERE id = ? AND vault_id = ?').get(credentialId, vaultId) as unknown as CredentialRow;
  return c.json(toCredential(row));
}

interface VaultRow {
  id: string;
  name: string;
  description: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  credential_count?: number;
}

interface CredentialRow {
  id: string;
  vault_id: string;
  name: string;
  auth_type: 'mcp_oauth' | 'bearer_token' | 'environment_variable';
  mcp_server_url: string | null;
  variable_name: string | null;
  value_hint: string;
  network: string;
  injection_locations: string;
  secret_ciphertext: string;
  secret_nonce: string;
  secret_tag: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
}
