import type { Database } from '@/core/db/database.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeSettings } from './schema.js';
import { localArtifactStorageDir, runtimeSettingsSecretStates } from './store.js';

export type RuntimeSettingsTestArea =
  | 'model'
  | 'loop_engine'
  | 'storage.metadata'
  | 'storage.artifacts'
  | 'memory'
  | 'sandbox';

export type RuntimeSettingsTestCheck = {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  message: string;
};

export type RuntimeSettingsTestResult = {
  ok: boolean;
  area: RuntimeSettingsTestArea;
  status: 'ok' | 'failed' | 'skipped';
  checks: RuntimeSettingsTestCheck[];
};

export function mergeRuntimeSettingsArea(
  base: RuntimeSettings,
  area: RuntimeSettingsTestArea,
  config: unknown,
): RuntimeSettings {
  const fragment = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  switch (area) {
    case 'model':
      return { ...base, model: fragment as RuntimeSettings['model'] };
    case 'loop_engine':
      return { ...base, loop_engine: fragment as RuntimeSettings['loop_engine'] };
    case 'storage.metadata':
      return { ...base, storage: { ...base.storage, metadata: fragment as RuntimeSettings['storage']['metadata'] } };
    case 'storage.artifacts':
      return { ...base, storage: { ...base.storage, artifacts: fragment as RuntimeSettings['storage']['artifacts'] } };
    case 'memory':
      return { ...base, memory: fragment as RuntimeSettings['memory'] };
    case 'sandbox':
      return { ...base, sandbox: fragment as RuntimeSettings['sandbox'] };
  }
}

export function testRuntimeSettingsArea(params: {
  db: Database;
  dataDir?: string;
  area: RuntimeSettingsTestArea;
  config: RuntimeSettings;
}): RuntimeSettingsTestResult {
  const checks = runChecks(params);
  const failed = checks.some((check) => check.status === 'failed');
  const skipped = checks.length > 0 && checks.every((check) => check.status === 'skipped');
  return {
    area: params.area,
    ok: !failed,
    status: failed ? 'failed' : skipped ? 'skipped' : 'ok',
    checks,
  };
}

function runChecks(params: {
  db: Database;
  dataDir?: string;
  area: RuntimeSettingsTestArea;
  config: RuntimeSettings;
}): RuntimeSettingsTestCheck[] {
  const { db, dataDir, area, config } = params;
  switch (area) {
    case 'model':
      return testModel(db, config);
    case 'loop_engine':
      return [{
        name: 'engine_available',
        status: config.loop_engine.provider === 'builtin' ? 'ok' : 'failed',
        message: config.loop_engine.provider === 'builtin'
          ? 'Built-in loop engine is available.'
          : `Loop engine "${config.loop_engine.provider}" is not installed.`,
      }];
    case 'storage.metadata':
      return testMetadataStorage(db, config);
    case 'storage.artifacts':
      return testArtifactStorage(dataDir, config);
    case 'memory':
      return testMemory(db, config);
    case 'sandbox':
      return testSandbox(dataDir, config);
  }
}

function testModel(db: Database, config: RuntimeSettings): RuntimeSettingsTestCheck[] {
  const checks: RuntimeSettingsTestCheck[] = [];
  const vendor = config.model.vendor;
  checks.push({
    name: 'vendor',
    status: ['openai', 'anthropic', 'openai_compatible'].includes(vendor) ? 'ok' : 'failed',
    message: `Model vendor is ${vendor}.`,
  });

  if (vendor === 'openai_compatible') {
    checks.push({
      name: 'base_url',
      status: config.model.base_url ? 'ok' : 'failed',
      message: config.model.base_url ? 'OpenAI-compatible base URL is configured.' : 'OpenAI-compatible vendors require base_url.',
    });
  } else if (config.model.base_url) {
    checks.push({
      name: 'base_url',
      status: 'ok',
      message: 'Custom base URL is configured.',
    });
  }

  checks.push({
    name: 'api_key',
    status: hasResolvableModelKey(db, config) ? 'ok' : 'failed',
    message: hasResolvableModelKey(db, config)
      ? 'Model API key is configured or resolves from the environment.'
      : 'Model API key is not configured or its environment variable is missing.',
  });
  return checks;
}

