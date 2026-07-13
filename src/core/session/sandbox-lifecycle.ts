import type { SandboxProvider, SandboxInstance, SandboxProviderType, EnvironmentConfig } from '@/types/sandbox.js';
import type { Session } from '@/types/session.js';
import type { SandboxProviderRegistry } from '@/sandbox/registry.js';
import type { SnapshotManager } from './snapshot-manager.js';

export interface SandboxLifecycleDeps {
  sandboxProvider: SandboxProvider;
  sandboxRegistry?: SandboxProviderRegistry;
  resolveEnvironmentConfig?: (environmentId: string) => EnvironmentConfig | undefined;
  snapshots?: SnapshotManager;
}

export class SandboxLifecycle {
  private readonly sandboxes = new Map<string, SandboxInstance>();

  constructor(private readonly deps: SandboxLifecycleDeps) {}

  async getOrProvision(session: Session): Promise<SandboxInstance> {
    const existing = this.sandboxes.get(session.id);
    if (existing) return existing;

    const envConfig = this.resolveEnvironmentConfig(session);
    const provider = this.resolveProvider(envConfig.sandbox_provider);
    const sandbox = await provider.provision(session.id, envConfig);

    if (this.snapshotsEnabled(envConfig) && this.deps.snapshots && sandbox.hostWorkDir) {
      try {
        this.deps.snapshots.restoreLatest(session.id, sandbox.hostWorkDir);
      } catch {
        // best-effort restore
      }
    }

    this.sandboxes.set(session.id, sandbox);
    return sandbox;
  }

  snapshotAfterTurn(session: Session, sandbox: SandboxInstance): void {
    const envConfig = this.resolveEnvironmentConfig(session);
    if (this.snapshotsEnabled(envConfig) && this.deps.snapshots && sandbox.hostWorkDir) {
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

  snapshotsEnabled(envConfig: EnvironmentConfig): boolean {
    return envConfig.snapshot?.enabled === true;
  }

  private resolveEnvironmentConfig(session: Session): EnvironmentConfig {
    return this.deps.resolveEnvironmentConfig?.(session.environmentId) ?? {
      name: session.environmentId || 'local',
      sandbox_provider: 'local',
      timeout: 300,
    };
  }

  private resolveProvider(type: SandboxProviderType): SandboxProvider {
    if (this.deps.sandboxRegistry?.has(type)) {
      return this.deps.sandboxRegistry.get(type);
    }
    return this.deps.sandboxProvider;
  }
}
