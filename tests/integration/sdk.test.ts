/**
 * Integration test: the client SDK against a real in-process server (D1).
 *
 * Starts the Hono app via @hono/node-server on a random port and drives it
 * through ManagedAgentsClient (create/list/get/sendMessage/events/tail/stop).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager, type SessionExecutor } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';
import { ManagedAgentsClient } from '@/sdk/client.js';

describe('Client SDK', () => {
  let db: Database;
  let tmpDir: string;
  let dataDir: string;
  let client: ManagedAgentsClient;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-sdk-'));
    dataDir = join(tmpDir, '.managed-agents');
    mkdirSync(dataDir, { recursive: true });
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    db.prepare('INSERT INTO agents (id, name, definition) VALUES (?, ?, ?)').run(
      'agent_echo',
      'echo',
      JSON.stringify({ name: 'echo', model: 'm', system: 'p' }),
    );

    const sessionManager = new SessionManager(db);
    // Executor that emits one agent.message then lets the session go idle
    const executor: SessionExecutor = {
      // eslint-disable-next-line require-yield
      async *execute(session, _event, options) {
        options?.broadcast?.({
          id: 'e1', sessionId: session.id, seq: 100, type: 'agent.message',
          content: [{ type: 'text', text: 'hello from agent' }], createdAt: new Date(),
        });
        return;
      },
      async cleanupSession() {},
    };
    sessionManager.setExecutor(executor);

    const app = createServer({
      db,
      sessionManager,
      agents: [{ name: 'echo', model: 'm', system: 'p' }],
      reloadAgents: () => ({ agents: [], errors: [] }),
      workspace: {
        root: tmpDir,
        dataDir,
        agentsDir: join(tmpDir, 'agents'),
        skillsDir: join(tmpDir, 'skills'),
        configPath: join(tmpDir, 'managed-agents.config.yaml'),
        target: 'local',
      },
    });

    client = new ManagedAgentsClient({
      baseUrl: 'http://managed-agents.test',
      fetch: (input, init) => {
        const url = new URL(input.toString());
        return app.request(`${url.pathname}${url.search}`, init);
      },
    });
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists agents', async () => {
    const { data } = await client.agents.list();
    expect(data.map((a) => a.name)).toContain('echo');
  });

  it('creates, versions, and archives agents', async () => {
    const created = await client.agents.create({
      name: 'sdk-agent',
      model: 'm',
      system: 'hello from sdk',
    });
    expect(created.id).toMatch(/^agent_/);

    const updated = await client.agents.update(created.id, {
      system: 'updated from sdk',
      expected_version: created.version,
    });
    expect(updated.version).toBe(created.version + 1);

    const versions = await client.agents.versions(created.id);
    expect(versions.data.length).toBeGreaterThanOrEqual(2);

    const archived = await client.agents.archive(created.id);
    expect(archived.status).toBe('archived');
  });

  it('creates and gets a session', async () => {
    const s = await client.sessions.create({ agent: 'agent_echo' });
    expect(s.id).toMatch(/^sess_/);
    const got = await client.sessions.get(s.id);
    expect(got.id).toBe(s.id);
  });

  it('sends a message and reads the persisted event log back', async () => {
    const s = await client.sessions.create({ agent: 'agent_echo' });
    const ack = await client.sessions.sendMessage(s.id, 'hi there');
    expect(ack.accepted).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    const { data } = await client.sessions.events(s.id);
    const types = data.map((e) => e.type);
    // user.message is persisted; the mock executor only broadcasts its reply
    // (transient), so the agent.message is asserted via tail() below.
    expect(types).toContain('user.message');
  });

  it('sends a message through the convenience endpoint without streaming', async () => {
    const s = await client.sessions.create({ agent: 'agent_echo' });
    const ack = await client.sessions.message(s.id, 'hi via messages', { stream: false });
    expect(ack.accepted).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    const { data } = await client.sessions.events(s.id);
    expect(data.map((e) => e.type)).toContain('user.message');
  });

  it('streams a message through the convenience endpoint', async () => {
    const s = await client.sessions.create({ agent: 'agent_echo' });
    const received: string[] = [];

    for await (const ev of client.sessions.message(s.id, 'go via messages')) {
      received.push(ev.type);
      if (ev.type === 'session.status_idle') break;
    }

    expect(received).toContain('user.message');
    expect(received).toContain('agent.message');
    expect(received).toContain('session.status_idle');
  });

  it('tails the live stream and receives the agent reply', async () => {
    const s = await client.sessions.create({ agent: 'agent_echo' });

    const received: string[] = [];
    const streamPromise = (async () => {
      for await (const ev of client.sessions.tail(s.id)) {
        received.push(ev.type);
        if (ev.type === 'session.status_idle') break;
      }
    })();

    // Give the stream a moment to open, then send
    await new Promise((r) => setTimeout(r, 50));
    await client.sessions.sendMessage(s.id, 'go');

    await Promise.race([
      streamPromise,
      new Promise((r) => setTimeout(r, 2000)),
    ]);

    expect(received).toContain('agent.message');
  });

  it('stops a session', async () => {
    const s = await client.sessions.create({ agent: 'agent_echo' });
    const res = await client.sessions.stop(s.id);
    expect(res.status).toBe('terminated');
  });

  it('manages files and session artifacts', async () => {
    const file = await client.files.create({ name: 'notes.txt', content: 'hello file' });
    expect(file.id).toMatch(/^file_/);
    await expect(client.files.text(file.id)).resolves.toBe('hello file');
    const files = await client.files.list();
    expect(files.data.map((item) => item.id)).toContain(file.id);

    const s = await client.sessions.create({ agent: 'agent_echo' });
    const artifact = await client.sessions.createArtifact(s.id, {
      path: '/artifacts/report.txt',
      content: 'hello artifact',
    });
    expect(artifact.artifact_path).toBe('/artifacts/report.txt');
    await expect(client.sessions.artifactText(s.id, artifact.id)).resolves.toBe('hello artifact');
    const artifacts = await client.sessions.artifacts(s.id);
    expect(artifacts.data.map((item) => item.id)).toContain(artifact.id);

    const archived = await client.files.delete(file.id);
    expect(archived.status).toBe('archived');
  });

  it('creates and deletes API keys', async () => {
    const key = await client.apiKeys.create({ name: 'SDK key' });
    expect(key.secret_key).toMatch(/^ma_/);
    const keys = await client.apiKeys.list();
    expect(keys.data.map((item) => item.id)).toContain(key.id);
    await expect(client.apiKeys.delete(key.id)).resolves.toMatchObject({ id: key.id, type: 'api_key_deleted' });
  });

  it('reads metrics helpers', async () => {
    await expect(client.metrics.prometheus()).resolves.toContain('metrics');
    const summary = await client.metrics.summary();
    expect(summary).toMatchObject({
      type: 'metrics_summary',
      sessions: expect.objectContaining({ total: expect.any(Number) }),
    });
  });

  it('throws ManagedAgentsApiError on 404', async () => {
    await expect(client.sessions.get('sess_nope')).rejects.toThrow(/API error 404/);
  });
});
