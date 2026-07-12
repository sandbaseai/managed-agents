import { describe, expect, it } from 'vitest';
import { ToolResolver } from '@/core/session/tool-resolver.js';
import { DelegationService } from '@/core/session/delegation-service.js';
import { ModelRegistry } from '@/model/registry.js';
import type { AgentDefinition } from '@/types/agent.js';
import type { SandboxInstance, SandboxProvider } from '@/types/sandbox.js';
import type { AgentStrategy } from '@/types/strategy.js';
import type { Session } from '@/types/session.js';

describe('ToolResolver', () => {
  it('builds sandbox tools and strips execute for confirm-required tools', async () => {
    const sandbox: SandboxInstance = {
      sessionId: 'sess_1',
      async execute() {
        return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
      },
      async writeFile() {},
      async readFile() {
        return 'content';
      },
      async listFiles() {
        return ['a.ts'];
      },
      async cleanup() {},
    };
    const provider: SandboxProvider = {
      type: 'local',
      async provision() {
        return sandbox;
      },
    };
    const strategy: AgentStrategy = {
      async *execute() {},
    };
    const delegationService = new DelegationService({
      agents: [],
      modelRegistry: new ModelRegistry(),
      strategy,
      sandboxProvider: provider,
      composeSystemPrompt: (agent) => agent.system,
      buildSandboxTools: () => ({}),
    });
    const resolver = new ToolResolver({ delegationService });
    const session = {
      id: 'sess_1',
      agentId: 'agent_a',
      agentName: 'a',
      environmentId: 'env_default',
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies Session;
    const agent = {
      name: 'a',
      model: { id: 'm', speed: 'standard' },
      system: 'p',
      tools: [{
        type: 'agent_toolset_20260401',
        default_config: {
          enabled: true,
          permission_policy: { type: 'always_allow' },
        },
        configs: {
          bash: {
            enabled: true,
            permission_policy: { type: 'always_ask' },
          },
          read: { enabled: true },
        },
      }],
    } satisfies AgentDefinition;

    const tools = await resolver.resolveTools(session, agent, sandbox);

    expect(tools.bash).toBeDefined();
    expect(tools.bash.execute).toBeUndefined();
    expect(tools.read.execute).toBeTypeOf('function');
    await expect(tools.read.execute({ path: 'x' })).resolves.toBe('content');
  });
});
