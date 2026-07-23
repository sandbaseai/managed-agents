import {
  ManagedAgentsClient,
  type EnvironmentSummary,
  type RuntimeSettingsSummary,
} from '@/sdk/client.js';

export type CliConnectionOptions = {
  port: string;
  apiKey?: string;
};

export type JsonOutputOption = {
  json?: boolean;
};

export type SettingsSetModelOptions = CliConnectionOptions & JsonOutputOption & {
  vendor: string;
  baseUrl?: string;
  apiKeyEnv?: string;
};

export type EnvironmentCreateOptions = CliConnectionOptions & JsonOutputOption & {
  name: string;
  description?: string;
  hostingType?: 'cloud' | 'local' | 'self_hosted';
  sandboxProvider?: string;
  configJson?: string;
};

export type EnvironmentUpdateOptions = CliConnectionOptions & JsonOutputOption & {
  name?: string;
  description?: string;
  hostingType?: 'cloud' | 'local' | 'self_hosted';
  sandboxProvider?: string;
  configJson?: string;
};

export async function settingsGetCommand(opts: CliConnectionOptions & JsonOutputOption) {
  const result = await createClient(opts).settings.get();
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(formatSettings(result));
}

export async function settingsSetModelCommand(opts: SettingsSetModelOptions) {
  const result = await createClient(opts).settings.patch({
    model_provider: {
      vendor: requiredString(opts.vendor, 'vendor'),
      base_url: opts.baseUrl,
      api_key_env: opts.apiKeyEnv,
    },
  });
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(formatSettings(result));
}

export async function settingsValidateCommand(opts: CliConnectionOptions & JsonOutputOption) {
  const result = await createClient(opts).settings.validate();
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(`settings: ${result.status}`);
  for (const check of result.checks) {
    console.log(`${check.status}  ${check.label}: ${check.message}`);
  }
}

export async function environmentsListCommand(opts: CliConnectionOptions & JsonOutputOption) {
  const result = await createClient(opts).environments.list();
  if (opts.json) {
    printJson(result.data);
    return;
  }
  if (result.data.length === 0) {
    console.log('No environments configured.');
    return;
  }
  for (const item of result.data) {
    console.log(formatEnvironment(item));
  }
}

export async function environmentInspectCommand(id: string, opts: CliConnectionOptions & JsonOutputOption) {
  const result = await createClient(opts).environments.get(id);
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(formatEnvironment(result));
  console.log(`config: ${JSON.stringify(result.config, null, 2)}`);
}

export async function environmentCreateCommand(opts: EnvironmentCreateOptions) {
  const config = parseConfigJson(opts.configJson);
  const result = await createClient(opts).environments.create({
    name: requiredString(opts.name, 'name'),
    description: opts.description,
    hosting_type: opts.hostingType,
    sandbox_provider: opts.sandboxProvider,
    config,
  });
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(`Created environment: ${formatEnvironment(result)}`);
}

export async function environmentUpdateCommand(id: string, opts: EnvironmentUpdateOptions) {
  const config = parseConfigJson(opts.configJson);
  const result = await createClient(opts).environments.update(id, {
    name: opts.name,
    description: opts.description,
    hosting_type: opts.hostingType,
    sandbox_provider: opts.sandboxProvider,
    config,
  });
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(`Updated environment: ${formatEnvironment(result)}`);
}

export async function environmentArchiveCommand(id: string, opts: CliConnectionOptions & JsonOutputOption) {
  const result = await createClient(opts).environments.archive(id);
  if (opts.json) {
    printJson(result);
    return;
  }
  console.log(`Archived environment: ${result.id} (${result.name})`);
}

export async function environmentWorkerKeysCommand(id: string, opts: CliConnectionOptions & JsonOutputOption) {
  const result = await createClient(opts).environments.workerKeys(id);
  if (opts.json) {
    printJson(result.data);
    return;
  }
  if (result.data.length === 0) {
    console.log('No worker keys for this environment.');
    return;
  }
  for (const key of result.data) {
    console.log(`${key.id}  ${key.status}  ${key.name}  ${key.key_prefix}`);
  }
}

function createClient(opts: CliConnectionOptions) {
  return new ManagedAgentsClient({
    baseUrl: `http://localhost:${opts.port}`,
    apiKey: opts.apiKey,
  });
}

function parseConfigJson(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--config-json must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: string | undefined, name: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`${name} is required`);
}

function formatSettings(settings: RuntimeSettingsSummary): string {
  const model = settings.model_provider;
  const metadata = settings.storage.metadata;
  const artifacts = settings.storage.artifacts;
  const memory = settings.memory.backend;
  return [
    `model: ${model.vendor}  api_key=${model.api_key_state}  base_url=${model.base_url ?? '-'}`,
    `loop: ${settings.loop_engine.type}  implemented=${settings.loop_engine.implemented}`,
    `metadata: ${metadata.type}  path=${metadata.path ?? metadata.connection_url ?? '-'}`,
    `artifacts: ${artifacts.type}  path=${artifacts.path ?? artifacts.bucket ?? '-'}`,
    `memory: ${memory.type}  implemented=${memory.implemented}`,
    `sandbox: ${settings.sandbox.type}  available=${settings.sandbox.available}`,
    `validation: ${settings.validation.status}`,
  ].join('\n');
}

function formatEnvironment(item: EnvironmentSummary): string {
  return `${item.id}  ${item.name}  ${item.hosting_type}  sandbox=${item.sandbox_provider ?? '-'}  status=${item.status}`;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
