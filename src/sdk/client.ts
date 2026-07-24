/**
 * managed-agents Client SDK
 *
 * A small typed wrapper over the managed-agents HTTP API. Works in Node 22+
 * (uses the global fetch). Provides ergonomic session/agent operations plus
 * SSE streaming (`tail`) and a convenience `chat` (send + stream the reply).
 */

import type { ContentBlock } from '@/types/cma-protocol.js';

export interface ClientOptions {
  /** Base URL of the server, e.g. http://localhost:3000 */
  baseUrl: string;
  /** API key (only needed when the server has auth enabled). */
  apiKey?: string;
  /** Optional custom fetch (for testing). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface SessionSummary {
  id: string;
  type: 'session';
  agent: AgentSummary;
  environment_id: string;
  status: 'idle' | 'running' | 'terminated' | 'failed';
  title?: string | null;
  resources: Array<Record<string, unknown>>;
  vault_ids: string[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface AgentSummary {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  system: string;
  model: string;
  model_config?: { speed: string };
  tools: Array<Record<string, unknown>>;
  mcp_servers: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  status: string;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  archived_at: string | null;
}

export interface WorkspaceFileSummary {
  id: string;
  type: 'file';
  filename: string;
  media_type: string;
  size_bytes: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SessionArtifactSummary extends Omit<WorkspaceFileSummary, 'type'> {
  type: 'session_artifact';
  session_id: string;
  artifact_path: string;
  preview?: string | null;
  content_url: string;
}

export interface ApiKeySummary {
  id: string;
  type: 'api_key';
  name: string;
  source: 'managed' | 'config_env';
  status: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKeyCreateResponse extends ApiKeySummary {
  secret_key: string;
}

export interface RuntimeMetricsSummary {
  type: 'metrics_summary';
  generated_at: string;
  sessions: {
    total: number;
    by_status: Record<string, number>;
    input_tokens: number;
    output_tokens: number;
  };
  events: {
    total: number;
    by_type: Record<string, number>;
    input_tokens: number;
    output_tokens: number;
    average_duration_ms: number;
  };
  storage: {
    files: number;
    file_bytes: number;
    artifacts: number;
    artifact_bytes: number;
  };
  work_queue: Record<string, number>;
  http: {
    requests: number;
    errors: number;
    request_duration_ms: { count: number; sum: number };
  };
}

export type RuntimeSettingsState = 'configured' | 'missing_env' | 'not_set';
export type RuntimeSettingsValidationStatus = 'ok' | 'warning' | 'error';

export interface RuntimeSettingsValidationCheck {
  key: string;
  label: string;
  status: RuntimeSettingsValidationStatus;
  message: string;
}

export interface RuntimeSettingsSummary {
  type: 'settings';
  model_provider: {
    vendor: string;
    base_url?: string;
    api_key_env?: string;
    api_key_state: RuntimeSettingsState;
    configured: boolean;
  };
  loop_engine: {
    type: 'managed-agents' | 'harness' | 'codex' | 'claude';
    implemented: boolean;
    config: Record<string, unknown>;
  };
  storage: {
    metadata: {
      type: string;
      path?: string;
      connection_url?: string;
      state: RuntimeSettingsState;
      implemented: boolean;
    };
    artifacts: {
      type: string;
      path?: string;
      bucket?: string;
      region?: string;
      state: RuntimeSettingsState;
      implemented: boolean;
    };
  };
  memory: {
    backend: {
      type: string;
      connection_url?: string;
      api_key_state: RuntimeSettingsState;
      implemented: boolean;
    };
  };
  sandbox: {
    type: string;
    implemented: boolean;
    available: boolean;
    providers: string[];
    config: Record<string, unknown>;
  };
  validation: {
    status: RuntimeSettingsValidationStatus;
    checks: RuntimeSettingsValidationCheck[];
  };
}

export interface RuntimeSettingsPatch {
  model_provider?: {
    vendor?: string;
    base_url?: string;
    api_key_env?: string;
  };
  loop_engine?: {
    type?: string;
    config?: Record<string, unknown>;
  };
  storage?: {
    metadata?: {
      type?: string;
      path?: string;
      connection_url?: string;
    };
    artifacts?: {
      type?: string;
      path?: string;
      bucket?: string;
      region?: string;
    };
  };
  memory?: {
    backend?: {
      type?: string;
      connection_url?: string;
      api_key_env?: string;
    };
  };
  sandbox?: {
    type?: string;
    config?: Record<string, unknown>;
  };
}

export interface EnvironmentSummary {
  id: string;
  type: 'environment';
  name: string;
  description: string;
  hosting_type: 'cloud' | 'local' | 'self_hosted';
  sandbox_provider: string | null;
  network: Record<string, unknown>;
  packages: unknown[];
  status: 'active' | 'archived';
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  worker_keys: EnvironmentWorkerKeySummary[];
  work_queue: Record<string, number>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface EnvironmentWorkerKeySummary {
  id: string;
  type: 'environment_worker_key';
  environment_id: string;
  name: string;
  status: string;
  key_prefix: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface EnvironmentWorkerKeyCreateResponse extends EnvironmentWorkerKeySummary {
  secret_key: string;
}

export interface StreamedEvent {
  id?: string;
  type: string;
  content?: ContentBlock[] | null;
  delta?: string;
  message_id?: string;
}

export class ManagedAgentsClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  readonly agents: AgentsResource;
  readonly sessions: SessionsResource;
  readonly files: FilesResource;
  readonly apiKeys: ApiKeysResource;
  readonly metrics: MetricsResource;
  readonly settings: SettingsResource;
  readonly environments: EnvironmentsResource;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.agents = new AgentsResource(this);
    this.sessions = new SessionsResource(this);
    this.files = new FilesResource(this);
    this.apiKeys = new ApiKeysResource(this);
    this.metrics = new MetricsResource(this);
    this.settings = new SettingsResource(this);
    this.environments = new EnvironmentsResource(this);
  }

  /** @internal */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        detail = j.error?.message ?? '';
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new ManagedAgentsApiError(res.status, detail || res.statusText);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** @internal */
  async requestText(method: string, path: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers });
    if (!res.ok) {
      throw new ManagedAgentsApiError(res.status, await res.text().catch(() => res.statusText));
    }
    return res.text();
  }

  /** @internal - opens an SSE stream and yields parsed events. */
  async *stream(
    path: string,
    opts?: { lastEventId?: string; method?: string; body?: unknown },
  ): AsyncIterable<StreamedEvent> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    if (opts?.lastEventId) headers['Last-Event-ID'] = opts.lastEventId;
    if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: opts?.method ?? 'GET',
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok || !res.body) {
      throw new ManagedAgentsApiError(res.status, `stream failed: ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseSseFrame(frame);
        if (parsed && parsed.event !== 'heartbeat' && parsed.data) {
          try {
            yield JSON.parse(parsed.data) as StreamedEvent;
          } catch {
            // skip malformed frames
          }
        }
      }
    }
  }
}

// ============================================================
// Resources
// ============================================================

class AgentsResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  list(): Promise<{ data: AgentSummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', '/v1/agents');
  }

  get(id: string): Promise<AgentSummary> {
    return this.client.request('GET', `/v1/agents/${encodeURIComponent(id)}`);
  }

  create(input: {
    name: string;
    description?: string;
    model: string | Record<string, unknown>;
    system: string;
    tools?: Array<Record<string, unknown>>;
    mcp_servers?: Array<Record<string, unknown>>;
    skills?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }): Promise<AgentSummary> {
    return this.client.request('POST', '/v1/agents', input);
  }

  async update(id: string, input: Partial<{
    name: string;
    description: string;
    model: string | Record<string, unknown>;
    system: string;
    tools: Array<Record<string, unknown>>;
    mcp_servers: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
    expected_version: number;
  }>): Promise<AgentSummary> {
    const current = await this.get(id);
    const { expected_version, ...patch } = input;
    return this.client.request('PUT', `/v1/agents/${encodeURIComponent(id)}`, {
      name: current.name,
      description: current.description,
      model: current.model,
      system: current.system,
      tools: current.tools,
      mcp_servers: current.mcp_servers,
      skills: current.skills,
      ...patch,
      ...(expected_version !== undefined ? { expected_version } : {}),
    });
  }

  versions(id: string): Promise<{ data: AgentSummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', `/v1/agents/${encodeURIComponent(id)}/versions`);
  }

  archive(id: string): Promise<AgentSummary> {
    return this.client.request('POST', `/v1/agents/${encodeURIComponent(id)}/archive`, {});
  }
}

class SessionsResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  create(input: {
    agent: string | { id: string; type?: 'agent'; version?: number };
    environment_id?: string;
    title?: string;
    resources?: Array<Record<string, unknown>>;
    vault_ids?: string[];
    metadata?: Record<string, string>;
  }): Promise<SessionSummary> {
    return this.client.request('POST', '/v1/sessions', input);
  }

  get(id: string): Promise<SessionSummary> {
    return this.client.request('GET', `/v1/sessions/${encodeURIComponent(id)}`);
  }

  list(opts?: { page?: number; limit?: number; status?: string }): Promise<{ data: SessionSummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    const q = new URLSearchParams();
    if (opts?.page) q.set('page', String(opts.page));
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.status) q.set('status', opts.status);
    const qs = q.toString();
    return this.client.request('GET', `/v1/sessions${qs ? `?${qs}` : ''}`);
  }

  /** Send a user text message (fire-and-forget; stream separately to see the reply). */
  sendMessage(id: string, text: string): Promise<{ accepted: boolean }> {
    return this.sendEvent(id, { type: 'user.message', content: [{ type: 'text', text }] });
  }

  /**
   * Send a user message through the session message convenience endpoint.
   *
   * Defaults to streaming the turn. Pass `{ stream: false }` for an immediate
   * `{ accepted: true }` acknowledgment.
   */
  message(
    id: string,
    content: string | ContentBlock[],
    opts: { stream: false },
  ): Promise<{ accepted: boolean }>;
  message(
    id: string,
    content: string | ContentBlock[],
    opts?: { stream?: true },
  ): AsyncIterable<StreamedEvent>;
  message(
    id: string,
    content: string | ContentBlock[],
    opts?: { stream?: boolean },
  ): Promise<{ accepted: boolean }> | AsyncIterable<StreamedEvent> {
    const path = `/v1/sessions/${encodeURIComponent(id)}/messages`;
    if (opts?.stream === false) {
      return this.client.request('POST', path, { content, stream: false });
    }
    return this.client.stream(path, { method: 'POST', body: { content, stream: true } });
  }

  sendEvent(id: string, event: {
    type: string;
    content?: ContentBlock[];
    tool_use_id?: string;
    custom_tool_use_id?: string;
    result?: 'allow' | 'deny';
    deny_message?: string;
  }): Promise<{ accepted: boolean }> {
    return this.client.request('POST', `/v1/sessions/${encodeURIComponent(id)}/events`, { events: [event] });
  }

  events(id: string, opts?: { limit?: number; afterId?: string }): Promise<{ data: StreamedEvent[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.afterId) q.set('after_id', opts.afterId);
    const qs = q.toString();
    return this.client.request('GET', `/v1/sessions/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`);
  }

  artifacts(id: string): Promise<{ data: SessionArtifactSummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', `/v1/sessions/${encodeURIComponent(id)}/artifacts`);
  }

  createArtifact(id: string, input: {
    path: string;
    content: string;
    media_type?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionArtifactSummary> {
    return this.client.request('POST', `/v1/sessions/${encodeURIComponent(id)}/artifacts`, input);
  }

  artifactText(id: string, artifactId: string): Promise<string> {
    return this.client.requestText('GET', `/v1/sessions/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/content`);
  }

  stop(id: string): Promise<{ id: string; status: 'terminated' }> {
    return this.client.request('POST', `/v1/sessions/${encodeURIComponent(id)}/stop`);
  }

  delete(id: string): Promise<{ deleted: boolean }> {
    return this.client.request('DELETE', `/v1/sessions/${encodeURIComponent(id)}`);
  }

  interrupt(id: string): Promise<{ accepted: boolean }> {
    return this.sendEvent(id, { type: 'user.interrupt' });
  }

  approveTool(id: string, toolUseId: string): Promise<{ accepted: boolean }> {
    return this.sendEvent(id, { type: 'user.tool_confirmation', tool_use_id: toolUseId, result: 'allow' });
  }

  denyTool(id: string, toolUseId: string, message?: string): Promise<{ accepted: boolean }> {
    return this.sendEvent(id, {
      type: 'user.tool_confirmation',
      tool_use_id: toolUseId,
      result: 'deny',
      ...(message ? { deny_message: message } : {}),
    });
  }

  customToolResult(
    id: string,
    customToolUseId: string,
    content: string | ContentBlock[],
  ): Promise<{ accepted: boolean }> {
    const blocks = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;
    return this.sendEvent(id, {
      type: 'user.custom_tool_result',
      custom_tool_use_id: customToolUseId,
      content: blocks,
    });
  }

  /** Tail the full live event stream (never closes until aborted). */
  tail(id: string, opts?: { lastEventId?: string }): AsyncIterable<StreamedEvent> {
    return this.client.stream(`/v1/sessions/${encodeURIComponent(id)}/events/stream`, opts);
  }

  /**
   * Send a message and stream the reply. Yields events until the session goes
   * idle. Opens the stream BEFORE sending to avoid missing early events.
   */
  async *chat(id: string, text: string): AsyncIterable<StreamedEvent> {
    const stream = this.message(id, text);
    for await (const event of stream) {
      yield event;
      if (event.type === 'session.status_idle' || event.type === 'session.status_terminated') {
        return;
      }
    }
  }
}

class FilesResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  list(): Promise<{ data: WorkspaceFileSummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', '/v1/files');
  }

  get(id: string): Promise<WorkspaceFileSummary> {
    return this.client.request('GET', `/v1/files/${encodeURIComponent(id)}`);
  }

  create(input: { name: string; content: string; media_type?: string; metadata?: Record<string, unknown> }): Promise<WorkspaceFileSummary> {
    return this.client.request('POST', '/v1/files', input);
  }

  text(id: string): Promise<string> {
    return this.client.requestText('GET', `/v1/files/${encodeURIComponent(id)}/content`);
  }

  delete(id: string): Promise<WorkspaceFileSummary> {
    return this.client.request('DELETE', `/v1/files/${encodeURIComponent(id)}`);
  }
}

class ApiKeysResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  list(): Promise<{ data: ApiKeySummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', '/v1/api-keys');
  }

  create(input: { name: string; metadata?: Record<string, unknown> }): Promise<ApiKeyCreateResponse> {
    return this.client.request('POST', '/v1/api-keys', input);
  }

  delete(id: string): Promise<{ id: string; type: 'api_key_deleted' }> {
    return this.client.request('DELETE', `/v1/api-keys/${encodeURIComponent(id)}`);
  }
}

class MetricsResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  prometheus(): Promise<string> {
    return this.client.requestText('GET', '/v1/x/metrics');
  }

  summary(): Promise<RuntimeMetricsSummary> {
    return this.client.request('GET', '/v1/x/metrics/summary');
  }
}

class SettingsResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  get(): Promise<RuntimeSettingsSummary> {
    return this.client.request('GET', '/v1/x/settings');
  }

  patch(input: RuntimeSettingsPatch): Promise<RuntimeSettingsSummary> {
    return this.client.request('PATCH', '/v1/x/settings', input);
  }

  validate(input?: RuntimeSettingsPatch): Promise<RuntimeSettingsSummary['validation']> {
    return this.client.request('POST', '/v1/x/settings/validate', input ?? {});
  }
}

class EnvironmentsResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  list(): Promise<{ data: EnvironmentSummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', '/v1/environments');
  }

  get(id: string): Promise<EnvironmentSummary> {
    return this.client.request('GET', `/v1/environments/${encodeURIComponent(id)}`);
  }

  create(input: {
    name: string;
    description?: string;
    hosting_type?: 'cloud' | 'local' | 'self_hosted';
    sandbox_provider?: string;
    network?: Record<string, unknown>;
    packages?: unknown[];
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<EnvironmentSummary> {
    return this.client.request('POST', '/v1/environments', input);
  }

  update(id: string, input: Partial<{
    name: string;
    description: string;
    hosting_type: 'cloud' | 'local' | 'self_hosted';
    sandbox_provider: string;
    network: Record<string, unknown>;
    packages: unknown[];
    config: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>): Promise<EnvironmentSummary> {
    return this.client.request('PUT', `/v1/environments/${encodeURIComponent(id)}`, input);
  }

  archive(id: string): Promise<EnvironmentSummary> {
    return this.client.request('POST', `/v1/environments/${encodeURIComponent(id)}/archive`, {});
  }

  workerKeys(id: string): Promise<{ data: EnvironmentWorkerKeySummary[]; has_more: boolean; first_id: string | null; last_id: string | null }> {
    return this.client.request('GET', `/v1/environments/${encodeURIComponent(id)}/worker-keys`);
  }

  createWorkerKey(id: string, input: { name?: string; expires_at?: string; metadata?: Record<string, unknown> } = {}): Promise<EnvironmentWorkerKeyCreateResponse> {
    return this.client.request('POST', `/v1/environments/${encodeURIComponent(id)}/worker-keys`, input);
  }

  revokeWorkerKey(id: string, keyId: string): Promise<EnvironmentWorkerKeySummary> {
    return this.client.request('POST', `/v1/environments/${encodeURIComponent(id)}/worker-keys/${encodeURIComponent(keyId)}/revoke`, {});
  }
}

// ============================================================
// Errors + SSE parsing
// ============================================================

export class ManagedAgentsApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`API error ${status}: ${message}`);
    this.name = 'ManagedAgentsApiError';
  }
}

function parseSseFrame(frame: string): { event?: string; data?: string; id?: string } | null {
  const result: { event?: string; data?: string; id?: string } = {};
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) result.event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    else if (line.startsWith('id:')) result.id = line.slice(3).trim();
  }
  if (dataLines.length) result.data = dataLines.join('\n');
  return Object.keys(result).length ? result : null;
}
