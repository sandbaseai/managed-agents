/**
 * Extension Routes (/v1/x/*)
 *
 * Platform-specific endpoints (non-CMA protocol):
 * POST /v1/x/reload  — hot-reload agent definitions
 * GET  /v1/x/health  — basic health check
 */

import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';
import { getAgentSkillIds, getEnabledToolNames } from '@/core/agent/standard.js';

export function extendedRoutes(deps: ServerDeps) {
  const app = new Hono();

  // POST /reload — Hot-reload agents
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

  // GET /health — Health check
  app.get('/health', (c) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      agents_loaded: deps.agents.length,
    });
  });

  // GET /metrics — Prometheus-format metrics
  app.get('/metrics', (c) => {
    if (!deps.metrics) {
      return c.text('# metrics disabled\n', 200, { 'Content-Type': 'text/plain' });
    }
    return c.text(deps.metrics.render(), 200, { 'Content-Type': 'text/plain; version=0.0.4' });
  });

  // GET /mcp/status?session_id=X — MCP server connection status for a session
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
    return c.json({
      type: 'workspace',
      name: deps.workspace?.root.split('/').filter(Boolean).at(-1) ?? 'local workspace',
      ...deps.workspace,
    });
  });

  app.get('/runtime', (c) => {
    return c.json({
      type: 'runtime',
      status: 'running',
      agents_loaded: deps.agents.length,
      skills_loaded: deps.skills?.length ?? 0,
      models: deps.runtime?.models ?? [],
      sandbox_providers: deps.runtime?.sandboxProviders ?? [],
      memory: deps.runtime?.memory ?? 'disabled',
      auth_enabled: deps.runtime?.authEnabled ?? false,
    });
  });

  app.get('/skills', (c) => {
    return c.json({
      data: (deps.skills ?? []).map((skill) => ({
        id: `skill_${skill.name}`,
        type: 'skill',
        name: skill.name,
        description: skill.description,
        file: skill.file,
      })),
      has_more: false,
      first_id: deps.skills?.[0] ? `skill_${deps.skills[0].name}` : null,
      last_id: deps.skills?.at(-1) ? `skill_${deps.skills.at(-1)!.name}` : null,
    });
  });

  app.get('/templates', (c) => {
    const templates = builtInTemplates();
    return c.json({
      data: templates,
      has_more: false,
      first_id: templates[0]?.id ?? null,
      last_id: templates.at(-1)?.id ?? null,
    });
  });

  return app;
}

function standardModel(id: string) {
  return { id, speed: 'standard' as const };
}

function builtInTemplates() {
  return [
    {
      id: 'template_blank_agent',
      type: 'template',
      name: 'Blank agent',
      description: 'Start from scratch with just the core toolset and a generic prompt.',
      tags: ['starter'],
      agent: {
        name: 'Untitled agent',
        model: standardModel('claude-sonnet-5'),
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
        model: standardModel('claude-sonnet-4-5'),
        description: 'Conducts multi-step web research with source synthesis and citations.',
        system: 'You are a deep research agent. Break the task into questions, gather sources, compare evidence, and produce a concise cited report.',
        tools: [{
          type: 'agent_toolset_20260401',
          default_config: {
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          configs: {
            read: { enabled: true },
            write: { enabled: true },
            grep: { enabled: true },
            web_search: { enabled: true },
            web_fetch: { enabled: true },
          },
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
        model: standardModel('gpt-4o'),
        description: 'Parses unstructured text into a typed JSON schema.',
        system: 'Extract structured data exactly matching the requested schema. Return valid JSON and note uncertain fields.',
        tools: [{
          type: 'agent_toolset_20260401',
          default_config: {
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          configs: {
            read: { enabled: true },
            write: { enabled: true },
          },
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
        model: standardModel('claude-sonnet-5'),
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
        model: standardModel('claude-sonnet-4-5'),
        description: 'Answers customer questions from your docs and knowledge base, and escalates when needed.',
        system: 'You are a support agent. Use the available docs first, answer with clear steps, and escalate when confidence is low.',
        tools: [{
          type: 'agent_toolset_20260401',
          default_config: {
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          configs: {
            read: { enabled: true },
            grep: { enabled: true },
            web_fetch: { enabled: true },
          },
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
        model: standardModel('claude-opus-4-8'),
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
    summary: `${template.agent.name} · ${getEnabledToolNames(template.agent as any).join(', ') || 'no tools'}`,
    skill_ids: getAgentSkillIds(template.agent as any),
  }));
}
