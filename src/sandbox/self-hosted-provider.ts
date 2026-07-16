/**
 * Self-Hosted Sandbox Provider (Requirement 9.14)
 *
 * Instead of executing tool calls in-process, this provider enqueues them as
 * work items. A user-run Worker process (on their own infrastructure) claims
 * items, executes them, and posts results back. The Session state machine and
 * the Worker communicate ONLY through the standardized work-item protocol —
 * neither assumes the other's implementation.
 *
 * The queue is persisted in SQLite so Workers can poll across restarts. This
 * module provides both the SandboxProvider (server side, enqueues + awaits) and
 * the queue primitives the HTTP worker endpoints use to claim/complete items.
 */

import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';
import type {
  SandboxProvider,
  SandboxInstance,
  EnvironmentConfig,
  ExecOptions,
  ExecResult,
} from '@/types/sandbox.js';

export type WorkItemKind = 'exec' | 'write' | 'read' | 'list';

export interface WorkItem {
  id: string;
  sessionId: string;
  kind: WorkItemKind;
  payload: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'done' | 'failed';
  result?: unknown;
}

export type WorkCompletionResult = 'completed' | 'not_found' | 'not_claimed_by_worker';

/**
 * Queue primitives shared by the provider (enqueue/await) and the HTTP worker
 * endpoints (claim/complete).
 */
export class WorkQueue {
  constructor(private readonly db: Database) {}

  enqueue(sessionId: string, kind: WorkItemKind, payload: Record<string, unknown>): string {
    const id = `work_${nanoid(16)}`;
    this.db
      .prepare('INSERT INTO work_items (id, session_id, kind, payload) VALUES (?, ?, ?, ?)')
      .run(id, sessionId, kind, JSON.stringify(payload));
    return id;
  }

  /**
   * Claim the oldest pending item (optionally scoped to a session). Uses a
   * single atomic conditional UPDATE guarded by `status='pending'` so two
   * concurrent workers can never claim the same item (H2). Only the worker
   * whose UPDATE actually flips the row wins.
   */
  claim(workerId: string, sessionId?: string): WorkItem | null {
    return this.db.transaction(() => {
      const selectSql = sessionId
        ? "SELECT id FROM work_items WHERE status = 'pending' AND session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1"
        : "SELECT id FROM work_items WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC LIMIT 1";
      const candidate = (sessionId ? this.db.prepare(selectSql).get(sessionId) : this.db.prepare(selectSql).get()) as
        | { id: string } | undefined;
      if (!candidate) return null;

      // Guarded update: only succeeds if the row is still pending.
      const res = this.db
        .prepare("UPDATE work_items SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now') WHERE id = ? AND status = 'pending'")
        .run(workerId, candidate.id) as { changes: number };
      if (res.changes !== 1) return null; // lost the race — someone else claimed it

      const r = this.db.prepare('SELECT * FROM work_items WHERE id = ?').get(candidate.id) as unknown as RawWorkItem;
      return toWorkItem(r);
    });
  }

  complete(id: string, workerId: string, result: unknown, failed = false): WorkCompletionResult {
    const update = this.db
      .prepare("UPDATE work_items SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ? AND status = 'claimed' AND claimed_by = ?")
      .run(failed ? 'failed' : 'done', JSON.stringify(result), id, workerId) as { changes: number };
    if (update.changes === 1) return 'completed';
    return this.get(id) ? 'not_claimed_by_worker' : 'not_found';
  }

  get(id: string): WorkItem | null {
    const r = this.db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as RawWorkItem | undefined;
    return r ? toWorkItem(r) : null;
  }

  /** Await a work item's completion by polling (server side of provision). */
  async await(id: string, opts: { timeoutMs: number; pollMs?: number }): Promise<unknown> {
    const poll = opts.pollMs ?? 200;
    const deadline = Date.now() + opts.timeoutMs;
    for (;;) {
      const item = this.get(id);
      if (item && (item.status === 'done' || item.status === 'failed')) {
        if (item.status === 'failed') throw new Error(`work item ${id} failed: ${JSON.stringify(item.result)}`);
        return item.result;
      }
      if (Date.now() > deadline) throw new Error(`work item ${id} timed out`);
      await sleep(poll);
    }
  }
}

export class SelfHostedSandboxProvider implements SandboxProvider {
  readonly type = 'self_hosted';

  constructor(private readonly queue: WorkQueue) {}

  async provision(sessionId: string, config: EnvironmentConfig): Promise<SandboxInstance> {
    return new SelfHostedSandboxInstance(sessionId, this.queue, (config.timeout ?? 300) * 1000);
  }
}

class SelfHostedSandboxInstance implements SandboxInstance {
  constructor(
    readonly sessionId: string,
    private readonly queue: WorkQueue,
    private readonly timeoutMs: number,
  ) {}

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    const id = this.queue.enqueue(this.sessionId, 'exec', { command, cwd: options?.cwd, env: options?.env });
    const result = (await this.queue.await(id, { timeoutMs: options?.timeout ?? this.timeoutMs })) as ExecResult;
    return result;
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    const id = this.queue.enqueue(this.sessionId, 'write', { path, content: content.toString() });
    await this.queue.await(id, { timeoutMs: this.timeoutMs });
  }

  async readFile(path: string): Promise<string> {
    const id = this.queue.enqueue(this.sessionId, 'read', { path });
    return (await this.queue.await(id, { timeoutMs: this.timeoutMs })) as string;
  }

  async listFiles(path: string): Promise<string[]> {
    const id = this.queue.enqueue(this.sessionId, 'list', { path });
    return (await this.queue.await(id, { timeoutMs: this.timeoutMs })) as string[];
  }

  async cleanup(): Promise<void> {
    // Nothing to tear down server-side; the Worker owns the actual resources.
  }
}

// ============================================================
// Helpers
// ============================================================

interface RawWorkItem {
  id: string;
  session_id: string;
  kind: string;
  payload: string;
  status: string;
  result: string | null;
}

function toWorkItem(r: RawWorkItem): WorkItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind as WorkItemKind,
    payload: JSON.parse(r.payload),
    status: r.status as WorkItem['status'],
    result: r.result ? JSON.parse(r.result) : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
