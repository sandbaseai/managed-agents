import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { dispatchWebhookEvent, retryDueWebhookDeliveries } from '@/core/operations/webhook-dispatcher.js';

describe('webhook dispatcher', () => {
  let db: Database;
  let tmpDir: string;
  const fixedNow = new Date('2026-07-23T00:00:00.000Z');

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-whd-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dispatches matching webhooks and stores signed delivered records', async () => {
    db.prepare(
      `INSERT INTO webhooks (id, name, url, events, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('wh_ok', 'OK', 'https://example.com/hook', JSON.stringify(['session.*']), fixedNow.toISOString(), fixedNow.toISOString());
    const fetchImpl = vi.fn(async () => ({ status: 204 })) as unknown as typeof fetch;

    const results = await dispatchWebhookEvent(db, {
      event: 'session.status_running',
      data: { session_id: 'sess_1' },
    }, { secret: 'secret', fetchImpl, now: () => fixedNow });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = (fetchImpl as any).mock.calls[0];
    expect(String(init.body)).toContain('session.status_running');
    expect(init.headers['X-Managed-Agents-Signature']).toMatch(/^sha256=/);
    expect(results[0]).toMatchObject({
      webhook_id: 'wh_ok',
      status: 'delivered',
      status_code: 204,
      attempt_count: 1,
      next_retry_at: null,
    });
  });

  it('queues failed deliveries for retry and later marks them delivered', async () => {
    db.prepare(
      `INSERT INTO webhooks (id, name, url, events, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('wh_retry', 'Retry', 'https://example.com/retry', JSON.stringify(['turn_complete']), fixedNow.toISOString(), fixedNow.toISOString());
    const failingFetch = vi.fn(async () => ({ status: 503 })) as unknown as typeof fetch;

    const first = await dispatchWebhookEvent(db, {
      event: 'turn_complete',
      data: { ok: false },
    }, { secret: 'secret', fetchImpl: failingFetch, now: () => fixedNow });

    expect(first[0]).toMatchObject({
      status: 'pending_retry',
      status_code: 503,
      attempt_count: 1,
    });
    expect(first[0].next_retry_at).toBe('2026-07-23T00:01:00.000Z');

    const successfulFetch = vi.fn(async () => ({ status: 200 })) as unknown as typeof fetch;
    const retried = await retryDueWebhookDeliveries(db, {
      secret: 'secret',
      fetchImpl: successfulFetch,
      now: () => new Date('2026-07-23T00:02:00.000Z'),
    });

    expect(successfulFetch).toHaveBeenCalledOnce();
    expect(retried[0]).toMatchObject({
      status: 'delivered',
      status_code: 200,
      attempt_count: 2,
      next_retry_at: null,
    });
  });
});
