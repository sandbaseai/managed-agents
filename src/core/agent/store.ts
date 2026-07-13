import type { Database } from '@/core/db/database.js';
import { validateAgentDefinition } from './schema.js';
import type { AgentDefinition, AgentLoadError } from '@/types/agent.js';

type AgentRow = {
  id: string;
  name: string;
  definition: string;
  loaded_at?: string;
  updated_at?: string;
  status?: string;
  version?: number;
  archived_at?: string | null;
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
    const existing = db.prepare('SELECT id FROM agents WHERE id = ?').get(id);
    if (existing) continue;

    db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      id,
      agent.name,
      JSON.stringify(agent),
    );
  }

  return errors;
}

export function loadActiveAgentRows(db: Database): AgentRow[] {
  return db
    .prepare(`
      SELECT id, name, definition, loaded_at, updated_at, status, version, archived_at
      FROM agents
      WHERE archived_at IS NULL
        AND status != 'archived'
      ORDER BY loaded_at ASC, name ASC
    `)
    .all() as unknown as AgentRow[];
}

export function loadActiveAgentsFromDb(db: Database): AgentDefinition[] {
  const rows = loadActiveAgentRows(db);
  return rows.flatMap((row) => {
    const agent = parseAgentDefinitionFromRow(row);
    return agent ? [agent] : [];
  });
}

export function loadAgentRowById(db: Database, id: string): AgentRow | undefined {
  return db.prepare(`
    SELECT id, name, definition, loaded_at, updated_at, status, version, archived_at
    FROM agents
    WHERE id = ?
  `).get(id) as AgentRow | undefined;
}

export function loadAgentDefinitionById(db: Database, id: string): AgentDefinition | undefined {
  const row = loadAgentRowById(db, id);
  if (!row || row.status === 'archived' || row.archived_at) return undefined;
  return parseAgentDefinitionFromRow(row);
}

export function parseAgentDefinitionFromRow(row: Pick<AgentRow, 'definition'>): AgentDefinition | undefined {
  try {
    const parsed = JSON.parse(row.definition) as unknown;
    const result = validateAgentDefinition(parsed);
    return result.valid && result.data ? result.data : undefined;
  } catch {
    return undefined;
  }
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
