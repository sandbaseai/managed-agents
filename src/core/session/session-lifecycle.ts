import type { SessionEvent, SessionStatus } from '@/types/session.js';

const STATUS_TO_EVENT: Partial<Record<SessionStatus, SessionEvent['type']>> = {
  running: 'session.status_running',
  paused: 'session.status_idle',
  requires_action: 'session.status_idle',
  completed: 'session.status_terminated',
  // 'failed' is terminal → status_terminated. The detailed session.error event
  // is appended separately by SessionManager.runTurn's catch block.
  failed: 'session.status_terminated',
};

export function eventTypeForStatus(status: SessionStatus): SessionEvent['type'] | undefined {
  return STATUS_TO_EVENT[status];
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))
  );
}
