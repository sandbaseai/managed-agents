/**
 * Self-Hosted Worker Routes (R9.14)
 *
 * A user-run Worker polls these endpoints to claim pending tool-execution work
 * items and post results back. The Worker executes the actual commands on the
 * user's own infrastructure — the server never runs them.
 *
 *   POST /v1/x/worker/claim     { worker_id, session_id? } → work item | 204
 *   POST /v1/x/worker/complete  { id, worker_id, result, failed? } → { ok: true }
 */

import { Hono } from 'hono';
import type { WorkQueue } from '@/sandbox/self-hosted-provider.js';

export function workerRoutes(queue: WorkQueue) {
  const app = new Hono();

  app.post('/claim', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const workerId = body.worker_id;
    if (!workerId || typeof workerId !== 'string') {
      return c.json({ error: { type: 'invalid_request', message: 'worker_id is required' } }, 400);
    }
    const item = queue.claim(workerId, body.session_id);
    if (!item) return c.body(null, 204);
    return c.json(item);
  });

  app.post('/complete', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.id || typeof body.id !== 'string' || !body.worker_id || typeof body.worker_id !== 'string') {
      return c.json({ error: { type: 'invalid_request', message: 'id and worker_id are required' } }, 400);
    }
    const outcome = queue.complete(body.id, body.worker_id, body.result, body.failed === true);
    if (outcome === 'not_found') {
      return c.json({ error: { type: 'not_found', message: 'work item not found' } }, 404);
    }
    if (outcome === 'not_claimed_by_worker') {
      return c.json({ error: { type: 'conflict', message: 'work item is not claimed by this worker' } }, 409);
    }
    return c.json({ ok: true });
  });

  return app;
}
