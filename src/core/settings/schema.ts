import { z } from 'zod';

const optionsSchema = z.record(z.unknown()).default({});

export const runtimeSettingsSchema = z.object({
  schema_version: z.literal(1),
  model: z.object({
    vendor: z.enum(['openai', 'anthropic', 'openai_compatible']),
    base_url: z.string().url().optional(),
    api_key: z.string().min(1).optional(),
    options: optionsSchema,
  }).strict(),
  loop_engine: z.object({
    provider: z.enum(['builtin', 'harness', 'codex', 'claude']),
    options: z.object({
      default_max_steps: z.number().int().min(1).max(1_000).default(25),
    }).catchall(z.unknown()),
  }).strict(),
  storage: z.object({
    metadata: z.object({
      provider: z.enum(['sqlite', 'postgres', 'mysql']),
      options: optionsSchema,
    }).strict(),
    artifacts: z.object({
      provider: z.enum(['local', 's3']),
      options: optionsSchema,
    }).strict(),
  }).strict(),
  memory: z.object({
    enabled: z.boolean(),
    provider: z.enum(['sqlite', 'memu', 'mem0']),
    options: optionsSchema,
  }).strict(),
  sandbox: z.object({
    provider: z.enum(['local', 'docker', 'remote']),
    options: z.object({
      timeout_seconds: z.number().int().min(1).max(86_400).default(300),
    }).catchall(z.unknown()),
  }).strict(),
}).strict();

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

export type SettingsValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type SettingsValidationResult = {
  valid: boolean;
  normalized_config?: RuntimeSettings;
  errors: SettingsValidationIssue[];
  warnings: SettingsValidationIssue[];
};

export type SettingsAvailability = {
  modelVendors: Set<RuntimeSettings['model']['vendor']>;
  loopEngines: Set<RuntimeSettings['loop_engine']['provider']>;
  metadataStorage: Set<RuntimeSettings['storage']['metadata']['provider']>;
  artifactStorage: Set<RuntimeSettings['storage']['artifacts']['provider']>;
  memoryProviders: Set<RuntimeSettings['memory']['provider']>;
  sandboxProviders: Set<RuntimeSettings['sandbox']['provider']>;
};

export function validateRuntimeSettings(
  input: unknown,
  availability: SettingsAvailability = defaultSettingsAvailability(),
): SettingsValidationResult {
  const parsed = runtimeSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
      warnings: [],
    };
  }

  const config = parsed.data;
  const errors: SettingsValidationIssue[] = [];
  requireAvailable(errors, 'model.vendor', config.model.vendor, availability.modelVendors);
  requireAvailable(errors, 'loop_engine.provider', config.loop_engine.provider, availability.loopEngines);
  requireAvailable(errors, 'storage.metadata.provider', config.storage.metadata.provider, availability.metadataStorage);
  requireAvailable(errors, 'storage.artifacts.provider', config.storage.artifacts.provider, availability.artifactStorage);
  if (config.memory.enabled) {
    requireAvailable(errors, 'memory.provider', config.memory.provider, availability.memoryProviders);
  }
  requireAvailable(errors, 'sandbox.provider', config.sandbox.provider, availability.sandboxProviders);

  return {
    valid: errors.length === 0,
    normalized_config: config,
    errors,
    warnings: [],
  };
}

export function defaultSettingsAvailability(): SettingsAvailability {
  return {
    modelVendors: new Set(['openai', 'anthropic', 'openai_compatible']),
    loopEngines: new Set(['builtin']),
    metadataStorage: new Set(['sqlite']),
    artifactStorage: new Set(['local']),
    memoryProviders: new Set(['sqlite']),
    sandboxProviders: new Set(['local']),
  };
}

function requireAvailable<T extends string>(
  errors: SettingsValidationIssue[],
  path: string,
  value: T,
  available: Set<T>,
): void {
  if (available.has(value)) return;
  errors.push({
    path,
    code: 'adapter_unavailable',
    message: `Adapter "${value}" is not available in this runtime`,
  });
}

