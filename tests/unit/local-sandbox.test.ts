/**
 * Unit tests for Local Sandbox Provider.
 * Validates: Requirements 12.1, 12.2, 12.5, Property 20
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { LocalSandboxProvider } from '@/sandbox/local-provider.js';

describe('Local Sandbox Provider', () => {
  let provider: LocalSandboxProvider;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-sandbox-'));
    provider = new LocalSandboxProvider(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('provision', () => {
    it('creates a working directory for the session', async () => {
      const sandbox = await provider.provision('sess_test', {
        name: 'local',
        sandbox_provider: 'local',
      });
      expect(sandbox.sessionId).toBe('sess_test');
      expect(existsSync(join(tmpDir, 'sandbox', 'sess_test'))).toBe(true);
    });
  });

  describe('execute', () => {
    it('runs a command and returns stdout', async () => {
      const sandbox = await provider.provision('sess_exec', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const result = await sandbox.execute('echo "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.timedOut).toBe(false);
    });

    it('returns stderr on error', async () => {
      const sandbox = await provider.provision('sess_err', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const result = await sandbox.execute('echo "error" >&2 && exit 1');
      expect(result.exitCode).toBe(1);
      expect(result.stderr.trim()).toBe('error');
    });

    it('times out long-running commands (Property 20)', async () => {
      const sandbox = await provider.provision('sess_timeout', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const result = await sandbox.execute('sleep 10', { timeout: 100 });
      expect(result.timedOut).toBe(true);
    });
  });

  describe('writeFile / readFile', () => {
    it('writes and reads a file', async () => {
      const sandbox = await provider.provision('sess_fs', {
        name: 'local',
        sandbox_provider: 'local',
      });
      await sandbox.writeFile('test.txt', 'hello');
      const content = await sandbox.readFile('test.txt');
      expect(content).toBe('hello');
    });

    it('creates nested directories', async () => {
      const sandbox = await provider.provision('sess_nested', {
        name: 'local',
        sandbox_provider: 'local',
      });
      await sandbox.writeFile('a/b/c.txt', 'deep');
      const content = await sandbox.readFile('a/b/c.txt');
      expect(content).toBe('deep');
    });
  });

  describe('listFiles', () => {
    it('lists files recursively', async () => {
      const sandbox = await provider.provision('sess_list', {
        name: 'local',
        sandbox_provider: 'local',
      });
      await sandbox.writeFile('file1.txt', 'a');
      await sandbox.writeFile('dir/file2.txt', 'b');

      const files = await sandbox.listFiles('.');
      expect(files).toContain('file1.txt');
      expect(files).toContain('dir/file2.txt');
    });

    it('returns empty array for non-existent path', async () => {
      const sandbox = await provider.provision('sess_empty', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const files = await sandbox.listFiles('nonexistent');
      expect(files).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('removes the working directory', async () => {
      const sandbox = await provider.provision('sess_cleanup', {
        name: 'local',
        sandbox_provider: 'local',
      });
      await sandbox.writeFile('test.txt', 'data');
      await sandbox.cleanup();
      expect(existsSync(join(tmpDir, 'sandbox', 'sess_cleanup'))).toBe(false);
    });
  });
});
