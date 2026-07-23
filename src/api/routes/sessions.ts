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
import { existsSync, readFileSync } from 'node:fs';
import type { ServerDeps } from '../server.js';
import type { SessionEvent } from '@/types/session.js';
import type { ContentBlock } from '@/types/cma-protocol.js';
import type { AgentDefinition } from '@/types/agent.js';
import { pageOf, toApiEvent, toApiSession } from '../standard.js';
import { loadAgentDefinitionById } from '@/core/agent/store.js';
import { encryptSecret } from '@/core/security/secrets.js';
import { persistFileResource, toFileResource, type FileRow } from './resources.js';

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
    const agentRef = normalizeAgentRef(agent);
    const environment = normalizeEnvironmentId(deps, environment_id);
    const resources = normalizeResources(deps, body.resources);
    const vaultIds = normalizeVaultIds(deps, body.vault_ids);

    if (!agentRef) {
      return invalid(c, 'agent field is required');
    }
    if (!agentRef.id.startsWith('agent_')) {
      return invalid(c, 'agent must be a standard agent id');
    }
    if (!environment.ok) return invalid(c, environment.message);
    if (!resources.ok) return invalid(c, resources.message);
    if (!vaultIds.ok) return invalid(c, vaultIds.message);

    try {
      const session = sessionManager.create({
        agent: agentRef.id,
        agentVersion: agentRef.version,
        environmentId: environment.value,
        title,
        resources: resources.value,
        vaultIds: vaultIds.value,
        contextId: memoryScopeFromResources(resources.value),
        metadata,
      });
      return c.json(toApiSession(session, session.agentDefinition ?? findAgentById(deps, session.agentId)), 201);
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
    const sessions = result.data.map((session) => toApiSession(session, session.agentDefinition ?? findAgentById(deps, session.agentId)));
    return c.json(pageOf(sessions, result.hasMore));
  });

  // GET /:id - Get session detail
  app.get('/:id', (c) => {
    const session = sessionManager.get(c.req.param('id'));
    if (!session) {
      return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    }
    return c.json(toApiSession(session, session.agentDefinition ?? findAgentById(deps, session.agentId)));
  });

  app.get('/:id/artifacts', (c) => {
    const sessionId = c.req.param('id');
    if (!sessionManager.get(sessionId)) return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    const rows = deps.db.prepare(
      `SELECT *
       FROM files
       WHERE role = 'artifact' AND session_id = ? AND archived_at IS NULL
       ORDER BY created_at DESC`,
    ).all(sessionId) as unknown as FileRow[];
    return c.json(pageOf(rows.map((row) => toFileResource(row, deps))));
  });

  app.post('/:id/artifacts', async (c) => {
    const sessionId = c.req.param('id');
    if (!sessionManager.get(sessionId)) return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return invalid(c, 'Request body must be valid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(c, 'Request body must be an object');
    const artifactPath = normalizeArtifactPath(body.path);
    if (!artifactPath) return invalid(c, 'path is required and must start with /artifacts/');
    const content = typeof body.content === 'string' ? body.content : '';
    const encoding = typeof body.encoding === 'string' ? body.encoding : 'utf8';
    if (encoding !== 'utf8' && encoding !== 'base64') return invalid(c, 'encoding must be utf8 or base64');
    const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    const name = sanitizeArtifactName(body.name) ?? artifactPath.split('/').filter(Boolean).at(-1) ?? 'artifact';
    try {
      const artifact = persistFileResource(deps, {
        name,
        mediaType: typeof body.media_type === 'string' && body.media_type.trim() ? body.media_type.trim() : mediaTypeForArtifactName(name),
        bytes,
        metadata: stringRecordField(body.metadata),
        role: 'artifact',
        sessionId,
        artifactPath,
      });
      return c.json(artifact, 201);
    } catch (err: any) {
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/:id/artifacts/:artifactId/content', (c) => {
    const sessionId = c.req.param('id');
    if (!sessionManager.get(sessionId)) return c.json({ error: { type: 'not_found', message: 'Session not found' } }, 404);
    const row = deps.db.prepare(
      `SELECT *
       FROM files
       WHERE id = ? AND session_id = ? AND role = 'artifact' AND archived_at IS NULL`,
    ).get(c.req.param('artifactId'), sessionId) as FileRow | undefined;
    if (!row || !existsSync(row.storage_path)) return c.json({ error: { type: 'not_found', message: 'Artifact not found' } }, 404);
    return new Response(readFileSync(row.storage_path), {
      headers: {
        'Content-Type': row.media_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${row.name.replace(/"/g, '')}"`,
      },
    });
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
      const queue: Array<SessionEvent | undefined> = [];
      let wake: ((event: SessionEvent | undefined) => void) | undefined;

      const push = (event: SessionEvent | undefined) => {
        if (wake) {
          const resolve = wake;
          wake = undefined;
          resolve(event);
        } else {
          queue.push(event);
        }
      };

      const nextEvent = async () => {
        const hasQueued = queue.length > 0;
        const queued = queue.shift();
        if (hasQueued) return queued;
        return new Promise<SessionEvent | undefined>((resolve) => {
          wake = resolve;
        });
      };

      const unsubscribe = sessionManager.subscribe(sessionId, push);
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        push(undefined);
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
          const sessionEvent = await nextEvent();
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

function normalizeMessageContent(content: unknown): ContentBlock[] | null {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content) && content.every((block) => block && typeof block === 'object')) {
    return content as ContentBlock[];
  }
  return null;
}

function isMessageStreamTerminalEvent(event: SessionEvent): boolean {
  return (
    event.type === 'session.status_idle' ||
    event.type === 'session.status_terminated' ||
    event.type === 'session.error'
  );
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

function normalizeAgentRef(value: unknown): { id: string; version?: number } | null {
  if (typeof value === 'string' && value.length > 0) return { id: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== undefined && record.type !== 'agent') return null;
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  const version = typeof record.version === 'number' && Number.isInteger(record.version) && record.version > 0
    ? record.version
    : undefined;
  return { id: record.id, version };
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

function normalizeEnvironmentId(deps: ServerDeps, value: unknown): ValidationResult<string> {
  const id = typeof value === 'string' && value.trim() ? value.trim() : 'env_default';
  const row = deps.db.prepare('SELECT id FROM environments WHERE id = ? AND archived_at IS NULL').get(id);
  if (!row) return { ok: false, message: `Environment not found: ${id}` };
  return { ok: true, value: id };
}

function normalizeVaultIds(deps: ServerDeps, value: unknown): ValidationResult<string[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: 'vault_ids must be an array' };
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    const id = readString(item);
    if (!id) return { ok: false, message: `vault_ids[${index}] must be a credential vault id` };
    if (!ids.includes(id)) ids.push(id);
  }
  for (const id of ids) {
    const row = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ? AND archived_at IS NULL').get(id);
    if (!row) return { ok: false, message: `Credential vault not found: ${id}` };
  }
  return { ok: true, value: ids };
}

function normalizeResources(deps: ServerDeps, value: unknown): ValidationResult<Array<Record<string, unknown>>> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: 'resources must be an array' };

  const resources: Array<Record<string, unknown>> = [];
  for (const [index, resource] of value.entries()) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      return { ok: false, message: `resources[${index}] must be an object` };
    }
    const normalized = normalizeSessionResource(deps, resource as Record<string, unknown>, index);
    if (!normalized.ok) return normalized;
    resources.push(normalized.value);
  }
  return { ok: true, value: resources };
}

function normalizeSessionResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  switch (resource.type) {
    case 'file':
      return normalizeFileResource(deps, resource, index);
    case 'github_repository':
      return normalizeGithubRepositoryResource(deps, resource, index);
    case 'memory_store':
      return normalizeMemoryStoreResource(deps, resource, index);
    default:
      return { ok: false, message: `resources[${index}].type must be file, github_repository, or memory_store` };
  }
}

function normalizeFileResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  const fileId = readString(resource.file_id);
  const mountPath = readString(resource.mount_path);
  if (!fileId?.startsWith('file_')) return { ok: false, message: `resources[${index}].file_id is required` };
  if (!mountPath?.startsWith('/uploads/')) return { ok: false, message: `resources[${index}].mount_path must start with /uploads/` };
  const row = deps.db.prepare("SELECT id FROM files WHERE id = ? AND role = 'file' AND archived_at IS NULL").get(fileId);
  if (!row) return { ok: false, message: `File not found: ${fileId}` };
  return { ok: true, value: { type: 'file', file_id: fileId, mount_path: mountPath } };
}

function normalizeGithubRepositoryResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  const url = readString(resource.url);
  const authorizationToken = readString(resource.authorization_token);
  const mountPath = readString(resource.mount_path);
  if (!url) return { ok: false, message: `resources[${index}].url is required` };
  if (!authorizationToken) return { ok: false, message: `resources[${index}].authorization_token is required` };
  if (mountPath && !mountPath.startsWith('/')) return { ok: false, message: `resources[${index}].mount_path must start with /` };
  const normalized: Record<string, unknown> = {
    type: 'github_repository',
    url,
    authorization_token: {
      type: 'encrypted_secret',
      ...encryptSecret(authorizationToken, deps.workspace?.dataDir),
    },
  };
  if (resource.checkout !== undefined) {
    if (
      typeof resource.checkout !== 'string'
      && (!resource.checkout || typeof resource.checkout !== 'object' || Array.isArray(resource.checkout))
    ) {
      return { ok: false, message: `resources[${index}].checkout must be a string or object` };
    }
    normalized.checkout = resource.checkout;
  }
  if (mountPath) normalized.mount_path = mountPath;
  return { ok: true, value: normalized };
}

function normalizeMemoryStoreResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  const memoryStoreId = readString(resource.memory_store_id);
  if (!memoryStoreId?.startsWith('memstore_')) return { ok: false, message: `resources[${index}].memory_store_id is required` };
  const row = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ? AND archived_at IS NULL').get(memoryStoreId);
  if (!row) return { ok: false, message: `Memory store not found: ${memoryStoreId}` };

  const access = readString(resource.access);
  if (access && access !== 'read_write' && access !== 'read_only') {
    return { ok: false, message: `resources[${index}].access must be read_write or read_only` };
  }
  const mountPath = readString(resource.mount_path);
  if (mountPath && !mountPath.startsWith('/')) return { ok: false, message: `resources[${index}].mount_path must start with /` };
  const instructions = readString(resource.instructions);
  return {
    ok: true,
    value: {
      type: 'memory_store',
      memory_store_id: memoryStoreId,
      ...(access ? { access } : {}),
      ...(mountPath ? { mount_path: mountPath } : {}),
      ...(instructions ? { instructions } : {}),
    },
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function memoryScopeFromResources(resources: Array<Record<string, unknown>>): string | undefined {
  const memoryStore = resources.find((resource) => resource.type === 'memory_store');
  return typeof memoryStore?.memory_store_id === 'string' ? memoryStore.memory_store_id : undefined;
}

function normalizeArtifactPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\/+/g, '/');
  if (!trimmed.startsWith('/artifacts/') || trimmed.endsWith('/') || trimmed.includes('/../') || trimmed.includes('/./')) return undefined;
  return trimmed.slice(0, 512);
}

function sanitizeArtifactName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/[\\/]/g, '_');
  return trimmed ? trimmed.slice(0, 255) : undefined;
}

function stringRecordField(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, recordValue]) => [key, String(recordValue)]));
}

function mediaTypeForArtifactName(name: string): string {
  if (/\.md$/i.test(name)) return 'text/markdown';
  if (/\.ya?ml$/i.test(name)) return 'application/yaml';
  if (/\.json$/i.test(name)) return 'application/json';
  if (/\.(txt|log|csv)$/i.test(name)) return 'text/plain';
  if (/\.html?$/i.test(name)) return 'text/html';
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  return 'application/octet-stream';
}

function invalid(c: any, message: string): Response {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}
