import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';

type ResourceKind = 'environment' | 'credential_vault' | 'memory_store';

export function resourceRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/environments', (c) => {
    const rows = deps.db.prepare('SELECT * FROM environments ORDER BY created_at DESC').all() as unknown as EnvironmentRow[];
    return c.json(pageOf(rows.map(toEnvironment)));
  });

  app.post('/environments', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('env_')
      ? body.value.id
      : `env_${slug(name)}`;
    try {
      deps.db.prepare(
        'INSERT INTO environments (id, name, description, config, metadata, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        JSON.stringify(objectField(body.value.config)),
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as unknown as EnvironmentRow;
      return c.json(toEnvironment(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Environment already exists: ${name}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/environments/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM environments WHERE id = ?').get(c.req.param('id')) as EnvironmentRow | undefined;
    return row ? c.json(toEnvironment(row)) : notFound(c, 'Environment not found');
  });

  app.post('/environments/:id/archive', (c) => archiveResource(c, deps, 'environments', toEnvironment));

  app.get('/credential-vaults', (c) => {
    const rows = deps.db.prepare('SELECT * FROM credential_vaults ORDER BY created_at DESC').all() as unknown as VaultRow[];
    return c.json(pageOf(rows.map(toVault)));
  });

  app.post('/credential-vaults', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('vault_')
      ? body.value.id
      : `vault_${nanoid(12)}`;
    try {
      deps.db.prepare(
        'INSERT INTO credential_vaults (id, name, description, metadata) VALUES (?, ?, ?, ?)',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare('SELECT * FROM credential_vaults WHERE id = ?').get(id) as unknown as VaultRow;
      return c.json(toVault(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Credential vault already exists: ${name}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/credential-vaults/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM credential_vaults WHERE id = ?').get(c.req.param('id')) as VaultRow | undefined;
    return row ? c.json(toVault(row)) : notFound(c, 'Credential vault not found');
  });

  app.post('/credential-vaults/:id/archive', (c) => archiveResource(c, deps, 'credential_vaults', toVault));

  app.get('/memory-stores', (c) => {
    const rows = deps.db.prepare('SELECT * FROM memory_stores ORDER BY created_at DESC').all() as unknown as MemoryStoreRow[];
    return c.json(pageOf(rows.map(toMemoryStore)));
  });

  app.post('/memory-stores', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('mem_')
      ? body.value.id
      : `mem_${nanoid(12)}`;
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
      const row = deps.db.prepare('SELECT * FROM memory_stores WHERE id = ?').get(id) as unknown as MemoryStoreRow;
      return c.json(toMemoryStore(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Memory store already exists: ${name}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/memory-stores/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM memory_stores WHERE id = ?').get(c.req.param('id')) as MemoryStoreRow | undefined;
    return row ? c.json(toMemoryStore(row)) : notFound(c, 'Memory store not found');
  });

  app.post('/memory-stores/:id/archive', (c) => archiveResource(c, deps, 'memory_stores', toMemoryStore));

  return app;
}

function toEnvironment(row: EnvironmentRow) {
  return {
    id: row.id,
    type: 'environment' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    status: row.archived_at ? 'archived' : 'active',
    config: parseObject(row.config),
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    archived_at: row.archived_at ?? null,
  };
}

function toVault(row: VaultRow) {
  return {
    id: row.id,
    type: 'credential_vault' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    status: row.archived_at ? 'archived' : row.status,
    credential_count: 0,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function toMemoryStore(row: MemoryStoreRow) {
  return {
    id: row.id,
    type: 'memory_store' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    provider: row.provider,
    status: row.archived_at ? 'archived' : row.status,
    config: parseObject(row.config),
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function archiveResource(c: any, deps: ServerDeps, table: string, map: (row: any) => unknown) {
  const id = c.req.param('id');
  const existing = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!existing) return notFound(c, 'Resource not found');
  deps.db.prepare(`UPDATE ${table} SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
  const row = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return c.json(map(row));
}

async function readObjectBody(c: any): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, response: invalid(c, 'Request body must be an object') };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, response: invalid(c, 'Request body must be valid JSON') };
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecordField(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectField(value)).map(([key, recordValue]) => [key, String(recordValue)]),
  );
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return objectField(parsed);
  } catch {
    return {};
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || nanoid(8);
}

function invalid(c: any, message: string): Response {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}

function conflict(c: any, message: string): Response {
  return c.json({ error: { type: 'conflict', message } }, 409);
}

function notFound(c: any, message: string): Response {
  return c.json({ error: { type: 'not_found', message } }, 404);
}

interface EnvironmentRow {
  id: string;
  name: string;
  description: string;
  config: string;
  metadata: string;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
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
}
