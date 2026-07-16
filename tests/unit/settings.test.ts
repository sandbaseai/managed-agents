import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describeSettingsAdapters, availabilityFromDescriptors } from '@/core/settings/adapters.js';
import { validateRuntimeSettings } from '@/core/settings/schema.js';
import { Database } from '@/core/db/database.js';
import { activateRuntimeSettings, getOrSeedRuntimeSettings, localArtifactStorageDir, modelConfigFromRuntimeSettings, saveRuntimeSettings } from '@/core/settings/store.js';

const validConfig = {
  schema_version: 1,
  model: { vendor: 'openai', api_key: '${OPENAI_API_KEY}', options: {} },
  loop_engine: { provider: 'builtin', options: { default_max_steps: 25 } },
  storage: {
    metadata: { provider: 'sqlite', options: {} },
    artifacts: { provider: 'local', options: { base_path: 'files' } },
  },
  memory: { enabled: true, provider: 'sqlite', options: {} },
  sandbox: { provider: 'local', options: { timeout_seconds: 300 } },
};

describe('Settings V2 schema', () => {
  it('normalizes a valid built-in configuration', () => {
    const result = validateRuntimeSettings(validConfig);
    expect(result.valid).toBe(true);
    expect(result.normalized_config?.loop_engine.options.default_max_steps).toBe(25);
  });

  it('rejects unknown top-level keys', () => {
    const result = validateRuntimeSettings({ ...validConfig, unexpected: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'unrecognized_keys')).toBe(true);
  });

  it('rejects adapters that are planned but unavailable', () => {
    const result = validateRuntimeSettings({
      ...validConfig,
      loop_engine: { provider: 'codex', options: { default_max_steps: 25 } },
      memory: { enabled: true, provider: 'mem0', options: {} },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'loop_engine.provider', code: 'adapter_unavailable' }),
      expect.objectContaining({ path: 'memory.provider', code: 'adapter_unavailable' }),
    ]));
  });

  it('uses installed sandbox capabilities during validation', () => {
    const descriptors = describeSettingsAdapters(['local', 'docker']);
    const result = validateRuntimeSettings({
      ...validConfig,
      sandbox: { provider: 'docker', options: { timeout_seconds: 300 } },
    }, availabilityFromDescriptors(descriptors));
    expect(result.valid).toBe(true);
  });
});

describe('Settings V2 activation', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('activates the saved revision on the next runtime start', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ma-settings-'));
    directories.push(directory);
    const db = new Database(join(directory, 'settings.db'));
    db.runMigrations();
    const initial = getOrSeedRuntimeSettings(db);
    const changed = {
      ...initial.saved_config,
      loop_engine: { provider: 'builtin' as const, options: { default_max_steps: 64 } },
    };
    const saved = saveRuntimeSettings(db, changed, initial.revision, directory);
    expect(saved.ok).toBe(true);
    expect(getOrSeedRuntimeSettings(db).restart_required).toBe(true);
    const activated = activateRuntimeSettings(db);
    expect(activated.restart_required).toBe(false);
    expect(activated.effective_config.loop_engine.options.default_max_steps).toBe(64);
    db.close();
  });

  it('builds the default runtime model from the effective settings without a UI model ID', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ma-settings-model-'));
    directories.push(directory);
    const db = new Database(join(directory, 'settings.db'));
    db.runMigrations();
    const initial = getOrSeedRuntimeSettings(db);
    const config = { ...initial.effective_config, model: { vendor: 'anthropic' as const, options: {} } };
    const model = modelConfigFromRuntimeSettings(db, config, directory);
    expect(model).toMatchObject({ name: 'default', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    db.close();
  });

  it('resolves local artifact storage beneath the runtime data directory', () => {
    expect(localArtifactStorageDir('/tmp/runtime', validConfig)).toBe('/tmp/runtime/files');
    expect(() => localArtifactStorageDir('/tmp/runtime', {
      ...validConfig,
      storage: { ...validConfig.storage, artifacts: { provider: 'local' as const, options: { base_path: '../escape' } } },
    })).toThrow(/inside the runtime data directory/);
  });
});
