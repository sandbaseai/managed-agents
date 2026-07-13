/**
 * Local Sandbox Provider
 *
 * Default execution backend: runs commands as local subprocesses.
 * Working directory: <runtime-data-dir>/sandbox/<session_id>/
 *
 * Zero isolation — suitable for development mode only.
 * Reference: OMA local-subprocess.ts
 */

import { spawn } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type {
  SandboxProvider,
  SandboxInstance,
  EnvironmentConfig,
  ExecOptions,
  ExecResult,
} from '@/types/sandbox.js';

export class LocalSandboxProvider implements SandboxProvider {
  readonly type = 'local';

  constructor(private readonly baseDir: string) {}

  async provision(sessionId: string, _config: EnvironmentConfig): Promise<SandboxInstance> {
    const workDir = join(this.baseDir, 'sandbox', sessionId);
    mkdirSync(workDir, { recursive: true });
    return new LocalSandboxInstance(sessionId, workDir);
  }
}

class LocalSandboxInstance implements SandboxInstance {
  constructor(
    readonly sessionId: string,
    private readonly workDir: string,
  ) {}

  /** Host filesystem path of the working directory (for snapshots). */
  get hostWorkDir(): string {
    return this.workDir;
  }

  private resolveInsideWorkDir(inputPath: string): string {
    const fullPath = resolve(this.workDir, inputPath);
    const workDir = resolve(this.workDir);
    const isInside = fullPath === workDir || fullPath.startsWith(`${workDir}${sep}`);

    if (!isInside) {
      throw new Error(`Path escapes sandbox workspace: ${inputPath}`);
    }

    return fullPath;
  }

  private assertExistingPathInsideWorkDir(fullPath: string, inputPath: string): void {
    if (!existsSync(fullPath)) return;

    const realPath = realpathSync(fullPath);
    const realWorkDir = realpathSync(this.workDir);
    const isInside = realPath === realWorkDir || realPath.startsWith(`${realWorkDir}${sep}`);

    if (!isInside) {
      throw new Error(`Path escapes sandbox workspace: ${inputPath}`);
    }
  }

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    const timeout = options?.timeout ?? 300_000; // 5 minutes default
    const cwd = options?.cwd ? this.resolveInsideWorkDir(options.cwd) : this.workDir;
    this.assertExistingPathInsideWorkDir(cwd, options?.cwd ?? '.');
    const env = { ...process.env, ...options?.env };

    return new Promise<ExecResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let resolved = false;

      const proc = spawn('/bin/sh', ['-c', command], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
            timedOut,
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({
            exitCode: 1,
            stdout,
            stderr: err.message,
            timedOut: false,
          });
        }
      });
    });
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolveInsideWorkDir(path);
    const dir = dirname(fullPath);
    this.assertExistingPathInsideWorkDir(dir, path);
    this.assertExistingPathInsideWorkDir(fullPath, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
  }

  async readFile(path: string): Promise<string> {
    const fullPath = this.resolveInsideWorkDir(path);
    this.assertExistingPathInsideWorkDir(fullPath, path);
    return readFileSync(fullPath, 'utf-8');
  }

  async listFiles(path: string): Promise<string[]> {
    const fullPath = this.resolveInsideWorkDir(path);
    if (!existsSync(fullPath)) return [];
    this.assertExistingPathInsideWorkDir(fullPath, path);

    const results: string[] = [];
    const walk = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else {
          results.push(relative(this.workDir, entryPath));
        }
      }
    };
    walk(fullPath);
    return results;
  }

  async cleanup(): Promise<void> {
    if (existsSync(this.workDir)) {
      rmSync(this.workDir, { recursive: true, force: true });
    }
  }
}
