import type { Session, SessionStatus } from '@/types/session.js';

export interface SessionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  environment_id: string;
  status: string;
  title: string | null;
  context_id: string | null;
  resources: string;
  vault_ids: string;
  metadata: string | null;
  sandbox_type: string | null;
  sandbox_state: string | null;
  usage_tokens_in: number;
  usage_tokens_out: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    environmentId: row.environment_id,
    status: row.status as SessionStatus,
    title: row.title ?? undefined,
    contextId: row.context_id ?? undefined,
    resources: JSON.parse(row.resources ?? '[]'),
    vaultIds: JSON.parse(row.vault_ids ?? '[]'),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    sandboxType: row.sandbox_type ?? undefined,
    sandboxState: row.sandbox_state ? JSON.parse(row.sandbox_state) : undefined,
    usage: { tokensIn: row.usage_tokens_in, tokensOut: row.usage_tokens_out },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}
