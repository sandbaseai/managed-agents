import { afterEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { defaultDataDir, defaultRuntimeHome, resolveDataDir, workspaceDataSlug } from '@/core/config/paths.js';

describe('runtime path defaults', () => {
  const originalHome = process.env.MANAGED_AGENTS_HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.MANAGED_AGENTS_HOME;
    } else {
      process.env.MANAGED_AGENTS_HOME = originalHome;
    }
  });

  it('stores runtime data under the user home by default', () => {
    delete process.env.MANAGED_AGENTS_HOME;

    const workspaceRoot = '/tmp/My Project';
    const dataDir = defaultDataDir(workspaceRoot);

    expect(dataDir.startsWith(join(homedir(), '.managed-agents'))).toBe(true);
    expect(dataDir).toContain(workspaceDataSlug(workspaceRoot));
  });

  it('uses a deterministic per-workspace slug', () => {
    expect(workspaceDataSlug('/tmp/My Project!')).toMatch(/^my-project-[a-f0-9]{8}$/);
    expect(workspaceDataSlug('/tmp/My Project!')).toBe(workspaceDataSlug('/tmp/My Project!'));
    expect(workspaceDataSlug('/tmp/Other Project')).not.toBe(workspaceDataSlug('/tmp/My Project!'));
  });

  it('supports MANAGED_AGENTS_HOME and explicit data-dir overrides', () => {
    process.env.MANAGED_AGENTS_HOME = '/tmp/managed-agents-home';

    expect(defaultRuntimeHome()).toBe('/tmp/managed-agents-home');
    expect(defaultDataDir('/tmp/workspace')).toBe(join('/tmp/managed-agents-home', workspaceDataSlug('/tmp/workspace')));
    expect(resolveDataDir('custom-data', '/tmp/workspace')).toBe(resolve('/tmp/workspace/custom-data'));
    expect(resolveDataDir('~/ma-data', '/tmp/workspace')).toBe(join(homedir(), 'ma-data'));
  });
});
