import { describe, expect, it } from 'vitest';
import { SandboxLifecycle } from '@/core/session/sandbox-lifecycle.js';
import type { SandboxInstance, SandboxProvider } from '@/types/sandbox.js';
import { SandboxProviderRegistry } from '@/sandbox/registry.js';
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
    await expect(lifecycle.getOrProvision(session)).resolves.toBe(sandbox);
    await expect(lifecycle.getOrProvision(session)).resolves.toBe(sandbox);
    expect(provisionCount).toBe(1);

    await lifecycle.cleanup(session.id);
    await lifecycle.cleanup(session.id);
    expect(cleanupCount).toBe(1);
  });

  it('selects the sandbox provider from the session environment config', async () => {
    const registry = new SandboxProviderRegistry();
    const provisioned: string[] = [];
    const makeProvider = (type: 'local' | 'self_hosted'): SandboxProvider => ({
      type,
      async provision() {
        provisioned.push(type);
        return {
          sessionId: 'sess_2',
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
          async cleanup() {},
        };
      },
    });
    const localProvider = makeProvider('local');
    const selfHostedProvider = makeProvider('self_hosted');
    registry.register(localProvider);
    registry.register(selfHostedProvider);

    const lifecycle = new SandboxLifecycle({
      sandboxProvider: localProvider,
      sandboxRegistry: registry,
      resolveEnvironmentConfig: (environmentId) => ({
        name: environmentId,
        sandbox_provider: 'self_hosted',
        timeout: 300,
      }),
    });
    const session = {
      id: 'sess_2',
      agentId: 'agent_a',
      agentName: 'a',
      environmentId: 'env_self_hosted',
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies Session;

    await lifecycle.getOrProvision(session);
    expect(provisioned).toEqual(['self_hosted']);
  });
});
