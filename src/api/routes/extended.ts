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
import { dirname, join } from 'node:path';
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
  type StorageProviderRole,
} from '@/core/storage/providers.js';
import { describeSettingsAdapters, availabilityFromDescriptors } from '@/core/settings/adapters.js';
import { validateRuntimeSettings, validateRuntimeSettingsCredentials, type RuntimeSettings } from '@/core/settings/schema.js';
import {
  mergeRuntimeSettingsArea,
  testRuntimeSettingsArea,
  type RuntimeSettingsTestArea,
} from '@/core/settings/test.js';
import {
  getOrSeedRuntimeSettings,
  hasRuntimeSettingsSecret,
  maskRuntimeSettings,
  runtimeSettingsSecretStates,
  saveRuntimeSettings,
} from '@/core/settings/store.js';

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const SETTINGS_TEST_AREAS = new Set<RuntimeSettingsTestArea>([
  'model',
  'loop_engine',
  'storage.metadata',
  'storage.artifacts',
  'memory',
  'sandbox',
]);

export function extendedRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/settings', (c) => {
    const settings = getOrSeedRuntimeSettings(deps.db, {}, deps.workspace?.dataDir);
    const adapters = describeSettingsAdapters(deps.runtime?.sandboxProviders);
    return c.json({
      schema_version: settings.schema_version,
      revision: settings.revision,
      effective_revision: settings.effective_revision,
      saved_config: maskRuntimeSettings(settings.saved_config),
      effective_config: maskRuntimeSettings(settings.effective_config),
      restart_required: settings.restart_required,
      activation_status: settings.activation_status,
      activation_errors: settings.activation_errors,
      diagnostics: settingsDiagnostics(deps),
      adapters,
      secret_states: runtimeSettingsSecretStates(deps.db, settings.saved_config),
    });
  });

  app.post('/settings/validate', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        valid: false,
        errors: [{ path: '', code: 'invalid_json', message: 'Request body must be valid JSON' }],
        warnings: [],
      }, 400);
    }
    const adapters = describeSettingsAdapters(deps.runtime?.sandboxProviders);
    const result = validateRuntimeSettings(body, availabilityFromDescriptors(adapters));
    if (result.normalized_config) {
      result.errors.push(...validateRuntimeSettingsCredentials(
        result.normalized_config,
        (path) => hasRuntimeSettingsSecret(deps.db, path),
      ));
      result.valid = result.errors.length === 0;
    }
    return c.json({
      ...result,
      ...(result.normalized_config ? { normalized_config: maskRuntimeSettings(result.normalized_config) } : {}),
    });
  });

  app.post('/settings/test', async (c) => {
    let body: { area?: unknown; config?: unknown; full_config?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }
    const area = body?.area;
    if (typeof area !== 'string' || !SETTINGS_TEST_AREAS.has(area as RuntimeSettingsTestArea)) {
      return c.json({
        error: {
          type: 'invalid_request',
          message: 'area must be one of model, loop_engine, storage.metadata, storage.artifacts, memory, or sandbox',
        },
      }, 400);
    }

    const settings = getOrSeedRuntimeSettings(deps.db, {}, deps.workspace?.dataDir);
    const candidate = body.full_config
      ? body.full_config
      : mergeRuntimeSettingsArea(settings.saved_config, area as RuntimeSettingsTestArea, body.config);
    const adapters = describeSettingsAdapters(deps.runtime?.sandboxProviders);
    const validation = validateRuntimeSettings(candidate, availabilityFromDescriptors(adapters));
    if (validation.normalized_config) {
      validation.errors.push(...credentialIssuesForTestArea(
        area as RuntimeSettingsTestArea,
        validation.normalized_config,
        (path) => hasRuntimeSettingsSecret(deps.db, path),
      ));
      validation.valid = validation.errors.length === 0;
    }
    if (!validation.valid || !validation.normalized_config) {
      return c.json({
        ok: false,
        area,
        status: 'failed',
        checks: [],
        errors: validation.errors,
        warnings: validation.warnings,
      }, 422);
    }

    const result = await testRuntimeSettingsArea({
      db: deps.db,
      dataDir: deps.workspace?.dataDir,
      area: area as RuntimeSettingsTestArea,
      config: validation.normalized_config,
    });
    return c.json({ ...result, errors: [], warnings: validation.warnings });
  });

  app.put('/settings', async (c) => {
    let body: { revision?: unknown; config?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }
    if (!body || typeof body !== 'object' || !Number.isInteger(body.revision) || (body.revision as number) < 1) {
      return c.json({ error: { type: 'invalid_request', message: 'revision must be a positive integer' } }, 400);
    }
    const adapters = describeSettingsAdapters(deps.runtime?.sandboxProviders);
    const validation = validateRuntimeSettings(body.config, availabilityFromDescriptors(adapters));
    if (validation.normalized_config) {
      validation.errors.push(...validateRuntimeSettingsCredentials(
        validation.normalized_config,
        (path) => hasRuntimeSettingsSecret(deps.db, path),
      ));
      validation.valid = validation.errors.length === 0;
    }
    if (!validation.valid || !validation.normalized_config) {
      return c.json({
        error: { type: 'validation_error', message: 'Settings configuration is invalid' },
        ...validation,
      }, 422);
    }
    const previous = getOrSeedRuntimeSettings(deps.db, {}, deps.workspace?.dataDir);
    const saved = saveRuntimeSettings(
      deps.db,
      validation.normalized_config,
      body.revision as number,
      deps.workspace?.dataDir,
    );
    if (!saved.ok) {
      return c.json({
        error: { type: 'revision_conflict', message: 'Settings were modified by another request' },
        revision: saved.record.revision,
        saved_config: maskRuntimeSettings(saved.record.saved_config),
      }, 409);
    }
    deps.logger?.info('runtime_settings_saved', {
      old_revision: previous.revision,
      new_revision: saved.record.revision,
      changed_paths: changedRuntimeSettingsPaths(previous.saved_config, saved.record.saved_config, validation.normalized_config),
      restart_required: saved.record.restart_required,
    });
    return c.json({
      schema_version: saved.record.schema_version,
      revision: saved.record.revision,
      effective_revision: saved.record.effective_revision,
      saved_config: maskRuntimeSettings(saved.record.saved_config),
      effective_config: maskRuntimeSettings(saved.record.effective_config),
      restart_required: saved.record.restart_required,
      activation_status: saved.record.activation_status,
      activation_errors: saved.record.activation_errors,
      diagnostics: settingsDiagnostics(deps),
      secret_states: runtimeSettingsSecretStates(deps.db, saved.record.saved_config),
    });
  });

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

