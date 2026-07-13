/**
 * Agent Routes
 *
 * GET /v1/agents      — list loaded agents
 * GET /v1/agents/:id  — get agent detail
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf, toApiAgent } from '../standard.js';
import { validateAgentDefinition } from '@/core/agent/schema.js';
import {
  loadActiveAgentRows,
  loadAgentRowById,
  parseAgentDefinitionFromRow,
  refreshAgentsFromDb,
} from '@/core/agent/store.js';

export function agentsRoutes(deps: ServerDeps) {
  const app = new Hono();

  // GET / — List agents
  app.get('/', (c) => {
    const agents = loadActiveAgentRows(deps.db).flatMap((row) => {
      const agent = parseAgentDefinitionFromRow(row);
      return agent ? [toApiAgent(agent, agentRowMetaFromRow(row))] : [];
    });
    return c.json(pageOf(agents));
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
    const id = createAgentId(deps);

    deps.db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      id,
      agent.name,
      JSON.stringify(agent),
    );
    refreshAgentsFromDb(deps.db, deps.agents);

    return c.json(toApiAgent(agent, agentRowMeta(deps, id)), 201);
  });

  app.get('/:id/versions', (c) => {
    const id = c.req.param('id');
    const row = activeAgentRow(deps, id);
    const agent = row ? parseAgentDefinitionFromRow(row) : undefined;
    if (!row || !agent) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    return c.json(pageOf([toApiAgent(agent, agentRowMetaFromRow(row))]));
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
    const existing = activeAgentRow(deps, id);
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

    refreshAgentsFromDb(deps.db, deps.agents);

    return c.json(toApiAgent(agent, agentRowMeta(deps, id)));
  });

  app.post('/:id/archive', (c) => {
    const id = c.req.param('id');
    const existing = activeAgentRow(deps, id);
    if (!existing) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    const agent = parseAgentDefinitionFromRow(existing);
    deps.db.prepare(`
      UPDATE agents
      SET status = 'archived',
          archived_at = COALESCE(archived_at, datetime('now')),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    refreshAgentsFromDb(deps.db, deps.agents);
    return c.json(agent ? toApiAgent(agent, agentRowMeta(deps, id)) : { id, status: 'archived' });
  });

  // GET /:id — Get agent detail
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const row = activeAgentRow(deps, id);
    const agent = row ? parseAgentDefinitionFromRow(row) : undefined;
    if (!row || !agent) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    return c.json(toApiAgent(agent, agentRowMetaFromRow(row)));
  });

  return app;
}

function agentRowMeta(deps: ServerDeps, id: string) {
  const row = loadAgentRowById(deps.db, id);
  if (!row) return undefined;
  return agentRowMetaFromRow(row);
}

function agentRowMetaFromRow(row: {
  id: string;
  loaded_at?: string;
  updated_at?: string;
  status?: string;
  version?: number;
  archived_at?: string | null;
}) {
  return {
    id: row.id,
    createdAt: row.loaded_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    status: row.status === 'archived' || row.archived_at ? 'archived' as const : 'active' as const,
    version: row.version ?? 1,
  };
}

function activeAgentRow(deps: ServerDeps, id: string) {
  const row = loadAgentRowById(deps.db, id);
  if (!row || row.status === 'archived' || row.archived_at) return undefined;
  return row;
}

function createAgentId(deps: ServerDeps): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = `agent_${nanoid(24)}`;
    const existing = deps.db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (!existing) return id;
  }
  throw new Error('Unable to allocate unique agent id');
}
