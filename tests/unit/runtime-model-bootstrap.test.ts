import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { seedModelProviders } from '@/core/model/providers.js';
import { bootstrapRuntimeModelRegistry } from '@/core/runtime/model-bootstrap.js';

describe('runtime model bootstrap', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeDb() {
    const directory = mkdtempSync(join(tmpdir(), 'ma-model-bootstrap-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.db'));
    db.runMigrations();
    return db;
  }

  it('seeds config models into an empty workspace and registers the default runtime model', () => {
    const db = makeDb();

    const result = bootstrapRuntimeModelRegistry({
      db,
      configModels: [
        {
          name: 'default',
          provider: 'openai',
          model: 'gpt-4o',
          api_key: '${OPENAI_API_KEY}',
        },
        {
          name: 'anthropic',
          provider: 'anthropic',
          model: 'claude-sonnet',
        },
      ],
    });

    expect(result.providers.map((provider) => provider.name)).toEqual(['default', 'anthropic']);
    expect(result.defaultProvider?.name).toBe('default');
    expect(result.modelRegistry.listNames()).toEqual(['default', 'anthropic']);
    expect(result.modelRegistry.getDefaultName()).toBe('default');
    expect(result.modelRegistry.get('default')).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      api_key: '${OPENAI_API_KEY}',
    });
    db.close();
  });

  it('keeps existing Dashboard-managed providers as the runtime source of truth', () => {
    const db = makeDb();
    seedModelProviders(db, [{
      name: 'dashboard-default',
      provider: 'openai',
      model: 'gpt-4o-mini',
    }]);

    const result = bootstrapRuntimeModelRegistry({
      db,
      configModels: [{
        name: 'yaml-default',
        provider: 'anthropic',
        model: 'claude-sonnet',
      }],
    });

    expect(result.providers.map((provider) => provider.name)).toEqual(['dashboard-default']);
    expect(result.defaultProvider?.name).toBe('dashboard-default');
    expect(result.modelRegistry.listNames()).toEqual(['dashboard-default']);
    expect(result.modelRegistry.getDefaultName()).toBe('dashboard-default');
    expect(result.modelRegistry.get('yaml-default')).toBeUndefined();
    db.close();
  });
});