function testMetadataStorage(db: Database, config: RuntimeSettings): RuntimeSettingsTestCheck[] {
  if (config.storage.metadata.provider !== 'sqlite') {
    return [{
      name: 'metadata_provider',
      status: 'failed',
      message: `Metadata provider "${config.storage.metadata.provider}" is not installed.`,
    }];
  }
  try {
    const result = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    return [{
      name: 'sqlite_quick_check',
      status: result?.quick_check === 'ok' ? 'ok' : 'failed',
      message: result?.quick_check === 'ok' ? 'SQLite metadata database passed quick_check.' : 'SQLite metadata database failed quick_check.',
    }];
  } catch (err) {
    return [{ name: 'sqlite_quick_check', status: 'failed', message: err instanceof Error ? err.message : 'SQLite quick_check failed.' }];
  }
}

function testArtifactStorage(dataDir: string | undefined, config: RuntimeSettings): RuntimeSettingsTestCheck[] {
  if (!dataDir) return [{ name: 'artifact_data_dir', status: 'failed', message: 'Runtime data directory is not available.' }];
  try {
    const target = localArtifactStorageDir(dataDir, config);
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    const probe = join(target, `.managed-agents-write-test-${process.pid}-${Date.now()}`);
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    return [{ name: 'local_artifact_storage', status: 'ok', message: `Local artifact storage is writable at ${target}.` }];
  } catch (err) {
    return [{ name: 'local_artifact_storage', status: 'failed', message: err instanceof Error ? err.message : 'Artifact storage check failed.' }];
  }
}

function testMemory(db: Database, config: RuntimeSettings): RuntimeSettingsTestCheck[] {
  if (!config.memory.enabled) {
    return [{ name: 'memory_enabled', status: 'skipped', message: 'Context memory is disabled.' }];
  }
  if (config.memory.provider !== 'sqlite') {
    return [{ name: 'memory_provider', status: 'failed', message: `Memory provider "${config.memory.provider}" is not installed.` }];
  }
  try {
    db.prepare('SELECT 1').get();
    return [{ name: 'sqlite_memory', status: 'ok', message: 'SQLite memory backend is available.' }];
  } catch (err) {
    return [{ name: 'sqlite_memory', status: 'failed', message: err instanceof Error ? err.message : 'SQLite memory check failed.' }];
  }
}

function testSandbox(dataDir: string | undefined, config: RuntimeSettings): RuntimeSettingsTestCheck[] {
  if (config.sandbox.provider !== 'local') {
    return [{
      name: 'sandbox_live_health',
      status: 'skipped',
      message: `Sandbox provider "${config.sandbox.provider}" is selected. Live health checks are not implemented for this provider yet.`,
    }];
  }
  if (!dataDir) return [{ name: 'sandbox_data_dir', status: 'failed', message: 'Runtime data directory is not available.' }];
  const timeout = config.sandbox.options.timeout_seconds;
  const checks: RuntimeSettingsTestCheck[] = [{
    name: 'timeout',
    status: Number.isInteger(timeout) && timeout > 0 ? 'ok' : 'failed',
    message: `Sandbox timeout is ${timeout} seconds.`,
  }];
  try {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const probe = join(dataDir, `.managed-agents-sandbox-test-${process.pid}-${Date.now()}`);
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    checks.push({ name: 'local_data_dir', status: 'ok', message: 'Runtime data directory is writable for local sandbox work.' });
  } catch (err) {
    checks.push({ name: 'local_data_dir', status: 'failed', message: err instanceof Error ? err.message : 'Local sandbox directory check failed.' });
  }
  return checks;
}

function hasResolvableModelKey(db: Database, config: RuntimeSettings): boolean {
  const value = config.model.api_key;
  if (!value) return false;
  if (value === '********') return runtimeSettingsSecretStates(db, config).model.api_key === 'configured';
  const match = /^\$\{([^}]+)\}$/.exec(value);
  if (match) return Boolean(process.env[match[1]]);
  return true;
}
