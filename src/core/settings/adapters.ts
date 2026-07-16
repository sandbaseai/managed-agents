import type { RuntimeSettings, SettingsAvailability } from './schema.js';

export type AdapterStatus = 'available' | 'unavailable';

export type AdapterDescriptor = {
  id: string;
  label: string;
  version: string;
  status: AdapterStatus;
  restart_policy: 'none' | 'runtime';
};

export type SettingsAdapterDescriptors = {
  model: AdapterDescriptor[];
  loop_engine: AdapterDescriptor[];
  storage: {
    metadata: AdapterDescriptor[];
    artifacts: AdapterDescriptor[];
  };
  memory: AdapterDescriptor[];
  sandbox: AdapterDescriptor[];
};

export function describeSettingsAdapters(installedSandboxes: string[] = ['local']): SettingsAdapterDescriptors {
  const sandboxAvailable = new Set(installedSandboxes.map((item) => item === 'self_hosted' ? 'remote' : item));
  return {
    model: [
      descriptor('openai', 'OpenAI', true, 'runtime'),
      descriptor('anthropic', 'Anthropic', true, 'runtime'),
      descriptor('openai_compatible', 'OpenAI compatible', true, 'runtime'),
    ],
    loop_engine: [
      descriptor('builtin', 'Managed Agents', true, 'runtime'),
      descriptor('harness', 'Harness', false, 'runtime'),
      descriptor('codex', 'Codex', false, 'runtime'),
      descriptor('claude', 'Claude', false, 'runtime'),
    ],
    storage: {
      metadata: [
        descriptor('sqlite', 'SQLite', true, 'runtime'),
        descriptor('postgres', 'Postgres', false, 'runtime'),
        descriptor('mysql', 'MySQL', false, 'runtime'),
      ],
      artifacts: [
        descriptor('local', 'Local filesystem', true, 'runtime'),
        descriptor('s3', 'S3-compatible', false, 'runtime'),
      ],
    },
    memory: [
      descriptor('sqlite', 'SQLite', true, 'runtime'),
      descriptor('memu', 'MemU', false, 'runtime'),
      descriptor('mem0', 'mem0', false, 'runtime'),
    ],
    sandbox: [
      descriptor('local', 'Local', sandboxAvailable.has('local'), 'runtime'),
      descriptor('docker', 'Docker', sandboxAvailable.has('docker'), 'runtime'),
      descriptor('remote', 'Remote', sandboxAvailable.has('remote'), 'runtime'),
    ],
  };
}

export function availabilityFromDescriptors(descriptors: SettingsAdapterDescriptors): SettingsAvailability {
  return {
    modelVendors: availableIds(descriptors.model),
    loopEngines: availableIds(descriptors.loop_engine),
    metadataStorage: availableIds(descriptors.storage.metadata),
    artifactStorage: availableIds(descriptors.storage.artifacts),
    memoryProviders: availableIds(descriptors.memory),
    sandboxProviders: availableIds(descriptors.sandbox),
  } as SettingsAvailability;
}

function descriptor(
  id: string,
  label: string,
  available: boolean,
  restartPolicy: AdapterDescriptor['restart_policy'],
): AdapterDescriptor {
  return {
    id,
    label,
    version: '1',
    status: available ? 'available' : 'unavailable',
    restart_policy: restartPolicy,
  };
}

function availableIds<T extends string>(items: AdapterDescriptor[]): Set<T> {
  return new Set(items.filter((item) => item.status === 'available').map((item) => item.id as T));
}

export function sandboxSettingForRuntime(value: string): RuntimeSettings['sandbox']['provider'] {
  return value === 'self_hosted' ? 'remote' : value === 'docker' ? 'docker' : 'local';
}

