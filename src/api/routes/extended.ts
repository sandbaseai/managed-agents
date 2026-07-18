/**
 * Extension Routes (/v1/x/*)
 *
 * Runtime extension endpoints:
 * POST /v1/x/reload  - hot-reload agent definitions
 * POST /v1/x/restart - restart the local runtime process
 * GET  /v1/x/logs    - recent structured runtime logs
 * GET  /v1/x/health  - basic health check
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { dirname } from 'node:path';
import type { ServerDeps } from '../server.js';
import type { LogLevel } from '@/core/observability/logger.js';
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
import { settingsRoutes } from './settings.js';
import { templateRoutes } from './templates.js';

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

export function extendedRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.route('/settings', settingsRoutes(deps));
  app.route('/templates', templateRoutes(deps));

  // POST /reload - Hot-reload agents
  app.post('/reload', (c) => {
    try {
      const result = deps.reloadAgents();
      deps.agents.length = 0;
      deps.agents.push(...result.agents);

      return c.json({
        reloaded: true,
        agents_loaded: result.agents.length,
        errors: result.errors,
      });
    } catch (err: any) {
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.post('/restart', (c) => {
    if (!deps.restart) {
      return c.json({
        error: {
          type: 'unsupported',
          message: 'Runtime restart is not available for this server instance.',
        },
      }, 501);
    }

    deps.logger?.warn('runtime_restart_scheduled', {
      source: 'api',
      path: c.req.path,
    });

    setTimeout(() => {
      void Promise.resolve(deps.restart?.()).catch((err: any) => {
        deps.logger?.error('runtime_restart_failed', {
          error: err?.message ?? String(err),
        });
      });
    }, 50);

    return c.json({ restarting: true, status: 'scheduled' }, 202);
  });

  // GET /health - Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      agents_loaded: deps.agents.length,
    });
  });

  // GET /logs - Recent in-process runtime logs
  app.get('/logs', (c) => {
    const rawLevel = c.req.query('level');
    const level = rawLevel as LogLevel | undefined;
    if (rawLevel && !LOG_LEVELS.has(level as LogLevel)) {
      return c.json({
        error: {
          type: 'invalid_request',
          message: 'level must be one of debug, info, warn, or error',
        },
      }, 400);
    }

    const limit = parsePositiveInteger(c.req.query('limit')) ?? 200;
    const query = c.req.query('q') ?? c.req.query('query') ?? undefined;
    const data = deps.logStore?.list({ limit, level, query }) ?? [];
    return c.json({
      data,
      has_more: false,
      first_id: data[0]?.time ?? null,
      last_id: data.at(-1)?.time ?? null,
    });
  });

  // GET /metrics - Prometheus-format metrics
  app.get('/metrics', (c) => {
    if (!deps.metrics) {
      return c.text('# metrics disabled\n', 200, { 'Content-Type': 'text/plain' });
    }
    return c.text(deps.metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4' });
  });

  // GET /mcp/status?session_id=X - MCP server connection status for a session
  app.get('/mcp/status', (c) => {
    const sessionId = c.req.query('session_id');
    if (!sessionId) {
      return c.json({ error: { type: 'invalid_request', message: 'session_id query param is required' } }, 400);
    }
    if (!deps.sessionManager.get(sessionId)) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    const servers = deps.getMcpStatus ? deps.getMcpStatus(sessionId) : [];
    return c.json({ session_id: sessionId, servers });
  });

  app.get('/workspace', (c) => {
    const workspace = deps.workspace;
    const configDir = workspace?.configPath ? dirname(workspace.configPath) : workspace?.root;
    return c.json({
      type: 'workspace',
      name: workspace?.root.split('/').filter(Boolean).at(-1) ?? 'local workspace',
      ...workspace,
      configDir,
      directories: workspace
        ? {
          root: workspace.root,
          agents: workspace.agentsDir,
          skills: workspace.skillsDir,
          data: workspace.dataDir,
          config: workspace.configPath,
        }
        : {},
    });
  });

  app.get('/runtime', (c) => {
    const authEnabled = Boolean(deps.runtime?.authEnabled || deps.hasApiKeys?.());
    return c.json({
      type: 'runtime',
      status: 'running',
      agents_loaded: deps.agents.length,
      skills_loaded: deps.skills?.length ?? 0,
      models: runtimeModels(deps),
      sandbox_providers: deps.runtime?.sandboxProviders ?? [],
      memory: deps.runtime?.memory ?? 'disabled',
      memory_providers: listMemoryProviders(deps.db).map(toRuntimeMemoryProviderInfo),
      storage_providers: listStorageProviders(deps.db).map(toRuntimeStorageProviderInfo),
      auth_enabled: authEnabled,
    });
  });

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

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
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

function runtimeModels(deps: ServerDeps) {
  return deps.listRuntimeModels?.() ?? deps.runtime?.models ?? [];
}
