import { describe, expect, it } from 'vitest';
import { createSessionEventQueue, isMessageStreamTerminalEvent } from '@/api/routes/session-stream.js';
import type { SessionEvent } from '@/types/session.js';

function sessionEvent(type: SessionEvent['type']): SessionEvent {
  return {
    id: `evt_${type}`,
    sessionId: 'sess_test',
    seq: 1,
    type,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('session stream helpers', () => {
  it('delivers queued events in order', async () => {
    const queue = createSessionEventQueue();
    const first = sessionEvent('session.status_running');
    const second = sessionEvent('session.status_idle');

    queue.push(first);
    queue.push(second);

    await expect(queue.next()).resolves.toBe(first);
    await expect(queue.next()).resolves.toBe(second);
  });

  it('wakes a pending reader when an event arrives', async () => {
    const queue = createSessionEventQueue();
    const pending = queue.next();
    const event = sessionEvent('session.status_running');

    queue.push(event);

    await expect(pending).resolves.toBe(event);
  });

  it('marks message stream terminal events', () => {
    expect(isMessageStreamTerminalEvent(sessionEvent('session.status_idle'))).toBe(true);
    expect(isMessageStreamTerminalEvent(sessionEvent('session.status_terminated'))).toBe(true);
    expect(isMessageStreamTerminalEvent(sessionEvent('session.error'))).toBe(true);
    expect(isMessageStreamTerminalEvent(sessionEvent('session.status_running'))).toBe(false);
  });
});
