/**
 * Docker Sandbox Provider
 *
 * Runs agent commands inside an isolated Docker container (one container per
 * session, 1:1 with the Session lifecycle). Provides real process isolation,
 * unlike the local subprocess provider.
 *
 * Requires the `docker` CLI on PATH. provision() starts a long-lived container
 * (`docker run -d ... sleep infinity`); execute() uses `docker exec`; files are
 * transferred via `docker cp`; cleanup() removes the container.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type {
  SandboxProvider,
  SandboxInstance,
  EnvironmentConfig,
  ExecOptions,
  ExecResult,
} from '@/types/sandbox.js';

const DEFAULT_IMAGE = 'node:22-slim';
const WORKDIR = '/workspace';

/** True if the `docker` CLI is available on PATH. */
export function isDockerAvailable(): boolean {
  try {
    const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly type = 'docker';

  async provision(sessionId: string, config: EnvironmentConfig): Promise<SandboxInstance> {
    const image = config.image ?? DEFAULT_IMAGE;
    const containerName = `ma-sandbox-${safeContainerSuffix(sessionId)}`;

    // Override the image's own entrypoint with `sleep` so the container stays
    // alive as a plain command host regardless of what the image declares.
    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--label',
      `managed-agents.session=${sessionId}`,
      '-w',
      WORKDIR,
      '--entrypoint',
      'sleep',
    ];
    // Resource limits
    if (config.resources?.memory) args.push('--memory', config.resources.memory);
    if (config.resources?.cpu) args.push('--cpus', String(config.resources.cpu));
    args.push(image, 'infinity');

    const run = spawnSync('docker', args, { encoding: 'utf-8', timeout: 30_000 });
    if (run.status !== 0) {
      throw new Error(`docker run failed: ${run.stderr || run.stdout || 'unknown error'}`);
    }

    // Ensure workdir exists
    spawnSync('docker', ['exec', containerName, 'mkdir', '-p', WORKDIR], { timeout: 10_000 });

    return new DockerSandboxInstance(sessionId, containerName);
  }
}

class DockerSandboxInstance implements SandboxInstance {
  constructor(
    readonly sessionId: string,
    private readonly containerName: string,
  ) {}

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    const timeout = options?.timeout ?? 300_000;
    const cwd = options?.cwd ? dockerWorkspacePath(options.cwd) : WORKDIR;

    const execArgs = ['exec', '-w', cwd];
    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        execArgs.push('-e', `${k}=${v}`);
      }
    }
    execArgs.push(this.containerName, '/bin/sh', '-c', command);

    return new Promise<ExecResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let done = false;

      const proc = spawn('docker', execArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
        }
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          resolve({ exitCode: 1, stdout, stderr: err.message, timedOut: false });
        }
      });
    });
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    // Stage locally then docker cp into the container
    const staging = mkdtempSync(join(tmpdir(), 'ma-dcp-'));
    try {
      const localFile = join(staging, 'file');
      writeFileSync(localFile, content);
      const targetPath = dockerWorkspacePath(path);
      const target = `${this.containerName}:${targetPath}`;
      // Ensure parent dir exists in the container
      const dir = posix.dirname(targetPath);
      spawnSync('docker', ['exec', this.containerName, 'mkdir', '-p', dir], { timeout: 10_000 });
      const cp = spawnSync('docker', ['cp', localFile, target], { encoding: 'utf-8', timeout: 15_000 });
      if (cp.status !== 0) throw new Error(`docker cp failed: ${cp.stderr}`);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async readFile(path: string): Promise<string> {
    const staging = mkdtempSync(join(tmpdir(), 'ma-dcp-'));
    try {
      const localFile = join(staging, 'file');
      const src = `${this.containerName}:${dockerWorkspacePath(path)}`;
      const cp = spawnSync('docker', ['cp', src, localFile], { encoding: 'utf-8', timeout: 15_000 });
      if (cp.status !== 0) throw new Error(`docker cp failed: ${cp.stderr}`);
      return readFileSync(localFile, 'utf-8');
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async listFiles(path: string): Promise<string[]> {
    const target = dockerWorkspacePath(path);
    const r = await this.execute(`find ${shellQuote(target)} -type f`);
    if (r.exitCode !== 0) return [];
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (l.startsWith(WORKDIR + '/') ? l.slice(WORKDIR.length + 1) : l));
  }

  async cleanup(): Promise<void> {
    spawnSync('docker', ['rm', '-f', this.containerName], { timeout: 15_000 });
  }
}

export function dockerWorkspacePath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (posix.isAbsolute(path) || parts.some((part) => part === '..')) {
    throw new Error('Docker sandbox paths must stay inside /workspace');
  }
  const normalized = posix.normalize(parts.join('/'));
  if (!normalized || normalized === '.') return WORKDIR;
  return posix.join(WORKDIR, normalized);
}

function safeContainerSuffix(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80) || 'session';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
