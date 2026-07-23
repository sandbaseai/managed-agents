import { describe, expect, it } from 'vitest';
import { createRuntimeLifecycle } from '@/core/runtime/lifecycle.js';

describe('runtime lifecycle', () => {
  it('closes server, drains sessions, closes db, and exits once', async () => {
    const calls: string[] = [];
    const lifecycle = createRuntimeLifecycle({
      db: { close: () => calls.push('db.close') } as any,
      sessionManager: { shutdown: async () => calls.push('sessions.shutdown') } as any,
      logger: {
        warn: (message: string) => calls.push(`warn:${message}`),
        error: (message: string) => calls.push(`error:${message}`),
      } as any,
      getServer: () => ({
        close: (callback?: (err?: Error) => void) => {
          calls.push('server.close');
          callback?.();
        },
      }),
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as never,
    });

    await expect(lifecycle.stop('shutdown')).rejects.toThrow('exit:0');
    await lifecycle.stop('shutdown');

    expect(calls).toEqual([
      'warn:runtime_shutdown_requested',
      'server.close',
      'sessions.shutdown',
      'db.close',
      'exit:0',
    ]);
  });

  it('logs session shutdown errors and still closes the database', async () => {
    const calls: string[] = [];
    const lifecycle = createRuntimeLifecycle({
      db: { close: () => calls.push('db.close') } as any,
      sessionManager: { shutdown: async () => { throw new Error('boom'); } } as any,
      logger: {
        warn: (message: string) => calls.push(`warn:${message}`),
        error: (message: string, data: any) => calls.push(`error:${message}:${data.error}`),
      } as any,
      getServer: () => undefined,
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as never,
    });

    await expect(lifecycle.stop('shutdown')).rejects.toThrow('exit:0');

    expect(calls).toContain('error:session_manager_shutdown_failed:boom');
    expect(calls).toContain('db.close');
    expect(calls.at(-1)).toBe('exit:0');
  });
});
