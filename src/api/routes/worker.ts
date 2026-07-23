/**
 * Self-Hosted Worker Routes (R9.14)
 *
 * A user-run Worker polls these endpoints to claim pending tool-execution work
 * items and post results back. The Worker executes the actual commands on the
 * user's own infrastructure — the server never runs them.
 *
 *   POST /v1/x/worker/claim     { worker_id, session_id? } → work item | 204
 *   POST /v1/x/worker/complete  { id, result, failed? }    → { ok: true }
 */

import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type { Database } from '@/core/db/database.js';
import type { WorkQueue } from '@/sandbox/self-hosted-provider.js';

export function workerRoutes(queue: WorkQueue, db?: Database) {
  const app = new Hono();

  app.post('/claim', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const workerId = body.worker_id;
    if (!workerId || typeof workerId !== 'string') {
      return c.json({ error: { type: 'invalid_request', message: 'worker_id is required' } }, 400);
    }
    const auth = db ? validateEnvironmentKey(db, body.environment_key) : { ok: true as const, environmentId: undefined };
    if (!auth.ok) return c.json({ error: { type: 'unauthorized', message: auth.message } }, 401);
    const requestedEnvironmentId = typeof body.environment_id === 'string' ? body.environment_id : undefined;
    if (auth.environmentId && requestedEnvironmentId && requestedEnvironmentId !== auth.environmentId) {
      return c.json({ error: { type: 'invalid_request', message: 'environment_id does not match environment_key scope' } }, 400);
    }
    const item = queue.claim(
      workerId,
      typeof body.session_id === 'string' ? body.session_id : undefined,
      auth.environmentId ?? requestedEnvironmentId,
    );
    if (!item) return c.body(null, 204);
    return c.json(item);
  });

  app.post('/complete', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.id || typeof body.id !== 'string') {
      return c.json({ error: { type: 'invalid_request', message: 'id is required' } }, 400);
    }
    queue.complete(body.id, body.result, body.failed === true);
    return c.json({ ok: true });
  });

  return app;
}

function validateEnvironmentKey(db: Database, value: unknown): { ok: true; environmentId?: string } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') return { ok: true };
  if (typeof value !== 'string') return { ok: false, message: 'environment_key must be a string' };
  const hash = createHash('sha256').update(value, 'utf8').digest('hex');
  const row = db.prepare(
    `SELECT id, environment_id, expires_at
     FROM environment_worker_keys
     WHERE key_hash = ? AND status = 'active' AND revoked_at IS NULL`,
  ).get(hash) as { id: string; environment_id: string; expires_at: string | null } | undefined;
  if (!row) return { ok: false, message: 'Invalid environment worker key' };
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, message: 'Environment worker key has expired' };
  }
  db.prepare('UPDATE environment_worker_keys SET last_seen_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?').run(row.id);
  return { ok: true, environmentId: row.environment_id };
}
