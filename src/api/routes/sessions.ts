/**
 * CMA-compatible Session Routes
 *
 * POST /v1/sessions          — create session
 * GET  /v1/sessions          — list sessions (paginated)
 * GET  /v1/sessions/:id      — get session detail
 * POST /v1/sessions/:id/events — send events
 * GET  /v1/sessions/:id/events — list events (paginated)
 * POST /v1/sessions/:id/stop — stop session
 * DELETE /v1/sessions/:id    — delete session
 */

import { Hono } from 'hono';
import type { ServerDeps } from '../server.js';

export function sessionsRoutes(deps: ServerDeps) {
  const app = new Hono();
  const { sessionManager } = deps;

  // POST / — Create session
  app.post('/', async (c) => {
    const body = await c.req.json();
    const { agent, environment_id, context_id, title, metadata } = body;

    if (!agent) {
      return c.json({ error: { type: 'invalid_request', message: 'agent field is required' } }, 400);
    }

    try {
      const session = sessionManager.create({
        agent,
        environmentId: environment_id,
        contextId: context_id,
        title,
        metadata,
      });
      return c.json({ type: 'session', ...sessionToResponse(session) }, 201);
    } catch (err) {
      return c.json({ error: { type: 'internal_error', message: String(err) } }, 500);
    }
  });

  // GET / — List sessions
  app.get('/', (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
    const rawLimit = parseInt(c.req.query('limit') ?? '20', 10) || 20;
    const pageSize = Math.min(1000, Math.max(1, rawLimit)); // cap at 1000
    const status = c.req.query('status') as any;

    const result = sessionManager.list({ page, pageSize, status });
    return c.json({
      data: result.data.map(sessionToResponse),
      has_more: result.hasMore,
      total: result.total,
    });
  });

  // GET /:id — Get session detail
  app.get('/:id', (c) => {
    const session = sessionManager.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    return c.json({ type: 'session', ...sessionToResponse(session) });
  });

  // POST /:id/events — Send events
  app.post('/:id/events', async (c) => {
    const sessionId = c.req.param('id');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }

    const events = Array.isArray(body.events) ? body.events : [body];

    // Validate every event carries a string `type` before touching the log
    for (const event of events) {
      if (!event || typeof event !== 'object' || typeof event.type !== 'string' || event.type.length === 0) {
        return c.json(
          {
            error: {
              type: 'invalid_request',
              message: 'Each event must be an object with a non-empty string "type" field',
            },
          },
          400,
        );
      }
      if (!event.type.startsWith('user.')) {
        return c.json(
          {
            error: {
              type: 'invalid_request',
              message: `Only user.* events can be sent to a session (got "${event.type}")`,
            },
          },
          400,
        );
      }
    }

    // Pre-flight: reject the whole batch up-front if the session is missing or
    // terminal, so we don't partially apply (L4). sendEvent still re-checks.
    const session = sessionManager.get(sessionId);
    if (!session) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    if (['completed', 'failed'].includes(session.status)) {
      return c.json({ error: { type: 'conflict', message: `Session ${sessionId} is in terminal state: ${session.status}` } }, 409);
    }

    try {
      for (const event of events) {
        await sessionManager.sendEvent(sessionId, event);
      }
      return c.json({ accepted: true });
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return c.json({ error: { type: 'not_found', message: err.message } }, 404);
      }
      if (err.message?.includes('terminal state')) {
        return c.json({ error: { type: 'conflict', message: err.message } }, 409);
      }
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  // GET /:id/events — List events (paginated)
  app.get('/:id/events', (c) => {
    const sessionId = c.req.param('id');

    // 404 if session does not exist (CMA clients expect this)
    if (!sessionManager.get(sessionId)) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }

    const rawLimit = parseInt(c.req.query('limit') ?? '1000', 10) || 1000;
    const limit = Math.min(1000, Math.max(1, rawLimit));
    const afterSeq = c.req.query('after_seq')
      ? parseInt(c.req.query('after_seq')!, 10)
      : undefined;

    const eventLogger = sessionManager.getEventLogger();
    const events = eventLogger.getEvents(sessionId, afterSeq);
    const limited = events.slice(0, limit);

    return c.json({
      data: limited.map((e) => ({
        id: e.id,
        seq: e.seq,
        type: e.type,
        content: e.content ?? null,
        processed_at: e.processedAt?.toISOString() ?? null,
        parent_event_id: e.parentEventId ?? null,
      })),
      has_more: events.length > limited.length,
    });
  });

  // POST /:id/stop — Stop session
  app.post('/:id/stop', async (c) => {
    const sessionId = c.req.param('id');
    try {
      await sessionManager.stop(sessionId);
      return c.json({ status: 'stopped' });
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return c.json({ error: { type: 'not_found', message: err.message } }, 404);
      }
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  // DELETE /:id — Delete session (logical delete; Event_Log retained per R9.8)
  app.delete('/:id', async (c) => {
    const sessionId = c.req.param('id');
    if (!sessionManager.get(sessionId)) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    await sessionManager.delete(sessionId);
    return c.json({ id: sessionId, deleted: true });
  });

  return app;
}

function sessionToResponse(session: any) {
  return {
    id: session.id,
    agent_id: session.agentId,
    agent_name: session.agentName,
    environment_id: session.environmentId,
    status: session.status,
    title: session.title ?? null,
    context_id: session.contextId ?? null,
    metadata: session.metadata ?? null,
    created_at: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    updated_at: session.updatedAt instanceof Date ? session.updatedAt.toISOString() : session.updatedAt,
  };
}
