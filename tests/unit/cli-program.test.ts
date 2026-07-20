import { describe, expect, it } from 'vitest';
import { createCliProgram, type StartServerOptions } from '@/cli/program.js';

describe('CLI program', () => {
  it('registers the public command surface', () => {
    const program = createCliProgram({
      version: '0.1.0',
      startServer: async () => undefined,
    });

    expect(program.name()).toBe('managed-agents');
    expect(program.commands.map((command) => command.name())).toEqual([
      'start',
      'init',
      'list',
      'reload',
      'chat',
      'deploy',
      'template',
    ]);
    expect(program.commands.find((command) => command.name() === 'template')?.commands.map((command) => command.name())).toEqual([
      'list',
      'install',
      'create',
    ]);
  });

  it('passes default start options to the runtime starter', async () => {
    let received: StartServerOptions | undefined;
    const program = createCliProgram({
      version: '0.1.0',
      startServer: async (opts) => {
        received = opts;
      },
    });

    await program.parseAsync(['node', 'managed-agents', 'start'], { from: 'node' });

    expect(received).toMatchObject({
      port: '3000',
      host: '127.0.0.1',
      workspace: '.',
      agentsDir: 'agents',
      skillsDir: 'skills',
      target: 'local',
    });
  });
});
