/**
 * Integration test: crash recovery / orphan reconciliation (R9.10, Property 10).
 *
 * Simulates a process crash mid-turn (a session left 'running' with an
 * unresolved tool_use) and verifies reconcileOrphans() injects a placeholder
 * tool_result and resets the session to idle so the message sequence stays
 * valid and the session is resumable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { EventLogger } from '@/core/session/event-logger.js';
import { eventsToMessages } from '@/core/session/events-to-messages.js';

describe('Crash recovery', () => {
  let db: Database;
  let manager: SessionManager;
  let logger: EventLogger;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-crash-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    db.exec(`INSERT INTO agents (id, name, definition) VALUES ('agent_echo', 'echo', '{}')`);
    manager = new SessionManager(db);
    logger = manager.getEventLogger();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Directly create a session stuck in 'running' with an orphaned tool_use. */
  function createOrphanedSession(): string {
    const session = manager.create({ agent: 'echo' });
    // Simulate a mid-turn crash: running status + tool_use with no result
    db.prepare(`UPDATE sessions SET status = 'running' WHERE id = ?`).run(session.id);
    logger.append(session.id, {
      type: 'user.message',
      content: [{ type: 'text', text: 'run a command' }],
    });
    logger.append(session.id, {
      type: 'agent.tool_use',
      content: [{ type: 'tool_use', id: 'call_123', name: 'bash', input: { command: 'sleep 100' } }],
    });
    // ...crash happens here — no tool_result ever written
    return session.id;
  }

  it('injects placeholder tool_result for orphaned tool_use', () => {
    const sessionId = createOrphanedSession();

    const count = manager.reconcileOrphans();
    expect(count).toBe(1);

    const events = logger.getEvents(sessionId);
    const resultEvent = events.find(
      (e) =>
        e.type === 'agent.tool_result' &&
        (e.content?.[0] as any)?.tool_use_id === 'call_123',
    );
    expect(resultEvent).toBeDefined();
    expect((resultEvent!.content![0] as any).is_error).toBe(true);
  });

  it('resets orphaned session to idle (paused) so it is resumable', () => {
    const sessionId = createOrphanedSession();
    manager.reconcileOrphans();
    expect(manager.get(sessionId)!.status).toBe('paused');
  });

  it('produces a valid paired message sequence after reconciliation', () => {
    const sessionId = createOrphanedSession();
    manager.reconcileOrphans();

    const events = logger.getEvents(sessionId);
    const messages = eventsToMessages(events);

    // The assistant tool-call must be followed by a tool result — no orphan
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).content[0].toolCallId).toBe('call_123');
  });

  it('does not double-inject if a tool_result already exists', () => {
    const session = manager.create({ agent: 'echo' });
    db.prepare(`UPDATE sessions SET status = 'running' WHERE id = ?`).run(session.id);
    logger.append(session.id, {
      type: 'agent.tool_use',
      content: [{ type: 'tool_use', id: 'call_ok', name: 'bash', input: {} }],
    });
    logger.append(session.id, {
      type: 'agent.tool_result',
      content: [{ type: 'tool_result', tool_use_id: 'call_ok', content: 'done' }],
    });

    manager.reconcileOrphans();

    const results = logger
      .getEvents(session.id)
      .filter((e) => e.type === 'agent.tool_result');
    expect(results).toHaveLength(1); // no extra placeholder injected
  });

  it('ignores sessions not in running state', () => {
    const session = manager.create({ agent: 'echo' }); // status = queued
    const count = manager.reconcileOrphans();
    expect(count).toBe(0);
    expect(manager.get(session.id)!.status).toBe('queued');
  });
});
