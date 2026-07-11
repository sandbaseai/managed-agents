/**
 * Session Manager
 *
 * Core control-plane component managing the full Session lifecycle:
 * create → sendEvent → subscribe → resume → stop
 *
 * Separation of concerns:
 * - SessionManager owns the control plane (status, Event_Log, routing)
 * - SandboxProvider owns the execution plane (file system, processes)
 * - AgentStrategy owns the engine loop (LLM calls, tool execution)
 */

import { nanoid } from 'nanoid';
import type { Database } from '@/core/db/database.js';
import { EventLogger } from './event-logger.js';
import { canTransition, isTerminal } from './state-machine.js';
import type {
  Session,
  SessionStatus,
  SessionEvent,
  CreateSessionParams,
  ListSessionsParams,
  PaginatedResult,
} from '@/types/session.js';
import type { UserEvent } from '@/types/cma-protocol.js';

// ============================================================
// Types
// ============================================================

export interface ExecuteOptions {
  /** Aborts the turn when the user sends user.interrupt. */
  abortSignal?: AbortSignal;
  /** Pushes an event to live SSE subscribers (does not persist). */
  broadcast?: (event: SessionEvent) => void;
  /** Called when the turn suspends awaiting user tool confirmation (A5). */
  onRequiresAction?: () => void;
}

export interface SessionExecutor {
  /** Called when a user event is received — runs the engine loop */
  execute(session: Session, event: UserEvent, options?: ExecuteOptions): AsyncIterable<SessionEvent>;
  /** Destroy resources (sandbox) bound to a session on terminal state */
  cleanupSession?(sessionId: string): Promise<void>;
}

type Subscriber = (event: SessionEvent) => void;

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
  );
}

/** Map internal session status → CMA lifecycle event type. */
const STATUS_TO_EVENT: Partial<Record<SessionStatus, SessionEvent['type']>> = {
  running: 'session.status_running',
  paused: 'session.status_idle',
  requires_action: 'session.status_idle',
  completed: 'session.status_terminated',
  // 'failed' is terminal → status_terminated. The detailed session.error event
  // (with the error message) is appended separately by runTurn's catch block.
  failed: 'session.status_terminated',
};

// ============================================================
// Session Manager
// ============================================================

export class SessionManager {
  private readonly eventLogger: EventLogger;
  private subscribers = new Map<string, Set<Subscriber>>();
  private executor?: SessionExecutor;
  /** Per-session execution chain — serializes turns so they never overlap. */
  private executionChains = new Map<string, Promise<void>>();
  /** Per-session abort controller for the currently running turn. */
  private abortControllers = new Map<string, AbortController>();

  constructor(private readonly db: Database) {
    this.eventLogger = new EventLogger(db);
  }

  /**
   * Register the session executor (called once during server init).
   */
  setExecutor(executor: SessionExecutor): void {
    this.executor = executor;
  }

