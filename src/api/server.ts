/**
 * HTTP API Server
 *
 * Hono-based REST API exposing CMA-compatible endpoints.
 * Factory function pattern — creates server with injected dependencies.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sessionsRoutes } from './routes/sessions.js';
import { agentsRoutes } from './routes/agents.js';
import { extendedRoutes } from './routes/extended.js';
import { streamRoutes } from './routes/stream.js';
import { createAuthMiddleware } from './auth.js';
import { DASHBOARD_HTML } from './dashboard.js';
import type { SessionManager } from '@/core/session/session-manager.js';
import type { AgentDefinition } from '@/types/agent.js';
import { workerRoutes } from './routes/worker.js';
import type { WorkQueue } from '@/sandbox/self-hosted-provider.js';
import type { Logger } from '@/core/observability/logger.js';
import type { Metrics } from '@/core/observability/metrics.js';

export interface ServerDeps {
  sessionManager: SessionManager;
  agents: AgentDefinition[];
  reloadAgents: () => { agents: AgentDefinition[]; errors: any[] };
  /** Accepted API keys. Empty/undefined = auth disabled (open, local-first). */
  apiKeys?: string[];
  /** MCP connection status for a session (for /v1/x/mcp/status). */
  getMcpStatus?: (sessionId: string) => Array<{
    name: string;
    transport: string;
    connected: boolean;
    toolCount: number;
    error?: string;
  }>;
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
  app.get('/ui', (c) => c.html(DASHBOARD_HTML));

  return app;
}
