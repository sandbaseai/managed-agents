import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ArtifactStore {
  readonly provider: 'local';
  rootPath(): string;
  path(...segments: string[]): string;
  contains(path: string): boolean;
  exists(path: string): boolean;
  readFile(path: string): Buffer;
  writeFile(path: string, bytes: Buffer): void;
  remove(path: string): void;
}

export class LocalArtifactStore implements ArtifactStore {
  readonly provider = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  rootPath(): string {
    return this.root;
  }

  path(...segments: string[]): string {
    const target = resolve(this.root, ...segments);
    if (!this.contains(target)) {
      throw new Error('Artifact path escapes the configured artifact storage directory.');
    }
    return target;
  }

  contains(path: string): boolean {
    const resolvedPath = resolve(path);
    const relativePath = relative(this.root, resolvedPath);
    return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
  }

  exists(path: string): boolean {
    return this.contains(path) && existsSync(path);
  }

  readFile(path: string): Buffer {
    if (!this.contains(path)) throw new Error('Artifact path escapes the configured artifact storage directory.');
    return readFileSync(path);
  }

  writeFile(path: string, bytes: Buffer): void {
    if (!this.contains(path)) throw new Error('Artifact path escapes the configured artifact storage directory.');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { mode: 0o600 });
  }

  remove(path: string): void {
    if (this.contains(path) && existsSync(path)) rmSync(path, { force: true });
  }
}
