import type { Database } from '../db/database.js';
import { LocalSandboxProvider } from '../../sandbox/local-provider.js';
import { DockerSandboxProvider, isDockerAvailable } from '../../sandbox/docker-provider.js';
import { SandboxProviderRegistry } from '../../sandbox/registry.js';
import { SelfHostedSandboxProvider, WorkQueue } from '../../sandbox/self-hosted-provider.js';

export interface RuntimeSandboxBootstrapOptions {
  db: Database;
  dataDir: string;
  dockerAvailable?: () => boolean;
}

export interface RuntimeSandboxBootstrapResult {
  sandboxProvider: LocalSandboxProvider;
  sandboxRegistry: SandboxProviderRegistry;
  workQueue: WorkQueue;
  dockerAvailable: boolean;
}

export function bootstrapRuntimeSandboxes(options: RuntimeSandboxBootstrapOptions): RuntimeSandboxBootstrapResult {
  const sandboxProvider = new LocalSandboxProvider(options.dataDir);
  const sandboxRegistry = new SandboxProviderRegistry();
  sandboxRegistry.register(sandboxProvider);

  const dockerAvailable = (options.dockerAvailable ?? isDockerAvailable)();
  if (dockerAvailable) {
    sandboxRegistry.register(new DockerSandboxProvider());
  }

  // self_hosted: tool calls are dispatched to a user-run Worker via the queue.
  const workQueue = new WorkQueue(options.db);
  sandboxRegistry.register(new SelfHostedSandboxProvider(workQueue));

  return {
    sandboxProvider,
    sandboxRegistry,
    workQueue,
    dockerAvailable,
  };
}
