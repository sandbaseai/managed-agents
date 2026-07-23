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
import { dirname } from 'node:path';
import type { ServerDeps } from '../server.js';
import type { LogLevel } from '@/core/observability/logger.js';
import { getAgentSkillIds, getEnabledToolNames } from '@/core/agent/standard.js';
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
} from '@/core/storage/providers.js';
import {
  getRuntimeSettings,
  updateRuntimeSettings,
  validateRuntimeSettings,
  type RuntimeSettingsPatch,
} from '@/core/settings/schema.js';

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

export function extendedRoutes(deps: ServerDeps) {
  const app = new Hono();

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

  // GET /metrics/summary - JSON runtime/workspace summary for Console monitoring.
  app.get('/metrics/summary', (c) => {
    const sessionsByStatus = countBy(deps.db, 'sessions', 'status');
    const eventsByType = countBy(deps.db, 'events', 'type');
    const sessionUsage = deps.db.prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(usage_tokens_in), 0) AS input_tokens,
        COALESCE(SUM(usage_tokens_out), 0) AS output_tokens
       FROM sessions`,
    ).get() as { total: number; input_tokens: number; output_tokens: number };
    const eventUsage = deps.db.prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(tokens_in), 0) AS input_tokens,
        COALESCE(SUM(tokens_out), 0) AS output_tokens,
        COALESCE(AVG(NULLIF(duration_ms, 0)), 0) AS average_duration_ms
       FROM events`,
    ).get() as { total: number; input_tokens: number; output_tokens: number; average_duration_ms: number };
    const files = deps.db.prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(size_bytes), 0) AS bytes
       FROM files
       WHERE archived_at IS NULL`,
    ).get() as { total: number; bytes: number };
    const artifacts = deps.db.prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(size_bytes), 0) AS bytes
       FROM files
       WHERE archived_at IS NULL AND role = 'artifact'`,
    ).get() as { total: number; bytes: number };
    const metricsSnapshot = deps.metrics?.snapshot();
    return c.json({
      type: 'metrics_summary',
      generated_at: new Date().toISOString(),
      sessions: {
        total: Number(sessionUsage.total ?? 0),
        by_status: sessionsByStatus,
        input_tokens: Number(sessionUsage.input_tokens ?? 0),
        output_tokens: Number(sessionUsage.output_tokens ?? 0),
      },
      events: {
        total: Number(eventUsage.total ?? 0),
        by_type: eventsByType,
        input_tokens: Number(eventUsage.input_tokens ?? 0),
        output_tokens: Number(eventUsage.output_tokens ?? 0),
        average_duration_ms: Math.round(Number(eventUsage.average_duration_ms ?? 0)),
      },
      storage: {
        files: Number(files.total ?? 0),
        file_bytes: Number(files.bytes ?? 0),
        artifacts: Number(artifacts.total ?? 0),
        artifact_bytes: Number(artifacts.bytes ?? 0),
      },
      work_queue: deps.workQueue?.stats() ?? {},
      http: {
        requests: metricsSnapshot?.counters.http_requests_total ?? 0,
        errors: metricsSnapshot?.counters.http_errors_total ?? 0,
        request_duration_ms: metricsSnapshot?.histograms.http_request_duration_ms ?? { count: 0, sum: 0 },
      },
    });
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

  app.get('/settings', (c) => {
    return c.json(getRuntimeSettings(deps.db, {
      sandboxProviders: deps.runtime?.sandboxProviders,
      dataDir: deps.workspace?.dataDir,
    }));
  });

  const updateSettings = async (c: any) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be JSON' } }, 400);
    }

    try {
      const settings = updateRuntimeSettings(deps.db, body as RuntimeSettingsPatch, {
        sandboxProviders: deps.runtime?.sandboxProviders,
        dataDir: deps.workspace?.dataDir,
      });
      const defaultModel = settings.model_provider.configured
        ? listModelProviders(deps.db).find((model) => model.is_default)
        : undefined;
      if (defaultModel) {
        deps.registerModelProvider?.(defaultModel);
        deps.setDefaultRuntimeModel?.(defaultModel.name);
      }
      return c.json(settings);
    } catch (err: any) {
      return c.json({ error: { type: 'invalid_request', message: err?.message ?? 'Invalid settings' } }, 400);
    }
  };

  app.put('/settings', updateSettings);
  app.patch('/settings', updateSettings);

  app.post('/settings/validate', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = getRuntimeSettings(deps.db, {
        sandboxProviders: deps.runtime?.sandboxProviders,
        dataDir: deps.workspace?.dataDir,
      });
    }

    return c.json(validateRuntimeSettings(body as RuntimeSettingsPatch));
  });

  app.get('/templates', (c) => {
    const templates = builtInTemplates(defaultTemplateModel(deps));
    return c.json({
      data: templates,
      has_more: false,
      first_id: templates[0]?.id ?? null,
      last_id: templates.at(-1)?.id ?? null,
    });
  });

  return app;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function countBy(db: ServerDeps['db'], table: 'sessions' | 'events', column: 'status' | 'type'): Record<string, number> {
  const rows = db.prepare(`SELECT ${column} AS name, COUNT(*) AS count FROM ${table} GROUP BY ${column}`).all() as Array<{ name: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.name, Number(row.count)]));
}

