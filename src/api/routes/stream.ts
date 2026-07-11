/**
 * SSE Streaming Route
 *
 * GET /v1/sessions/:id/events/stream — Server-Sent Events endpoint
 *
 * Resume support: the client may pass `Last-Event-ID` header (or `last_event_id`
 * query param) carrying the last seq it saw. On connect we backfill all stored
 * events with seq > lastSeq, then switch to live events — deduping by seq so an
 * event that lands between backfill and live subscription is never sent twice
 * or dropped (OMA consolidation pattern).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { SessionEvent } from '@/types/session.js';
import type { ServerDeps } from '../server.js';

export function streamRoutes(deps: ServerDeps) {
  const app = new Hono();
  const { sessionManager } = deps;

  // GET /:id/events/stream — SSE stream
  app.get('/:id/events/stream', (c) => {
    const sessionId = c.req.param('id');
    const session = sessionManager.get(sessionId);

    if (!session) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }

    // Parse resume cursor from Last-Event-ID header or query param
    const lastEventIdRaw =
      c.req.header('Last-Event-ID') ?? c.req.query('last_event_id') ?? '';
    const lastSeq = parseInt(lastEventIdRaw, 10);
    const resumeFromSeq = Number.isFinite(lastSeq) ? lastSeq : 0;

    return streamSSE(c, async (stream) => {
      let closed = false;
      let maxEmittedSeq = resumeFromSeq;

      // Buffer live events that arrive during backfill so nothing is lost.
      const liveBuffer: SessionEvent[] = [];
      let backfilling = true;

      const writeEvent = async (event: SessionEvent) => {
        // Transient streaming events (seq === 0) are broadcast-only: they are
        // never persisted, don't advance the resume cursor, and skip dedup.
        const transient = event.seq === 0;
        if (!transient) {
          if (event.seq <= maxEmittedSeq) return; // dedup persisted events
          maxEmittedSeq = event.seq;
        }
        await stream.writeSSE({
          ...(transient ? {} : { id: String(event.seq) }),
          event: event.type,
          data: JSON.stringify({
            id: event.id,
            seq: event.seq,
            type: event.type,
            content: event.content ?? null,
            // pass through streaming fields (delta / message_id) when present
            ...(('delta' in event) ? { delta: (event as any).delta } : {}),
            ...(('message_id' in event) ? { message_id: (event as any).message_id } : {}),
            processed_at: event.processedAt?.toISOString() ?? null,
            parent_event_id: event.parentEventId ?? null,
          }),
        });
      };

      // Subscribe first — while backfilling, buffer; after, write directly.
      const unsubscribe = sessionManager.subscribe(sessionId, (event) => {
        if (closed) return;
        if (backfilling) {
          liveBuffer.push(event);
        } else {
          void writeEvent(event).catch(() => {
            closed = true;
          });
        }
      });

      // Backfill stored events with seq > resumeFromSeq
      try {
        const stored = sessionManager
          .getEventLogger()
          .getEvents(sessionId, resumeFromSeq > 0 ? resumeFromSeq : undefined);
        for (const event of stored) {
          if (closed) break;
          await writeEvent(event);
        }
      } catch {
        // Backfill best-effort; continue to live
      }

      // Flush any events buffered during backfill, then go live
      backfilling = false;
      for (const event of liveBuffer) {
        if (closed) break;
        await writeEvent(event);
      }
      liveBuffer.length = 0;

      // Periodic heartbeat to keep the connection alive
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
          closed = true;
          clearInterval(heartbeat);
        });
      }, 15_000);

      // Clean up on client disconnect
      stream.onAbort(() => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Hold the stream open until aborted
      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return app;
}
