import { describe, expect, it } from 'vitest';
import { SandboxLifecycle } from '@/core/session/sandbox-lifecycle.js';
import type { SandboxInstance, SandboxProvider } from '@/types/sandbox.js';
import type { AgentDefinition } from '@/types/agent.js';
import type { Session } from '@/types/session.js';

describe('SandboxLifecycle', () => {
  it('reuses one sandbox per session and cleans it up once', async () => {
    let provisionCount = 0;
    let cleanupCount = 0;
    const sandbox: SandboxInstance = {
      sessionId: 'sess_1',
      async execute() {
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      },
      async writeFile() {},
      async readFile() {
        return '';
      },
      async listFiles() {
        return [];
      },
      async cleanup() {
        cleanupCount += 1;
      },
    };
    const provider: SandboxProvider = {
      type: 'local',
      async provision() {
        provisionCount += 1;
        return sandbox;
      },
    };
    const lifecycle = new SandboxLifecycle({ sandboxProvider: provider });
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
      model: 'm',
      system: 'p',
    } satisfies AgentDefinition;

    await expect(lifecycle.getOrProvision(session, agent)).resolves.toBe(sandbox);
    await expect(lifecycle.getOrProvision(session, agent)).resolves.toBe(sandbox);
    expect(provisionCount).toBe(1);

    await lifecycle.cleanup(session.id);
    await lifecycle.cleanup(session.id);
    expect(cleanupCount).toBe(1);
  });
});
