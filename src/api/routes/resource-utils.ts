import type { ServerDeps } from '../server.js';

export async function readObjectBody(c: any): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, response: invalid(c, 'Request body must be an object') };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, response: invalid(c, 'Request body must be valid JSON') };
  }
}

export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringRecordField(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectField(value)).map(([key, recordValue]) => [key, String(recordValue)]),
  );
}

export function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return objectField(parsed);
  } catch {
    return {};
  }
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return arrayOfStrings(JSON.parse(value));
  } catch {
    return [];
  }
}

export function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

export function invalid(c: any, message: string): Response {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}

export function conflict(c: any, message: string): Response {
  return c.json({ error: { type: 'conflict', message } }, 409);
}

export function notFound(c: any, message: string): Response {
  return c.json({ error: { type: 'not_found', message } }, 404);
}

export function archiveResource(c: any, deps: ServerDeps, table: string, map: (row: any) => unknown) {
  const id = c.req.param('id');
  const existing = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND archived_at IS NULL`).get(id);
  if (!existing) return notFound(c, 'Resource not found');
  deps.db.prepare(`UPDATE ${table} SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
  const row = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return c.json(map(row));
}
