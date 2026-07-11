/**
 * Agent Routes
 *
 * GET /v1/agents      — list loaded agents
 * GET /v1/agents/:id  — get agent detail
 */

import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';

export function agentsRoutes(deps: ServerDeps) {
  const app = new Hono();

  // GET / — List agents
  app.get('/', (c) => {
    const agents = deps.agents.map((a) => ({
      id: agentId(a.name),
      name: a.name,
      model: a.model,
      description: a.description ?? null,
      status: 'active',
    }));
    return c.json({ data: agents });
  });

  // GET /:id — Get agent detail (accepts both "agent_<name>" and bare "<name>")
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const agent = deps.agents.find((a) => agentId(a.name) === id || a.name === id);
    if (!agent) {
      return c.json({ error: { type: 'not_found', message: `Agent not found: ${id}` } }, 404);
    }
    return c.json({
      id: agentId(agent.name),
      name: agent.name,
      model: agent.model,
      description: agent.description ?? null,
      system_prompt: agent.system_prompt,
      skills: agent.skills ?? [],
      tools: agent.tools ?? [],
      confirm_tools: agent.confirm_tools ?? [],
      delegations: agent.delegations ?? [],
      max_turns: agent.max_turns ?? 50,
      temperature: agent.temperature ?? 0.7,
      strategy: agent.strategy ?? 'default',
      environment: agent.environment ?? 'local',
      status: 'active',
    });
  });

  return app;
}

/**
 * Compute the public agent id from its name. Must match the id scheme used
 * by SessionManager.create() when it stores session.agent_id, so that
 * `GET /v1/agents/{session.agent_id}` resolves correctly.
 */
function agentId(name: string): string {
  return `agent_${name}`;
}
