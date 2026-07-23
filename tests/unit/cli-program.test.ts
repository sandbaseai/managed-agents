import { describe, expect, it, vi } from 'vitest';
import { createCliProgram } from '@/cli/program.js';

describe('CLI program', () => {
  function makeHandlers() {
    return {
      startServer: vi.fn(async () => {}),
      initProject: vi.fn(() => {}),
      listAgents: vi.fn(async () => {}),
      reloadAgents: vi.fn(async () => {}),
      chatCommand: vi.fn(async () => {}),
      sessionCreate: vi.fn(async () => {}),
      sessionMessage: vi.fn(async () => {}),
      sessionTail: vi.fn(async () => {}),
      sessionInspect: vi.fn(async () => {}),
      sessionLogs: vi.fn(async () => {}),
      settingsGet: vi.fn(async () => {}),
      settingsSetModel: vi.fn(async () => {}),
      settingsValidate: vi.fn(async () => {}),
      environmentsList: vi.fn(async () => {}),
      environmentInspect: vi.fn(async () => {}),
      environmentCreate: vi.fn(async () => {}),
      environmentUpdate: vi.fn(async () => {}),
      environmentArchive: vi.fn(async () => {}),
      environmentWorkerKeys: vi.fn(async () => {}),
      workspaceList: vi.fn(() => {}),
      workspaceCreate: vi.fn(() => {}),
      workspaceOpen: vi.fn(() => {}),
      workspaceResolve: vi.fn(() => {}),
      workspaceRemove: vi.fn(() => {}),
      workerPoll: vi.fn(async () => {}),
    };
  }

  it('registers the default start command and forwards options', async () => {
    const handlers = makeHandlers();
    const program = createCliProgram('9.9.9', handlers);

    await program.parseAsync([
      'node',
      'managed-agents',
      'start',
      '--port',
      '4321',
      '--host',
      '0.0.0.0',
      '--target',
      'local',
    ]);

    expect(handlers.startServer).toHaveBeenCalledWith(expect.objectContaining({
      port: '4321',
      host: '0.0.0.0',
      target: 'local',
      agentsDir: 'agents',
      skillsDir: 'skills',
      config: 'managed-agents.config.yaml',
    }));
  });

  it('wires init/list/reload/chat handlers', async () => {
    const handlers = makeHandlers();
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'init']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'list', '--port', '3001']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'reload', '--port', '3002']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'chat', 'agent_x', '--message', 'hi', '--api-key', 'ma_test']);

    expect(handlers.initProject).toHaveBeenCalledOnce();
    expect(handlers.listAgents).toHaveBeenCalledWith(expect.objectContaining({ port: '3001' }));
    expect(handlers.reloadAgents).toHaveBeenCalledWith(expect.objectContaining({ port: '3002' }));
    expect(handlers.chatCommand).toHaveBeenCalledWith('agent_x', expect.objectContaining({
      message: 'hi',
      apiKey: 'ma_test',
    }));
  });

  it('wires session helper subcommands', async () => {
    const handlers = makeHandlers();
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'session', 'create', '--agent', 'agent_x', '--title', 'Smoke']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'session', 'message', 'sess_x', '--message', 'hello', '--no-stream']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'session', 'tail', 'sess_x', '--last-event-id', 'sevt_1']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'session', 'inspect', 'sess_x', '--json']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'session', 'logs', 'sess_x']);

    expect(handlers.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({ agent: 'agent_x', title: 'Smoke' }));
    expect(handlers.sessionMessage).toHaveBeenCalledWith('sess_x', expect.objectContaining({ message: 'hello', stream: false }));
    expect(handlers.sessionTail).toHaveBeenCalledWith('sess_x', expect.objectContaining({ lastEventId: 'sevt_1' }));
    expect(handlers.sessionInspect).toHaveBeenCalledWith('sess_x', expect.objectContaining({ json: true }));
    expect(handlers.sessionLogs).toHaveBeenCalledWith('sess_x', expect.objectContaining({ port: '3000' }));
  });

  it('wires self-hosted worker poll command', async () => {
    const handlers = makeHandlers();
    await createCliProgram('9.9.9', handlers).parseAsync([
      'node',
      'managed-agents',
      'worker',
      'poll',
      '--environment-id',
      'env_self_hosted',
      '--worker-id',
      'worker_a',
      '--workdir',
      '/tmp/worker',
      '--once',
    ]);

    expect(handlers.workerPoll).toHaveBeenCalledWith(expect.objectContaining({
      environmentId: 'env_self_hosted',
      workerId: 'worker_a',
      workdir: '/tmp/worker',
      once: true,
      port: '3000',
    }));
  });

  it('does not expose historical model provider marketplace commands', () => {
    const handlers = makeHandlers();
    const program = createCliProgram('9.9.9', handlers);
    expect(program.commands.map((command) => command.name())).not.toContain('models');
    expect(program.commands.map((command) => command.name())).not.toContain('deploy');
  });

  it('wires canonical settings commands', async () => {
    const handlers = makeHandlers();
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'settings', 'get', '--json']);
    await createCliProgram('9.9.9', handlers).parseAsync([
      'node',
      'managed-agents',
      'settings',
      'set-model',
      '--vendor',
      'anthropic',
      '--base-url',
      'https://api.anthropic.com',
      '--api-key-env',
      'ANTHROPIC_API_KEY',
    ]);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'settings', 'validate']);

    expect(handlers.settingsGet).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
    expect(handlers.settingsSetModel).toHaveBeenCalledWith(expect.objectContaining({
      vendor: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    }));
    expect(handlers.settingsValidate).toHaveBeenCalledWith(expect.objectContaining({ port: '3000' }));
  });

  it('wires environment management commands', async () => {
    const handlers = makeHandlers();
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'environments', 'list']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'environments', 'inspect', 'env_default', '--json']);
    await createCliProgram('9.9.9', handlers).parseAsync([
      'node',
      'managed-agents',
      'environments',
      'create',
      '--name',
      'docker',
      '--hosting-type',
      'local',
      '--sandbox-provider',
      'docker',
      '--config-json',
      '{"timeout":600}',
    ]);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'environments', 'update', 'env_x', '--description', 'Updated']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'environments', 'worker-keys', 'env_x']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'environments', 'archive', 'env_x']);

    expect(handlers.environmentsList).toHaveBeenCalledWith(expect.objectContaining({ port: '3000' }));
    expect(handlers.environmentInspect).toHaveBeenCalledWith('env_default', expect.objectContaining({ json: true }));
    expect(handlers.environmentCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'docker',
      hostingType: 'local',
      sandboxProvider: 'docker',
      configJson: '{"timeout":600}',
    }));
    expect(handlers.environmentUpdate).toHaveBeenCalledWith('env_x', expect.objectContaining({ description: 'Updated' }));
    expect(handlers.environmentWorkerKeys).toHaveBeenCalledWith('env_x', expect.objectContaining({ port: '3000' }));
    expect(handlers.environmentArchive).toHaveBeenCalledWith('env_x', expect.objectContaining({ port: '3000' }));
  });

  it('wires workspace registry commands', async () => {
    const handlers = makeHandlers();
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'workspace', 'list', '--json']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'workspace', 'create', '/tmp/acme', '--name', 'Acme', '--data-dir', '/tmp/acme-data']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'workspace', 'open', '/tmp/existing']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'workspace', 'resolve', 'Acme', '--json']);
    await createCliProgram('9.9.9', handlers).parseAsync(['node', 'managed-agents', 'workspace', 'remove', 'Acme']);

    expect(handlers.workspaceList).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
    expect(handlers.workspaceCreate).toHaveBeenCalledWith('/tmp/acme', expect.objectContaining({ name: 'Acme', dataDir: '/tmp/acme-data' }));
    expect(handlers.workspaceOpen).toHaveBeenCalledWith('/tmp/existing', expect.objectContaining({}));
    expect(handlers.workspaceResolve).toHaveBeenCalledWith('Acme', expect.objectContaining({ json: true }));
    expect(handlers.workspaceRemove).toHaveBeenCalledWith('Acme');
  });
});
