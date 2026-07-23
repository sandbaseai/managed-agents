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
  claimedBy?: string | null;
  createdAt?: string;
  claimedAt?: string | null;
  completedAt?: string | null;
}

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
  claim(workerId: string, sessionId?: string, environmentId?: string): WorkItem | null {
    return this.db.transaction(() => {
      let candidate: { id: string } | undefined;
      if (sessionId) {
        candidate = this.db.prepare(
          environmentId
            ? `SELECT wi.id
               FROM work_items wi
               JOIN sessions s ON s.id = wi.session_id
               WHERE wi.status = 'pending' AND wi.session_id = ? AND s.environment_id = ?
               ORDER BY wi.created_at ASC, wi.rowid ASC
               LIMIT 1`
            : "SELECT id FROM work_items WHERE status = 'pending' AND session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1",
        ).get(...(environmentId ? [sessionId, environmentId] : [sessionId])) as { id: string } | undefined;
      } else if (environmentId) {
        candidate = this.db.prepare(
          `SELECT wi.id
           FROM work_items wi
           JOIN sessions s ON s.id = wi.session_id
           WHERE wi.status = 'pending' AND s.environment_id = ?
           ORDER BY wi.created_at ASC, wi.rowid ASC
           LIMIT 1`,
        ).get(environmentId) as { id: string } | undefined;
      } else {
        candidate = this.db.prepare(
          "SELECT id FROM work_items WHERE status = 'pending' ORDER BY created_at ASC, rowid ASC LIMIT 1",
        ).get() as { id: string } | undefined;
      }
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

  complete(id: string, result: unknown, failed = false): void {
    this.db
      .prepare("UPDATE work_items SET status = ?, result = ?, completed_at = datetime('now') WHERE id = ?")
      .run(failed ? 'failed' : 'done', JSON.stringify(result), id);
  }

  get(id: string): WorkItem | null {
    const r = this.db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as RawWorkItem | undefined;
    return r ? toWorkItem(r) : null;
  }

  list(opts: { environmentId?: string; limit?: number } = {}): WorkItem[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
    const rows = opts.environmentId
      ? this.db.prepare(
        `SELECT wi.*
         FROM work_items wi
         JOIN sessions s ON s.id = wi.session_id
         WHERE s.environment_id = ?
         ORDER BY wi.created_at DESC, wi.rowid DESC
         LIMIT ?`,
      ).all(opts.environmentId, limit)
      : this.db.prepare(
        `SELECT *
         FROM work_items
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      ).all(limit);
    return (rows as unknown as RawWorkItem[]).map(toWorkItem);
  }

  stats(opts: { environmentId?: string } = {}): Record<string, number> {
    const rows = opts.environmentId
      ? this.db.prepare(
        `SELECT wi.status, COUNT(*) AS count
         FROM work_items wi
         JOIN sessions s ON s.id = wi.session_id
         WHERE s.environment_id = ?
         GROUP BY wi.status`,
      ).all(opts.environmentId)
      : this.db.prepare('SELECT status, COUNT(*) AS count FROM work_items GROUP BY status').all();
    return Object.fromEntries((rows as Array<{ status: string; count: number }>).map((row) => [row.status, Number(row.count)]));
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
  claimed_by: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

function toWorkItem(r: RawWorkItem): WorkItem {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind as WorkItemKind,
    payload: JSON.parse(r.payload),
    status: r.status as WorkItem['status'],
    result: r.result ? JSON.parse(r.result) : undefined,
    claimedBy: r.claimed_by ?? null,
    createdAt: r.created_at,
    claimedAt: r.claimed_at ?? null,
    completedAt: r.completed_at ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
