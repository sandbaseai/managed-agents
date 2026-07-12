/**
 * Integration test: API authentication (F1).
 *
 * Verifies:
 * - auth disabled by default (no keys) → all routes open
 * - auth enabled (keys configured) → /v1 routes require Bearer token
 * - public paths (/, /v1/x/health) stay open even when auth is enabled
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';

function makeApp(apiKeys?: string[]) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ma-auth-'));
  const db = new Database(join(tmpDir, 'test.db'));
  db.runMigrations();
  db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
  db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_a', 'a', '{}')`);
  const app = createServer({
    db,
    sessionManager: new SessionManager(db),
    agents: [{ name: 'a', model: { id: 'm', speed: 'standard' }, system: 'p' }],
    apiKeys,
    reloadAgents: () => ({ agents: [], errors: [] }),
  });
  return { app, db, tmpDir };
}

describe('API authentication', () => {
  describe('auth disabled (default)', () => {
    let ctx: ReturnType<typeof makeApp>;
    beforeEach(() => { ctx = makeApp(); });
    afterEach(() => { ctx.db.close(); rmSync(ctx.tmpDir, { recursive: true, force: true }); });

    it('allows /v1/agents without a token', async () => {
      const res = await ctx.app.request('/v1/agents');
      expect(res.status).toBe(200);
    });
  });

  describe('auth enabled', () => {
    let ctx: ReturnType<typeof makeApp>;
    beforeEach(() => { ctx = makeApp(['secret-key-1', 'secret-key-2']); });
    afterEach(() => { ctx.db.close(); rmSync(ctx.tmpDir, { recursive: true, force: true }); });

    it('rejects /v1/agents without a token (401)', async () => {
      const res = await ctx.app.request('/v1/agents');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.type).toBe('authentication_error');
    });

    it('rejects an invalid token (401)', async () => {
      const res = await ctx.app.request('/v1/agents', {
        headers: { Authorization: 'Bearer wrong-key' },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a valid token', async () => {
      const res = await ctx.app.request('/v1/agents', {
        headers: { Authorization: 'Bearer secret-key-1' },
      });
      expect(res.status).toBe(200);
    });

    it('accepts any of the configured keys', async () => {
      const res = await ctx.app.request('/v1/agents', {
        headers: { Authorization: 'Bearer secret-key-2' },
      });
      expect(res.status).toBe(200);
    });

    it('keeps /v1/x/health public', async () => {
      const res = await ctx.app.request('/v1/x/health');
      expect(res.status).toBe(200);
    });

    it('keeps root (/) public', async () => {
      const res = await ctx.app.request('/');
      expect(res.status).toBe(200);
    });

    it('is case-insensitive on the Bearer scheme', async () => {
      const res = await ctx.app.request('/v1/agents', {
        headers: { Authorization: 'bearer secret-key-1' },
      });
      expect(res.status).toBe(200);
    });
  });
});
