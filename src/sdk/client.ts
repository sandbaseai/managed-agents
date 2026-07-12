/**
 * managed-agents Client SDK
 *
 * A small typed wrapper over the CMA-compatible HTTP API. Works in Node 22+
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
  agent_id: string;
  agent_name: string;
  status: string;
  title?: string | null;
  context_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StreamedEvent {
  id?: string;
  seq?: number;
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

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.agents = new AgentsResource(this);
    this.sessions = new SessionsResource(this);
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

  /** @internal — opens an SSE stream and yields parsed events. */
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

  list(): Promise<{ data: Array<{ id: string; name: string; model: string; status: string }> }> {
    return this.client.request('GET', '/v1/agents');
  }

  get(id: string): Promise<Record<string, unknown>> {
    return this.client.request('GET', `/v1/agents/${encodeURIComponent(id)}`);
  }
}

class SessionsResource {
  constructor(private readonly client: ManagedAgentsClient) {}

  create(input: { agent: string; environment_id?: string; context_id?: string; title?: string }): Promise<SessionSummary> {
    return this.client.request('POST', '/v1/sessions', input);
  }

  get(id: string): Promise<SessionSummary> {
    return this.client.request('GET', `/v1/sessions/${encodeURIComponent(id)}`);
  }

  list(opts?: { page?: number; limit?: number; status?: string }): Promise<{ data: SessionSummary[]; has_more: boolean; total: number }> {
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
   * Send a user message through the CMA-style convenience endpoint.
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

  sendEvent(id: string, event: { type: string; content?: ContentBlock[] }): Promise<{ accepted: boolean }> {
    return this.client.request('POST', `/v1/sessions/${encodeURIComponent(id)}/events`, event);
  }

  events(id: string, opts?: { limit?: number; afterSeq?: number }): Promise<{ data: StreamedEvent[]; has_more: boolean }> {
    const q = new URLSearchParams();
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.afterSeq) q.set('after_seq', String(opts.afterSeq));
    const qs = q.toString();
    return this.client.request('GET', `/v1/sessions/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ''}`);
  }

  stop(id: string): Promise<{ status: string }> {
    return this.client.request('POST', `/v1/sessions/${encodeURIComponent(id)}/stop`);
  }

  delete(id: string): Promise<{ deleted: boolean }> {
    return this.client.request('DELETE', `/v1/sessions/${encodeURIComponent(id)}`);
  }

  interrupt(id: string): Promise<{ accepted: boolean }> {
    return this.sendEvent(id, { type: 'user.interrupt' });
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
