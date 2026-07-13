import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';
import {
  archiveManagedApiKey,
  configuredApiKeyRecords,
  createManagedApiKey,
  listManagedApiKeys,
} from '@/core/auth/api-keys.js';

export function apiKeysRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/', (c) => {
    const data = [
      ...listManagedApiKeys(deps.db),
      ...configuredApiKeyRecords(deps.apiKeys ?? []),
    ];
    return c.json(pageOf(data));
  });

  app.post('/', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    if (name.length > 80) return invalid(c, 'name must be 80 characters or fewer');
    try {
      return c.json(createManagedApiKey(deps.db, name), 201);
    } catch (err: any) {
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    if (id.startsWith('key_config_')) {
      return invalid(c, 'Configured API keys must be removed from config or environment variables');
    }
    const archived = archiveManagedApiKey(deps.db, id);
    if (!archived) return notFound(c, 'API key not found');
    return c.json({ id: archived.id, type: 'api_key_deleted' });
  });

  return app;
}

async function readObjectBody(c: any): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, response: invalid(c, 'Request body must be a JSON object') };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: invalid(c, 'Request body must be valid JSON') };
  }
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function invalid(c: any, message: string): Response {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}

function notFound(c: any, message: string): Response {
  return c.json({ error: { type: 'not_found', message } }, 404);
}
