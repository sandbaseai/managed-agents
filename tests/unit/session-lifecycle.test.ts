import { describe, expect, it } from 'vitest';
import { eventTypeForStatus, isAbortError } from '@/core/session/session-lifecycle.js';

describe('session lifecycle helpers', () => {
  it('maps internal statuses to CMA lifecycle events', () => {
    expect(eventTypeForStatus('running')).toBe('session.status_running');
    expect(eventTypeForStatus('paused')).toBe('session.status_idle');
    expect(eventTypeForStatus('requires_action')).toBe('session.status_idle');
    expect(eventTypeForStatus('completed')).toBe('session.status_terminated');
    expect(eventTypeForStatus('failed')).toBe('session.status_terminated');
    expect(eventTypeForStatus('queued')).toBeUndefined();
  });

  it('recognizes abort errors without treating arbitrary errors as aborts', () => {
    expect(isAbortError(Object.assign(new Error('cancelled'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(new Error('operation aborted by user'))).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
