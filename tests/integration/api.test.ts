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
      db,
      sessionManager,
      agents: [
        {
          name: 'echo-agent',
          model: { id: 'gpt-4o', speed: 'standard' },
          system: 'Echo back what the user says.',
        },
      ],
      consoleRoot: null,
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
    it('requires the built Console artifact', async () => {
      const res = await app.request('/ui');
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Console not built');
    });
  });

  describe('POST /v1/sessions', () => {
    it('creates a session', async () => {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toMatch(/^sess_/);
      expect(body.status).toBe('idle');
      expect(body.agent.id).toBe('agent_echo-agent');
      expect(body.agent.name).toBe('echo-agent');
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
          agent: 'agent_echo-agent',
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
          body: JSON.stringify({ agent: 'agent_echo-agent' }),
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
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
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
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/v1/sessions/${id}/stop`, { method: 'POST' });
      expect(res.status).toBe(200);

      const getRes = await app.request(`/v1/sessions/${id}`);
      const session = await getRes.json();
      expect(session.status).toBe('terminated');
    });
  });

  describe('POST /v1/sessions/:id/events — validation', () => {
    async function createSession() {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
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
        body: JSON.stringify({ events: [{ type: 'agent.message', content: [] }] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for events on non-existent session', async () => {
      const res = await app.request('/v1/sessions/sess_nope/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [{ type: 'user.message', content: [{ type: 'text', text: 'hi' }] }] }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /v1/sessions/:id/messages', () => {
    async function createSession() {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
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

    it('returns events with id cursors for a valid session', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
      });
      const { id } = await createRes.json();

      const res = await app.request(`/v1/sessions/${id}/events`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.has_more).toBe(false);
      expect(body.first_id).toBeDefined();
      expect(body.last_id).toBeDefined();
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
    it('does not resolve agents by bare name', async () => {
      const res = await app.request('/v1/agents/echo-agent');
      expect(res.status).toBe(404);
    });

    it('returns agent detail by prefixed id', async () => {
      const res = await app.request('/v1/agents/agent_echo-agent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('echo-agent');
      expect(body.model.id).toBe('gpt-4o');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await app.request('/v1/agents/nonexist');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /v1/environments/:id', () => {
    it('updates Claude-style environment fields', async () => {
      const res = await app.request('/v1/environments/env_default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cloud runner',
          description: 'Container template for console sessions.',
          config: {
            hosting_type: 'cloud',
            sandbox_provider: 'cloud',
            network: {
              type: 'limited',
              allow_mcp_server_network_access: false,
              allow_package_manager_network_access: true,
              allowed_hosts: ['api.github.com'],
            },
            packages: [{ manager: 'pip', package: 'ruff==0.5.0' }],
          },
          metadata: { owner: 'platform' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Cloud runner');
      expect(body.description).toBe('Container template for console sessions.');
      expect(body.config.hosting_type).toBe('cloud');
      expect(body.config.network.allowed_hosts).toEqual(['api.github.com']);
      expect(body.config.packages[0].package).toBe('ruff==0.5.0');
      expect(body.metadata.owner).toBe('platform');
    });

    it('returns 404 for non-existent environments', async () => {
      const res = await app.request('/v1/environments/env_nope', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Missing' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Credential vaults', () => {
    it('creates a vault and stores credential metadata without returning the secret value', async () => {
      const vaultRes = await app.request('/v1/credential-vaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Production vault' }),
      });
      expect(vaultRes.status).toBe(201);
      const vault = await vaultRes.json();
      expect(vault.id).toMatch(/^vlt_/);
      expect(vault.credential_count).toBe(0);
      expect(vault.credentials).toEqual([]);

      const credentialRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'API token',
          auth_type: 'environment_variable',
          variable_name: 'MY_API_KEY',
          value: 'sk-test-secret-value',
          network: { type: 'limited', allowed_hosts: ['api.example.com'] },
          injection_locations: ['request_headers'],
        }),
      });
      expect(credentialRes.status).toBe(201);
      const credential = await credentialRes.json();
      expect(credential.id).toMatch(/^vcrd_/);
      expect(credential.variable_name).toBe('MY_API_KEY');
      expect(credential.value).toBeUndefined();
      expect(credential.value_hint).toBe('••••alue');
      expect(credential.network.allowed_hosts).toEqual(['api.example.com']);
      expect(credential.injection_locations).toEqual(['request_headers']);
      expect(JSON.stringify(credential)).not.toContain('sk-test-secret-value');

      const storedCredential = db.prepare(
        'SELECT secret_ciphertext, secret_nonce, secret_tag FROM credential_records WHERE id = ?',
      ).get(credential.id) as { secret_ciphertext: string; secret_nonce: string; secret_tag: string };
      expect(storedCredential.secret_ciphertext).toBeTruthy();
      expect(storedCredential.secret_nonce).toBeTruthy();
      expect(storedCredential.secret_tag).toBeTruthy();
      expect(storedCredential.secret_ciphertext).not.toContain('sk-test-secret-value');

      const listRes = await app.request('/v1/credential-vaults');
      const list = await listRes.json();
      const listedVault = list.data.find((item: any) => item.id === vault.id);
      expect(listedVault.credential_count).toBe(1);
      expect(listedVault.credentials[0].value).toBeUndefined();
      expect(listedVault.credentials[0].value_hint).toBe('••••alue');
    });

    it('rejects non-standard credential injection locations', async () => {
      const vaultRes = await app.request('/v1/credential-vaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Strict vault' }),
      });
      const vault = await vaultRes.json();

      const credentialRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_type: 'bearer_token',
          value: 'sk-test-secret-value',
          injection_locations: ['headers'],
        }),
      });
      expect(credentialRes.status).toBe(400);
      expect((await credentialRes.json()).error.message).toContain('request_headers');
    });

    it('archives and deletes credentials within a vault', async () => {
      const vaultRes = await app.request('/v1/credential-vaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Lifecycle vault' }),
      });
      const vault = await vaultRes.json();
      const credentialRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_type: 'mcp_oauth',
          mcp_server_url: 'https://mcp.example.com',
        }),
      });
      const credential = await credentialRes.json();

      const archiveRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials/${credential.id}/archive`, { method: 'POST' });
      expect(archiveRes.status).toBe(200);
      expect((await archiveRes.json()).status).toBe('archived');

      const deleteRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials/${credential.id}`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).status).toBe('deleted');
    });
  });

  describe('Memory stores', () => {
    it('creates a memory store and manages memories by path', async () => {
      const storeRes = await app.request('/v1/memory-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Research notes',
          description: 'Persistent notes for agents.',
        }),
      });
      expect(storeRes.status).toBe(201);
      const store = await storeRes.json();
      expect(store.id).toMatch(/^memstore_/);
      expect(store.memory_count).toBe(0);
      expect(store.memories).toEqual([]);

      const memoryRes = await app.request(`/v1/memory-stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/note/d',
          content: 'ddd',
        }),
      });
      expect(memoryRes.status).toBe(201);
      const memory = await memoryRes.json();
      expect(memory.id).toMatch(/^mem_/);
      expect(memory.path).toBe('/note/d');
      expect(memory.content).toBe('ddd');

      const updateRes = await app.request(`/v1/memory-stores/${store.id}/memories/${memory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'updated' }),
      });
      expect(updateRes.status).toBe(200);
      expect((await updateRes.json()).content).toBe('updated');

      const listRes = await app.request('/v1/memory-stores');
      const list = await listRes.json();
      const listedStore = list.data.find((item: any) => item.id === store.id);
      expect(listedStore.memory_count).toBe(1);
      expect(listedStore.memories[0].path).toBe('/note/d');

      const deleteRes = await app.request(`/v1/memory-stores/${store.id}/memories/${memory.id}`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).deleted).toBe(true);

      const recreateRes = await app.request(`/v1/memory-stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/note/d',
          content: 'recreated',
        }),
      });
      expect(recreateRes.status).toBe(201);
      expect((await recreateRes.json()).content).toBe('recreated');
    });

    it('rejects memory paths that are not file-like absolute paths', async () => {
      const storeRes = await app.request('/v1/memory-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Absolute paths only' }),
      });
      const store = await storeRes.json();
      const res = await app.request(`/v1/memory-stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'note/d', content: 'ddd' }),
      });
      expect(res.status).toBe(400);

      const rootRes = await app.request(`/v1/memory-stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/', content: 'ddd' }),
      });
      expect(rootRes.status).toBe(400);

      const directoryRes = await app.request(`/v1/memory-stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/note/', content: 'ddd' }),
      });
      expect(directoryRes.status).toBe(400);
    });
  });

  describe('DELETE /v1/sessions/:id', () => {
    it('deletes a session and retains the event log (R9.8)', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
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

  describe('agent identity consistency', () => {
    it('session.agent.id resolves via GET /v1/agents/:id', async () => {
      const createRes = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'agent_echo-agent' }),
      });
      const session = await createRes.json();

      const agentRes = await app.request(`/v1/agents/${session.agent.id}`);
      expect(agentRes.status).toBe(200);
      const agent = await agentRes.json();
      expect(agent.id).toBe(session.agent.id);
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
