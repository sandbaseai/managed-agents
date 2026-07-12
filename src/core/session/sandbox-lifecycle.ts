import type { AgentDefinition } from '@/types/agent.js';
import type { SandboxProvider, SandboxInstance, SandboxProviderType } from '@/types/sandbox.js';
import type { Session } from '@/types/session.js';
import type { SandboxProviderRegistry } from '@/sandbox/registry.js';
import type { SnapshotManager } from './snapshot-manager.js';

export interface SandboxLifecycleDeps {
  sandboxProvider: SandboxProvider;
  sandboxRegistry?: SandboxProviderRegistry;
  resolveEnvProviderType?: (envName: string) => SandboxProviderType | undefined;
  resolveEnvSnapshot?: (envName: string) => boolean;
  snapshots?: SnapshotManager;
}

export class SandboxLifecycle {
  private readonly sandboxes = new Map<string, SandboxInstance>();

  constructor(private readonly deps: SandboxLifecycleDeps) {}

  async getOrProvision(session: Session, agent: AgentDefinition): Promise<SandboxInstance> {
    const existing = this.sandboxes.get(session.id);
    if (existing) return existing;

    const providerType = this.resolveProviderType(agent);
    const provider = this.resolveProvider(providerType);
    const sandbox = await provider.provision(session.id, {
      name: agent.environment ?? 'local',
      sandbox_provider: providerType,
      timeout: 300,
    });

    if (this.snapshotsEnabled(agent) && this.deps.snapshots && sandbox.hostWorkDir) {
      try {
        this.deps.snapshots.restoreLatest(session.id, sandbox.hostWorkDir);
      } catch {
        // best-effort restore
      }
    }

    this.sandboxes.set(session.id, sandbox);
    return sandbox;
  }

  snapshotAfterTurn(session: Session, agent: AgentDefinition, sandbox: SandboxInstance): void {
    if (this.snapshotsEnabled(agent) && this.deps.snapshots && sandbox.hostWorkDir) {
      try {
        this.deps.snapshots.create(session.id, sandbox.hostWorkDir);
      } catch {
        // best-effort snapshot
      }
    }
  }

  async cleanup(sessionId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) return;

    this.sandboxes.delete(sessionId);
    try {
      await sandbox.cleanup();
    } catch {
      // best-effort cleanup
    }
  }

  snapshotsEnabled(agent: AgentDefinition): boolean {
    return !!(this.deps.resolveEnvSnapshot && agent.environment && this.deps.resolveEnvSnapshot(agent.environment));
  }

  private resolveProviderType(agent: AgentDefinition): SandboxProviderType {
    if (this.deps.resolveEnvProviderType && agent.environment) {
      const type = this.deps.resolveEnvProviderType(agent.environment);
      if (type) return type;
    }
    return 'local';
  }

  private resolveProvider(type: SandboxProviderType): SandboxProvider {
    if (this.deps.sandboxRegistry?.has(type)) {
      return this.deps.sandboxRegistry.get(type);
    }
    return this.deps.sandboxProvider;
  }
}
