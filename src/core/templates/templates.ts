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
import { defaultTemplateCacheDir } from '@/core/config/paths.js';
import { validateAgentDefinition } from '@/core/agent/schema.js';

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

export interface TemplateValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  files: string[];
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/.test(parsed.name)) {
    throw new Error('Template manifest "name" must be alphanumeric with spaces, dots, hyphens, or underscores');
  }
  if (parsed.description !== undefined && typeof parsed.description !== 'string') {
    throw new Error('Template manifest "description" must be a string');
  }
  if (parsed.tags !== undefined && (!Array.isArray(parsed.tags) || parsed.tags.some((tag) => typeof tag !== 'string'))) {
    throw new Error('Template manifest "tags" must be an array of strings');
  }
  return parsed;
}

/** Validate template manifest and bundled agent/skill files without installing it. */
export function validateTemplate(templateDir: string): TemplateValidationResult {
  const errors: TemplateValidationResult['errors'] = [];
  const files: string[] = [];

  try {
    readManifest(templateDir);
    files.push('manifest.yaml');
  } catch (err) {
    errors.push({ path: 'manifest.yaml', message: err instanceof Error ? err.message : String(err) });
  }

  for (const sub of SUBDIRS) {
    const dir = join(templateDir, sub);
    if (!existsSync(dir)) continue;
    collectTemplateFiles(dir, sub, files, errors);
  }

  if (!files.some((file) => file.startsWith('agents/') || file.startsWith('skills/') || file.startsWith('mcp/'))) {
    errors.push({ path: '.', message: 'Template must include at least one agents/, skills/, or mcp/ file' });
  }

  return { valid: errors.length === 0, errors, files };
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
  const validation = validateTemplate(templateDir);
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new Error(`Invalid template ${first.path}: ${first.message}`);
  }
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

function collectTemplateFiles(
  dir: string,
  relativeRoot: string,
  files: string[],
  errors: TemplateValidationResult['errors'],
): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (relativeRoot === 'skills') {
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) {
        errors.push({ path: join(relativeRoot, entry.name), message: 'Skill directory must contain SKILL.md' });
      }
    }
  }

  for (const entry of entries) {
    const child = join(dir, entry.name);
    const relativePath = join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      collectTemplateFiles(child, relativePath, files, errors);
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(relativePath);

    if (relativeRoot === 'agents' && /\.(ya?ml|json)$/i.test(entry.name)) {
      try {
        const raw = readFileSync(child, 'utf-8');
        const parsed = entry.name.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
        const result = validateAgentDefinition(parsed);
        if (!result.valid) {
          errors.push({
            path: relativePath,
            message: result.errors?.map((item) => `${item.path}: ${item.message}`).join('; ') ?? 'Invalid agent definition',
          });
        }
      } catch (err) {
        errors.push({ path: relativePath, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
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
  opts: { repo?: string; cacheDir: string } = { cacheDir: defaultTemplateCacheDir() },
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
