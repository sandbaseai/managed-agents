/**
 * Memory Provider (Requirements 9.16–9.18)
 *
 * Optional cross-session long-term memory, scoped by `context_id`. The platform
 * does not build its own memory store — it defines an interface that adapters
 * (mem0, memU, or a built-in SQLite store) implement. Memory is disabled by
 * default; when enabled, relevant memories are injected into a new session's
 * system context, and key facts are extracted after the turn.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  relevance: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface MemoryProvider {
  readonly name: string;
  /** Store a memory scoped to a context_id. Returns the new memory id. */
  add(contextId: string, content: string, metadata?: Record<string, unknown>): Promise<string>;
  /** Retrieve memories relevant to a query within a context_id. */
  search(contextId: string, query: string, limit?: number): Promise<MemoryEntry[]>;
  /** Update an existing memory. */
  update(memoryId: string, content: string): Promise<void>;
  /** Delete a memory. */
  delete(memoryId: string): Promise<void>;
}
