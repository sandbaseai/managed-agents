import type { Database } from '../db/database.js';
import { listModelProviders, seedModelProviders, type ModelProviderRecord } from '../model/providers.js';
import { ModelRegistry } from '../../model/registry.js';
import type { ModelConfig } from '@/types/model.js';

export interface RuntimeModelBootstrapOptions {
  db: Database;
  configModels: ModelConfig[];
  modelRegistry?: ModelRegistry;
}

export interface RuntimeModelBootstrapResult {
  modelRegistry: ModelRegistry;
  providers: ModelProviderRecord[];
  defaultProvider: ModelProviderRecord | undefined;
}

export function bootstrapRuntimeModelRegistry(options: RuntimeModelBootstrapOptions): RuntimeModelBootstrapResult {
  const modelRegistry = options.modelRegistry ?? new ModelRegistry();

  // Dashboard-managed model providers are stored in SQLite and are the runtime
  // source of truth. Config models can optionally bootstrap a new local project.
  seedModelProviders(options.db, options.configModels);
  const providers = listModelProviders(options.db);

  for (const provider of providers) {
    modelRegistry.register(provider);
  }

  const defaultProvider = providers.find((provider) => provider.is_default);
  if (defaultProvider) {
    modelRegistry.setDefault(defaultProvider.name);
  }

  return { modelRegistry, providers, defaultProvider };
}
