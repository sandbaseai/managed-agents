import { describe, expect, it } from 'vitest';
import {
  attachRuntimeServerErrorHandler,
  parseCsv,
  runtimeStartupBannerLines,
  type RuntimeErrorServer,
} from '@/core/runtime/http-server.js';

describe('runtime HTTP server helpers', () => {
  it('parses comma-separated configuration values', () => {
    expect(parseCsv(undefined)).toEqual([]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(' http://localhost:3000,https://example.test ,, http://127.0.0.1:3000 ')).toEqual([
      'http://localhost:3000',
      'https://example.test',
      'http://127.0.0.1:3000',
    ]);
  });

  it('formats the startup banner with optional load warnings', () => {
    expect(runtimeStartupBannerLines({
      version: '0.1.0',
      host: '127.0.0.1',
      port: 3000,
      agentsCount: 2,
      skillsCount: 3,
      sandboxProviders: ['local', 'self_hosted'],
      memory: 'sqlite',
      target: 'local',
      dataDir: '/tmp/managed-agents',
      authEnabled: true,
      agentLoadErrorCount: 1,
    })).toEqual([
      '\n  managed-agents v0.1.0\n',
      '  API:       http://127.0.0.1:3000/v1',
      '  Dashboard: http://127.0.0.1:3000/dashboard',
      '  Health:    http://127.0.0.1:3000/v1/x/health',
      '  Agents:    2 loaded',
      '  Skills:    3 loaded',
      '  Sandbox:   local, self_hosted',
      '  Memory:    sqlite',
      '  Target:    local',
      '  Data:      /tmp/managed-agents',
      '  Auth:      enabled (Bearer token required)',
      '  Warnings:  1 agent load errors',
      '',
    ]);
  });

  it('prints a clear port-in-use error, closes the database, and exits', () => {
    const errors: string[] = [];
    const calls: string[] = [];
    let listener: ((err: NodeJS.ErrnoException) => void) | undefined;
    const server: RuntimeErrorServer = {
      on: (_event, callback) => {
        listener = callback;
      },
    };

    attachRuntimeServerErrorHandler({
      server,
      port: 3000,
      db: { close: () => calls.push('db.close') },
      writeError: (message) => errors.push(message),
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as (code: number) => never,
    });

    expect(() => listener?.(Object.assign(new Error('listen failed'), { code: 'EADDRINUSE' }))).toThrow('exit:1');
    expect(errors).toEqual([
      'Error: [PORT_IN_USE] Port 3000 is already in use.',
      '  -> Stop the process using it, or start with --port <other>',
    ]);
    expect(calls).toEqual(['db.close', 'exit:1']);
  });

  it('prints a generic server error, closes the database, and exits', () => {
    const errors: string[] = [];
    const calls: string[] = [];
    let listener: ((err: NodeJS.ErrnoException) => void) | undefined;
    const server: RuntimeErrorServer = {
      on: (_event, callback) => {
        listener = callback;
      },
    };

    attachRuntimeServerErrorHandler({
      server,
      port: 3000,
      db: { close: () => calls.push('db.close') },
      writeError: (message) => errors.push(message),
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw new Error(`exit:${code}`);
      }) as (code: number) => never,
    });

    expect(() => listener?.(new Error('boom') as NodeJS.ErrnoException)).toThrow('exit:1');
    expect(errors).toEqual(['Error: [SERVER] boom']);
    expect(calls).toEqual(['db.close', 'exit:1']);
  });
});
