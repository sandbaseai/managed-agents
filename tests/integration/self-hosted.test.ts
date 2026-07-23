/**
 * Integration test: self_hosted sandbox work-queue (R9.14).
 *
 * Verifies the enqueue → claim → complete → await round-trip, provider
 * dispatch, and the worker HTTP endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Database } from '@/core/db/database.js';
import { WorkQueue, SelfHostedSandboxProvider } from '@/sandbox/self-hosted-provider.js';
import { workerRoutes } from '@/api/routes/worker.js';

describe('WorkQueue', () => {
  let db: Database;
  let queue: WorkQueue;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-sh-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    queue = new WorkQueue(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enqueue → claim → complete → await round-trip', async () => {
    const id = queue.enqueue('sess_1', 'exec', { command: 'echo hi' });

    // A worker claims it
    const claimed = queue.claim('worker_1');
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(id);
    expect(claimed!.kind).toBe('exec');
    expect(claimed!.payload.command).toBe('echo hi');

    // Worker completes it
    queue.complete(id, { exitCode: 0, stdout: 'hi', stderr: '', timedOut: false });

    // Server awaits the result
    const result = await queue.await(id, { timeoutMs: 1000, pollMs: 10 });
    expect((result as any).stdout).toBe('hi');
  });

  it('claim returns null when the queue is empty', () => {
    expect(queue.claim('w')).toBeNull();
  });

  it('claims oldest-first (FIFO)', () => {
    const a = queue.enqueue('s', 'read', { path: 'a' });
    const b = queue.enqueue('s', 'read', { path: 'b' });
    expect(queue.claim('w')!.id).toBe(a);
    expect(queue.claim('w')!.id).toBe(b);
  });

  it('never double-claims a single item across workers (H2)', () => {
    const id = queue.enqueue('s', 'exec', { command: 'x' });
    // Two workers race to claim the single pending item
    const first = queue.claim('worker_a');
    const second = queue.claim('worker_b');
    // Exactly one wins; the other sees an empty queue
    const claimedIds = [first, second].filter(Boolean).map((i) => i!.id);
    expect(claimedIds).toEqual([id]);
    expect([first, second].filter((x) => x === null)).toHaveLength(1);
  });

  it('can scope claims to a session', () => {
    queue.enqueue('s1', 'read', { path: 'x' });
    const forS2 = queue.enqueue('s2', 'read', { path: 'y' });
    const claimed = queue.claim('w', 's2');
    expect(claimed!.id).toBe(forS2);
  });

  it('await rejects on failed items', async () => {
    const id = queue.enqueue('s', 'exec', { command: 'bad' });
    queue.complete(id, 'boom', true);
    await expect(queue.await(id, { timeoutMs: 500, pollMs: 10 })).rejects.toThrow(/failed/);
  });

  it('await times out if never completed', async () => {
    const id = queue.enqueue('s', 'exec', { command: 'slow' });
    await expect(queue.await(id, { timeoutMs: 60, pollMs: 10 })).rejects.toThrow(/timed out/);
  });
});

describe('SelfHostedSandboxProvider', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-shp-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dispatches execute() to the queue and returns the worker result', async () => {
    const queue = new WorkQueue(db);
    const provider = new SelfHostedSandboxProvider(queue);
    const sandbox = await provider.provision('sess_x', { name: 'sh', sandbox_provider: 'self_hosted', timeout: 5 });

    // Simulate a worker in the background
    const workerLoop = (async () => {
      for (let i = 0; i < 50; i++) {
        const item = queue.claim('w1', 'sess_x');
        if (item) {
          queue.complete(item.id, { exitCode: 0, stdout: 'from worker', stderr: '', timedOut: false });
          return;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    })();

    const result = await sandbox.execute('echo test');
    await workerLoop;
    expect(result.stdout).toBe('from worker');
  });
});

describe('Worker HTTP endpoints', () => {
  let db: Database;
  let tmpDir: string;
  let app: ReturnType<typeof workerRoutes>;
  let queue: WorkQueue;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-shw-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    queue = new WorkQueue(db);
    app = workerRoutes(queue);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('claim returns 204 when empty, then the item once enqueued', async () => {
    const empty = await app.request('/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'w1' }),
    });
    expect(empty.status).toBe(204);

    queue.enqueue('s', 'read', { path: 'f' });
    const res = await app.request('/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'w1' }),
    });
    expect(res.status).toBe(200);
    const item = await res.json();
    expect(item.kind).toBe('read');
  });

  it('claim rejects without worker_id', async () => {
    const res = await app.request('/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('complete marks the item done', async () => {
    const id = queue.enqueue('s', 'read', { path: 'f' });
    queue.claim('w1');
    const res = await app.request('/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, result: 'file contents' }),
    });
    expect(res.status).toBe(200);
    expect(queue.get(id)!.status).toBe('done');
  });

  it('scopes claims to an environment worker key and records last seen', async () => {
    app = workerRoutes(queue, db);
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_a', 'A', '{}'), ('env_b', 'B', '{}')`);
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_a', 'agent-a', '{}')`);
    db.exec(`
      INSERT INTO sessions (id, agent_id, agent_name, environment_id, status)
      VALUES ('sess_a', 'agent_a', 'agent-a', 'env_a', 'idle'),
             ('sess_b', 'agent_a', 'agent-a', 'env_b', 'idle')
    `);
    const secret = 'mawk_test_worker_key';
    db.prepare(
      `INSERT INTO environment_worker_keys (id, environment_id, name, key_hash, key_prefix)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('wrkkey_a', 'env_a', 'Worker A', createHash('sha256').update(secret).digest('hex'), 'mawk_test…key');
    const itemA = queue.enqueue('sess_a', 'read', { path: 'a.txt' });
    const itemB = queue.enqueue('sess_b', 'read', { path: 'b.txt' });

    const res = await app.request('/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'worker_a', environment_key: secret }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(itemA);
    expect(queue.get(itemA)?.status).toBe('claimed');
    expect(queue.get(itemB)?.status).toBe('pending');
    const key = db.prepare('SELECT last_seen_at FROM environment_worker_keys WHERE id = ?').get('wrkkey_a') as { last_seen_at: string | null };
    expect(key.last_seen_at).toBeTruthy();
  });

  it('rejects revoked environment worker keys', async () => {
    app = workerRoutes(queue, db);
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_a', 'A', '{}')`);
    const secret = 'mawk_revoked_worker_key';
    db.prepare(
      `INSERT INTO environment_worker_keys (id, environment_id, name, key_hash, key_prefix, status, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run('wrkkey_revoked', 'env_a', 'Revoked', createHash('sha256').update(secret).digest('hex'), 'mawk_revo…key', 'revoked');

    const res = await app.request('/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: 'worker_a', environment_key: secret }),
    });
    expect(res.status).toBe(401);
  });
});
