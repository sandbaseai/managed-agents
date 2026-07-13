/**
 * Agent Routes
 *
 * GET /v1/agents      — list loaded agents
 * GET /v1/agents/:id  — get agent detail
 */

import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';
import { agentId, pageOf, toApiAgent } from '../standard.js';
import { validateAgentDefinition } from '@/core/agent/schema.js';

export function agentsRoutes(deps: ServerDeps) {
  const app = new Hono();

  // GET / — List agents
  app.get('/', (c) => {
    return c.json(pageOf(deps.agents.map((agent) => toApiAgent(agent, agentRowMeta(deps, agentId(agent.name))))));
  });

  // POST / — Create a standard agent definition in SQLite.
  app.post('/', async (c) => {
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
    const existing = deps.db.prepare('SELECT id FROM agents WHERE id = ? OR name = ?').get(id, agent.name);
    if (existing || deps.agents.some((item) => agentId(item.name) === id)) {
      return c.json({ error: { type: 'conflict', message: `Agent already exists: ${agent.name}` } }, 409);
    }

    deps.db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      id,
      agent.name,
      JSON.stringify(agent),
    );
    deps.agents.push(agent);

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
      return c.json({ error: { type: 'invalid_request', message: 'Agent rename is not supported yet' } }, 400);
    }

    const existing = deps.db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (!existing) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }

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

    const index = deps.agents.findIndex((item) => agentId(item.name) === id);
    if (index >= 0) {
      deps.agents[index] = agent;
    } else {
      deps.agents.push(agent);
    }

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
    if (agent) {
      const index = deps.agents.indexOf(agent);
      if (index >= 0) deps.agents.splice(index, 1);
    }
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
