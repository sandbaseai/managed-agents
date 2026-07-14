/**
 * Integration test: API authentication (F1).
 *
 * Verifies:
 * - auth disabled by default (no keys) → all routes open
 * - auth enabled (keys configured) → /v1 routes require Bearer token
 * - public paths (/, /dashboard, /dashboard/assets/*, /v1/x/health) stay open even when auth is enabled
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';
import { countActiveManagedApiKeys, validateManagedApiKey } from '@/core/auth/api-keys.js';

function makeApp(apiKeys?: string[]) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ma-auth-'));
  const db = new Database(join(tmpDir, 'test.db'));
  db.runMigrations();
  db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
  db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_a', 'a', '{}')`);
  const app = createServer({
    db,
    sessionManager: new SessionManager(db),
    agents: [{ name: 'a', model: 'm', system: 'p' }],
    apiKeys,
    reloadAgents: () => ({ agents: [], errors: [] }),
  });
  return { app, db, tmpDir };
}

function makeDynamicApp() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ma-auth-dynamic-'));
  const db = new Database(join(tmpDir, 'test.db'));
  db.runMigrations();
  db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
  db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_a', 'a', '{}')`);
  const app = createServer({
    db,
    sessionManager: new SessionManager(db),
    agents: [{ name: 'a', model: 'm', system: 'p' }],
    hasApiKeys: () => countActiveManagedApiKeys(db) > 0,
    validateApiKey: (key) => validateManagedApiKey(db, key),
    runtime: {
      models: [],
      sandboxProviders: ['local'],
      memory: 'disabled',
      authEnabled: false,
    },
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

    it('lists configured API keys without exposing raw secrets', async () => {
      const res = await ctx.app.request('/v1/api-keys', {
        headers: { Authorization: 'Bearer secret-key-1' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].source).toBe('config_env');
      expect(body.data[0].secret_key).toBeUndefined();
      expect(body.data[0].key_prefix).toContain('...');
      expect(body.data[0].key_prefix).not.toBe('secret-key-1');

      const deleteRes = await ctx.app.request(`/v1/api-keys/${body.data[0].id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret-key-1' },
      });
      expect(deleteRes.status).toBe(400);
    });

    it('keeps /v1/x/health public', async () => {
      const res = await ctx.app.request('/v1/x/health');
      expect(res.status).toBe(200);
    });

    it('keeps root (/) public', async () => {
      const res = await ctx.app.request('/');
      expect(res.status).toBe(200);
    });

    it('keeps the console shell and static assets public', async () => {
      const shell = await ctx.app.request('/dashboard');
      expect(shell.status).not.toBe(401);

      const asset = await ctx.app.request('/dashboard/assets/app.js');
      expect(asset.status).not.toBe(401);

      const legacyShell = await ctx.app.request('/ui');
      expect(legacyShell.status).not.toBe(401);
    });

    it('is case-insensitive on the Bearer scheme', async () => {
      const res = await ctx.app.request('/v1/agents', {
        headers: { Authorization: 'bearer secret-key-1' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('database-managed API keys', () => {
    let ctx: ReturnType<typeof makeDynamicApp>;
    beforeEach(() => { ctx = makeDynamicApp(); });
    afterEach(() => { ctx.db.close(); rmSync(ctx.tmpDir, { recursive: true, force: true }); });

    it('creates a key, enables auth, accepts the returned secret, and deletes the key', async () => {
      const before = await ctx.app.request('/v1/agents');
      expect(before.status).toBe(200);

      const createRes = await ctx.app.request('/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CI key' }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { id: string; secret_key: string; key_prefix: string };
      expect(created.id).toMatch(/^key_/);
      expect(created.secret_key).toMatch(/^ma_/);
      expect(created.key_prefix).not.toContain(created.secret_key);

      const runtimeRes = await ctx.app.request('/v1/x/runtime', {
        headers: { Authorization: `Bearer ${created.secret_key}` },
      });
      expect(runtimeRes.status).toBe(200);
      expect((await runtimeRes.json()).auth_enabled).toBe(true);

      const unauthorized = await ctx.app.request('/v1/agents');
      expect(unauthorized.status).toBe(401);

      const authorized = await ctx.app.request('/v1/agents', {
        headers: { Authorization: `Bearer ${created.secret_key}` },
      });
      expect(authorized.status).toBe(200);

      const listRes = await ctx.app.request('/v1/api-keys', {
        headers: { Authorization: `Bearer ${created.secret_key}` },
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.data).toHaveLength(1);
      expect(listBody.data[0].last_used_at).toBeTruthy();

      const deleteRes = await ctx.app.request(`/v1/api-keys/${created.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${created.secret_key}` },
      });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).type).toBe('api_key_deleted');

      const afterDelete = await ctx.app.request('/v1/agents', {
        headers: { Authorization: `Bearer ${created.secret_key}` },
      });
      expect(afterDelete.status).toBe(200);
    });
  });
});
