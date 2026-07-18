/**
 * Session Routes
 *
 * POST /v1/sessions          - create session
 * GET  /v1/sessions          - list sessions (paginated)
 * GET  /v1/sessions/:id      - get session detail
 * POST /v1/sessions/:id/events - send events
 * GET  /v1/sessions/:id/events - list events (paginated)
 * POST /v1/sessions/:id/stop - stop session
 * DELETE /v1/sessions/:id    - delete session
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServerDeps } from '../server.js';
import type { SessionEvent } from '@/types/session.js';
import type { AgentDefinition } from '@/types/agent.js';
import { pageOf, toApiEvent, toApiSession } from '../standard.js';
import { loadAgentDefinitionById } from '@/core/agent/store.js';
import {
  memoryScopeFromResources,
  normalizeAgentRef,
  normalizeEnvironmentId,
  normalizeMessageContent,
  normalizeResources,
  normalizeVaultIds,
} from './session-normalizers.js';
import { createSessionEventQueue, isMessageStreamTerminalEvent } from './session-stream.js';

export function sessionsRoutes(deps: ServerDeps) {
  const app = new Hono();
  const { sessionManager } = deps;

  // POST / - Create session
  app.post('/', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, 'Request body must be valid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return invalid(c, 'Request body must be an object');
    }
    const { agent, environment_id, title, metadata } = body;
    const agentIdValue = normalizeAgentRef(agent);
    const environment = normalizeEnvironmentId(deps, environment_id);
    const resources = normalizeResources(deps, body.resources);
    const vaultIds = normalizeVaultIds(deps, body.vault_ids);

    if (!agentIdValue) {
      return invalid(c, 'agent field is required');
    }
    if (!agentIdValue.startsWith('agent_')) {
      return invalid(c, 'agent must be a standard agent id');
    }
    if (!environment.ok) return invalid(c, environment.message);
    if (!resources.ok) return invalid(c, resources.message);
    if (!vaultIds.ok) return invalid(c, vaultIds.message);

    try {
      const session = sessionManager.create({
        agent: agentIdValue,
        environmentId: environment.value,
        title,
        resources: resources.value,
        vaultIds: vaultIds.value,
        contextId: memoryScopeFromResources(resources.value),
        metadata,
      });
      return c.json(toApiSession(session, findAgentById(deps, session.agentId)), 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Agent not found')) {
        return c.json({ error: { type: 'not_found', message: err.message } }, 404);
      }
      return c.json({ error: { type: 'internal_error', message: String(err) } }, 500);
    }
  });

  // GET / - List sessions
  app.get('/', (c) => {
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
    const rawLimit = parseInt(c.req.query('limit') ?? '20', 10) || 20;
    const pageSize = Math.min(1000, Math.max(1, rawLimit)); // cap at 1000
    const status = c.req.query('status');
    const agentIdFilter = c.req.query('agent_id');

    const result = sessionManager.list({
      page,
      pageSize,
      ...(agentIdFilter ? { agentId: agentIdFilter } : {}),
      ...internalStatusFilter(status),
    });
    const sessions = result.data.map((session) => toApiSession(session, findAgentById(deps, session.agentId)));
    return c.json(pageOf(sessions, result.hasMore));
  });

  // GET /:id - Get session detail
  app.get('/:id', (c) => {
    const session = sessionManager.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    return c.json(toApiSession(session, findAgentById(deps, session.agentId)));
  });

  // POST /:id/events - Send events
  app.post('/:id/events', async (c) => {
    const sessionId = c.req.param('id');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }

    const events = Array.isArray(body.events) ? body.events : null;
    if (!events) {
      return c.json({ error: { type: 'invalid_request', message: 'events must be an array' } }, 400);
    }

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

  // POST /:id/messages - Send a user.message and optionally stream the turn.
  app.post('/:id/messages', async (c) => {
    const sessionId = c.req.param('id');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { type: 'invalid_request', message: 'Request body must be valid JSON' } }, 400);
    }

    const content = normalizeMessageContent(body && typeof body === 'object' ? body.content : undefined);
    if (!content) {
      return c.json(
        {
          error: {
            type: 'invalid_request',
            message: 'content must be a string or an array of content blocks',
          },
        },
        400,
      );
    }

    const session = sessionManager.get(sessionId);
    if (!session) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    if (['completed', 'failed'].includes(session.status)) {
      return c.json({ error: { type: 'conflict', message: `Session ${sessionId} is in terminal state: ${session.status}` } }, 409);
    }

    const event = { type: 'user.message' as const, content };
    const shouldStream = body && typeof body === 'object' ? body.stream !== false : true;

    if (!shouldStream) {
      try {
        await sessionManager.sendEvent(sessionId, event);
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
    }

    return streamSSE(c, async (stream) => {
      let closed = false;
      const events = createSessionEventQueue();

      const unsubscribe = sessionManager.subscribe(sessionId, events.push);
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        events.push(undefined);
      });

      const writeEvent = async (sessionEvent: SessionEvent) => {
        const transient = sessionEvent.seq === 0;
        await stream.writeSSE({
          ...(transient ? {} : { id: sessionEvent.id }),
          event: sessionEvent.type,
          data: JSON.stringify(toApiEvent(sessionEvent)),
        });
      };

      try {
        await sessionManager.sendEvent(sessionId, event);

        while (!closed) {
          const sessionEvent = await events.next();
          if (!sessionEvent) break;
          await writeEvent(sessionEvent);

          if (isMessageStreamTerminalEvent(sessionEvent)) {
            break;
          }
        }
      } catch (err: any) {
        await stream.writeSSE({
          event: 'session.error',
          data: JSON.stringify({
            type: 'session.error',
            content: [{ type: 'text', text: err.message ?? String(err) }],
          }),
        });
      } finally {
        closed = true;
        unsubscribe();
      }
    });
  });

  // GET /:id/events - List events (paginated)
  app.get('/:id/events', (c) => {
    const sessionId = c.req.param('id');

    // 404 if session does not exist.
    if (!sessionManager.get(sessionId)) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }

    const rawLimit = parseInt(c.req.query('limit') ?? '1000', 10) || 1000;
    const limit = Math.min(1000, Math.max(1, rawLimit));
    const afterId = c.req.query('after_id');

    const eventLogger = sessionManager.getEventLogger();
    const allEvents = eventLogger.getEvents(sessionId);
    const start = afterId ? allEvents.findIndex((event) => event.id === afterId) + 1 : 0;
    const events = start > 0 ? allEvents.slice(start) : allEvents;
    const limited = events.slice(0, limit);

    return c.json(pageOf(limited.map(toApiEvent), events.length > limited.length));
  });

  // POST /:id/stop - Stop session
  app.post('/:id/stop', async (c) => {
    const sessionId = c.req.param('id');
    try {
      await sessionManager.stop(sessionId);
      return c.json({ id: sessionId, status: 'terminated' });
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        return c.json({ error: { type: 'not_found', message: err.message } }, 404);
      }
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  // DELETE /:id - Delete session (logical delete; Event_Log retained per R9.8)
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

function internalStatusFilter(status: string | undefined) {
  switch (status) {
    case undefined:
    case '':
    case 'all':
      return {};
    case 'running':
      return { status: 'running' as const };
    case 'failed':
      return { status: 'failed' as const };
    case 'terminated':
      return { status: 'completed' as const };
    case 'idle':
      return { status: 'queued' as const };
    default:
      return {};
  }
}

function findAgentById(deps: ServerDeps, id: string): AgentDefinition | undefined {
  return loadAgentDefinitionById(deps.db, id);
}

function invalid(c: any, message: string): Response {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}
