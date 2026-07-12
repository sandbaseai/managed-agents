/**
 * Solution Templates (Requirement 14, Properties 18 & 19)
 *
 * A template is a directory containing:
 *   manifest.yaml   — { name, description, version?, author?, tags? }
 *   agents/         — Agent definition files (.yaml/.json)
 *   skills/         — Skill directories with SKILL.md at the root, optional
 *   mcp/            — MCP config files, optional
 *
 * `installTemplate` copies a template's agents/ and skills/ into a project.
 * `createTemplate` exports a project's agents/ and skills/ into a template dir.
 * Together they round-trip (Property 19); install places files byte-identically
 * (Property 18).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface TemplateManifest {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
}

const SUBDIRS = ['agents', 'skills', 'mcp'] as const;

/** Read a template's manifest. Throws if missing/invalid. */
export function readManifest(templateDir: string): TemplateManifest {
  const manifestPath = join(templateDir, 'manifest.yaml');
  if (!existsSync(manifestPath)) {
    throw new Error(`Template manifest not found: ${manifestPath}`);
  }
  const parsed = parseYaml(readFileSync(manifestPath, 'utf-8')) as TemplateManifest;
  if (!parsed?.name) {
    throw new Error('Template manifest missing required "name" field');
  }
  return parsed;
}

/**
 * Install a template into a project directory. Copies agents/, skills/, mcp/
 * files. On name collision: skip unless `force` is set (then overwrite).
 */
export function installTemplate(
  templateDir: string,
  projectDir: string,
  opts: { force?: boolean } = {},
): InstallResult {
  readManifest(templateDir); // validate first
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const sub of SUBDIRS) {
    const srcDir = join(templateDir, sub);
    if (!existsSync(srcDir)) continue;
    const destDir = join(projectDir, sub);
    mkdirSync(destDir, { recursive: true });

    copyTree(srcDir, destDir, sub, opts, installed, skipped);
  }

  return { installed, skipped };
}

/**
 * Create a template directory from a project's agents/ and skills/.
 */
export function createTemplate(
  projectDir: string,
  templateDir: string,
  manifest: TemplateManifest,
): { files: string[] } {
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(join(templateDir, 'manifest.yaml'), stringifyYaml(manifest));

  const files: string[] = ['manifest.yaml'];
  for (const sub of SUBDIRS) {
    const srcDir = join(projectDir, sub);
    if (!existsSync(srcDir)) continue;
    const destDir = join(templateDir, sub);
    mkdirSync(destDir, { recursive: true });
    copyTree(srcDir, destDir, sub, { force: true }, files, []);
  }

  return { files };
}

function copyTree(
  srcDir: string,
  destDir: string,
  relativeRoot: string,
  opts: { force?: boolean },
  copied: string[],
  skipped: string[],
): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    const relativePath = join(relativeRoot, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyTree(src, dest, relativePath, opts, copied, skipped);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (existsSync(dest) && !opts.force) {
      skipped.push(relativePath);
      continue;
    }

    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    copied.push(relativePath);
  }
}

/**
 * Resolve a template source: if it's an existing local directory, return it;
 * otherwise treat it as a template name to fetch from a remote GitHub repo
 * (default the official repo) into a local cache dir, and return that path.
 *
 * Remote layout (R14.2): repo root has one subdirectory per template. We fetch
 * via the GitHub tarball API and extract the requested subdirectory.
 */
export async function resolveTemplateSource(
  nameOrPath: string,
  opts: { repo?: string; cacheDir: string } = { cacheDir: '.managed-agents/templates-cache' },
): Promise<string> {
  // Local path takes precedence
  if (existsSync(join(nameOrPath, 'manifest.yaml'))) {
    return nameOrPath;
  }

  const repo = opts.repo ?? 'sandbaseai/managed-agents-templates';
  const cacheRoot = join(opts.cacheDir, repo.replace(/[^a-z0-9]+/gi, '_'));
  await fetchRepoTarball(repo, cacheRoot);

  // The tarball extracts to <cacheRoot>/<repo-name>-<ref>/<template>/...
  const extractedRoot = findExtractedRoot(cacheRoot);
  const templatePath = join(extractedRoot, nameOrPath);
  if (!existsSync(join(templatePath, 'manifest.yaml'))) {
    throw new Error(`Template "${nameOrPath}" not found in repo ${repo}`);
  }
  return templatePath;
}

/** List templates in a local templates root (each subdir = one template). */
export function listTemplates(templatesRoot: string): TemplateManifest[] {
  if (!existsSync(templatesRoot)) return [];
  const result: TemplateManifest[] = [];
  for (const entry of readdirSync(templatesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      result.push(readManifest(join(templatesRoot, entry.name)));
    } catch {
      // skip dirs without a valid manifest
    }
  }
  return result;
}

// ============================================================
// Remote repo fetch (GitHub tarball)
// ============================================================

/**
 * Download and extract a GitHub repo tarball into cacheRoot. Uses the platform
 * `curl` + `tar` (universally available) to avoid an HTTP/tar npm dependency.
 * Tries the `main` then `master` default branches.
 */
async function fetchRepoTarball(repo: string, cacheRoot: string): Promise<void> {
  rmSync(cacheRoot, { recursive: true, force: true });
  mkdirSync(cacheRoot, { recursive: true });

  const branches = ['main', 'master'];
  let lastErr = '';
  for (const branch of branches) {
    const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${branch}`;
    const tarball = join(cacheRoot, 'repo.tar.gz');
    const dl = spawnSync('curl', ['-fsSL', '-o', tarball, url], { encoding: 'utf-8', timeout: 60_000 });
    if (dl.status !== 0) {
      lastErr = dl.stderr || `curl failed for ${branch}`;
      continue;
    }
    const ex = spawnSync('tar', ['-xzf', tarball, '-C', cacheRoot], { encoding: 'utf-8', timeout: 60_000 });
    if (ex.status !== 0) {
      lastErr = ex.stderr || 'tar extract failed';
      continue;
    }
    return; // success
  }
  throw new Error(`Failed to fetch template repo "${repo}": ${lastErr}`);
}

/** The tarball extracts to a single top-level dir (repo-branch); return it. */
function findExtractedRoot(cacheRoot: string): string {
  const dirs = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (dirs.length === 0) throw new Error('Template repo tarball had no extracted directory');
  return join(cacheRoot, dirs[0]);
}
