import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { getRuntimeSettings, updateRuntimeSettings, validateRuntimeSettings } from '@/core/settings/schema.js';

describe('runtime settings schema', () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-settings-'));
    db = new Database(join(tmpDir, 'settings.db'));
    db.runMigrations();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('projects existing provider tables into one canonical settings object', () => {
    const settings = getRuntimeSettings(db, {
      dataDir: tmpDir,
      sandboxProviders: ['local'],
    });

    expect(settings).toMatchObject({
      type: 'settings',
      loop_engine: { type: 'managed-agents', implemented: true },
      storage: {
        metadata: { type: 'sqlite', implemented: true },
        artifacts: { type: 'local_filesystem', implemented: true },
      },
      memory: { backend: { type: 'sqlite', implemented: true } },
      sandbox: { type: 'local', available: true },
    });
    expect(settings.validation.status).toBe('warning');
  });

  it('validates future adapters without pretending they are implemented', () => {
    const validation = validateRuntimeSettings({
      model_provider: { vendor: 'anthropic', api_key_env: 'ANTHROPIC_API_KEY' },
      memory: { backend: { type: 'mem0', api_key_env: 'MEM0_API_KEY' } },
      storage: {
        metadata: { type: 'postgres', connection_url: '${DATABASE_URL}' },
        artifacts: { type: 's3', bucket: 'agent-artifacts' },
      },
    });

    expect(validation.status).toBe('error');
    expect(validation.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'storage.metadata', status: 'error' }),
      expect.objectContaining({ key: 'storage.artifacts', status: 'error' }),
      expect.objectContaining({ key: 'memory.backend', status: 'error' }),
    ]));
  });

  it('updates active settings through sanitized env references', () => {
    const settings = updateRuntimeSettings(db, {
      model_provider: {
        vendor: 'anthropic',
        base_url: 'https://api.anthropic.com/v1',
        api_key_env: 'ANTHROPIC_API_KEY',
      },
      loop_engine: {
        type: 'managed-agents',
        config: { max_concurrent_turns: 1 },
      },
      memory: { backend: { type: 'sqlite' } },
      storage: {
        metadata: { type: 'sqlite', path: 'data.db' },
        artifacts: { type: 'local_filesystem', path: 'files' },
      },
      sandbox: {
        type: 'local',
        config: { workspace_root: tmpDir },
      },
    }, {
      dataDir: tmpDir,
      sandboxProviders: ['local'],
    });

    expect(settings.model_provider).toMatchObject({
      vendor: 'anthropic',
      base_url: 'https://api.anthropic.com/v1',
      api_key_env: 'ANTHROPIC_API_KEY',
      api_key_state: 'missing_env',
      configured: true,
    });
    expect(JSON.stringify(settings)).not.toContain('${ANTHROPIC_API_KEY}');
    expect(settings.loop_engine).toMatchObject({
      type: 'managed-agents',
      implemented: true,
      config: { max_concurrent_turns: 1 },
    });
    expect(settings.sandbox).toMatchObject({
      type: 'local',
      implemented: true,
      available: true,
      config: { workspace_root: tmpDir },
    });

    const row = db.prepare('SELECT provider, model, api_key, is_default FROM models WHERE is_default = 1').get() as {
      provider: string;
      model: string;
      api_key: string;
      is_default: number;
    };
    expect(row).toMatchObject({
      provider: 'anthropic',
      model: 'anthropic',
      api_key: '${ANTHROPIC_API_KEY}',
      is_default: 1,
    });

    expect(getRuntimeSettings(db, { dataDir: tmpDir, sandboxProviders: ['local'] }).sandbox.config).toEqual({ workspace_root: tmpDir });
  });
});
