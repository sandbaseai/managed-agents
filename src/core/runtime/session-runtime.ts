import type { Database } from '../db/database.js';
import { loadAgentDefinitionById } from '../agent/store.js';
import { SessionManager } from '../session/session-manager.js';
import { DefaultSessionExecutor } from '../session/executor.js';
import { ContextCompactor } from '../session/context-compactor.js';
import { SnapshotManager } from '../session/snapshot-manager.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import type { Skill } from '../skills/loader.js';
import type { MemoryProvider } from '../memory/memory-provider.js';
import type { ModelRegistry } from '../../model/registry.js';
import type { SandboxProvider } from '@/types/sandbox.js';
import type { SandboxProviderRegistry } from '@/sandbox/registry.js';
import type { AgentDefinition } from '@/types/agent.js';
import type { AgentStrategy } from '@/types/strategy.js';
import type { RuntimeComposition } from './composition.js';

export interface RuntimeSessionServicesOptions {
  db: Database;
  agents: AgentDefinition[];
  modelRegistry: ModelRegistry;
  sandboxProvider: SandboxProvider;
  sandboxRegistry: SandboxProviderRegistry;
  runtimeComposition: Pick<RuntimeComposition, 'resolveEnvironmentConfig'>;
  strategy: AgentStrategy;
  skills: Skill[];
  memory?: MemoryProvider;
  artifactStore: Pick<ArtifactStore, 'path'>;
  defaultMaxSteps: number;
}

export interface RuntimeSessionServices {
  sessionManager: SessionManager;
  executor: DefaultSessionExecutor;
  snapshots: SnapshotManager;
  reconciled: number;
}

export function createRuntimeSessionServices(options: RuntimeSessionServicesOptions): RuntimeSessionServices {
  const sessionManager = new SessionManager(options.db);
  const eventLogger = sessionManager.getEventLogger();
  const snapshots = new SnapshotManager(options.db, options.artifactStore.path('snapshots'));

  const executor = new DefaultSessionExecutor({
    agents: options.agents,
    modelRegistry: options.modelRegistry,
    sandboxProvider: options.sandboxProvider,
    sandboxRegistry: options.sandboxRegistry,
    resolveEnvironmentConfig: options.runtimeComposition.resolveEnvironmentConfig,
    resolveAgent: (agentId) => loadAgentDefinitionById(options.db, agentId),
    strategy: options.strategy,
    eventLogger,
    compactor: new ContextCompactor(),
    skills: options.skills,
    memory: options.memory,
    snapshots,
    defaultMaxSteps: options.defaultMaxSteps,
  });
  sessionManager.setExecutor(executor);

  const reconciled = sessionManager.reconcileOrphans();

  return {
    sessionManager,
    executor,
    snapshots,
    reconciled,
  };
}
