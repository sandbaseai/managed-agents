/**
 * Integration test for the CMA-compatible API.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.6
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';
import type { Session, SessionEvent } from '@/types/session.js';
import type { UserEvent } from '@/types/cma-protocol.js';

describe('CMA-compatible API', () => {
  let app: ReturnType<typeof createServer>;
  let db: Database;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-api-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    // Match production id scheme (index.ts inserts agents with id = agent_<name>)
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_echo-agent', 'echo-agent', '{}')`);

    const sessionManager = new SessionManager(db);
    sessionManager.setExecutor({
      async *execute(session: Session, event: UserEvent): AsyncIterable<SessionEvent> {
        const text = event.content?.find((block: any) => block.type === 'text')?.text ?? '';
        yield {
          id: 'sevt_fake_agent_message',
          sessionId: session.id,
          seq: 0,
          type: 'agent.message',
          content: [{ type: 'text', text: `echo: ${text}` }],
          createdAt: new Date(),
        };
      },
    });

    app = createServer({
      sessionManager,
      agents: [
        {
          name: 'echo-agent',
          model: 'gpt-4o',
          system_prompt: 'Echo back what the user says.',
        },
      ],
      reloadAgents: () => ({ agents: [], errors: [] }),
    });
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /', () => {
    it('returns server info', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('managed-agents');
    });
  });

  describe('GET /ui', () => {
    it('serves the HTML dashboard', async () => {
      const res = await app.request('/ui');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('managed-agents');
      expect(html).toContain('<script>');
    });
  });

  describe('POST /v1/sessions', () => {
    it('creates a session', async () => {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toMatch(/^sess_/);
      expect(body.status).toBe('queued');
      expect(body.agent_name).toBe('echo-agent');
    });

    it('rejects without agent field', async () => {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('ignores unknown fields (Property 15 — forward compat)', async () => {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'echo-agent',
          unknown_field: 'should be ignored',
          nested: { also: 'ignored' },
        }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /v1/sessions', () => {
    it('lists sessions with pagination', async () => {
      // Create a few sessions
      for (let i = 0; i < 3; i++) {
        await app.request('/v1/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: 'echo-agent' }),
        });
      }

      const res = await app.request('/v1/sessions?limit=2');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.has_more).toBeDefined();
    });
  });

  describe('GET /v1/sessions/:id', () => {
    it('returns session detail', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/v1/sessions/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(id);
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/v1/sessions/sess_nonexist');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /v1/sessions/:id/stop', () => {
    it('stops a session', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/v1/sessions/${id}/stop`, { method: 'POST' });
      expect(res.status).toBe(200);

      const getRes = await app.request(`/v1/sessions/${id}`);
      const session = await getRes.json();
      expect(session.status).toBe('completed');
    });
  });

  describe('POST /v1/sessions/:id/events — validation', () => {
    async function createSession() {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      return (await res.json()).id as string;
    }

    it('rejects empty body (no type) with 400', async () => {
      const id = await createSession();
      const res = await app.request(`/v1/sessions/${id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.type).toBe('invalid_request');
    });

    it('rejects non-user event types with 400', async () => {
      const id = await createSession();
      const res = await app.request(`/v1/sessions/${id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent.message', content: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for events on non-existent session', async () => {
      const res = await app.request('/v1/sessions/sess_nope/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user.message', content: [{ type: 'text', text: 'hi' }] }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /v1/sessions/:id/messages', () => {
    async function createSession() {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      return (await res.json()).id as string;
    }

    it('accepts a string message without streaming', async () => {
      const id = await createSession();
      const res = await app.request(`/v1/sessions/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hi', stream: false }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: true });
    });

    it('rejects invalid message content with 400', async () => {
      const id = await createSession();
      const res = await app.request(`/v1/sessions/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(null),
      });

      expect(res.status).toBe(400);
    });

    it('streams a message turn by default', async () => {
      const id = await createSession();
      const res = await app.request(`/v1/sessions/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('event: user.message');
      expect(text).toContain('event: agent.message');
      expect(text).toContain('echo: hello');
      expect(text).toContain('event: session.status_idle');
    });

    it('returns 404 for messages on non-existent sessions', async () => {
      const res = await app.request('/v1/sessions/sess_nope/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hi' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 for messages on terminal sessions', async () => {
      const id = await createSession();
      await app.request(`/v1/sessions/${id}/stop`, { method: 'POST' });

      const res = await app.request(`/v1/sessions/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hi' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /v1/sessions/:id/events', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/v1/sessions/sess_nope/events');
      expect(res.status).toBe(404);
    });

    it('returns events with seq for a valid session', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/v1/sessions/${id}/events`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.has_more).toBe(false);
    });
  });

  describe('GET /v1/agents', () => {
    it('lists loaded agents', async () => {
      const res = await app.request('/v1/agents');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('echo-agent');
    });
  });

  describe('GET /v1/agents/:id', () => {
    it('returns agent detail by bare name', async () => {
      const res = await app.request('/v1/agents/echo-agent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model).toBe('gpt-4o');
    });

    it('returns agent detail by prefixed id', async () => {
      const res = await app.request('/v1/agents/agent_echo-agent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('echo-agent');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await app.request('/v1/agents/nonexist');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /v1/sessions/:id', () => {
    it('deletes a session and retains the event log (R9.8)', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      const { id } = await createRes.json();

      const delRes = await app.request(`/v1/sessions/${id}`, { method: 'DELETE' });
      expect(delRes.status).toBe(200);
      const delBody = await delRes.json();
      expect(delBody.deleted).toBe(true);

      // Event log still queryable, and includes a session.deleted event
      const eventsRes = await app.request(`/v1/sessions/${id}/events`);
      expect(eventsRes.status).toBe(200);
      const events = await eventsRes.json();
      const types = events.data.map((e: any) => e.type);
      expect(types).toContain('session.deleted');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/v1/sessions/sess_nope', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('agent_id consistency', () => {
    it('session.agent_id resolves via GET /v1/agents/:id', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'echo-agent' }),
      });
      const session = await createRes.json();

      // The agent_id returned in the session must be resolvable
      const agentRes = await app.request(`/v1/agents/${session.agent_id}`);
      expect(agentRes.status).toBe(200);
      const agent = await agentRes.json();
      expect(agent.id).toBe(session.agent_id);
    });
  });

  describe('GET /v1/x/health', () => {
    it('returns health status', async () => {
      const res = await app.request('/v1/x/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
    });
  });

  describe('GET /v1/x/metrics', () => {
    it('returns 200 (metrics disabled without a registry)', async () => {
      const res = await app.request('/v1/x/metrics');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('metrics');
    });
  });

  describe('POST /v1/x/reload', () => {
    it('reloads agents', async () => {
      const res = await app.request('/v1/x/reload', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reloaded).toBe(true);
    });
  });
});
