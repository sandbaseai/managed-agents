import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRuntimeConfig, openRuntimeDatabase, resolveRuntimePaths } from '@/core/runtime/bootstrap.js';

describe('runtime bootstrap', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('resolves runtime paths relative to the workspace root', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-runtime-bootstrap-'));
    const paths = resolveRuntimePaths({
      cwd: tmpDir,
      dataDir: '.data',
      agentsDir: 'agents',
      skillsDir: 'skills',
      config: 'managed-agents.config.yaml',
      target: 'cloud',
    });

    expect(paths).toMatchObject({
      workspaceRoot: tmpDir,
      dataDir: join(tmpDir, '.data'),
      agentsDir: join(tmpDir, 'agents'),
      skillsDir: join(tmpDir, 'skills'),
      configPath: join(tmpDir, 'managed-agents.config.yaml'),
      target: 'cloud',
    });
  });

  it('opens the runtime database and seeds the default environment', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-runtime-bootstrap-'));
    const dataDir = join(tmpDir, 'data');
    const db = openRuntimeDatabase(dataDir);
    try {
      expect(existsSync(join(dataDir, 'data.db'))).toBe(true);
      const env = db.prepare('SELECT id, name FROM environments WHERE id = ?').get('env_default') as { id: string; name: string };
      expect(env).toMatchObject({ id: 'env_default', name: 'local' });
    } finally {
      db.close();
    }
  });

  it('loads config api keys, target model overrides, sqlite memory, and environments', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-runtime-bootstrap-'));
    const db = openRuntimeDatabase(join(tmpDir, 'data'));
    const configPath = join(tmpDir, 'managed-agents.config.yaml');
    writeFileSync(configPath, [
      'api_keys:',
      '  - key_static',
      'memory:',
      '  provider: sqlite',
      'models:',
      '  - name: default',
      '    provider: anthropic',
      '    model: claude-base',
      '    api_key: base-key',
      'overrides:',
      '  cloud:',
      '    models:',
      '      - name: default',
      '        model: claude-cloud',
      '        base_url: https://example.test/v1',
      '        is_default: true',
      'environments:',
      '  staging:',
      '    sandbox_provider: local',
      '',
    ].join('\n'));

    try {
      const result = loadRuntimeConfig(configPath, 'cloud', db);
      expect(result.apiKeys).toEqual(['key_static']);
      expect(result.memory?.name).toBe('sqlite');
      expect(result.models).toEqual([
        expect.objectContaining({
          name: 'default',
          provider: 'anthropic',
          model: 'claude-cloud',
          api_key: 'base-key',
          base_url: 'https://example.test/v1',
          is_default: true,
        }),
      ]);
      const env = db.prepare('SELECT name FROM environments WHERE name = ?').get('staging') as { name: string };
      expect(env.name).toBe('staging');
    } finally {
      db.close();
    }
  });
});
