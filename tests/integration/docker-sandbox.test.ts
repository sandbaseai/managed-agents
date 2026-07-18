/**
 * Tests for the sandbox provider registry and Docker provider (R12.3, R12.4).
 *
 * Registry tests always run. Real container execution tests run only when the
 * `docker` CLI is available (skipped otherwise).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxProviderRegistry } from '@/sandbox/registry.js';
import { LocalSandboxProvider } from '@/sandbox/local-provider.js';
import { DockerSandboxProvider, dockerWorkspacePath, isDockerAvailable } from '@/sandbox/docker-provider.js';

/** Find a locally-cached Docker image so tests don't require registry access. */
function findLocalImage(): string | undefined {
  try {
    const r = spawnSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    if (r.status !== 0) return undefined;
    const images = r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.includes('<none>'));
    return images[0];
  } catch {
    return undefined;
  }
}

describe('SandboxProviderRegistry', () => {
  it('registers and resolves a provider by type', () => {
    const reg = new SandboxProviderRegistry();
    const local = new LocalSandboxProvider(tmpdir());
    reg.register(local);
    expect(reg.has('local')).toBe(true);
    expect(reg.get('local')).toBe(local);
    expect(reg.listTypes()).toContain('local');
  });

  it('throws a descriptive error with install hint for a missing provider', () => {
    const reg = new SandboxProviderRegistry();
    reg.register(new LocalSandboxProvider(tmpdir()));
    expect(() => reg.get('docker')).toThrow(/not available/);
    expect(() => reg.get('docker')).toThrow(/Docker/);
  });

  it('has() returns false for unregistered types', () => {
    const reg = new SandboxProviderRegistry();
    expect(reg.has('e2b')).toBe(false);
  });
});

describe('DockerSandboxProvider', () => {
  it('reports the correct type', () => {
    expect(new DockerSandboxProvider().type).toBe('docker');
  });

  it('keeps file paths inside the container workspace', () => {
    expect(dockerWorkspacePath('src/index.ts')).toBe('/workspace/src/index.ts');
    expect(dockerWorkspacePath('')).toBe('/workspace');
    expect(() => dockerWorkspacePath('../etc/passwd')).toThrow(/inside \/workspace/);
    expect(() => dockerWorkspacePath('/etc/passwd')).toThrow(/inside \/workspace/);
  });

  const localImage = isDockerAvailable() ? findLocalImage() : undefined;
  const dockerTests = localImage ? describe : describe.skip;
  dockerTests('with a running Docker daemon + cached image', () => {
    let tmpDir: string;
    let provider: DockerSandboxProvider;

    it('provisions, executes, writes/reads files, and cleans up', async () => {
      tmpDir = mkdtempSync(join(tmpdir(), 'ma-docker-'));
      provider = new DockerSandboxProvider();
      const sandbox = await provider.provision('sess_docker_test', {
        name: 'docker',
        sandbox_provider: 'docker',
        timeout: 60,
        image: localImage,
      });
      try {
        const r = await sandbox.execute('echo hello-docker');
        expect(r.exitCode).toBe(0);
        expect(r.stdout.trim()).toBe('hello-docker');

        await sandbox.writeFile('test.txt', 'in container');
        const content = await sandbox.readFile('test.txt');
        expect(content).toBe('in container');

        const files = await sandbox.listFiles('.');
        expect(files).toContain('test.txt');
      } finally {
        await sandbox.cleanup();
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 120_000);
  });
});
