import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalArtifactStore } from '@/core/storage/artifact-store.js';

describe('LocalArtifactStore', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('writes, reads, and removes artifacts under the configured root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ma-artifacts-'));
    directories.push(root);
    const store = new LocalArtifactStore(root);
    const path = store.path('files', 'file_123');

    store.writeFile(path, Buffer.from('hello'));

    expect(store.exists(path)).toBe(true);
    expect(store.readFile(path).toString('utf8')).toBe('hello');
    store.remove(path);
    expect(existsSync(path)).toBe(false);
  });

  it('rejects artifact paths outside the configured root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ma-artifacts-'));
    directories.push(root);
    const store = new LocalArtifactStore(root);

    expect(() => store.path('..', 'escape')).toThrow(/escapes/);
    expect(store.contains(join(root, '..', 'escape'))).toBe(false);
  });
});
