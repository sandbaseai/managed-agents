/**
 * Unit tests for the SQLite Memory Provider (R9.16–9.18).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SqliteMemoryProvider } from '@/core/memory/sqlite-memory-provider.js';

describe('SqliteMemoryProvider', () => {
  let db: Database;
  let memory: SqliteMemoryProvider;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-mem-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    memory = new SqliteMemoryProvider(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds and retrieves a memory scoped by context_id', async () => {
    const id = await memory.add('ctx_1', 'The user prefers TypeScript');
    expect(id).toMatch(/^mem_/);

    const results = await memory.search('ctx_1', 'typescript');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('TypeScript');
    expect(results[0].relevance).toBeGreaterThan(0);
  });

  it('isolates memories across context_ids (R9.17)', async () => {
    await memory.add('ctx_a', 'secret for A');
    await memory.add('ctx_b', 'secret for B');

    const a = await memory.search('ctx_a', 'secret');
    expect(a).toHaveLength(1);
    expect(a[0].content).toContain('for A');

    const b = await memory.search('ctx_b', 'secret');
    expect(b).toHaveLength(1);
    expect(b[0].content).toContain('for B');
  });

  it('ranks by keyword overlap', async () => {
    await memory.add('ctx', 'the quick brown fox jumps');
    await memory.add('ctx', 'completely unrelated content about cats');

    const results = await memory.search('ctx', 'quick brown fox');
    expect(results[0].content).toContain('fox'); // most relevant first
  });

  it('returns recent memories when query is empty', async () => {
    await memory.add('ctx', 'first');
    await memory.add('ctx', 'second');
    const results = await memory.search('ctx', '');
    expect(results.length).toBe(2);
  });

  it('updates a memory', async () => {
    const id = await memory.add('ctx', 'original text');
    await memory.update(id, 'updated text');
    const results = await memory.search('ctx', 'updated');
    expect(results[0].content).toBe('updated text');
  });

  it('deletes a memory', async () => {
    const id = await memory.add('ctx', 'to be deleted');
    await memory.delete(id);
    const results = await memory.search('ctx', 'deleted');
    expect(results).toHaveLength(0);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 10; i++) await memory.add('ctx', `memory item ${i}`);
    const results = await memory.search('ctx', 'memory item', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
