/**
 * Unit tests for the Database layer and migrations.
 * Validates: Property 17 — migration idempotency (Requirement 8.4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';

describe('Database migrations', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-db-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all expected tables on first run', () => {
    const db = new Database(dbPath);
    db.runMigrations();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain('agents');
    expect(names).toContain('environments');
    expect(names).toContain('sessions');
    expect(names).toContain('events');
    expect(names).toContain('compaction_boundaries');
    expect(names).toContain('models');
    expect(names).toContain('snapshots');
    expect(names).toContain('memories');
    expect(names).toContain('_migrations');
    db.close();
  });

  it('is idempotent — running migrations repeatedly is a no-op (Property 17)', () => {
    const db = new Database(dbPath);
    db.runMigrations();

    // Insert some data
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_x', 'x', '{}')`);
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_x', 'x', '{}')`);

    // Run migrations again — should not error, drop tables, or lose data
    db.runMigrations();
    db.runMigrations();

    const envCount = (db.prepare('SELECT COUNT(*) as c FROM environments').get() as { c: number }).c;
    const agentCount = (db.prepare('SELECT COUNT(*) as c FROM agents').get() as { c: number }).c;
    const migrationCount = (db.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number }).c;
    const distinctMigrations = (db.prepare('SELECT COUNT(DISTINCT version) as c FROM _migrations').get() as { c: number }).c;

    expect(envCount).toBe(1);
    expect(agentCount).toBe(1);
    // Each migration recorded exactly once regardless of how many times run
    expect(migrationCount).toBe(distinctMigrations);
    db.close();
  });

  it('persists data across reopen', () => {
    const db1 = new Database(dbPath);
    db1.runMigrations();
    db1.exec(`INSERT INTO environments (id, name, config) VALUES ('env_p', 'persist', '{}')`);
    db1.close();

    const db2 = new Database(dbPath);
    db2.runMigrations(); // should detect already-applied, not recreate
    const row = db2.prepare('SELECT name FROM environments WHERE id = ?').get('env_p') as { name: string };
    expect(row.name).toBe('persist');
    db2.close();
  });

  it('transaction rolls back on error', () => {
    const db = new Database(dbPath);
    db.runMigrations();

    expect(() =>
      db.transaction(() => {
        db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_t', 't', '{}')`);
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const count = (db.prepare('SELECT COUNT(*) as c FROM environments').get() as { c: number }).c;
    expect(count).toBe(0); // rolled back
    db.close();
  });
});