  /**
   * Create a new Session (two-step lifecycle step 1: provision).
   * Status starts as 'queued'. Execution begins on first sendEvent().
   */
  create(params: CreateSessionParams): Session {
    const id = `sess_${nanoid(16)}`;
    const now = new Date();

    // Look up agent_id from agents table by name
    const agentRow = this.db.prepare('SELECT id, name FROM agents WHERE name = ? OR id = ?').get(
      params.agent,
      params.agent,
    ) as { id: string; name: string } | undefined;

    const agentId = agentRow?.id ?? params.agent;
    const agentName = agentRow?.name ?? params.agent;

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent_id, agent_name, environment_id, status, title, context_id, metadata)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    `);

    stmt.run(
      id,
      agentId,
      agentName,
      params.environmentId ?? 'env_default',
      params.title ?? null,
      params.contextId ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    );

    return {
      id,
      agentId,
      agentName,
      environmentId: params.environmentId ?? 'env_default',
      status: 'queued',
      title: params.title,
      contextId: params.contextId,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Send a user event to a session.
   * Returns synchronous acknowledgment; actual execution is async via SSE.
   */
  async sendEvent(sessionId: string, event: UserEvent): Promise<{ accepted: boolean }> {
    if (!event || typeof (event as any).type !== 'string' || (event as any).type.length === 0) {
      throw new Error('Invalid event: missing required string "type" field');
    }

    const session = this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (isTerminal(session.status)) {
      throw new Error(`Session ${sessionId} is in terminal state: ${session.status}`);
    }

    // Append the user event to the log
    const logged = this.eventLogger.append(sessionId, {
      type: event.type,
      content: 'content' in event ? (event as any).content : undefined,
    });
    this.broadcast(sessionId, logged);

    // user.interrupt jumps the queue and aborts the running turn — it does
    // NOT enqueue a new turn (there's no new work, just a stop signal).
    if (event.type === 'user.interrupt') {
      this.abortControllers.get(sessionId)?.abort();
      return { accepted: true };
    }

    // Execute asynchronously, serialized per session so turns never overlap.
    // The user event is already durably in the log; the chained turn will
    // read the full log (including this event) when it runs.
    if (this.executor) {
      const prev = this.executionChains.get(sessionId) ?? Promise.resolve();
      const next = prev
        .catch(() => {}) // isolate failures so one bad turn doesn't wedge the chain
        .then(() => this.runTurn(sessionId, event))
        .catch(() => {}); // never let a turn (even its prelude) reject the chain
      this.executionChains.set(sessionId, next);
      // Clean up the map entry once this is the last queued turn (L1 leak fix).
      void next.finally(() => {
        if (this.executionChains.get(sessionId) === next) {
          this.executionChains.delete(sessionId);
        }
      });
    }

    return { accepted: true };
  }

  /**
   * Subscribe to real-time session events (SSE pub/sub channel).
   */
  subscribe(sessionId: string, callback: Subscriber): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(callback);

    // Return unsubscribe function
    return () => {
      const set = this.subscribers.get(sessionId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.subscribers.delete(sessionId);
      }
    };
  }

  /**
   * Resume a paused/idle session (optionally with a different sandbox provider).
   * Rebuilds model context from Event_Log. Does NOT dispatch an event.
   */
  resume(sessionId: string): Session {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (isTerminal(session.status)) {
      throw new Error(`Cannot resume terminal session: ${session.status}`);
    }
    // Mark as ready for next event (paused → will go to running on next sendEvent)
    if (session.status === 'running') {
      // Already running, nothing to do
      return session;
    }
    // No status change here — resume just re-establishes readiness
    // The actual transition to 'running' happens on next sendEvent()
    return session;
  }

  /**
   * Get a session by ID.
   */
  get(sessionId: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(sessionId) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  /**
   * List sessions with pagination.
   */
  list(params: ListSessionsParams = {}): PaginatedResult<Session> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    let countSql = 'SELECT COUNT(*) as total FROM sessions';
    let querySql = 'SELECT * FROM sessions';
    const conditions: string[] = [];
    const queryParams: unknown[] = [];

    if (params.status) {
      conditions.push('status = ?');
      queryParams.push(params.status);
    }
    if (params.agentId) {
      conditions.push('agent_id = ?');
      queryParams.push(params.agentId);
    }

    if (conditions.length > 0) {
      const where = ` WHERE ${conditions.join(' AND ')}`;
      countSql += where;
      querySql += where;
    }

    querySql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countRow = this.db.prepare(countSql).get(...queryParams as any[]) as { total: number };
    const total = countRow.total;

    const rows = this.db.prepare(querySql).all(...queryParams as any[], pageSize, offset) as unknown as SessionRow[];

    return {
      data: rows.map(rowToSession),
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    };
  }

  /**
   * Stop a session and release its sandbox (terminal → completed).
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    // Abort any in-flight turn and wait for it to unwind before tearing down
    // the sandbox, so the strategy never calls into a destroyed sandbox (H1).
    this.abortControllers.get(sessionId)?.abort();
    await this.drainChain(sessionId);
    if (!isTerminal(this.get(sessionId)?.status ?? session.status)) {
      this.updateStatus(sessionId, 'completed');
    }
    await this.releaseSandbox(sessionId);
  }

  /**
   * Delete a session. Stops it if running, releases the sandbox, then emits
   * a session.deleted event. Per Requirement 9.8, the Event_Log and session
   * metadata are retained (queryable) — this is a logical delete.
   */
  async delete(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.abortControllers.get(sessionId)?.abort();
    await this.drainChain(sessionId);
    if (!isTerminal(this.get(sessionId)?.status ?? session.status)) {
      this.updateStatus(sessionId, 'completed');
    }
    await this.releaseSandbox(sessionId);
    const deletedEvent = this.eventLogger.append(sessionId, { type: 'session.deleted' });
    this.broadcast(sessionId, deletedEvent);
  }

  /** Await the current execution chain for a session (if any), swallowing errors. */
  private async drainChain(sessionId: string): Promise<void> {
    const chain = this.executionChains.get(sessionId);
    if (chain) {
      await chain.catch(() => {});
    }
  }

  /**
   * Get the Event Logger (exposed for Strategy/tests).
   */
  getEventLogger(): EventLogger {
    return this.eventLogger;
  }

  /**
   * Crash recovery (R9.10). On process restart, any session left in 'running'
   * was interrupted mid-turn. For each, inject a placeholder tool_result for
   * every orphaned tool_use (so the next eventsToMessages projection has a
   * valid, paired message sequence), then reset the session to idle (paused)
   * so it can be resumed. Sandbox state is NOT restored (Event_Log ≠ file
   * bytes) — the next turn re-provisions a fresh sandbox.
   *
   * Returns the number of sessions reconciled.
   */
  reconcileOrphans(): number {
    const running = this.db
      .prepare("SELECT id FROM sessions WHERE status = 'running'")
      .all() as Array<{ id: string }>;

    for (const { id: sessionId } of running) {
      const events = this.eventLogger.getEvents(sessionId);

      // Build tool_use → resolved sets to find orphans
      const toolUses = new Map<string, string>(); // id → event type
      const resolved = new Set<string>();
      for (const e of events) {
        if (e.type === 'agent.tool_use' || e.type === 'agent.mcp_tool_use') {
          const block = e.content?.find((b) => b.type === 'tool_use') as
            | { type: 'tool_use'; id: string } | undefined;
          if (block) toolUses.set(block.id, e.type);
        } else if (e.type === 'agent.tool_result' || e.type === 'agent.mcp_tool_result') {
          const block = e.content?.find((b) => b.type === 'tool_result') as
            | { type: 'tool_result'; tool_use_id: string } | undefined;
          if (block) resolved.add(block.tool_use_id);
        }
      }

      // Inject placeholder results for orphaned tool_use calls
      const placeholder = '(interrupted by server restart — retry if needed)';
      for (const [useId, useType] of toolUses) {
        if (resolved.has(useId)) continue;
        const resultType = useType === 'agent.mcp_tool_use'
          ? 'agent.mcp_tool_result'
          : 'agent.tool_result';
        this.eventLogger.append(sessionId, {
          type: resultType,
          content: [{ type: 'tool_result', tool_use_id: useId, content: placeholder, is_error: true }],
        });
      }

      // Reset to idle so the session is resumable
      this.updateStatus(sessionId, 'paused');
    }

    return running.length;
  }

  /**
   * Graceful shutdown: abort in-flight turns and release all sandboxes bound
   * to sessions that ran this process. Called on SIGINT/SIGTERM.
   */
  async shutdown(): Promise<void> {
    // Abort any running turns, then wait for them to unwind before teardown.
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    await Promise.all(
      Array.from(this.executionChains.values()).map((c) => c.catch(() => {})),
    );
    // Release sandboxes for all sessions currently 'running' or idle
    if (this.executor?.cleanupSession) {
      const rows = this.db
        .prepare("SELECT id FROM sessions WHERE status IN ('running', 'paused', 'requires_action')")
        .all() as Array<{ id: string }>;
      for (const row of rows) {
        try {
          await this.executor.cleanupSession(row.id);
        } catch {
          // best-effort
        }
      }
    }
  }

  // ============================================================
  // Internal
  // ============================================================

  private broadcast(sessionId: string, event: SessionEvent): void {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(event);
        } catch {
          // subscriber errors don't propagate
        }
      }
    }
  }

  private updateStatus(sessionId: string, newStatus: SessionStatus): void {
    // Validate the transition against the state machine. If the current status
    // already equals the target, this is a no-op. Invalid transitions are
    // skipped (defense — should not happen given callers guard with isTerminal).
    const current = this.get(sessionId);
    if (current) {
      if (current.status === newStatus) return;
      if (!canTransition(current.status, newStatus)) {
        return;
      }
    }

    const completedAt = isTerminal(newStatus) ? new Date().toISOString() : null;
    this.db.prepare(
      `UPDATE sessions SET status = ?, updated_at = datetime('now'), completed_at = ? WHERE id = ?`,
    ).run(newStatus, completedAt, sessionId);

    // Broadcast the corresponding CMA lifecycle event
    const eventType = STATUS_TO_EVENT[newStatus];
    if (eventType) {
      const statusEvent = this.eventLogger.append(sessionId, { type: eventType });
      this.broadcast(sessionId, statusEvent);
    }
  }

  /**
   * Run a single turn for a session. Serialized via executionChains so turns
   * never overlap. Transitions running on start, then paused (idle, awaiting
   * next input) on normal completion — NOT terminal, so multi-turn works.
   */
  private async runTurn(sessionId: string, event: UserEvent): Promise<void> {
    if (!this.executor) return;

    const session = this.get(sessionId);
    // Session may have been stopped/deleted between enqueue and execution.
    if (!session || isTerminal(session.status)) return;

    // Transition to running for this turn
    if (session.status !== 'running') {
      this.updateStatus(sessionId, 'running');
    }

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);
    let requiresAction = false;

    try {
      const running = this.get(sessionId)!;
      for await (const evt of this.executor.execute(running, event, {
        abortSignal: abortController.signal,
        broadcast: (e) => this.broadcast(sessionId, e),
        onRequiresAction: () => {
          requiresAction = true;
        },
      })) {
        this.broadcast(sessionId, evt);
      }
      // Turn finished. If a tool needs confirmation → requires_action;
      // otherwise go idle (paused), awaiting next input.
      const current = this.get(sessionId);
      if (current && current.status === 'running') {
        this.updateStatus(sessionId, requiresAction ? 'requires_action' : 'paused');
      }
    } catch (err) {
      // An abort (user.interrupt) is normal control flow, not a failure:
      // the session returns to idle so the user can send a follow-up.
      if (abortController.signal.aborted || isAbortError(err)) {
        const current = this.get(sessionId);
        if (current && current.status === 'running') {
          this.updateStatus(sessionId, 'paused');
        }
      } else {
        // Turn failed unrecoverably — terminal. Log error + release sandbox.
        this.eventLogger.append(sessionId, {
          type: 'session.error',
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        });
        const current = this.get(sessionId);
        if (current && !isTerminal(current.status)) {
          this.updateStatus(sessionId, 'failed');
        }
        await this.releaseSandbox(sessionId);
      }
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  private async releaseSandbox(sessionId: string): Promise<void> {
    if (this.executor?.cleanupSession) {
      try {
        await this.executor.cleanupSession(sessionId);
      } catch {
        // best-effort
      }
    }
  }
}

// ============================================================
// Internal Helpers
// ============================================================

interface SessionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  environment_id: string;
  status: string;
  title: string | null;
  context_id: string | null;
  metadata: string | null;
  sandbox_type: string | null;
  sandbox_state: string | null;
  usage_tokens_in: number;
  usage_tokens_out: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    environmentId: row.environment_id,
    status: row.status as SessionStatus,
    title: row.title ?? undefined,
    contextId: row.context_id ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    sandboxType: row.sandbox_type ?? undefined,
    sandboxState: row.sandbox_state ? JSON.parse(row.sandbox_state) : undefined,
    usage: { tokensIn: row.usage_tokens_in, tokensOut: row.usage_tokens_out },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}
