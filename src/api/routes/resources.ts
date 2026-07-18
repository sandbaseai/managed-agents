import { join } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';
import { encryptSecret } from '@/core/security/secrets.js';
import { environmentRoutes } from './environments.js';
import { fileRoutes } from './files.js';
import {
  archiveResource,
  conflict,
  invalid,
  notFound,
  objectField,
  parseObject,
  readObjectBody,
  stringField,
  stringRecordField,
} from './resource-utils.js';

type ResourceKind = 'credential_vault' | 'memory_store';

export function resourceRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.route('/', environmentRoutes(deps));
  app.route('/', fileRoutes(deps));

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

  app.get('/memory_stores', (c) => {
    const rows = deps.db.prepare(`${memoryStoreSelect('WHERE m.archived_at IS NULL')} ORDER BY m.created_at DESC`).all() as unknown as MemoryStoreRow[];
    return c.json(pageOf(rows.map((row) => toMemoryStore(row, deps))));
  });

  app.post('/memory_stores', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = `memstore_${nanoid(18)}`;
    try {
      deps.db.prepare(
        'INSERT INTO memory_stores (id, name, description, provider, config, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        stringField(body.value.provider) ?? 'sqlite',
        JSON.stringify(objectField(body.value.config)),
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare(memoryStoreSelect('WHERE m.id = ? AND m.archived_at IS NULL')).get(id) as unknown as MemoryStoreRow;
      return c.json(toMemoryStore(row, deps), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, 'Memory store id already exists');
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/memory_stores/:id', (c) => {
    const row = deps.db.prepare(memoryStoreSelect('WHERE m.id = ? AND m.archived_at IS NULL')).get(c.req.param('id')) as MemoryStoreRow | undefined;
    return row ? c.json(toMemoryStore(row, deps)) : notFound(c, 'Memory store not found');
  });

  app.get('/memory_stores/:id/memories', (c) => {
    const store = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ? AND archived_at IS NULL').get(c.req.param('id'));
    if (!store) return notFound(c, 'Memory store not found');
    return c.json(pageOf(listMemories(deps, c.req.param('id'))));
  });

  app.post('/memory_stores/:id/memories', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const storeId = c.req.param('id');
    const store = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ? AND archived_at IS NULL').get(storeId);
    if (!store) return notFound(c, 'Memory store not found');
    const path = memoryPath(body.value.path);
    if (!path) return invalid(c, 'path is required and must start with /');
    const content = typeof body.value.content === 'string' ? body.value.content : '';
    const id = `mem_${nanoid(18)}`;
    const now = new Date().toISOString();
    try {
      deps.db.prepare(
        `INSERT INTO memory_records (id, store_id, path, content, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, storeId, path, content, JSON.stringify(stringRecordField(body.value.metadata)), now, now);
      deps.db.prepare('UPDATE memory_stores SET updated_at = datetime(\'now\') WHERE id = ?').run(storeId);
      const row = deps.db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id) as unknown as MemoryRecordRow;
      return c.json(toMemory(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Memory already exists at path: ${path}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.put('/memory_stores/:id/memories/:memoryId', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const storeId = c.req.param('id');
    const memoryId = c.req.param('memoryId');
    const store = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ? AND archived_at IS NULL').get(storeId);
    if (!store) return notFound(c, 'Memory store not found');
    const existing = deps.db.prepare('SELECT * FROM memory_records WHERE id = ? AND store_id = ? AND archived_at IS NULL').get(memoryId, storeId) as MemoryRecordRow | undefined;
    if (!existing) return notFound(c, 'Memory not found');
    const path = body.value.path === undefined ? existing.path : memoryPath(body.value.path);
    if (!path) return invalid(c, 'path must start with /');
    const content = typeof body.value.content === 'string' ? body.value.content : existing.content;
    try {
      deps.db.prepare(
        'UPDATE memory_records SET path = ?, content = ?, metadata = ?, updated_at = datetime(\'now\') WHERE id = ? AND store_id = ?',
      ).run(
        path,
        content,
        JSON.stringify(body.value.metadata === undefined ? parseObject(existing.metadata) : stringRecordField(body.value.metadata)),
        memoryId,
        storeId,
      );
      deps.db.prepare('UPDATE memory_stores SET updated_at = datetime(\'now\') WHERE id = ?').run(storeId);
      const row = deps.db.prepare('SELECT * FROM memory_records WHERE id = ? AND store_id = ?').get(memoryId, storeId) as unknown as MemoryRecordRow;
      return c.json(toMemory(row));
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Memory already exists at path: ${path}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.delete('/memory_stores/:id/memories/:memoryId', (c) => {
    const storeId = c.req.param('id');
    const memoryId = c.req.param('memoryId');
    const store = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ? AND archived_at IS NULL').get(storeId);
    if (!store) return notFound(c, 'Memory store not found');
    const existing = deps.db.prepare('SELECT * FROM memory_records WHERE id = ? AND store_id = ? AND archived_at IS NULL').get(memoryId, storeId) as MemoryRecordRow | undefined;
    if (!existing) return notFound(c, 'Memory not found');
    deps.db.prepare('UPDATE memory_records SET archived_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND store_id = ?').run(memoryId, storeId);
    deps.db.prepare('UPDATE memory_stores SET updated_at = datetime(\'now\') WHERE id = ?').run(storeId);
    return c.json({ deleted: true, id: memoryId });
  });

  app.post('/memory_stores/:id/archive', (c) => archiveResource(c, deps, 'memory_stores', (row) => toMemoryStore(row, deps)));

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

function memoryStoreSelect(where = '') {
  return `
    SELECT m.*,
      (
        SELECT COUNT(*)
        FROM memory_records mr
        WHERE mr.store_id = m.id AND mr.archived_at IS NULL
      ) AS memory_count
    FROM memory_stores m
    ${where}
  `;
}

function toMemoryStore(row: MemoryStoreRow, deps?: ServerDeps) {
  return {
    id: row.id,
    type: 'memory_store' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    provider: row.provider,
    status: row.archived_at ? 'archived' : row.status,
    memory_count: Number(row.memory_count ?? 0),
    memories: deps ? listMemories(deps, row.id) : [],
    config: parseObject(row.config),
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function listMemories(deps: ServerDeps, storeId: string) {
  const rows = deps.db.prepare(
    `SELECT *
     FROM memory_records
     WHERE store_id = ? AND archived_at IS NULL
     ORDER BY path ASC`,
  ).all(storeId) as unknown as MemoryRecordRow[];
  return rows.map(toMemory);
}

function toMemory(row: MemoryRecordRow) {
  return {
    id: row.id,
    type: 'memory',
    store_id: row.store_id,
    path: row.path,
    content: row.content,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return arrayOfStrings(JSON.parse(value));
  } catch {
    return [];
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
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

function memoryPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const normalized = trimmed.replace(/\/+/g, '/');
  if (normalized === '/' || normalized.endsWith('/')) return undefined;
  return normalized;
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

interface MemoryStoreRow {
  id: string;
  name: string;
  description: string;
  provider: string;
  status: string;
  config: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  memory_count?: number;
}

interface MemoryRecordRow {
  id: string;
  store_id: string;
  path: string;
  content: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
