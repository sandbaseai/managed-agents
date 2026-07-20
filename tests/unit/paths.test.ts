import { afterEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { defaultConfigPath, defaultDataDir, defaultLogFile, defaultRuntimeHome, resolveConfigPath, resolveDataDir, resolveLogFile } from '@/core/config/paths.js';

describe('runtime path defaults', () => {
  const originalHome = process.env.MANAGED_AGENTS_HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.MANAGED_AGENTS_HOME;
    } else {
      process.env.MANAGED_AGENTS_HOME = originalHome;
    }
  });

  it('stores workspace runtime data under the workspace by default', () => {
    delete process.env.MANAGED_AGENTS_HOME;

    const workspaceRoot = '/tmp/My Project';

    expect(defaultDataDir(workspaceRoot)).toBe('/tmp/My Project/.managed-agents');
    expect(defaultConfigPath(workspaceRoot)).toBe('/tmp/My Project/.managed-agents/config.yaml');
    expect(defaultLogFile(workspaceRoot)).toBe('/tmp/My Project/.managed-agents/logs/runtime.log');
  });

  it('supports MANAGED_AGENTS_HOME for global cache and explicit workspace path overrides', () => {
    process.env.MANAGED_AGENTS_HOME = '/tmp/managed-agents-home';

    expect(defaultRuntimeHome()).toBe('/tmp/managed-agents-home');
    expect(defaultDataDir('/tmp/workspace')).toBe('/tmp/workspace/.managed-agents');
    expect(resolveDataDir('custom-data', '/tmp/workspace')).toBe(resolve('/tmp/workspace/custom-data'));
    expect(resolveConfigPath('custom.yaml', '/tmp/workspace')).toBe(resolve('/tmp/workspace/custom.yaml'));
    expect(resolveLogFile('logs/dev.log', '/tmp/workspace')).toBe(resolve('/tmp/workspace/logs/dev.log'));
    expect(resolveDataDir('~/ma-data', '/tmp/workspace')).toBe(join(homedir(), 'ma-data'));
  });
});
