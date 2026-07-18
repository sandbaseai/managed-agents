import type { SessionEvent } from '@/types/session.js';

export interface SessionEventQueue {
  push: (event: SessionEvent | undefined) => void;
  next: () => Promise<SessionEvent | undefined>;
}

export function createSessionEventQueue(): SessionEventQueue {
  const queue: Array<SessionEvent | undefined> = [];
  let wake: ((event: SessionEvent | undefined) => void) | undefined;

  return {
    push(event) {
      if (wake) {
        const resolve = wake;
        wake = undefined;
        resolve(event);
      } else {
        queue.push(event);
      }
    },
    async next() {
      const hasQueued = queue.length > 0;
      const queued = queue.shift();
      if (hasQueued) return queued;
      return new Promise<SessionEvent | undefined>((resolve) => {
        wake = resolve;
      });
    },
  };
}

export function isMessageStreamTerminalEvent(event: SessionEvent): boolean {
  return (
    event.type === 'session.status_idle' ||
    event.type === 'session.status_terminated' ||
    event.type === 'session.error'
  );
}
