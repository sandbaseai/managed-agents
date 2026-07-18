import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { createManagedApiKey } from '@/core/auth/api-keys.js';
import { resolveRuntimeApiAuth } from '@/core/runtime/api-auth.js';

describe('runtime API auth', () => {
  const directories: string[] = [];
  const originalEnvKey = process.env.MANAGED_AGENTS_API_KEY;

  afterEach(() => {
    if (originalEnvKey === undefined) delete process.env.MANAGED_AGENTS_API_KEY;
    else process.env.MANAGED_AGENTS_API_KEY = originalEnvKey;
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeDb() {
    const directory = mkdtempSync(join(tmpdir(), 'ma-api-auth-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.db'));
    db.runMigrations();
    return db;
  }

  it('merges config and environment API keys', () => {
    const db = makeDb();
    process.env.MANAGED_AGENTS_API_KEY = 'env-one, env-two';

    const auth = resolveRuntimeApiAuth({ db, configKeys: ['config-one', 'env-one'] });

    expect(auth.apiKeys).toEqual(['config-one', 'env-one', 'env-two']);
    expect(auth.hasApiKeys()).toBe(true);
    expect(auth.validateApiKey('config-one')).toBe(true);
    expect(auth.validateApiKey('env-two')).toBe(true);
    expect(auth.validateApiKey('missing')).toBe(false);
    db.close();
  });

  it('dynamically enables auth when a managed key exists in SQLite', () => {
    const db = makeDb();
    delete process.env.MANAGED_AGENTS_API_KEY;

    const auth = resolveRuntimeApiAuth({ db, configKeys: [] });
    expect(auth.hasApiKeys()).toBe(false);

    const created = createManagedApiKey(db, 'Dashboard key');

    expect(auth.hasApiKeys()).toBe(true);
    expect(auth.validateApiKey(created.secret_key)).toBe(true);
    expect(auth.validateApiKey('missing')).toBe(false);
    db.close();
  });
});
