/**
 * Unit tests for Session Manager.
 * Validates: session create/get/list/stop lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';

describe('Session Manager', () => {
  let db: Database;
  let manager: SessionManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-test-'));
    const dbPath = join(tmpDir, 'test.db');
    db = new Database(dbPath);
    db.runMigrations();

    // Insert default environment
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    // Insert a test agent
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_test', 'test-agent', '{}')`);

    manager = new SessionManager(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('creates a session with queued status', () => {
      const session = manager.create({ agent: 'agent_test' });
      expect(session.id).toMatch(/^sess_/);
      expect(session.status).toBe('queued');
      expect(session.agentId).toBe('agent_test');
    });

    it('stores context_id when provided', () => {
      const session = manager.create({ agent: 'agent_test', contextId: 'ctx_abc' });
      expect(session.contextId).toBe('ctx_abc');
    });

    it('stores metadata when provided', () => {
      const session = manager.create({
        agent: 'agent_test',
        metadata: { project: 'test' },
      });
      expect(session.metadata).toEqual({ project: 'test' });
    });
  });

  describe('get', () => {
    it('retrieves a created session', () => {
      const created = manager.create({ agent: 'agent_test' });
      const retrieved = manager.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.status).toBe('queued');
    });

    it('returns null for non-existent session', () => {
      expect(manager.get('sess_nonexist')).toBeNull();
    });
  });

  describe('list', () => {
    it('lists sessions with pagination', () => {
      for (let i = 0; i < 5; i++) {
        manager.create({ agent: 'agent_test', title: `session-${i}` });
      }

      const page1 = manager.list({ pageSize: 3 });
      expect(page1.data).toHaveLength(3);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page2 = manager.list({ page: 2, pageSize: 3 });
      expect(page2.data).toHaveLength(2);
      expect(page2.hasMore).toBe(false);
    });

    it('returns empty when no sessions exist', () => {
      const result = manager.list();
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('stop', () => {
    it('stops a session (transitions to completed)', async () => {
      const session = manager.create({ agent: 'agent_test' });
      await manager.stop(session.id);
      const stopped = manager.get(session.id);
      expect(stopped!.status).toBe('completed');
    });

    it('throws for non-existent session', async () => {
      await expect(manager.stop('sess_nonexist')).rejects.toThrow('Session not found');
    });
  });

  describe('subscribe', () => {
    it('receives events when broadcast', async () => {
      const session = manager.create({ agent: 'agent_test' });
      const received: any[] = [];
      manager.subscribe(session.id, (evt) => received.push(evt));

      // Trigger by stopping (which internally broadcasts status events)
      await manager.stop(session.id);
      expect(received.length).toBeGreaterThan(0);
    });

    it('unsubscribe stops receiving events', async () => {
      const session = manager.create({ agent: 'agent_test' });
      const received: any[] = [];
      const unsub = manager.subscribe(session.id, (evt) => received.push(evt));
      unsub();

      await manager.stop(session.id);
      expect(received).toHaveLength(0);
    });
  });

  describe('automatic continuation', () => {
    it('keeps non-terminal sessions queryable for the next user event', () => {
      const session = manager.create({ agent: 'agent_test' });
      const current = manager.get(session.id);
      expect(current!.status).toBe('queued');
      expect(current!.id).toBe(session.id);
    });
  });
});
