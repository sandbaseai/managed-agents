import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';
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

type ResourceKind = 'environment';

export function environmentRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/environments', (c) => {
    const rows = deps.db.prepare('SELECT * FROM environments WHERE archived_at IS NULL ORDER BY created_at DESC').all() as unknown as EnvironmentRow[];
    return c.json(pageOf(rows.map(toEnvironment)));
  });

  app.post('/environments', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const config = normalizeEnvironmentConfig(body.value);
    const id = `env_${nanoid(18)}`;
    try {
      deps.db.prepare(
        'INSERT INTO environments (id, name, description, config, metadata, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        JSON.stringify(config),
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare('SELECT * FROM environments WHERE id = ? AND archived_at IS NULL').get(id) as unknown as EnvironmentRow;
      return c.json(toEnvironment(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, 'Environment id already exists');
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/environments/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM environments WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as EnvironmentRow | undefined;
    return row ? c.json(toEnvironment(row)) : notFound(c, 'Environment not found');
  });

  app.put('/environments/:id', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    const existing = deps.db.prepare('SELECT * FROM environments WHERE id = ? AND archived_at IS NULL').get(id) as EnvironmentRow | undefined;
    if (!existing) return notFound(c, 'Environment not found');

    const name = stringField(body.value.name) ?? existing.name;
    const config = normalizeEnvironmentConfig(body.value, parseObject(existing.config));
    deps.db.prepare(
      'UPDATE environments SET name = ?, description = ?, config = ?, metadata = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(
      name,
      stringField(body.value.description) ?? existing.description ?? '',
      JSON.stringify(config),
      JSON.stringify(body.value.metadata === undefined ? parseObject(existing.metadata) : stringRecordField(body.value.metadata)),
      id,
    );
    const row = deps.db.prepare('SELECT * FROM environments WHERE id = ? AND archived_at IS NULL').get(id) as unknown as EnvironmentRow;
    return c.json(toEnvironment(row));
  });

  app.post('/environments/:id/archive', (c) => archiveResource(c, deps, 'environments', toEnvironment));

  return app;
}

function toEnvironment(row: EnvironmentRow) {
  const config = parseObject(row.config);
  return {
    id: row.id,
    type: 'environment' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    hosting_type: environmentHostingType(config),
    sandbox_provider: typeof config.sandbox_provider === 'string' ? config.sandbox_provider : null,
    network: objectField(config.network),
    packages: Array.isArray(config.packages) ? config.packages : [],
    status: row.archived_at ? 'archived' : 'active',
    config,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    archived_at: row.archived_at ?? null,
  };
}

function normalizeEnvironmentConfig(
  body: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const config = {
    ...existing,
    ...objectField(body.config),
  };
  for (const key of ['hosting_type', 'sandbox_provider', 'network', 'packages'] as const) {
    if (body[key] !== undefined) config[key] = body[key];
  }
  return config;
}

function environmentHostingType(config: Record<string, unknown>): 'cloud' | 'local' | 'docker' | 'self_hosted' {
  if (config.hosting_type === 'self_hosted') return 'self_hosted';
  if (config.hosting_type === 'docker') return 'docker';
  if (config.hosting_type === 'local') return 'local';
  if (config.hosting_type === 'cloud') return 'cloud';
  if (config.sandbox_provider === 'self_hosted') return 'self_hosted';
  if (config.sandbox_provider === 'docker') return 'docker';
  if (config.sandbox_provider === 'local') return 'local';
  return 'cloud';
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
