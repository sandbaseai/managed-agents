import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  listModelProviders,
  toRuntimeModelInfo,
} from '@/core/model/providers.js';
import {
  listMemoryProviders,
  toRuntimeMemoryProviderInfo,
} from '@/core/memory/providers.js';
import {
  listStorageProviders,
  toRuntimeStorageProviderInfo,
  type StorageProviderRole,
} from '@/core/storage/providers.js';
import type { ServerDeps } from '../server.js';

export function legacyProviderRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/model-providers', (c) => {
    const data = listModelProviders(deps.db).map(toRuntimeModelInfo);
    return c.json({
      data,
      has_more: false,
      first_id: data[0]?.name ?? null,
      last_id: data.at(-1)?.name ?? null,
    });
  });

  app.post('/model-providers', async (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  app.post('/model-providers/:name/default', (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  app.get('/memory-providers', (c) => {
    const data = listMemoryProviders(deps.db).map(toRuntimeMemoryProviderInfo);
    return c.json({
      data,
      has_more: false,
      first_id: data[0]?.name ?? null,
      last_id: data.at(-1)?.name ?? null,
    });
  });

  app.post('/memory-providers', async (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  app.post('/memory-providers/:name/default', (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  app.get('/storage-providers', (c) => {
    const role = normalizeStorageProviderRole(c.req.query('role'));
    if (c.req.query('role') && !role) {
      return c.json({ error: { type: 'invalid_request', message: 'role must be metadata or artifact' } }, 400);
    }
    const data = listStorageProviders(deps.db, role).map(toRuntimeStorageProviderInfo);
    return c.json({
      data,
      has_more: false,
      first_id: data[0]?.name ?? null,
      last_id: data.at(-1)?.name ?? null,
    });
  });

  app.post('/storage-providers', async (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  app.post('/storage-providers/:name/initialize', (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  app.post('/storage-providers/:name/default', (c) => {
    return legacyProviderMutationUnsupported(c);
  });

  return app;
}

function legacyProviderMutationUnsupported(c: Context) {
  return c.json({
    error: {
      type: 'unsupported',
      message: 'Provider tables are read-only compatibility views. Use /v1/x/settings to validate and save runtime configuration.',
    },
  }, 410);
}

function normalizeStorageProviderRole(value: string | undefined): StorageProviderRole | undefined {
  if (value === 'metadata' || value === 'artifact') return value;
  return undefined;
}
