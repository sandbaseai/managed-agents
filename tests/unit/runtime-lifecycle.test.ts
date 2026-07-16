import { describe, expect, it } from 'vitest';
import { createRuntimeStopper, type ClosableServer, type RuntimeStopMode } from '@/core/runtime/lifecycle.js';
import type { Logger } from '@/core/observability/logger.js';

function makeLogger() {
  const records: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (msg, fields) => records.push({ level: 'debug', msg, fields }),
    info: (msg, fields) => records.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => records.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => records.push({ level: 'error', msg, fields }),
    child: () => logger,
  };
  return { logger, records };
}

async function runStopper(stop: (mode: RuntimeStopMode) => Promise<void>, mode: RuntimeStopMode) {
  try {
    await stop(mode);
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

describe('runtime lifecycle', () => {
  it('closes the HTTP server, drains sessions, closes DB, and exits on shutdown', async () => {
    const { logger, records } = makeLogger();
    const calls: string[] = [];
    const server: ClosableServer = {
      close: (callback) => {
        calls.push('server.close');
        callback();
      },
    };
    const stop = createRuntimeStopper({
      getServer: () => server,
      sessionManager: {
        shutdown: async () => {
          calls.push('sessions.shutdown');
        },
      },
      db: {
        close: () => calls.push('db.close'),
      },
      logger,
      log: (message) => calls.push(`log:${message}`),
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as (code: number) => never,
    });

    const err = await runStopper(stop, 'shutdown');

    expect(err?.message).toBe('exit:0');
    expect(calls).toEqual([
      'log:\nShutting down...',
      'server.close',
      'sessions.shutdown',
      'db.close',
      'exit:0',
    ]);
    expect(records).toContainEqual({
      level: 'warn',
      msg: 'runtime_shutdown_requested',
      fields: { source: 'runtime' },
    });
  });

  it('spawns a detached replacement process on restart', async () => {
    const { logger } = makeLogger();
    const calls: string[] = [];
    const spawnCalls: unknown[] = [];
    const stop = createRuntimeStopper({
      getServer: () => undefined,
      sessionManager: {
        shutdown: async () => {
          calls.push('sessions.shutdown');
        },
      },
      db: {
        close: () => calls.push('db.close'),
      },
      logger,
      execPath: '/node',
      argv: ['/node', '/app/dist/index.js', 'start', '--port', '3001'],
      cwd: '/workspace',
      env: { MANAGED_AGENTS_TEST: '1' },
      log: (message) => calls.push(`log:${message}`),
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return {
          unref: () => calls.push('child.unref'),
        };
      },
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as (code: number) => never,
    });

    const err = await runStopper(stop, 'restart');

    expect(err?.message).toBe('exit:0');
    expect(spawnCalls).toEqual([{
      command: '/node',
      args: ['/app/dist/index.js', 'start', '--port', '3001'],
      options: {
        cwd: '/workspace',
        env: { MANAGED_AGENTS_TEST: '1' },
        stdio: 'ignore',
        detached: true,
      },
    }]);
    expect(calls).toEqual([
      'log:\nRestarting runtime...',
      'sessions.shutdown',
      'db.close',
      'child.unref',
      'exit:0',
    ]);
  });

  it('logs close and shutdown failures while still closing the database', async () => {
    const { logger, records } = makeLogger();
    const calls: string[] = [];
    const server: ClosableServer = {
      close: (callback) => {
        calls.push('server.close');
        callback(new Error('close failed'));
      },
    };
    const stop = createRuntimeStopper({
      getServer: () => server,
      sessionManager: {
        shutdown: async () => {
          calls.push('sessions.shutdown');
          throw new Error('drain failed');
        },
      },
      db: {
        close: () => calls.push('db.close'),
      },
      logger,
      log: () => undefined,
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as (code: number) => never,
    });

    const err = await runStopper(stop, 'shutdown');

    expect(err?.message).toBe('exit:0');
    expect(calls).toEqual(['server.close', 'sessions.shutdown', 'db.close', 'exit:0']);
    expect(records).toContainEqual({
      level: 'warn',
      msg: 'http_server_close_failed',
      fields: { error: 'close failed' },
    });
    expect(records).toContainEqual({
      level: 'error',
      msg: 'session_manager_shutdown_failed',
      fields: { error: 'drain failed' },
    });
  });

  it('is idempotent after shutdown starts', async () => {
    const { logger } = makeLogger();
    const calls: string[] = [];
    const stop = createRuntimeStopper({
      getServer: () => undefined,
      sessionManager: {
        shutdown: async () => {
          calls.push('sessions.shutdown');
        },
      },
      db: {
        close: () => calls.push('db.close'),
      },
      logger,
      log: () => undefined,
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as (code: number) => never,
    });

    await runStopper(stop, 'shutdown');
    const second = await runStopper(stop, 'shutdown');

    expect(second).toBeUndefined();
    expect(calls).toEqual(['sessions.shutdown', 'db.close', 'exit:0']);
  });
});
