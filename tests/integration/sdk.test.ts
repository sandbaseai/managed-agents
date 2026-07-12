/**
 * Integration test: the client SDK against a real in-process server (D1).
 *
 * Starts the Hono app via @hono/node-server on a random port and drives it
 * through ManagedAgentsClient (create/list/get/sendMessage/events/tail/stop).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager, type SessionExecutor } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';
import { ManagedAgentsClient } from '@/sdk/client.js';

describe('Client SDK', () => {
  let server: ServerType;
  let db: Database;
  let tmpDir: string;
  let client: ManagedAgentsClient;
  let port: number;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-sdk-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_echo', 'echo', '{}')`);

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
      sessionManager,
      agents: [{ name: 'echo', model: 'm', system_prompt: 'p' }],
      reloadAgents: () => ({ agents: [], errors: [] }),
    });

    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) => {
        port = info.port;
        resolve();
      });
    });

    client = new ManagedAgentsClient({ baseUrl: `http://localhost:${port}` });
  });

  afterAll(() => {
    server?.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists agents', async () => {
    const { data } = await client.agents.list();
    expect(data.map((a) => a.name)).toContain('echo');
  });

  it('creates and gets a session', async () => {
    const s = await client.sessions.create({ agent: 'echo' });
    expect(s.id).toMatch(/^sess_/);
    const got = await client.sessions.get(s.id);
    expect(got.id).toBe(s.id);
  });

  it('sends a message and reads the persisted event log back', async () => {
    const s = await client.sessions.create({ agent: 'echo' });
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
    const s = await client.sessions.create({ agent: 'echo' });
    const ack = await client.sessions.message(s.id, 'hi via messages', { stream: false });
    expect(ack.accepted).toBe(true);

    await new Promise((r) => setTimeout(r, 60));
    const { data } = await client.sessions.events(s.id);
    expect(data.map((e) => e.type)).toContain('user.message');
  });

  it('streams a message through the convenience endpoint', async () => {
    const s = await client.sessions.create({ agent: 'echo' });
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
    const s = await client.sessions.create({ agent: 'echo' });

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
    const s = await client.sessions.create({ agent: 'echo' });
    const res = await client.sessions.stop(s.id);
    expect(res.status).toBe('stopped');
  });

  it('throws ManagedAgentsApiError on 404', async () => {
    await expect(client.sessions.get('sess_nope')).rejects.toThrow(/API error 404/);
  });
});
