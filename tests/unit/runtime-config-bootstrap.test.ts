import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { ensureDefaultEnvironment, loadRuntimeConfigBootstrap } from '@/core/runtime/config-bootstrap.js';

describe('runtime config bootstrap', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeDb() {
    const directory = mkdtempSync(join(tmpdir(), 'ma-runtime-config-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.db'));
    db.runMigrations();
    return { db, directory };
  }

  it('seeds the default environment exactly once', () => {
    const { db } = makeDb();

    ensureDefaultEnvironment(db);
    ensureDefaultEnvironment(db);

    const rows = db.prepare('SELECT id, name, config FROM environments WHERE id = ?').all('env_default') as Array<{ id: string; name: string; config: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'env_default', name: 'local' });
    expect(JSON.parse(rows[0].config)).toMatchObject({ sandbox_provider: 'local', timeout: 300 });
    db.close();
  });

  it('returns an empty bootstrap when config is missing', () => {
    const { db, directory } = makeDb();

    const bootstrap = loadRuntimeConfigBootstrap({
      db,
      configPath: join(directory, 'missing.yaml'),
      target: 'local',
    });

    expect(bootstrap).toEqual({ models: [], settingsSeed: {} });
    db.close();
  });

  it('loads model connection overrides, memory, and environments', () => {
    const { db, directory } = makeDb();
    const configPath = join(directory, 'managed-agents.config.yaml');
    writeFileSync(configPath, [
      'memory:',
      '  enabled: true',
      '  provider: sqlite',
      'storage:',
      '  metadata:',
      '    provider: sqlite',
      '    options: {}',
      '  artifacts:',
      '    provider: local',
      '    options:',
      '      base_path: runtime-files',
      'model:',
      '  provider: openai',
      '  api_key: ${OPENAI_API_KEY}',
      'overrides:',
      '  cloud:',
      '    model:',
      '      base_url: https://example.test/v1',
      'environments:',
      '  ci:',
      '    sandbox_provider: local',
      '    timeout: 120',
      '',
    ].join('\n'));

    const bootstrap = loadRuntimeConfigBootstrap({ db, configPath, target: 'cloud' });

    expect(bootstrap.models).toEqual([expect.objectContaining({
      name: 'default',
      provider: 'openai',
      base_url: 'https://example.test/v1',
      api_key: '${OPENAI_API_KEY}',
      is_default: true,
    })]);
    expect(bootstrap.settingsSeed).toEqual({
      memory: { enabled: true, provider: 'sqlite', options: {} },
      storage: {
        metadata: { provider: 'sqlite', options: {} },
        artifacts: { provider: 'local', options: { base_path: 'runtime-files' } },
      },
    });
    const row = db.prepare('SELECT name, config FROM environments WHERE name = ?').get('ci') as { name: string; config: string } | undefined;
    expect(row?.name).toBe('ci');
    expect(JSON.parse(row?.config ?? '{}')).toMatchObject({ sandbox_provider: 'local', timeout: 120 });
    db.close();
  });
});