function settingsDiagnostics(deps: ServerDeps) {
  let metadataHealth: 'ok' | 'failed' = 'failed';
  try {
    const result = deps.db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    metadataHealth = result?.quick_check === 'ok' ? 'ok' : 'failed';
  } catch {
    metadataHealth = 'failed';
  }
  return {
    metadata: {
      path: deps.workspace?.dataDir ? join(deps.workspace.dataDir, 'data.db') : null,
      health: metadataHealth,
    },
  };
}

function changedRuntimeSettingsPaths(before: RuntimeSettings, after: RuntimeSettings, candidate: RuntimeSettings = after): string[] {
  const paths = new Set<string>();
  collectChangedPaths(before, after, candidate, '', paths);
  return Array.from(paths).sort();
}

function credentialIssuesForTestArea(
  area: RuntimeSettingsTestArea,
  config: RuntimeSettings,
  hasStoredSecret: (path: string) => boolean,
) {
  const prefixes = credentialPrefixesForTestArea(area);
  return validateRuntimeSettingsCredentials(config, hasStoredSecret)
    .filter((issue) => prefixes.some((prefix) => issue.path === prefix || issue.path.startsWith(`${prefix}.`)));
}

function credentialPrefixesForTestArea(area: RuntimeSettingsTestArea): string[] {
  switch (area) {
    case 'model':
      return ['model'];
    case 'loop_engine':
      return ['loop_engine'];
    case 'storage.metadata':
      return ['storage.metadata'];
    case 'storage.artifacts':
      return ['storage.artifacts'];
    case 'memory':
      return ['memory'];
    case 'sandbox':
      return ['sandbox'];
  }
}

function collectChangedPaths(before: unknown, after: unknown, candidate: unknown, prefix: string, paths: Set<string>): void {
  if (prefix && isSettingsSecretPath(prefix)) {
    if (candidate === '********') {
      if (!Object.is(before, after)) paths.add(prefix);
      return;
    }
    if (candidate === undefined) {
      if (before !== undefined) paths.add(prefix);
      return;
    }
    if (typeof candidate === 'string') {
      if (!Object.is(before, candidate)) paths.add(prefix);
      return;
    }
  }
  if (Object.is(before, after)) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      const childCandidate = isPlainObject(candidate) ? candidate[key] : after[key];
      collectChangedPaths(before[key], after[key], childCandidate, childPrefix, paths);
    }
    return;
  }
  if (prefix) paths.add(prefix);
}

function isSettingsSecretPath(path: string): boolean {
  if (path === 'model.api_key') return true;
  if (!path.includes('.options.')) return false;
  const key = path.split('.').at(-1) ?? '';
  return /(api[_-]?key|access[_-]?key|secret|token|password|credential)/i.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