function runtimeModels(deps: ServerDeps) {
  return deps.listRuntimeModels?.() ?? deps.runtime?.models ?? [];
}

function defaultTemplateModel(deps: ServerDeps) {
  const models = runtimeModels(deps);
  return models.find((model) => model.is_default)?.name
    ?? models.find((model) => model.name.trim().length > 0)?.name
    ?? 'default';
}

function builtInTemplates(defaultModelName: string) {
  return [
    {
      id: 'template_blank_agent',
      type: 'template',
      name: 'Blank agent',
      description: 'Start from scratch with just the core toolset and a generic prompt.',
      tags: ['starter'],
      agent: {
        name: 'Untitled agent',
        model: defaultModelName,
        description: 'A blank starting point with the core toolset.',
        system: 'You are a general-purpose agent that can research, write code, run commands, and use connected tools to complete the user\'s task end to end.',
        mcp_servers: [],
        tools: [{ type: 'agent_toolset_20260401' }],
        skills: [],
        metadata: {},
      },
    },
    {
      id: 'template_deep_researcher',
      type: 'template',
      name: 'Deep researcher',
      description: 'Plans multi-step research, tracks sources, and writes a cited synthesis.',
      tags: ['research', 'web'],
      agent: {
        name: 'deep-researcher',
        model: defaultModelName,
        description: 'Conducts multi-step web research with source synthesis and citations.',
        system: 'You are a deep research agent. Break the task into questions, gather sources, compare evidence, and produce a concise cited report.',
        tools: [{
          type: 'agent_toolset_20260401',
          default_config: {
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          configs: [
            { name: 'read', enabled: true },
            { name: 'write', enabled: true },
            { name: 'grep', enabled: true },
            { name: 'web_search', enabled: true },
            { name: 'web_fetch', enabled: true },
          ],
        }],
        skills: [],
        metadata: { template: 'deep-researcher' },
      },
    },
    {
      id: 'template_structured_extractor',
      type: 'template',
      name: 'Structured extractor',
      description: 'Turns unstructured text into a typed JSON schema.',
      tags: ['data'],
      agent: {
        name: 'structured-extractor',
        model: defaultModelName,
        description: 'Parses unstructured text into a typed JSON schema.',
        system: 'Extract structured data exactly matching the requested schema. Return valid JSON and note uncertain fields.',
        tools: [{
          type: 'agent_toolset_20260401',
          default_config: {
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          configs: [
            { name: 'read', enabled: true },
            { name: 'write', enabled: true },
          ],
        }],
        skills: [],
        metadata: { template: 'structured-extractor' },
      },
    },
    {
      id: 'template_field_monitor',
      type: 'template',
      name: 'Field monitor',
      description: 'Scans software blogs for a topic and writes a weekly what-changed brief.',
      tags: ['monitoring', 'recurring'],
      agent: {
        name: 'Field monitor',
        model: defaultModelName,
        description: 'Scans software blogs for a topic and writes a weekly what-changed brief.',
        system: 'You are a field monitor. Track the assigned topic, scan relevant product and engineering updates, compare changes week over week, and write a concise brief with links and impact notes.',
        mcp_servers: [
          { name: 'notion', type: 'url', url: 'https://mcp.notion.com/mcp' },
        ],
        tools: [
          { type: 'agent_toolset_20260401' },
          {
            type: 'mcp_toolset',
            mcp_server_name: 'notion',
            default_config: { permission_policy: { type: 'always_allow' } },
          },
        ],
        skills: [],
        metadata: { template: 'field-monitor' },
      },
    },
    {
      id: 'template_support_agent',
      type: 'template',
      name: 'Support agent',
      description: 'Answers questions from documentation and escalates unresolved cases.',
      tags: ['support'],
      agent: {
        name: 'support-agent',
        model: defaultModelName,
        description: 'Answers customer questions from your docs and knowledge base, and escalates when needed.',
        system: 'You are a support agent. Use the available docs first, answer with clear steps, and escalate when confidence is low.',
        tools: [{
          type: 'agent_toolset_20260401',
          default_config: {
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          configs: [
            { name: 'read', enabled: true },
            { name: 'grep', enabled: true },
            { name: 'web_fetch', enabled: true },
          ],
        }],
        skills: [],
        metadata: { template: 'support-agent' },
      },
    },
    {
      id: 'template_incident_commander',
      type: 'template',
      name: 'Incident commander',
      description: 'Triages a Sentry alert, opens a Linear incident ticket, and runs the Slack war room.',
      tags: ['incident', 'sentry', 'linear', 'slack'],
      agent: {
        name: 'Incident commander',
        description: 'Triages a Sentry alert, opens a Linear incident ticket, and runs the Slack war room.',
        model: defaultModelName,
        system: `You are an on-call incident commander. When handed a Sentry issue ID or an error fingerprint:

1. Pull the full event payload, stack trace, release tag, and affected-user count from Sentry.
2. Grep the repo for the top frame's file path and surrounding commits (last 72h).
3. Open a Linear incident ticket with severity, suspected blast radius, and your rollback recommendation.
4. Post a threaded status to the incident Slack channel: what broke, who's looking, ETA for next update.
5. Every 15 minutes, re-check Sentry event volume and update the thread until the user closes the incident.

Be decisive. If you're >70% confident it's a specific deploy, say so and recommend the revert.`,
        mcp_servers: [
          { name: 'sentry', type: 'url', url: 'https://mcp.sentry.dev/mcp' },
          { name: 'linear', type: 'url', url: 'https://mcp.linear.app/mcp' },
          { name: 'slack', type: 'url', url: 'https://mcp.slack.com/mcp' },
          { name: 'github', type: 'url', url: 'https://api.githubcopilot.com/mcp/' },
        ],
        tools: [
          { type: 'agent_toolset_20260401' },
          { type: 'mcp_toolset', mcp_server_name: 'sentry', default_config: { permission_policy: { type: 'always_allow' } } },
          { type: 'mcp_toolset', mcp_server_name: 'linear', default_config: { permission_policy: { type: 'always_allow' } } },
          { type: 'mcp_toolset', mcp_server_name: 'slack', default_config: { permission_policy: { type: 'always_allow' } } },
          { type: 'mcp_toolset', mcp_server_name: 'github', default_config: { permission_policy: { type: 'always_allow' } } },
        ],
        skills: [],
        metadata: { template: 'incident-commander' },
      },
    },
  ].map((template) => ({
    ...template,
    summary: `${template.agent.name} - ${getEnabledToolNames(template.agent as any).join(', ') || 'no tools'}`,
    skill_ids: getAgentSkillIds(template.agent as any),
  }));
}
