import type { Database } from '@/core/db/database.js';
import { validateAgentDefinition } from './schema.js';
import type { AgentDefinition, AgentLoadError } from '@/types/agent.js';

type AgentRow = {
  id: string;
  name: string;
  definition: string;
};

export function importAgentSeeds(db: Database, agents: AgentDefinition[]): AgentLoadError[] {
  const errors: AgentLoadError[] = [];

  for (const agent of agents) {
    const result = validateAgentDefinition(agent);
    if (!result.valid || !result.data) {
      errors.push({
        file: agent.name,
        reason: 'Invalid seeded agent definition',
        field: result.errors?.[0]?.path,
      });
      continue;
    }

    const id = standardAgentId(agent.name);
    const existing = db.prepare('SELECT id FROM agents WHERE id = ? OR name = ?').get(id, agent.name);
    if (existing) continue;

    db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      id,
      agent.name,
      JSON.stringify(agent),
    );
  }

  return errors;
}

export function loadActiveAgentsFromDb(db: Database): AgentDefinition[] {
  const rows = db
    .prepare(`
      SELECT id, name, definition
      FROM agents
      WHERE archived_at IS NULL
        AND status != 'archived'
      ORDER BY loaded_at ASC, name ASC
    `)
    .all() as unknown as AgentRow[];

  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.definition) as unknown;
      const result = validateAgentDefinition(parsed);
      return result.valid && result.data ? [result.data] : [];
    } catch {
      return [];
    }
  });
}

export function refreshAgentsFromDb(db: Database, target: AgentDefinition[]): AgentDefinition[] {
  const agents = loadActiveAgentsFromDb(db);
  target.length = 0;
  target.push(...agents);
  return agents;
}

function standardAgentId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `agent_${slug || 'untitled'}`;
}
