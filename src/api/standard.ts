import type { AgentDefinition, AgentToolset, McpServerConfig } from '@/types/agent.js';
import type { Session, SessionEvent } from '@/types/session.js';

export interface ApiPage<T extends { id: string }> {
  data: T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
}

export interface ApiAgent {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  system: string;
  model: string;
  model_config?: {
    speed: 'fast' | 'standard' | 'extended';
  };
  tools: AgentToolset[];
  mcp_servers: ApiMcpServer[];
  skills: Array<{
    type: 'custom' | 'anthropic';
    skill_id: string;
    version?: string;
  }>;
  metadata: Record<string, string>;
  status: 'active' | 'archived';
  version: number;
  created_at: string | null;
  updated_at: string | null;
  archived_at: string | null;
}

export type ApiMcpServer =
  | { type: 'url'; name: string; url: string }
  | { type: 'stdio'; name: string; command: string; args: string[]; env: Record<string, string> };

export interface ApiSession {
  id: string;
  type: 'session';
  title: string | null;
  agent: ApiAgent | { id: string; type: 'agent'; name: string };
  environment_id: string;
  status: 'idle' | 'running' | 'terminated' | 'failed';
  resources: ApiSessionResource[];
  vault_ids: string[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stats: Record<string, number>;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type ApiSessionResource =
  | { type: 'file'; file_id: string; mount_path: string }
  | { type: 'github_repository'; url?: string; repository_id?: string; checkout?: unknown; mount_path?: string }
  | { type: 'memory_store'; memory_store_id: string; access?: 'read_write' | 'read_only'; instructions?: string; mount_path?: string };

export interface ApiEvent {
  id: string;
  type: string;
  content: unknown[] | null;
  delta?: string;
  message_id?: string;
  created_at: string | null;
  processed_at: string | null;
  parent_event_id: string | null;
}

export function pageOf<T extends { id: string }>(data: T[], hasMore = false): ApiPage<T> {
  return {
    data,
    has_more: hasMore,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  };
}

export function agentId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `agent_${slug || 'untitled'}`;
}

export function toApiAgent(
  agent: AgentDefinition,
  dates?: {
    id?: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    archivedAt?: string | null;
    status?: 'active' | 'archived';
    version?: number;
  },
): ApiAgent {
  return {
    id: dates?.id ?? agentId(agent.name),
    type: 'agent',
    name: agent.name,
    description: agent.description ?? '',
    system: agent.system,
    model: agent.model,
    ...(agent.model_config && agent.model_config.speed !== 'standard' ? { model_config: agent.model_config } : {}),
    tools: agent.tools ?? [],
    mcp_servers: toApiMcpServers(agent.mcp_servers ?? []),
    skills: agent.skills ?? [],
    metadata: parseStringRecord(agent.metadata),
    status: dates?.status ?? (dates?.archivedAt ? 'archived' : 'active'),
    version: dates?.version ?? 1,
    created_at: dates?.createdAt ?? null,
    updated_at: dates?.updatedAt ?? null,
    archived_at: dates?.archivedAt ?? null,
  };
}

export function toApiSession(session: Session, agent?: AgentDefinition): ApiSession {
  return {
    id: session.id,
    type: 'session',
    title: session.title ?? null,
    agent: agent
      ? toApiAgent(agent, { id: session.agentId, version: session.agentVersion })
      : { id: session.agentId, type: 'agent', name: session.agentName },
    environment_id: session.environmentId,
    status: toApiSessionStatus(session.status),
    resources: parseJsonArray<Record<string, unknown>>(session.resources).map(toApiSessionResource),
    vault_ids: parseJsonArray(session.vaultIds),
    usage: {
      input_tokens: session.usage?.tokensIn ?? 0,
      output_tokens: session.usage?.tokensOut ?? 0,
    },
    stats: {},
    metadata: parseStringRecord(session.metadata),
    created_at: toIsoString(session.createdAt),
    updated_at: toIsoString(session.updatedAt),
    archived_at: null,
  };
}

export function toApiEvent(event: SessionEvent): ApiEvent {
  const streamEvent = event as SessionEvent & { delta?: string; message_id?: string };
  return {
    id: event.id,
    type: event.type,
    content: event.content ?? null,
    ...(streamEvent.delta !== undefined ? { delta: streamEvent.delta } : {}),
    ...(streamEvent.message_id !== undefined ? { message_id: streamEvent.message_id } : {}),
    created_at: event.createdAt ? toIsoString(event.createdAt) : null,
    processed_at: event.processedAt ? toIsoString(event.processedAt) : null,
    parent_event_id: event.parentEventId ?? null,
  };
}

export function toApiSessionStatus(status: string): ApiSession['status'] {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'terminated';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

function toApiSessionResource(resource: Record<string, unknown>): ApiSessionResource {
  if (resource.type === 'github_repository') {
    const safeResource = { ...resource };
    delete safeResource.authorization_token;
    return safeResource as ApiSessionResource;
  }
  return resource as ApiSessionResource;
}

function toApiMcpServers(servers: McpServerConfig[]): ApiMcpServer[] {
  return servers.map((server) => {
    if (server.type === 'url') {
      return { type: 'url', name: server.name, url: server.url ?? '' };
    }
    return {
      type: 'stdio',
      name: server.name,
      command: server.command ?? '',
      args: server.args ?? [],
      env: redactEnv(server.env ?? {}),
    };
  });
}

function redactEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(env).map((key) => [key, '${' + key + '}']));
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, recordValue]) => [key, String(recordValue)]),
    );
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parseStringRecord(parsed);
  } catch {
    return {};
  }
}

function parseJsonArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
