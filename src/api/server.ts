/**
 * HTTP API Server
 *
 * Hono-based REST API exposing CMA-compatible endpoints.
 * Factory function pattern — creates server with injected dependencies.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessionsRoutes } from './routes/sessions.js';
import { agentsRoutes } from './routes/agents.js';
import { resourceRoutes } from './routes/resources.js';
import { extendedRoutes } from './routes/extended.js';
import { streamRoutes } from './routes/stream.js';
import { createAuthMiddleware } from './auth.js';
import type { SessionManager } from '@/core/session/session-manager.js';
import type { AgentDefinition } from '@/types/agent.js';
import { workerRoutes } from './routes/worker.js';
import type { WorkQueue } from '@/sandbox/self-hosted-provider.js';
import type { Logger } from '@/core/observability/logger.js';
import type { Metrics } from '@/core/observability/metrics.js';
import type { Skill } from '@/core/skills/loader.js';
import type { Database } from '@/core/db/database.js';

export interface ServerDeps {
  db: Database;
  sessionManager: SessionManager;
  agents: AgentDefinition[];
  reloadAgents: () => { agents: AgentDefinition[]; errors: any[] };
  /** Accepted API keys. Empty/undefined = auth disabled (open, local-first). */
  apiKeys?: string[];
  /** MCP connection status for a session (for /v1/x/mcp/status). */
  getMcpStatus?: (sessionId: string) => Array<{
    name: string;
    type: string;
    connected: boolean;
    toolCount: number;
    error?: string;
  }>;
  workspace?: {
    root: string;
    dataDir: string;
    agentsDir: string;
    skillsDir: string;
    configPath: string;
    target: string;
  };
  runtime?: {
    models: string[];
    sandboxProviders: string[];
    memory: string;
    authEnabled: boolean;
  };
  skills?: Skill[];
  /** Override for tests. Undefined = auto-detect dist/console; null = disabled. */
  consoleRoot?: string | null;
  /** Optional structured logger for request logging. */
  logger?: Logger;
  /** Optional metrics registry (exposed at /v1/x/metrics). */
  metrics?: Metrics;
  /** Optional work queue for the self_hosted sandbox worker endpoints (R9.14). */
  workQueue?: WorkQueue;
}

export function createServer(deps: ServerDeps) {
  const app = new Hono();

  // Middleware
  app.use('*', cors());

  // Request logging + metrics (F3)
  if (deps.logger || deps.metrics) {
    app.use('*', async (c, next) => {
      const start = Date.now();
      await next();
      const durationMs = Date.now() - start;
      const route = c.req.routePath ?? c.req.path;
      deps.metrics?.counter('http_requests_total', 'Total HTTP requests');
      deps.metrics?.observe('http_request_duration_ms', durationMs, 'HTTP request duration (ms)');
      if (c.res.status >= 500) {
        deps.metrics?.counter('http_errors_total', 'Total HTTP 5xx responses');
      }
      deps.logger?.info('http_request', {
        method: c.req.method,
        path: c.req.path,
        route,
        status: c.res.status,
        durationMs,
      });
    });
  }

  app.use('*', createAuthMiddleware({ apiKeys: deps.apiKeys }));

  // CMA-compatible endpoints
  app.route('/v1/sessions', sessionsRoutes(deps));
  app.route('/v1/agents', agentsRoutes(deps));
  app.route('/v1', resourceRoutes(deps));

  // SSE streaming
  app.route('/v1/sessions', streamRoutes(deps));

  // Extension endpoints (non-CMA)
  app.route('/v1/x', extendedRoutes(deps));

  // Self-hosted sandbox worker endpoints (R9.14)
  if (deps.workQueue) {
    app.route('/v1/x/worker', workerRoutes(deps.workQueue));
  }

  // Root health check (JSON — used by SDK/clients)
  app.get('/', (c) => c.json({ status: 'ok', name: 'managed-agents', version: '0.1.0' }));

  // Web dashboard (R10)
  app.get('/ui', (c) => serveConsoleAsset(c, 'index.html', deps.consoleRoot));
  app.get('/ui/*', (c) => {
    const path = c.req.path.replace(/^\/ui\/?/, '') || 'index.html';
    return serveConsoleAsset(c, path, deps.consoleRoot);
  });

  return app;
}

function serveConsoleAsset(c: any, requestedPath: string, overrideRoot?: string | null) {
  const root = resolveConsoleRoot(overrideRoot);
  if (!root) {
    return c.html(
      '<!doctype html><html><head><title>Console not built</title></head><body><h1>Console not built</h1><p>Run <code>npm run build:console</code> before serving /ui.</p></body></html>',
      503,
    );
  }

  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const assetPath = join(root, safePath);
  const filePath = existsSync(assetPath) && statSync(assetPath).isFile()
    ? assetPath
    : join(root, 'index.html');

  const content = readFileSync(filePath);
  return c.body(content, 200, {
    'Content-Type': contentTypeFor(filePath),
  });
}

function resolveConsoleRoot(overrideRoot?: string | null): string | null {
  if (overrideRoot === null) return null;
  if (overrideRoot) return existsSync(join(overrideRoot, 'index.html')) ? overrideRoot : null;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, 'console'),
    join(process.cwd(), 'dist', 'console'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? null;
}

function contentTypeFor(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
