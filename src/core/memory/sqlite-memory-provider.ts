/**
 * SQLite Memory Provider
 *
 * Built-in default MemoryProvider backed by the local SQLite database. Uses a
 * simple keyword-overlap relevance score (no embeddings) — good enough for a
 * local-first default. External adapters (mem0/memU) can replace it for
 * semantic retrieval.
 */

import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';
import type { MemoryProvider, MemoryEntry } from './memory-provider.js';

interface MemoryRow {
  id: string;
  context_id: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

export class SqliteMemoryProvider implements MemoryProvider {
  readonly name = 'sqlite';

  constructor(private readonly db: Database) {}

  async add(contextId: string, content: string, metadata?: Record<string, unknown>): Promise<string> {
    const id = `mem_${nanoid(16)}`;
    this.db
      .prepare('INSERT INTO memories (id, context_id, content, metadata) VALUES (?, ?, ?, ?)')
      .run(id, contextId, content, metadata ? JSON.stringify(metadata) : null);
    return id;
  }

  async search(contextId: string, query: string, limit = 5): Promise<MemoryEntry[]> {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE context_id = ? ORDER BY created_at DESC')
      .all(contextId) as unknown as MemoryRow[];

    const queryTerms = tokenize(query);
    const scored = rows.map((row) => ({
      row,
      relevance: relevanceScore(queryTerms, tokenize(row.content)),
    }));

    // If query is empty, return most-recent; else rank by overlap
    scored.sort((a, b) => b.relevance - a.relevance);

    return scored
      .slice(0, limit)
      .filter((s) => (query.trim() ? s.relevance > 0 : true))
      .map(({ row, relevance }) => ({
        id: row.id,
        content: row.content,
        relevance,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: new Date(row.created_at),
      }));
  }

  async update(memoryId: string, content: string): Promise<void> {
    this.db.prepare('UPDATE memories SET content = ? WHERE id = ?').run(content, memoryId);
  }

  async delete(memoryId: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
  }
}

// ============================================================
// Relevance scoring (keyword overlap)
// ============================================================

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function relevanceScore(query: Set<string>, doc: Set<string>): number {
  if (query.size === 0) return 0;
  let overlap = 0;
  for (const term of query) {
    if (doc.has(term)) overlap++;
  }
  return overlap / query.size;
}
