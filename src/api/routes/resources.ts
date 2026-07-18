import { join } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';
import { credentialVaultRoutes } from './credential-vaults.js';
import { environmentRoutes } from './environments.js';
import { fileRoutes } from './files.js';
import {
  archiveResource,
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

type ResourceKind = 'memory_store';

export function resourceRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.route('/', environmentRoutes(deps));
  app.route('/', fileRoutes(deps));
  app.route('/', credentialVaultRoutes(deps));

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

function memoryPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const normalized = trimmed.replace(/\/+/g, '/');
  if (normalized === '/' || normalized.endsWith('/')) return undefined;
  return normalized;
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
