import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { bootstrapRuntimeSandboxes } from '@/core/runtime/sandbox-bootstrap.js';

describe('runtime sandbox bootstrap', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeRuntime() {
    const directory = mkdtempSync(join(tmpdir(), 'ma-sandbox-bootstrap-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.db'));
    db.runMigrations();
    return { db, dataDir: directory };
  }

  it('always registers local and self-hosted sandbox providers', () => {
    const { db, dataDir } = makeRuntime();

    const result = bootstrapRuntimeSandboxes({
      db,
      dataDir,
      dockerAvailable: () => false,
    });

    expect(result.dockerAvailable).toBe(false);
    expect(result.sandboxProvider.type).toBe('local');
    expect(result.sandboxRegistry.listTypes()).toEqual(['local', 'self_hosted']);
    expect(result.sandboxRegistry.get('local')).toBe(result.sandboxProvider);
    expect(result.sandboxRegistry.has('self_hosted')).toBe(true);
    db.close();
  });

  it('registers docker when the docker CLI is available', () => {
    const { db, dataDir } = makeRuntime();

    const result = bootstrapRuntimeSandboxes({
      db,
      dataDir,
      dockerAvailable: () => true,
    });

    expect(result.dockerAvailable).toBe(true);
    expect(result.sandboxRegistry.listTypes()).toEqual(['local', 'docker', 'self_hosted']);
    expect(result.sandboxRegistry.has('docker')).toBe(true);
    db.close();
  });
});
