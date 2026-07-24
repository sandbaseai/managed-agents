import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRegisteredWorkspace,
  listRegisteredWorkspaces,
  registerWorkspace,
  removeRegisteredWorkspace,
  resolveRegisteredWorkspace,
  workspaceRegistryPath,
} from '@/core/workspace/registry.js';

describe('workspace registry', () => {
  it('creates, lists, resolves, and removes workspace entries', () => {
    const home = mkdtempSync(join(tmpdir(), 'ma-home-'));
    const root = join(mkdtempSync(join(tmpdir(), 'ma-workspaces-')), 'acme');
    const now = new Date('2026-07-22T00:00:00.000Z');

    const created = createRegisteredWorkspace({ root, name: 'Acme', home, now });
    expect(created.name).toBe('Acme');
    expect(created.root).toBe(root);
    expect(created.data_dir).toContain(home);
    expect(readFileSync(join(root, 'managed-agents.config.yaml'), 'utf8')).toContain('environments:');

    expect(listRegisteredWorkspaces({ home })).toHaveLength(1);
    const opened = resolveRegisteredWorkspace('Acme', { home, now: new Date('2026-07-22T01:00:00.000Z') });
    expect(opened?.id).toBe(created.id);
    expect(opened?.last_opened_at).toBe('2026-07-22T01:00:00.000Z');

    expect(removeRegisteredWorkspace(created.id, { home })).toBe(true);
    expect(listRegisteredWorkspaces({ home })).toEqual([]);
    expect(workspaceRegistryPath(home)).toBe(join(home, 'workspaces.json'));
  });

  it('deduplicates registrations by root and supports explicit data dirs', () => {
    const home = mkdtempSync(join(tmpdir(), 'ma-home-'));
    const root = mkdtempSync(join(tmpdir(), 'ma-existing-'));
    const dataDir = join(root, '.runtime');

    registerWorkspace({ root, name: 'First', dataDir, home, now: new Date('2026-07-22T00:00:00.000Z') });
    const updated = registerWorkspace({ root, name: 'Second', dataDir, home, now: new Date('2026-07-22T02:00:00.000Z') });

    expect(updated.name).toBe('Second');
    expect(updated.data_dir).toBe(dataDir);
    expect(listRegisteredWorkspaces({ home })).toHaveLength(1);
  });
});
