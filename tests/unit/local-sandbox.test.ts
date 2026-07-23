/**
 * Unit tests for Local Sandbox Provider.
 * Validates: Requirements 12.1, 12.2, 12.5, Property 20
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

    it('does not inherit arbitrary service environment variables', async () => {
      process.env.MANAGED_AGENTS_TEST_SECRET = 'must-not-leak';
      try {
        const sandbox = await provider.provision('sess_env', {
          name: 'local',
          sandbox_provider: 'local',
        });
        const result = await sandbox.execute('printf %s "${MANAGED_AGENTS_TEST_SECRET:-}"');
        expect(result.stdout).toBe('');
      } finally {
        delete process.env.MANAGED_AGENTS_TEST_SECRET;
      }
    });

    it('passes explicitly supplied command environment variables', async () => {
      const sandbox = await provider.provision('sess_env_explicit', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const result = await sandbox.execute('printf %s "$INJECTED_VALUE"', {
        env: { INJECTED_VALUE: 'allowed' },
      });
      expect(result.stdout).toBe('allowed');
    });

    it('times out long-running commands (Property 20)', async () => {
      const sandbox = await provider.provision('sess_timeout', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const result = await sandbox.execute('sleep 10', { timeout: 100 });
      expect(result.timedOut).toBe(true);
    });

    it('rejects cwd paths that escape the sandbox workspace', async () => {
      const sandbox = await provider.provision('sess_exec_escape', {
        name: 'local',
        sandbox_provider: 'local',
      });

      await expect(sandbox.execute('pwd', { cwd: '..' })).rejects.toThrow(
        'Path escapes sandbox workspace',
      );
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

    it('rejects writes that escape the sandbox workspace', async () => {
      const sandbox = await provider.provision('sess_write_escape', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const outsidePath = join(tmpDir, 'escape.txt');

      await expect(sandbox.writeFile('../escape.txt', 'oops')).rejects.toThrow(
        'Path escapes sandbox workspace',
      );
      expect(existsSync(outsidePath)).toBe(false);
    });

    it('rejects reads that escape the sandbox workspace', async () => {
      const sandbox = await provider.provision('sess_read_escape', {
        name: 'local',
        sandbox_provider: 'local',
      });
      writeFileSync(join(tmpDir, 'secret.txt'), 'secret');

      await expect(sandbox.readFile('../secret.txt')).rejects.toThrow(
        'Path escapes sandbox workspace',
      );
    });

    it('rejects writes through symlinks that point outside the sandbox workspace', async () => {
      const sandbox = await provider.provision('sess_symlink_escape', {
        name: 'local',
        sandbox_provider: 'local',
      });
      const workDir = join(tmpDir, 'sandbox', 'sess_symlink_escape');
      const outsidePath = join(tmpDir, 'outside.txt');
      writeFileSync(outsidePath, 'outside');
      symlinkSync(outsidePath, join(workDir, 'link.txt'));

      await expect(sandbox.writeFile('link.txt', 'oops')).rejects.toThrow(
        'Path escapes sandbox workspace',
      );
      expect(readFileSync(outsidePath, 'utf-8')).toBe('outside');
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

    it('rejects list paths that escape the sandbox workspace', async () => {
      const sandbox = await provider.provision('sess_list_escape', {
        name: 'local',
        sandbox_provider: 'local',
      });

      await expect(sandbox.listFiles('..')).rejects.toThrow(
        'Path escapes sandbox workspace',
      );
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
