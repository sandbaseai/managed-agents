/**
 * Integration test for the Managed Agents API.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.6
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';
import { loadSkills } from '@/core/skills/loader.js';
import { createLogger, InMemoryLogStore } from '@/core/observability/logger.js';
import { resolveSessionCredentialInjections } from '@/core/credentials/injection.js';
import type { Session, SessionEvent } from '@/types/session.js';
import type { UserEvent } from '@/types/cma-protocol.js';
import type { RuntimeModelInfo } from '@/types/model.js';

describe('Managed Agents API', () => {
  let app: ReturnType<typeof createServer>;
  let db: Database;
  let tmpDir: string;
  let dataDir: string;
  let agentsDir: string;
  let skillsDir: string;
  let logStore: InMemoryLogStore;
  let restartRequested = false;
  let runtimeModelsData: RuntimeModelInfo[] = [];

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-api-test-'));
    agentsDir = join(tmpDir, 'agents');
    skillsDir = join(tmpDir, 'skills');
    dataDir = join(tmpDir, '.managed-agents');
    const configPath = join(tmpDir, 'managed-agents.config.yaml');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(agentsDir, 'echo-agent.yaml'), 'name: echo-agent\nmodel: claude-sonnet-4-6\n');
    mkdirSync(join(skillsDir, 'research'), { recursive: true });
    writeFileSync(join(skillsDir, 'research', 'SKILL.md'), '---\nname: research\ndescription: Use cited sources.\n---\n# Research\n\nUse cited sources.\n');
    writeFileSync(configPath, 'models:\n  - name: local\n    api_key: secret-value\n');
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    db.exec(`INSERT INTO credential_vaults (id, name) VALUES ('vlt_test', 'test vault')`);
    db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      'agent_echo-agent',
      'echo-agent',
      JSON.stringify({
        name: 'echo-agent',
        model: 'gpt-4o',
        system: 'Echo back what the user says.',
      }),
    );

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

    logStore = new InMemoryLogStore();
    const logger = createLogger({ level: 'debug', logStore, write: () => undefined });
    logger.info('test_runtime_ready', { component: 'integration' });

    runtimeModelsData = [{
      name: 'local',
      provider: 'openai',
      model: 'gpt-4o',
      api_key_state: 'configured',
      base_url_state: 'not_set',
      is_default: true,
    }];

    app = createServer({
      db,
      sessionManager,
      agents: [
        {
          name: 'echo-agent',
          model: 'gpt-4o',
          system: 'Echo back what the user says.',
        },
      ],
      consoleRoot: null,
      workspace: {
        root: tmpDir,
        dataDir,
        agentsDir,
        skillsDir,
        configPath,
        target: 'local',
      },
      runtime: {
        models: runtimeModelsData,
        sandboxProviders: ['local'],
        memory: 'disabled',
        authEnabled: false,
      },
      skills: loadSkills(skillsDir).skills,
      logger,
      logStore,
      restart: () => {
        restartRequested = true;
        logger.warn('test_restart_called', { component: 'integration' });
      },
      listRuntimeModels: () => runtimeModelsData,
      registerModelProvider: (provider) => {
        const next: RuntimeModelInfo = {
          name: provider.name,
          provider: provider.provider,
          model: provider.model,
          base_url: provider.base_url,
          api_key_state: provider.api_key ? 'configured' : 'not_set',
          base_url_state: provider.base_url ? 'configured' : 'not_set',
          is_default: Boolean(provider.is_default),
        };
        runtimeModelsData = runtimeModelsData.filter((model) => model.name !== next.name);
        if (next.is_default) {
          runtimeModelsData = runtimeModelsData.map((model) => ({ ...model, is_default: false }));
        }
        runtimeModelsData.unshift(next);
      },
      setDefaultRuntimeModel: (name) => {
        runtimeModelsData = runtimeModelsData.map((model) => ({ ...model, is_default: model.name === name }));
      },
      evaluateOutcome: async (input) => ({
        status: 'passed',
        score: 0.88,
        summary: `Mock model evaluator reviewed ${input.criteria.length} criteria.`,
        details: {
          evaluator: input.evaluator,
          pass_threshold: input.passThreshold,
          model: 'mock-evaluator',
          checks: input.criteria.map((criterion) => ({ criterion, matched: true })),
        },
      }),
      reloadAgents: () => ({ agents: [], errors: [] }),
    });
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getJson(path: string) {
    const res = await app.request(path);
    return { res, body: await res.json() as any };
  }

  async function postJson(path: string, body: unknown) {
    const res = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, body: await res.json() as any };
  }

  function expectPage(body: any) {
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.has_more).toBe('boolean');
    expect(body.first_id === null || typeof body.first_id === 'string').toBe(true);
    expect(body.last_id === null || typeof body.last_id === 'string').toBe(true);
  }

  function expectError(body: any) {
    expect(body).toHaveProperty('error');
    expect(typeof body.error.type).toBe('string');
    expect(typeof body.error.message).toBe('string');
  }

  describe('GET /', () => {
    it('returns server info', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('managed-agents');
    });
  });

  describe('GET /dashboard', () => {
    it('requires the built Console artifact', async () => {
      const res = await app.request('/dashboard');
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Dashboard not built');
    });

    it('redirects the legacy /ui path to /dashboard', async () => {
      const res = await app.request('/ui');
      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('/dashboard');
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

    it('accepts standard agent refs, resources, vault ids, and redacts repository tokens', async () => {
      const { body: store } = await postJson('/v1/memory_stores', {
        name: 'Session resource memory',
        description: 'Mounted session memory.',
      });
      const { body: file } = await postJson('/v1/files', {
        name: 'resource.txt',
        media_type: 'text/plain',
        content: 'session resource',
      });
      const { res, body } = await postJson('/v1/sessions', {
        title: 'resource run',
        agent: { id: 'agent_echo-agent', type: 'agent', version: 1 },
        environment_id: 'env_default',
        vault_ids: ['vlt_test'],
        resources: [
          { type: 'file', file_id: file.id, mount_path: '/uploads/file.txt' },
          {
            type: 'github_repository',
            url: 'https://github.com/example/repo',
            authorization_token: 'ghp_super_secret_token',
            checkout: { type: 'branch', name: 'main' },
            mount_path: '/workspace/repo',
          },
          { type: 'memory_store', memory_store_id: store.id, mount_path: '/memory' },
        ],
        metadata: { source: 'contract-test' },
      });

      expect(res.status).toBe(201);
      expect(body.agent.id).toBe('agent_echo-agent');
      expect(body.environment_id).toBe('env_default');
      expect(body.title).toBe('resource run');
      expect(body.vault_ids).toEqual(['vlt_test']);
      expect(body.metadata.source).toBe('contract-test');
      expect(body.resources).toHaveLength(3);
      expect(JSON.stringify(body.resources)).not.toContain('ghp_super_secret_token');
      expect(body.resources.find((resource: any) => resource.type === 'github_repository').authorization_token).toBeUndefined();
      expect(body.resources.find((resource: any) => resource.type === 'memory_store').memory_store_id).toBe(store.id);

      const detail = await app.request(`/v1/sessions/${body.id}`);
      expect(JSON.stringify(await detail.json())).not.toContain('ghp_super_secret_token');
      const stored = db.prepare('SELECT resources FROM sessions WHERE id = ?').get(body.id) as { resources: string };
      expect(stored.resources).not.toContain('ghp_super_secret_token');
      expect(stored.resources).toContain('encrypted_secret');
    });

    it('rejects session resources that do not reference existing workspace resources', async () => {
      const { res, body } = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        resources: [{ type: 'file', file_id: 'file_missing', mount_path: '/uploads/missing.txt' }],
      });

      expect(res.status).toBe(400);
      expect(body.error.message).toContain('File not found');
    });

    it('rejects malformed session environment, vault, and resource references', async () => {
      const missingEnvironment = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        environment_id: 'env_missing',
      });
      expect(missingEnvironment.res.status).toBe(400);
      expect(missingEnvironment.body.error.message).toContain('Environment not found');

      const malformedVault = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        vault_ids: ['vlt_test', 42],
      });
      expect(malformedVault.res.status).toBe(400);
      expect(malformedVault.body.error.message).toContain('vault_ids[1]');

      const missingVault = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        vault_ids: ['vlt_missing'],
      });
      expect(missingVault.res.status).toBe(400);
      expect(missingVault.body.error.message).toContain('Credential vault not found');

      const malformedCheckout = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        resources: [
          {
            type: 'github_repository',
            url: 'https://github.com/example/repo',
            authorization_token: 'ghp_super_secret_token',
            checkout: ['main'],
          },
        ],
      });
      expect(malformedCheckout.res.status).toBe(400);
      expect(malformedCheckout.body.error.message).toContain('checkout');

      const missingMemoryStore = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        resources: [{ type: 'memory_store', memory_store_id: 'memstore_missing' }],
      });
      expect(missingMemoryStore.res.status).toBe(400);
      expect(missingMemoryStore.body.error.message).toContain('Memory store not found');
    });

    it('rejects without agent field', async () => {
      const res = await app.request('/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('ignores unknown fields (Property 15 - forward compatibility)', async () => {
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

  describe('POST /v1/sessions/:id/events - validation', () => {
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

  describe('POST /v1/agents', () => {
    it('stores created agents in SQLite without writing source YAML files', async () => {
      const { res, body } = await postJson('/v1/agents', {
        name: 'runtime-agent',
        description: 'Created through the API.',
        model: 'claude-sonnet-5',
        system: 'Handle runtime requests.',
        tools: [{ type: 'agent_toolset_20260401' }],
      });

      expect(res.status).toBe(201);
      expect(body.id).toMatch(/^agent_/);
      expect(body.id).not.toBe('agent_runtime-agent');
      expect(body.name).toBe('runtime-agent');
      expect(existsSync(join(agentsDir, 'runtime-agent.yaml'))).toBe(false);
      expect(existsSync(join(agentsDir, 'Runtime agent.yaml'))).toBe(false);

      const row = db.prepare('SELECT definition FROM agents WHERE id = ?').get(body.id) as
        | { definition: string }
        | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row!.definition).name).toBe('runtime-agent');

      const list = await getJson('/v1/agents');
      expect(list.body.data.some((item: any) => item.id === body.id)).toBe(true);
    });

    it('allows duplicate display names because ids are server generated', async () => {
      const definition = {
        name: 'duplicate-name-agent',
        model: 'gpt-4o',
        system: 'Handle duplicate names.',
      };

      const first = await postJson('/v1/agents', definition);
      const second = await postJson('/v1/agents', definition);

      expect(first.res.status).toBe(201);
      expect(second.res.status).toBe(201);
      expect(first.body.name).toBe('duplicate-name-agent');
      expect(second.body.name).toBe('duplicate-name-agent');
      expect(first.body.id).toMatch(/^agent_/);
      expect(second.body.id).toMatch(/^agent_/);
      expect(second.body.id).not.toBe(first.body.id);
    });

    it('stores immutable agent version snapshots and rejects stale expected versions', async () => {
      const create = await postJson('/v1/agents', {
        name: 'versioned-agent',
        description: 'Version one.',
        model: 'default',
        system: 'Version one system.',
      });

      expect(create.res.status).toBe(201);
      expect(create.body.version).toBe(1);

      const update = await app.request(`/v1/agents/${create.body.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'versioned-agent',
          description: 'Version two.',
          model: 'default',
          system: 'Version two system.',
          expected_version: 1,
        }),
      });
      const updated = await update.json() as any;

      expect(update.status).toBe(200);
      expect(updated.version).toBe(2);
      expect(updated.system).toBe('Version two system.');

      const stale = await app.request(`/v1/agents/${create.body.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'versioned-agent',
          model: 'default',
          system: 'Stale write.',
          expected_version: 1,
        }),
      });
      const staleBody = await stale.json() as any;

      expect(stale.status).toBe(409);
      expect(staleBody.error.type).toBe('conflict');

      const versions = await getJson(`/v1/agents/${create.body.id}/versions`);
      expect(versions.res.status).toBe(200);
      expect(versions.body.data.map((item: any) => item.version)).toEqual([2, 1]);
      expect(versions.body.data[0].system).toBe('Version two system.');
      expect(versions.body.data[1].system).toBe('Version one system.');

      const pinnedSession = await postJson('/v1/sessions', {
        agent: { id: create.body.id, type: 'agent', version: 1 },
        environment_id: 'env_default',
        title: 'Pinned v1 session',
      });

      expect(pinnedSession.res.status).toBe(201);
      expect(pinnedSession.body.agent.id).toBe(create.body.id);
      expect(pinnedSession.body.agent.version).toBe(1);
      expect(pinnedSession.body.agent.system).toBe('Version one system.');

      const currentSession = await postJson('/v1/sessions', {
        agent: create.body.id,
        environment_id: 'env_default',
        title: 'Current version session',
      });

      expect(currentSession.res.status).toBe(201);
      expect(currentSession.body.agent.version).toBe(2);
      expect(currentSession.body.agent.system).toBe('Version two system.');
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
      expect(body.model).toBe('gpt-4o');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await app.request('/v1/agents/nonexist');
      expect(res.status).toBe(404);
    });
  });

  describe('standard API page contracts', () => {
    it('returns standard page envelopes for collection endpoints', async () => {
      const collectionPaths = [
        '/v1/agents',
        '/v1/sessions',
        '/v1/environments',
        '/v1/credential-vaults',
        '/v1/memory_stores',
        '/v1/skills',
        '/v1/api-keys',
        '/v1/webhooks',
        '/v1/scheduled-deployments',
        '/v1/outcomes',
        '/v1/x/logs',
        '/v1/x/templates',
      ];

      for (const path of collectionPaths) {
        const { res, body } = await getJson(path);
        expect(res.status, path).toBe(200);
        expectPage(body);
      }
    });

    it('returns standard error envelopes for invalid write requests', async () => {
      const cases: Array<{ path: string; body: unknown; status: number }> = [
        { path: '/v1/sessions', body: { agent: 42 }, status: 400 },
        { path: '/v1/agents', body: { name: 'bad-agent', model: 'm' }, status: 400 },
        { path: '/v1/environments', body: { name: '' }, status: 400 },
        { path: '/v1/credential-vaults', body: { name: '' }, status: 400 },
        { path: '/v1/memory_stores', body: { name: '' }, status: 400 },
        { path: '/v1/api-keys', body: { name: '' }, status: 400 },
        { path: '/v1/webhooks', body: { name: '' }, status: 400 },
        { path: '/v1/scheduled-deployments', body: { name: '' }, status: 400 },
        { path: '/v1/outcomes', body: { name: '' }, status: 400 },
      ];

      for (const testCase of cases) {
        const { res, body } = await postJson(testCase.path, testCase.body);
        expect(res.status, testCase.path).toBe(testCase.status);
        expectError(body);
      }
    });

    it('exposes workspace, runtime, templates, and standard skills metadata for the console', async () => {
      const workspaceRes = await app.request('/v1/x/workspace');
      expect(workspaceRes.status).toBe(200);
      const workspace = await workspaceRes.json();
      expect(workspace.type).toBe('workspace');
      expect(workspace.name).toBeTruthy();
      expect(workspace.directories).toBeDefined();
      expect(typeof workspace.directories).toBe('object');

      const runtimeRes = await app.request('/v1/x/runtime');
      expect(runtimeRes.status).toBe(200);
      const runtime = await runtimeRes.json();
      expect(runtime.type).toBe('runtime');
      expect(runtime.status).toBe('running');
      expect(runtime.agents_loaded).toBeGreaterThanOrEqual(1);
      expect(runtime.models[0]).toMatchObject({
        name: 'local',
        api_key_state: 'configured',
      });
      expect(runtime.models[0]).not.toHaveProperty('api_key');

      const templatesRes = await app.request('/v1/x/templates');
      const templates = await templatesRes.json();
      const incidentCommander = templates.data.find((item: any) => item.name === 'Incident commander');
      expect(incidentCommander).toBeDefined();
      expect(incidentCommander.agent.model).toBe('local');
      expect(templates.data.every((item: any) => item.agent.model === 'local')).toBe(true);
      expect(incidentCommander.agent.tools.some((tool: any) => tool.type === 'mcp_toolset' && tool.mcp_server_name === 'sentry')).toBe(true);
      expect(templates.data.every((item: any) => item.type === 'template')).toBe(true);

      const skillsRes = await app.request('/v1/skills');
      const skills = await skillsRes.json();
      expectPage(skills);
      expect(skills.data.some((item: any) => item.id === 'pptx' && item.source === 'anthropic')).toBe(true);
      expect(skills.data.some((item: any) => item.id === 'skill_research' && item.source === 'custom')).toBe(true);
      expect(skills.data.every((item: any) => item.type === 'skill')).toBe(true);
    });

    it('exposes canonical runtime settings and validates single active configs', async () => {
      const initial = await getJson('/v1/x/settings');
      expect(initial.res.status).toBe(200);
      expect(initial.body).toMatchObject({
        type: 'settings',
        model_provider: {
          vendor: 'openai-compatible',
          api_key_state: 'not_set',
          configured: false,
        },
        loop_engine: {
          type: 'managed-agents',
          implemented: true,
        },
        storage: {
          metadata: {
            type: 'sqlite',
            implemented: true,
          },
          artifacts: {
            type: 'local_filesystem',
            implemented: true,
          },
        },
        memory: {
          backend: {
            type: 'sqlite',
            implemented: true,
          },
        },
      });
      expect(initial.body.validation.status).toBe('warning');
      expect(JSON.stringify(initial.body)).not.toContain('sk-test');

      const validation = await postJson('/v1/x/settings/validate', {
        model_provider: { vendor: 'anthropic', api_key_env: 'ANTHROPIC_API_KEY' },
        memory: { backend: { type: 'mem0', api_key_env: 'MEM0_API_KEY' } },
        storage: { artifacts: { type: 's3', bucket: 'agent-artifacts' } },
      });
      expect(validation.res.status).toBe(200);
      expect(validation.body.status).toBe('error');
      expect(validation.body.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'memory.backend', status: 'error' }),
        expect.objectContaining({ key: 'storage.artifacts', status: 'error' }),
      ]));

      const updated = await app.request('/v1/x/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_provider: {
            vendor: 'anthropic',
            base_url: 'https://api.anthropic.com/v1',
            api_key_env: 'ANTHROPIC_API_KEY',
          },
          loop_engine: {
            type: 'managed-agents',
            config: { max_concurrent_turns: 1 },
          },
          memory: { backend: { type: 'sqlite' } },
          storage: {
            metadata: { type: 'sqlite', path: 'data.db' },
            artifacts: { type: 'local_filesystem', path: 'files' },
          },
          sandbox: {
            type: 'local',
            config: { workspace_root: dataDir },
          },
        }),
      });
      expect(updated.status).toBe(200);
      const updatedBody = await updated.json();
      expect(updatedBody.model_provider).toMatchObject({
        vendor: 'anthropic',
        base_url: 'https://api.anthropic.com/v1',
        api_key_env: 'ANTHROPIC_API_KEY',
        api_key_state: 'missing_env',
        configured: true,
      });
      expect(updatedBody.loop_engine).toMatchObject({
        type: 'managed-agents',
        implemented: true,
        config: { max_concurrent_turns: 1 },
      });
      expect(updatedBody.sandbox).toMatchObject({
        type: 'local',
        implemented: true,
        available: true,
        config: { workspace_root: dataDir },
      });
      expect(JSON.stringify(updatedBody)).not.toContain('${ANTHROPIC_API_KEY}');

      const runtime = await getJson('/v1/x/runtime');
      expect(runtime.body.models[0]).toMatchObject({
        provider: 'anthropic',
        model: 'anthropic',
        base_url: 'https://api.anthropic.com/v1',
        is_default: true,
      });
      expect(['configured', 'missing_env']).toContain(runtime.body.models[0].api_key_state);
      expect(runtime.body.models[0]).not.toHaveProperty('api_key');
    });

    it('manages webhooks as local control-plane resources', async () => {
      const created = await postJson('/v1/webhooks', {
        name: 'Session events',
        url: 'https://example.com/managed-agents/webhook',
        events: ['session.status_running', 'session.status_terminated'],
        metadata: { team: 'fde' },
      });
      expect(created.res.status).toBe(201);
      expect(created.body).toMatchObject({
        id: expect.stringMatching(/^wh_/),
        type: 'webhook',
        name: 'Session events',
        status: 'active',
        events: ['session.status_running', 'session.status_terminated'],
        metadata: { team: 'fde' },
      });

      const updated = await app.request(`/v1/webhooks/${created.body.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: ['turn_complete'],
          description: 'Terminal turn callback.',
        }),
      });
      expect(updated.status).toBe(200);
      const updatedBody = await updated.json();
      expect(updatedBody.events).toEqual(['turn_complete']);
      expect(updatedBody.description).toBe('Terminal turn callback.');

      const listed = await getJson('/v1/webhooks');
      expectPage(listed.body);
      expect(listed.body.data.some((item: any) => item.id === created.body.id)).toBe(true);

      const testDelivery = await postJson(`/v1/webhooks/${created.body.id}/test`, {
        event: 'turn_complete',
        payload: { session_id: 'sess_test' },
      });
      expect(testDelivery.res.status).toBe(202);
      expect(testDelivery.body).toMatchObject({
        id: expect.stringMatching(/^whd_/),
        type: 'webhook_delivery',
        webhook_id: created.body.id,
        event: 'turn_complete',
        status: 'simulated',
        status_code: 202,
        attempt_count: 0,
        next_retry_at: null,
        payload: {
          type: 'webhook_test',
          event: 'turn_complete',
          webhook_id: created.body.id,
          data: { session_id: 'sess_test' },
        },
      });
      expect(testDelivery.body.signature).toMatch(/^sha256=/);

      const deliveries = await getJson(`/v1/webhooks/${created.body.id}/deliveries`);
      expectPage(deliveries.body);
      expect(deliveries.body.data[0].id).toBe(testDelivery.body.id);

      const retryDue = await postJson('/v1/webhooks/retry-due', {});
      expect(retryDue.res.status).toBe(202);
      expectPage(retryDue.body);

      const archived = await postJson(`/v1/webhooks/${created.body.id}/archive`, {});
      expect(archived.res.status).toBe(200);
      expect(archived.body.status).toBe('archived');
    });

    it('manages scheduled deployments as persisted run plans', async () => {
      const created = await postJson('/v1/scheduled-deployments', {
        name: 'Morning smoke',
        agent_id: 'agent_echo-agent',
        environment_id: 'env_default',
        cron: '0 9 * * 1',
        payload: { title: 'Daily FDE smoke' },
        next_run_at: '2026-07-23T01:00:00.000Z',
      });
      expect(created.res.status).toBe(201);
      expect(created.body).toMatchObject({
        id: expect.stringMatching(/^sched_/),
        type: 'scheduled_deployment',
        name: 'Morning smoke',
        agent_id: 'agent_echo-agent',
        environment_id: 'env_default',
        cron: '0 9 * * 1',
        payload: { title: 'Daily FDE smoke' },
        status: 'active',
      });

      const badCron = await postJson('/v1/scheduled-deployments', {
        name: 'Bad cron',
        agent_id: 'agent_echo-agent',
        cron: '* * *',
      });
      expect(badCron.res.status).toBe(400);

      const run = await postJson(`/v1/scheduled-deployments/${created.body.id}/run`, {
        trigger_type: 'manual',
        payload: { title: 'Manual schedule smoke' },
      });
      expect(run.res.status).toBe(201);
      expect(run.body).toMatchObject({
        id: expect.stringMatching(/^srun_/),
        type: 'scheduled_deployment_run',
        schedule_id: created.body.id,
        status: 'created_session',
        trigger_type: 'manual',
        payload: { title: 'Manual schedule smoke' },
      });
      expect(run.body.session_id).toMatch(/^sess_/);

      const runs = await getJson(`/v1/scheduled-deployments/${created.body.id}/runs`);
      expectPage(runs.body);
      expect(runs.body.data[0].id).toBe(run.body.id);

      const due = await postJson('/v1/scheduled-deployments', {
        name: 'Due smoke',
        agent_id: 'agent_echo-agent',
        environment_id: 'env_default',
        cron: '*/5 * * * *',
        payload: { title: 'Automatic due smoke' },
        next_run_at: '2000-01-01T00:00:00.000Z',
      });
      const dueRun = await postJson('/v1/scheduled-deployments/run-due', {});
      expect(dueRun.res.status).toBe(202);
      expectPage(dueRun.body);
      const dueRunRow = dueRun.body.data.find((item: any) => item.schedule_id === due.body.id);
      expect(dueRunRow).toMatchObject({ status: 'created_session', trigger_type: 'scheduled' });
      const dueAfterRun = await getJson(`/v1/scheduled-deployments/${due.body.id}`);
      expect(dueAfterRun.body.last_run_at).toBeTruthy();
      expect(dueAfterRun.body.next_run_at).toBeTruthy();

      const paused = await app.request(`/v1/scheduled-deployments/${created.body.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paused', cron: '30 9 * * 1' }),
      });
      expect(paused.status).toBe(200);
      const pausedBody = await paused.json();
      expect(pausedBody).toMatchObject({ status: 'paused', cron: '30 9 * * 1' });

      const listed = await getJson('/v1/scheduled-deployments');
      expectPage(listed.body);
      expect(listed.body.data.some((item: any) => item.id === created.body.id)).toBe(true);

      const archived = await postJson(`/v1/scheduled-deployments/${created.body.id}/archive`, {});
      expect(archived.res.status).toBe(200);
      expect(archived.body.status).toBe('archived');
    });

    it('manages outcomes and records session outcome evaluations', async () => {
      const outcome = await postJson('/v1/outcomes', {
        name: 'Release readiness',
        objective: 'The agent should produce a concise release-readiness summary.',
        criteria: ['Mentions tests', 'Mentions risks'],
      });
      expect(outcome.res.status).toBe(201);
      expect(outcome.body).toMatchObject({
        id: expect.stringMatching(/^out_/),
        type: 'outcome',
        name: 'Release readiness',
        criteria: ['Mentions tests', 'Mentions risks'],
        pass_threshold: 0.75,
        evaluator: 'deterministic_transcript_matcher',
        status: 'active',
      });

      const session = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        environment_id: 'env_default',
        title: 'Outcome run',
      });
      expect(session.res.status).toBe(201);

      const evaluation = await postJson(`/v1/sessions/${session.body.id}/outcomes`, {
        outcome_id: outcome.body.id,
        status: 'passed',
        score: 0.92,
        summary: 'The run met release-readiness criteria.',
        details: { checked_by: 'integration-test' },
      });
      expect(evaluation.res.status).toBe(201);
      expect(evaluation.body).toMatchObject({
        id: expect.stringMatching(/^sout_/),
        type: 'session_outcome',
        session_id: session.body.id,
        outcome_id: outcome.body.id,
        status: 'passed',
        score: 0.92,
        details: { checked_by: 'integration-test' },
      });

      const sessionOutcomes = await getJson(`/v1/sessions/${session.body.id}/outcomes`);
      expectPage(sessionOutcomes.body);
      expect(sessionOutcomes.body.data[0].id).toBe(evaluation.body.id);

      const readyOutcome = await postJson('/v1/outcomes', {
        name: 'Transcript readiness',
        objective: 'The session should mention tests and risks.',
        criteria: ['tests', 'risks'],
        pass_threshold: 1,
      });
      const readySession = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        environment_id: 'env_default',
        title: 'Automated outcome run',
      });
      await postJson(`/v1/sessions/${readySession.body.id}/messages`, {
        content: 'Please summarize tests and risks.',
        stream: false,
      });
      const autoEvaluation = await postJson(`/v1/sessions/${readySession.body.id}/outcomes/evaluate`, {
        outcome_id: readyOutcome.body.id,
      });
      expect(autoEvaluation.res.status).toBe(201);
      expect(autoEvaluation.body).toMatchObject({
        type: 'session_outcome',
        session_id: readySession.body.id,
        outcome_id: readyOutcome.body.id,
        status: 'passed',
        score: 1,
        details: {
          evaluator: 'deterministic_transcript_matcher',
          pass_threshold: 1,
        },
      });

      const partialOutcome = await postJson('/v1/outcomes', {
        name: 'Partial threshold',
        objective: 'The session should mention tests, risks, and deploys.',
        criteria: ['tests', 'risks', 'deploys'],
        pass_threshold: 0.7,
      });
      const partialEvaluation = await postJson(`/v1/sessions/${readySession.body.id}/outcomes/evaluate`, {
        outcome_id: partialOutcome.body.id,
      });
      expect(partialEvaluation.body.status).toBe('inconclusive');
      expect(partialEvaluation.body.score).toBeCloseTo(2 / 3, 5);

      const lowered = await app.request(`/v1/outcomes/${partialOutcome.body.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass_threshold: 0.6 }),
      });
      expect(lowered.status).toBe(200);
      expect((await lowered.json() as any).pass_threshold).toBe(0.6);
      const loweredEvaluation = await postJson(`/v1/sessions/${readySession.body.id}/outcomes/evaluate`, {
        outcome_id: partialOutcome.body.id,
      });
      expect(loweredEvaluation.body.status).toBe('passed');

      const modelOutcome = await postJson('/v1/outcomes', {
        name: 'Model assisted readiness',
        objective: 'The session should be judged by a model evaluator.',
        criteria: ['tests', 'risks'],
        evaluator: 'model_assisted',
        pass_threshold: 0.8,
      });
      const modelEvaluation = await postJson(`/v1/sessions/${readySession.body.id}/outcomes/evaluate`, {
        outcome_id: modelOutcome.body.id,
      });
      expect(modelEvaluation.body).toMatchObject({
        status: 'passed',
        score: 0.88,
        summary: 'Mock model evaluator reviewed 2 criteria.',
        details: {
          evaluator: 'model_assisted',
          pass_threshold: 0.8,
          model: 'mock-evaluator',
        },
      });

      const archived = await postJson(`/v1/outcomes/${outcome.body.id}/archive`, {});
      expect(archived.res.status).toBe(200);
      expect(archived.body.status).toBe('archived');
    });

    it('exposes recent runtime logs through the extension API', async () => {
      const { res, body } = await getJson('/v1/x/logs?limit=10&q=test_runtime_ready');
      expect(res.status).toBe(200);
      expectPage(body);
      expect(body.data.some((entry: any) => entry.msg === 'test_runtime_ready')).toBe(true);
      expect(body.data[0]).toHaveProperty('line');

      const warnOnly = await getJson('/v1/x/logs?level=warn&limit=10');
      expect(warnOnly.res.status).toBe(200);
      expect(warnOnly.body.data.every((entry: any) => ['warn', 'error'].includes(entry.level))).toBe(true);
    });

    it('schedules runtime restart through the extension API', async () => {
      restartRequested = false;
      const { res, body } = await postJson('/v1/x/restart', {});
      expect(res.status).toBe(202);
      expect(body).toMatchObject({ restarting: true, status: 'scheduled' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(restartRequested).toBe(true);
      expect(logStore.list({ query: 'test_restart_called' })).toHaveLength(1);
    });

    it('creates, retrieves, lists, and deletes skills through /v1/skills', async () => {
      const skillContent = `---
name: contract-skill
description: Exercises the standard skill API.
---

# Contract Skill

Use this in API tests.
`;
      const create = await postJson('/v1/skills', {
        display_title: 'Contract Skill',
        files: [
          { path: 'contract-skill/SKILL.md', content: skillContent },
          { path: 'contract-skill/resources/example.txt', content: 'resource' },
        ],
      });

      expect(create.res.status).toBe(201);
      expect(create.body.id).toMatch(/^skill_[A-Za-z0-9_-]+$/);
      expect(create.body.id).not.toBe('skill_contract-skill');
      expect(create.body.type).toBe('skill');
      expect(create.body.source).toBe('custom');
      expect(create.body.display_title).toBe('Contract Skill');
      expect(create.body.latest_version).toBeTruthy();

      const skillId = create.body.id;
      const storedSkill = db.prepare('SELECT instructions, storage_path FROM skills WHERE id = ?').get(skillId) as
        | { instructions: string; storage_path: string | null }
        | undefined;
      expect(storedSkill).toBeDefined();
      expect(storedSkill!.instructions).toContain('Use this in API tests.');
      expect(storedSkill!.storage_path).toBe(join(dataDir, 'skills', skillId));
      expect(existsSync(storedSkill!.storage_path!)).toBe(true);
      expect(existsSync(join(storedSkill!.storage_path!, 'SKILL.md'))).toBe(true);
      expect(existsSync(join(storedSkill!.storage_path!, 'resources', 'example.txt'))).toBe(true);
      expect(existsSync(join(skillsDir, 'contract-skill'))).toBe(false);

      const get = await getJson(`/v1/skills/${skillId}`);
      expect(get.res.status).toBe(200);
      expect(get.body.id).toBe(skillId);
      expect(get.body.name).toBe('contract-skill');
      expect(get.body.description).toBe('Exercises the standard skill API.');

      const customList = await getJson('/v1/skills?source=custom');
      expect(customList.body.data.some((item: any) => item.id === skillId)).toBe(true);
      expect(customList.body.data.every((item: any) => item.source === 'custom')).toBe(true);

      const del = await app.request(`/v1/skills/${skillId}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
      expect(await del.json()).toEqual({ id: skillId, type: 'skill_deleted' });
      expect(existsSync(storedSkill!.storage_path!)).toBe(false);
      const archived = db.prepare('SELECT archived_at FROM skills WHERE id = ?').get(skillId) as
        | { archived_at: string | null }
        | undefined;
      expect(archived?.archived_at).toBeTruthy();

      const missing = await app.request(`/v1/skills/${skillId}`);
      expect(missing.status).toBe(404);
    });

    it('extracts zip skill packages before validating SKILL.md', async () => {
      const zip = makeStoredZip([
        {
          path: 'zip-skill/SKILL.md',
          content: `---
name: zip-skill
description: Uploaded from a compressed package.
---

# Zip Skill
`,
        },
        { path: 'zip-skill/resources/example.txt', content: 'resource' },
        { path: 'zip-skill/.DS_Store', content: 'ignored' },
        { path: '__MACOSX/zip-skill/._SKILL.md', content: 'ignored' },
      ]);

      const create = await postJson('/v1/skills', {
        files: [{ filename: 'zip-skill.zip', base64: zip.toString('base64') }],
      });

      expect(create.res.status).toBe(201);
      expect(create.body.id).toMatch(/^skill_[A-Za-z0-9_-]+$/);
      expect(create.body.id).not.toBe('skill_zip-skill');
      expect(create.body.name).toBe('zip-skill');
      expect(create.body.display_title).toBe('zip-skill');

      const get = await getJson(`/v1/skills/${create.body.id}`);
      expect(get.res.status).toBe(200);
      expect(get.body.description).toBe('Uploaded from a compressed package.');

      const del = await app.request(`/v1/skills/${create.body.id}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
    });

    it('rejects zip skill packages whose declared unpacked size exceeds the limit', async () => {
      const zip = makeStoredZip([
        { path: 'huge-skill/SKILL.md', content: '', declaredSize: 8 * 1024 * 1024 + 1 },
      ]);

      const create = await postJson('/v1/skills', {
        files: [{ filename: 'huge-skill.zip', base64: zip.toString('base64') }],
      });

      expect(create.res.status).toBe(400);
      expect(create.body.error.message).toContain('8MB');
    });

    it('rejects invalid skill uploads with standard validation messages', async () => {
      const flat = await postJson('/v1/skills', {
        files: [{ path: 'SKILL.md', content: '---\nname: flat\ndescription: invalid\n---\nBody' }],
      });
      expect(flat.res.status).toBe(400);
      expect(flat.body.error.message).toContain('top-level directory');

      const missingFrontmatter = await postJson('/v1/skills', {
        files: [{ path: 'bad-skill/SKILL.md', content: '# No frontmatter' }],
      });
      expect(missingFrontmatter.res.status).toBe(400);
      expect(missingFrontmatter.body.error.message).toContain('YAML frontmatter');
    });

    it('creates and exposes file resources without leaking internal paths', async () => {
      const create = await postJson('/v1/files', {
        name: 'notes.md',
        media_type: 'text/markdown',
        content: '# Notes\n\nSession mountable file.',
      });
      expect(create.res.status).toBe(201);
      expect(create.body.id).toMatch(/^file_/);
      expect(create.body.type).toBe('file');
      expect(create.body.name).toBe('notes.md');
      expect(create.body.media_type).toBe('text/markdown');
      expect(create.body.size_bytes).toBeGreaterThan(0);
      expect(create.body.preview).toContain('Session mountable file');
      expect(create.body.storage_path).toBeUndefined();

      const { res, body } = await getJson('/v1/files');
      expect(res.status).toBe(200);
      expectPage(body);
      const listed = body.data.find((file: any) => file.id === create.body.id);
      expect(listed).toBeDefined();
      expect(JSON.stringify(body)).not.toContain('.managed-agents');
      expect(JSON.stringify(body)).not.toContain('secrets.key');

      const content = await app.request(`/v1/files/${create.body.id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers.get('content-type')).toContain('text/markdown');
      expect(await content.text()).toContain('# Notes');

      const archive = await app.request(`/v1/files/${create.body.id}`, { method: 'DELETE' });
      expect(archive.status).toBe(200);
      expect((await archive.json() as any).status).toBe('archived');

      const afterArchive = await getJson('/v1/files');
      expect(afterArchive.body.data.some((file: any) => file.id === create.body.id)).toBe(false);
    });

    it('always generates file ids and keeps storage inside the managed files directory', async () => {
      const create = await postJson('/v1/files', {
        id: 'file_/../../escape.txt',
        name: 'escape.txt',
        content: 'should stay managed',
      });

      expect(create.res.status).toBe(201);
      expect(create.body.id).toMatch(/^file_/);
      expect(create.body.id).not.toBe('file_/../../escape.txt');
      expect(existsSync(join(dataDir, 'escape.txt'))).toBe(false);
    });

    it('uploads file resources with multipart form data', async () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob(['uploaded through the console'], { type: 'text/plain' }),
        'sandbase-upload-test.txt',
      );

      const res = await app.request('/v1/files', {
        method: 'POST',
        body: form,
      });
      const body = await res.json() as any;

      expect(res.status).toBe(201);
      expect(body.id).toMatch(/^file_/);
      expect(body.name).toBe('sandbase-upload-test.txt');
      expect(body.media_type).toBe('text/plain');
      expect(body.size_bytes).toBe(28);
      expect(body.preview).toContain('uploaded through the console');

      const content = await app.request(`/v1/files/${body.id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers.get('content-disposition')).toContain('sandbase-upload-test.txt');
      expect(await content.text()).toBe('uploaded through the console');
    });

    it('creates session artifacts with previews without mixing them into uploaded files', async () => {
      const session = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        environment_id: 'env_default',
        title: 'Artifact run',
      });
      expect(session.res.status).toBe(201);

      const created = await postJson(`/v1/sessions/${session.body.id}/artifacts`, {
        path: '/artifacts/report.md',
        name: 'report.md',
        media_type: 'text/markdown',
        content: '# Run report\n\nGenerated by the local runtime.',
        metadata: { source: 'test' },
      });
      expect(created.res.status).toBe(201);
      expect(created.body).toMatchObject({
        type: 'artifact',
        role: 'artifact',
        session_id: session.body.id,
        artifact_path: '/artifacts/report.md',
        media_type: 'text/markdown',
      });
      expect(created.body.preview).toContain('Generated by the local runtime');
      expect(created.body.storage_path).toBeUndefined();

      const artifacts = await getJson(`/v1/sessions/${session.body.id}/artifacts`);
      expect(artifacts.res.status).toBe(200);
      expect(artifacts.body.data).toHaveLength(1);
      expect(artifacts.body.data[0].id).toBe(created.body.id);

      const content = await app.request(`/v1/sessions/${session.body.id}/artifacts/${created.body.id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers.get('content-type')).toContain('text/markdown');
      expect(await content.text()).toContain('# Run report');

      const files = await getJson('/v1/files');
      expect(files.body.data.some((file: any) => file.id === created.body.id)).toBe(false);

      const badPath = await postJson(`/v1/sessions/${session.body.id}/artifacts`, {
        path: '/tmp/report.md',
        content: 'bad',
      });
      expect(badPath.res.status).toBe(400);
      expect(badPath.body.error.message).toContain('/artifacts/');
    });
  });

  describe('PUT /v1/environments/:id', () => {
    it('creates, gets, and archives environment resources', async () => {
      const { res, body } = await postJson('/v1/environments', {
        name: 'Contract runner',
        description: 'Configuration template for sessions and code execution.',
        config: {
          hosting_type: 'self_hosted',
          sandbox_provider: 'self_hosted',
          network: {
            type: 'limited',
            allow_mcp_server_network_access: false,
            allow_package_manager_network_access: false,
            allowed_hosts: ['api.example.com'],
          },
          packages: [{ manager: 'pip', package: 'pytest==8.3.4' }],
        },
        metadata: { tier: 'qa' },
      });

      expect(res.status).toBe(201);
      expect(body.id).toMatch(/^env_/);
      expect(body.type).toBe('environment');
      expect(body.status).toBe('active');
      expect(body.hosting_type).toBe('self_hosted');
      expect(body.sandbox_provider).toBe('self_hosted');
      expect(body.network.allowed_hosts).toEqual(['api.example.com']);
      expect(body.packages[0].package).toBe('pytest==8.3.4');
      expect(body.config.network.allowed_hosts).toEqual(['api.example.com']);

      const getRes = await app.request(`/v1/environments/${body.id}`);
      expect(getRes.status).toBe(200);
      expect((await getRes.json()).metadata.tier).toBe('qa');

      const archiveRes = await app.request(`/v1/environments/${body.id}/archive`, { method: 'POST' });
      expect(archiveRes.status).toBe(200);
      expect((await archiveRes.json()).status).toBe('archived');

      const getArchived = await app.request(`/v1/environments/${body.id}`);
      expect(getArchived.status).toBe(404);
    });

    it('ignores client-supplied environment ids', async () => {
      const first = await postJson('/v1/environments', { id: 'env_duplicate_contract', name: 'Duplicate contract' });
      const second = await postJson('/v1/environments', { id: 'env_duplicate_contract', name: 'Duplicate contract' });

      expect(first.res.status).toBe(201);
      expect(second.res.status).toBe(201);
      expect(first.body.id).toMatch(/^env_/);
      expect(second.body.id).toMatch(/^env_/);
      expect(first.body.id).not.toBe('env_duplicate_contract');
      expect(second.body.id).not.toBe('env_duplicate_contract');
      expect(first.body.id).not.toBe(second.body.id);
    });

    it('generates environment ids and allows duplicate display names', async () => {
      const first = await postJson('/v1/environments', { name: 'Reusable environment' });
      const second = await postJson('/v1/environments', { name: 'Reusable environment' });

      expect(first.res.status).toBe(201);
      expect(second.res.status).toBe(201);
      expect(first.body.id).toMatch(/^env_/);
      expect(second.body.id).toMatch(/^env_/);
      expect(first.body.id).not.toBe(second.body.id);
      expect(first.body.name).toBe('Reusable environment');
      expect(second.body.name).toBe('Reusable environment');
    });

    it('preserves local hosting for desktop runtimes', async () => {
      const { res, body } = await postJson('/v1/environments', {
        name: 'Local desktop',
        description: 'Runs sessions on the local machine.',
        config: {
          hosting_type: 'local',
          sandbox_provider: 'local',
        },
      });

      expect(res.status).toBe(201);
      expect(body.hosting_type).toBe('local');
      expect(body.sandbox_provider).toBe('local');
      expect(body.config.hosting_type).toBe('local');
      expect(body.config.sandbox_provider).toBe('local');
    });

    it('updates environment fields', async () => {
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
      expect(body.hosting_type).toBe('cloud');
      expect(body.sandbox_provider).toBe('cloud');
      expect(body.network.allowed_hosts).toEqual(['api.github.com']);
      expect(body.packages[0].package).toBe('ruff==0.5.0');
      expect(body.config.hosting_type).toBe('cloud');
      expect(body.config.network.allowed_hosts).toEqual(['api.github.com']);
      expect(body.config.packages[0].package).toBe('ruff==0.5.0');
      expect(body.metadata.owner).toBe('platform');
    });

    it('accepts standard top-level environment fields', async () => {
      const { res, body } = await postJson('/v1/environments', {
        name: 'Standard top level',
        description: 'Uses the same shape as the Console create form.',
        hosting_type: 'cloud',
        sandbox_provider: 'cloud',
        network: {
          type: 'limited',
          allow_mcp_server_network_access: false,
          allow_package_manager_network_access: true,
          allowed_hosts: ['docs.anthropic.com'],
        },
        packages: [{ manager: 'npm', package: 'tsx@latest' }],
      });

      expect(res.status).toBe(201);
      expect(body.hosting_type).toBe('cloud');
      expect(body.sandbox_provider).toBe('cloud');
      expect(body.network.allowed_hosts).toEqual(['docs.anthropic.com']);
      expect(body.packages[0].package).toBe('tsx@latest');
      expect(body.config.hosting_type).toBe('cloud');
      expect(body.config.packages[0].manager).toBe('npm');
    });

    it('manages self-hosted worker keys and environment queue visibility', async () => {
      const { body: environment } = await postJson('/v1/environments', {
        name: 'Self-hosted worker pool',
        hosting_type: 'self_hosted',
        sandbox_provider: 'self_hosted',
      });

      const createdKey = await postJson(`/v1/environments/${environment.id}/worker-keys`, {
        name: 'Laptop runner',
        metadata: { host: 'fde-laptop' },
      });
      expect(createdKey.res.status).toBe(201);
      expect(createdKey.body.secret_key).toMatch(/^mawk_/);
      expect(createdKey.body.key_prefix).toContain('…');
      expect(createdKey.body.key_hash).toBeUndefined();

      const keys = await getJson(`/v1/environments/${environment.id}/worker-keys`);
      expect(keys.body.data).toHaveLength(1);
      expect(keys.body.data[0]).toMatchObject({
        id: createdKey.body.id,
        environment_id: environment.id,
        status: 'active',
      });
      expect(keys.body.data[0].secret_key).toBeUndefined();

      const session = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        environment_id: environment.id,
        title: 'Queue visibility',
      });
      db.prepare('INSERT INTO work_items (id, session_id, kind, payload, status) VALUES (?, ?, ?, ?, ?)').run(
        'work_api_env_queue',
        session.body.id,
        'exec',
        JSON.stringify({ command: 'echo ok' }),
        'pending',
      );

      const workItems = await getJson(`/v1/environments/${environment.id}/work-items`);
      expect(workItems.res.status).toBe(200);
      expect(workItems.body.stats.pending).toBe(1);
      expect(workItems.body.data[0]).toMatchObject({
        id: 'work_api_env_queue',
        session_id: session.body.id,
        kind: 'exec',
        status: 'pending',
      });

      const revoked = await postJson(`/v1/environments/${environment.id}/worker-keys/${createdKey.body.id}/revoke`, {});
      expect(revoked.res.status).toBe(200);
      expect(revoked.body.status).toBe('revoked');
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
    it('supports detail, all standard credential auth types, active filtering, and vault archive', async () => {
      const { res: vaultRes, body: vault } = await postJson('/v1/credential-vaults', {
        name: 'Contract vault',
        description: 'Shared credentials for contract tests.',
        metadata: { owner: 'qa' },
      });
      expect(vaultRes.status).toBe(201);
      expect(vault.type).toBe('credential_vault');

      const credentialInputs = [
        {
          name: 'OAuth MCP',
          auth_type: 'mcp_oauth',
          mcp_server_url: 'https://mcp.example.com/mcp',
          injection_locations: ['request_headers'],
        },
        {
          name: 'Bearer MCP',
          auth_type: 'bearer_token',
          value: 'secret-bearer-token',
          network: { type: 'unrestricted', allowed_hosts: ['api.example.com'] },
          injection_locations: ['request_headers', 'request_headers', 'request_body'],
        },
        {
          name: 'Env credential',
          auth_type: 'environment_variable',
          variable_name: 'MY_API_KEY',
          value: 'secret-env-token',
        },
      ];

      const createdCredentials = [];
      for (const input of credentialInputs) {
        const { res, body } = await postJson(`/v1/credential-vaults/${vault.id}/credentials`, input);
        expect(res.status).toBe(201);
        expect(body.type).toBe('credential');
        expect(body.value).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('secret-');
        createdCredentials.push(body);
      }

      const bearer = createdCredentials.find((item: any) => item.auth_type === 'bearer_token');
      expect(bearer.network.type).toBe('unrestricted');
      expect(bearer.injection_locations).toEqual(['request_headers', 'request_body']);

      const detailRes = await app.request(`/v1/credential-vaults/${vault.id}`);
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.credential_count).toBe(3);
      expect(detail.credentials).toHaveLength(3);

      const archiveRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials/${createdCredentials[0].id}/archive`, { method: 'POST' });
      expect(archiveRes.status).toBe(200);
      const deleteRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials/${createdCredentials[1].id}`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(200);

      const activeRes = await app.request(`/v1/credential-vaults/${vault.id}/credentials`);
      const active = await activeRes.json();
      expectPage(active);
      expect(active.data.map((item: any) => item.id)).toEqual([createdCredentials[2].id]);

      const archiveVaultRes = await app.request(`/v1/credential-vaults/${vault.id}/archive`, { method: 'POST' });
      expect(archiveVaultRes.status).toBe(200);
      expect((await archiveVaultRes.json()).status).toBe('archived');

      const archivedDetailRes = await app.request(`/v1/credential-vaults/${vault.id}`);
      expect(archivedDetailRes.status).toBe(404);
      const archivedCredentialCreate = await postJson(`/v1/credential-vaults/${vault.id}/credentials`, {
        auth_type: 'mcp_oauth',
        mcp_server_url: 'https://mcp.example.com',
      });
      expect(archivedCredentialCreate.res.status).toBe(404);
    });

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
          id: 'vcrd_client_supplied',
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
      expect(credential.id).not.toBe('vcrd_client_supplied');
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

    it('allows duplicate credential vault display names', async () => {
      const first = await postJson('/v1/credential-vaults', { id: 'vlt_client_supplied', name: 'Shared credentials' });
      const second = await postJson('/v1/credential-vaults', { id: 'vlt_client_supplied', name: 'Shared credentials' });

      expect(first.res.status).toBe(201);
      expect(second.res.status).toBe(201);
      expect(first.body.id).toMatch(/^vlt_/);
      expect(second.body.id).toMatch(/^vlt_/);
      expect(first.body.id).not.toBe('vlt_client_supplied');
      expect(second.body.id).not.toBe('vlt_client_supplied');
      expect(first.body.id).not.toBe(second.body.id);
      expect(first.body.name).toBe('Shared credentials');
      expect(second.body.name).toBe('Shared credentials');
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

    it('rotates credentials, records audit events, and resolves runtime injection bundles', async () => {
      const vault = await postJson('/v1/credential-vaults', { name: 'Runtime injection vault' });
      const credential = await postJson(`/v1/credential-vaults/${vault.body.id}/credentials`, {
        name: 'GitHub token',
        auth_type: 'environment_variable',
        variable_name: 'GITHUB_TOKEN',
        value: 'ghp_old_secret',
        injection_locations: ['request_headers'],
      });
      expect(credential.res.status).toBe(201);

      const rotated = await postJson(`/v1/credential-vaults/${vault.body.id}/credentials/${credential.body.id}/rotate`, {
        value: 'ghp_new_secret',
        actor: 'integration-test',
        metadata: { reason: 'rotation-test' },
      });
      expect(rotated.res.status).toBe(200);
      expect(rotated.body.value_hint).toBe('••••cret');
      expect(JSON.stringify(rotated.body)).not.toContain('ghp_new_secret');

      const session = await postJson('/v1/sessions', {
        agent: 'agent_echo-agent',
        environment_id: 'env_default',
        vault_ids: [vault.body.id],
      });
      expect(session.res.status).toBe(201);

      const bundle = resolveSessionCredentialInjections(db, session.body.id, {
        dataDir,
        actor: 'test-runtime',
        metadata: { session_id: session.body.id },
      });
      expect(bundle.environment.GITHUB_TOKEN).toBe('ghp_new_secret');
      expect(bundle.credentials[0]).toMatchObject({
        id: credential.body.id,
        vault_id: vault.body.id,
        variable_name: 'GITHUB_TOKEN',
      });

      const detail = await getJson(`/v1/credential-vaults/${vault.body.id}/credentials`);
      const updated = detail.body.data.find((item: any) => item.id === credential.body.id);
      expect(updated.last_used_at).toBeTruthy();
      expect(JSON.stringify(detail.body)).not.toContain('ghp_new_secret');

      const audit = await getJson(`/v1/credential-vaults/${vault.body.id}/credentials/${credential.body.id}/audit`);
      expect(audit.body.data.map((event: any) => event.action)).toEqual(expect.arrayContaining(['rotate', 'runtime_inject']));
      expect(audit.body.data.find((event: any) => event.action === 'rotate').metadata.reason).toBe('rotation-test');

      const marked = await postJson(`/v1/credential-vaults/${vault.body.id}/credentials/${credential.body.id}/mark-used`, {
        actor: 'api-test',
        metadata: { check: 'manual' },
      });
      expect(marked.res.status).toBe(200);
      expect(marked.body.last_used_at).toBeTruthy();
    });
  });

  describe('Memory stores', () => {
    it('supports detail, normalized path conflicts, active memory filtering, and store archive', async () => {
      const { res: storeRes, body: store } = await postJson('/v1/memory_stores', {
        name: 'Contract memory store',
        description: 'Persistent memory for contract tests.',
        metadata: { owner: 'qa' },
      });
      expect(storeRes.status).toBe(201);
      expect(store.type).toBe('memory_store');
      expect(store.memory_count).toBe(0);

      const { res: memoryRes, body: memory } = await postJson(`/v1/memory_stores/${store.id}/memories`, {
        path: '/folder/a',
        content: 'alpha',
        metadata: { kind: 'note' },
      });
      expect(memoryRes.status).toBe(201);
      expect(memory.path).toBe('/folder/a');
      expect(memory.content_size_bytes).toBe(5);
      expect(memory.content_hash).toHaveLength(64);

      const duplicate = await postJson(`/v1/memory_stores/${store.id}/memories`, {
        path: '/folder//a',
        content: 'duplicate',
      });
      expect(duplicate.res.status).toBe(409);
      expect(duplicate.body.error.type).toBe('conflict');

      const detailRes = await app.request(`/v1/memory_stores/${store.id}`);
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.memory_count).toBe(1);
      expect(detail.memories[0].content).toBe('alpha');
      expect(detail.memories[0].content_size_bytes).toBe(5);
      expect(detail.memories[0].content_hash).toBe(memory.content_hash);

      const deleteRes = await app.request(`/v1/memory_stores/${store.id}/memories/${memory.id}`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(200);

      const memoriesRes = await app.request(`/v1/memory_stores/${store.id}/memories`);
      const memories = await memoriesRes.json();
      expectPage(memories);
      expect(memories.data).toEqual([]);

      const archiveStoreRes = await app.request(`/v1/memory_stores/${store.id}/archive`, { method: 'POST' });
      expect(archiveStoreRes.status).toBe(200);
      expect((await archiveStoreRes.json()).status).toBe('archived');

      const archivedDetailRes = await app.request(`/v1/memory_stores/${store.id}`);
      expect(archivedDetailRes.status).toBe(404);
      const archivedMemoryCreate = await postJson(`/v1/memory_stores/${store.id}/memories`, {
        path: '/folder/b',
        content: 'beta',
      });
      expect(archivedMemoryCreate.res.status).toBe(404);
    });

    it('creates a memory store and manages memories by path', async () => {
      const storeRes = await app.request('/v1/memory_stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Research notes',
          id: 'memstore_client_supplied',
          description: 'Persistent notes for agents.',
        }),
      });
      expect(storeRes.status).toBe(201);
      const store = await storeRes.json();
      expect(store.id).toMatch(/^memstore_/);
      expect(store.id).not.toBe('memstore_client_supplied');
      expect(store.memory_count).toBe(0);
      expect(store.memories).toEqual([]);

      const memoryRes = await app.request(`/v1/memory_stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/note/d',
          id: 'mem_client_supplied',
          content: 'ddd',
        }),
      });
      expect(memoryRes.status).toBe(201);
      const memory = await memoryRes.json();
      expect(memory.id).toMatch(/^mem_/);
      expect(memory.id).not.toBe('mem_client_supplied');
      expect(memory.path).toBe('/note/d');
      expect(memory.content).toBe('ddd');

      const updateRes = await app.request(`/v1/memory_stores/${store.id}/memories/${memory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'updated' }),
      });
      expect(updateRes.status).toBe(200);
      const updatedMemory = await updateRes.json();
      expect(updatedMemory.content).toBe('updated');
      expect(updatedMemory.content_size_bytes).toBe(7);
      expect(updatedMemory.content_hash).toHaveLength(64);

      const listRes = await app.request('/v1/memory_stores');
      const list = await listRes.json();
      const listedStore = list.data.find((item: any) => item.id === store.id);
      expect(listedStore.memory_count).toBe(1);
      expect(listedStore.memories[0].path).toBe('/note/d');

      const deleteRes = await app.request(`/v1/memory_stores/${store.id}/memories/${memory.id}`, { method: 'DELETE' });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).deleted).toBe(true);

      const recreateRes = await app.request(`/v1/memory_stores/${store.id}/memories`, {
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
      const storeRes = await app.request('/v1/memory_stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Absolute paths only' }),
      });
      const store = await storeRes.json();
      const res = await app.request(`/v1/memory_stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'note/d', content: 'ddd' }),
      });
      expect(res.status).toBe(400);

      const rootRes = await app.request(`/v1/memory_stores/${store.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/', content: 'ddd' }),
      });
      expect(rootRes.status).toBe(400);

      const directoryRes = await app.request(`/v1/memory_stores/${store.id}/memories`, {
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

    it('returns a JSON runtime metrics summary', async () => {
      db.prepare(
        `INSERT INTO files (id, name, media_type, size_bytes, storage_path, role, session_id, artifact_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('file_metrics_artifact', 'artifact.txt', 'text/plain', 42, 'artifact.txt', 'artifact', null, '/artifacts/artifact.txt');

      const res = await app.request('/v1/x/metrics/summary');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        type: 'metrics_summary',
        sessions: expect.objectContaining({
          total: expect.any(Number),
          by_status: expect.any(Object),
        }),
        events: expect.objectContaining({
          total: expect.any(Number),
          by_type: expect.any(Object),
        }),
        storage: expect.objectContaining({
          artifacts: expect.any(Number),
          artifact_bytes: expect.any(Number),
        }),
        work_queue: expect.any(Object),
        http: expect.objectContaining({
          requests: expect.any(Number),
          errors: expect.any(Number),
        }),
      });
      expect(body.storage.artifacts).toBeGreaterThanOrEqual(1);
      expect(body.storage.artifact_bytes).toBeGreaterThanOrEqual(42);
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

function makeStoredZip(entries: Array<{ path: string; content: string; declaredSize?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const declaredSize = entry.declaredSize ?? content.length;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(declaredSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + content.length;
  }

  const local = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, central, eocd]);
}
