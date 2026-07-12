/**
 * Agent Routes
 *
 * GET /v1/agents      — list loaded agents
 * GET /v1/agents/:id  — get agent detail
 */

import { Hono } from 'hono';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { ServerDeps } from '../server.js';
import { agentId, pageOf, toApiAgent } from '../standard.js';
import { validateAgentDefinition } from '@/core/agent/schema.js';
import type { AgentDefinition } from '@/types/agent.js';

export function agentsRoutes(deps: ServerDeps) {
  const app = new Hono();

  // GET / — List agents
  app.get('/', (c) => {
    return c.json(pageOf(deps.agents.map((agent) => toApiAgent(agent, agentRowMeta(deps, agentId(agent.name))))));
  });

  // POST / — Create a standard agent definition in agents/
  app.post('/', async (c) => {
    if (!deps.workspace?.agentsDir) {
      return c.json({ error: { type: 'not_available', message: 'agentsDir is not configured' } }, 503);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }

    const result = validateAgentDefinition(body);
    if (!result.valid || !result.data) {
      return c.json({ error: { type: 'invalid_request', message: 'Invalid agent definition', details: result.errors } }, 400);
    }

    const agent = result.data;
    const id = agentId(agent.name);
    mkdirSync(deps.workspace.agentsDir, { recursive: true });
    const filePath = join(deps.workspace.agentsDir, `${agent.name}.yaml`);
    if (existsSync(filePath) || deps.agents.some((item) => agentId(item.name) === id)) {
      return c.json({ error: { type: 'conflict', message: `Agent already exists: ${agent.name}` } }, 409);
    }

    writeAgentFile(filePath, agent);
    deps.db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      id,
      agent.name,
      JSON.stringify(agent),
    );
    const reload = deps.reloadAgents();
    deps.agents.length = 0;
    deps.agents.push(...reload.agents);

    return c.json(toApiAgent(agent, agentRowMeta(deps, id)), 201);
  });

  app.get('/:id/versions', (c) => {
    const id = c.req.param('id');
    const agent = deps.agents.find((a) => agentId(a.name) === id);
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    return c.json(pageOf([toApiAgent(agent, agentRowMeta(deps, id))]));
  });

  app.put('/:id', async (c) => {
    if (!deps.workspace?.agentsDir) {
      return c.json({ error: { type: 'not_available', message: 'agentsDir is not configured' } }, 503);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }

    const id = c.req.param('id');
    const result = validateAgentDefinition(body);
    if (!result.valid || !result.data) {
      return c.json({ error: { type: 'invalid_request', message: 'Invalid agent definition', details: result.errors } }, 400);
    }

    const agent = result.data;
    if (agentId(agent.name) !== id) {
      return c.json({ error: { type: 'invalid_request', message: 'Agent rename is not supported by this local file-backed store yet' } }, 400);
    }

    const existing = deps.db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (!existing) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }

    mkdirSync(deps.workspace.agentsDir, { recursive: true });
    writeAgentFile(join(deps.workspace.agentsDir, `${agent.name}.yaml`), agent);
    deps.db.prepare(`
      UPDATE agents
      SET name = ?,
          definition = ?,
          status = 'active',
          error_message = NULL,
          archived_at = NULL,
          version = COALESCE(version, 1) + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(agent.name, JSON.stringify(agent), id);

    const reload = deps.reloadAgents();
    deps.agents.length = 0;
    deps.agents.push(...reload.agents);

    return c.json(toApiAgent(agent, agentRowMeta(deps, id)));
  });

  app.post('/:id/archive', (c) => {
    const id = c.req.param('id');
    const existing = deps.db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (!existing) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    deps.db.prepare(`
      UPDATE agents
      SET status = 'archived',
          archived_at = COALESCE(archived_at, datetime('now')),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    const agent = deps.agents.find((a) => agentId(a.name) === id);
    return c.json(agent ? toApiAgent(agent, agentRowMeta(deps, id)) : { id, status: 'archived' });
  });

  // GET /:id — Get agent detail
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const agent = deps.agents.find((a) => agentId(a.name) === id);
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    return c.json(toApiAgent(agent, agentRowMeta(deps, id)));
  });

  return app;
}

function writeAgentFile(filePath: string, agent: AgentDefinition): void {
  writeFileSync(filePath, stringifyYaml(agent));
}

function agentRowMeta(deps: ServerDeps, id: string) {
  const row = deps.db.prepare('SELECT loaded_at, updated_at, status, version, archived_at FROM agents WHERE id = ?').get(id) as
    | { loaded_at: string; updated_at: string; status: string; version?: number; archived_at?: string | null }
    | undefined;
  if (!row) return undefined;
  return {
    createdAt: row.loaded_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    status: row.status === 'archived' || row.archived_at ? 'archived' as const : 'active' as const,
    version: row.version ?? 1,
  };
}
