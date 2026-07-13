import { Hono } from 'hono';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { ServerDeps } from '../server.js';
import { BUILTIN_SKILLS } from '@/core/skills/catalog.js';
import { createSkillId, parseSkill, type Skill } from '@/core/skills/loader.js';
import { getSkillStoragePath, insertSkill } from '@/core/skills/store.js';

type SkillSourceFilter = 'custom' | 'anthropic';

type UploadedSkillFile = {
  path: string;
  content: Buffer;
};

type NormalizedSkillPackage = {
  topLevel: string;
  files: Array<{ relativePath: string; content: Buffer }>;
  skillContent: string;
};

type JsonSkillFile = {
  path?: string;
  name?: string;
  filename?: string;
  content?: string;
  base64?: string;
};

const SKILL_DIR_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;
const MAX_SKILL_UPLOAD_BYTES = 8 * 1024 * 1024;

export function skillsRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/', (c) => {
    const source = c.req.query('source');
    if (source && source !== 'custom' && source !== 'anthropic') {
      return c.json({ error: { type: 'invalid_request', message: 'source must be custom or anthropic' } }, 400);
    }
    return c.json(skillPage(listSkillResources(deps, source as SkillSourceFilter | undefined), c.req.query('limit'), c.req.query('page')));
  });

  app.post('/', async (c) => {
    if (!deps.workspace?.dataDir) {
      return c.json({ error: { type: 'invalid_request', message: 'Workspace data directory is not configured' } }, 400);
    }

    try {
      const { files, displayTitle } = await readCreateSkillRequest(c);
      const skillPackage = normalizeSkillPackage(files);
      const existingSkills = listSkillResources(deps);
      const skillId = createUniqueSkillId(existingSkills);
      const parsed = parseSkill(skillPackage.skillContent, skillPackage.topLevel, `${skillPackage.topLevel}/SKILL.md`, skillId);
      if (!parsed) {
        const message = skillPackage.skillContent.startsWith('---')
          ? 'SKILL.md frontmatter must include name and description.'
          : 'SKILL.md must start with YAML frontmatter (---).';
        return c.json({ error: { type: 'invalid_request', message } }, 400);
      }
      if (existingSkills.some((skill) => skill.name === parsed.name)) {
        return c.json({ error: { type: 'conflict', message: `Skill name ${parsed.name} already exists` } }, 409);
      }

      const skillDir = safeJoin(resolve(deps.workspace.dataDir, 'skills'), skillId);
      for (const file of skillPackage.files) {
        const outputPath = safeJoin(skillDir, file.relativePath);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, file.content);
      }

      const saved = materializeCustomSkill(parsed, displayTitle);
      insertSkill(deps.db, saved, skillDir);
      deps.skills ??= [];
      deps.skills.push(saved);
      return c.json(skillResource(saved), 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: { type: 'invalid_request', message } }, 400);
    }
  });

  app.get('/:skillId', (c) => {
    const skill = findSkill(deps, c.req.param('skillId'));
    if (!skill) {
      return c.json({ error: { type: 'not_found', message: 'Skill not found' } }, 404);
    }
    return c.json(skillResource(skill));
  });

  app.delete('/:skillId', (c) => {
    const skill = findSkill(deps, c.req.param('skillId'));
    if (!skill) {
      return c.json({ error: { type: 'not_found', message: 'Skill not found' } }, 404);
    }
    if (skill.source === 'anthropic') {
      return c.json({ error: { type: 'invalid_request', message: 'Anthropic skills are built-in and cannot be deleted' } }, 400);
    }

    deps.db.prepare(`
      UPDATE skills
      SET archived_at = COALESCE(archived_at, datetime('now')),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(skill.id);
    const storagePath = getSkillStoragePath(deps.db, skill.id);
    if (storagePath && deps.workspace?.dataDir && isManagedSkillStoragePath(storagePath, deps.workspace.dataDir)) {
      rmSync(storagePath, { recursive: true, force: true });
    }
    if (deps.skills) {
      const index = deps.skills.findIndex((item) => item.id === skill.id);
      if (index >= 0) deps.skills.splice(index, 1);
    }
    return c.json({ id: skill.id, type: 'skill_deleted' });
  });

  return app;
}

export function listSkillResources(deps: ServerDeps, source?: SkillSourceFilter): Skill[] {
  const customSkills = [...(deps.skills ?? [])].sort(compareSkillsByUpdatedAtDesc);
  const skills = [...customSkills, ...BUILTIN_SKILLS];
  return source ? skills.filter((skill) => skill.source === source) : skills;
}

export function skillResource(skill: Skill) {
  return {
    id: skill.id,
    created_at: skill.created_at,
    display_title: skill.display_title,
    latest_version: skill.latest_version,
    source: skill.source,
    type: skill.type,
    updated_at: skill.updated_at,
    name: skill.name,
    description: skill.description,
    file: skill.file || null,
    versions: skill.versions,
  };
}

function skillPage(skills: Skill[], limitQuery?: string, pageQuery?: string) {
  const limit = Math.max(1, Math.min(Number(limitQuery ?? 20) || 20, 100));
  const offset = decodePage(pageQuery);
  const data = skills.slice(offset, offset + limit).map(skillResource);
  const nextOffset = offset + limit;
  return {
    data,
    has_more: nextOffset < skills.length,
    next_page: nextOffset < skills.length ? Buffer.from(String(nextOffset)).toString('base64url') : null,
    first_id: data[0]?.id ?? null,
    last_id: data.at(-1)?.id ?? null,
  };
}

function decodePage(page?: string): number {
  if (!page) return 0;
  const parsed = Number(Buffer.from(page, 'base64url').toString('utf8'));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function findSkill(deps: ServerDeps, id: string): Skill | undefined {
  return listSkillResources(deps).find((skill) => skill.id === id);
}

function compareSkillsByUpdatedAtDesc(a: Skill, b: Skill): number {
  return timestampMs(b.updated_at) - timestampMs(a.updated_at);
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createUniqueSkillId(existingSkills: Skill[]): string {
  let id = createSkillId();
  while (existingSkills.some((skill) => skill.id === id)) {
    id = createSkillId();
  }
  return id;
}

async function readCreateSkillRequest(c: any): Promise<{ files: UploadedSkillFile[]; displayTitle?: string }> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody({ all: true });
    const files: UploadedSkillFile[] = [];
    let displayTitle: string | undefined;

    for (const [key, rawValue] of Object.entries(body)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (key === 'display_title' && typeof value === 'string') {
          displayTitle = value;
          continue;
        }
        if (!isSkillFileField(key) || !isFileLike(value)) {
          continue;
        }

        const filePath = value.webkitRelativePath || value.name;
        const content = Buffer.from(await value.arrayBuffer());
        files.push(...expandUploadedSkillFile(filePath, content));
      }
    }

    return { files, displayTitle };
  }

  const body = await c.req.json().catch(() => ({})) as { files?: JsonSkillFile[]; display_title?: string };
  const files = (body.files ?? []).map((file) => {
    const filePath = file.path ?? file.name ?? file.filename;
    if (!filePath) throw new Error('Each uploaded file must include a path.');
    if (file.base64) return expandUploadedSkillFile(filePath, Buffer.from(file.base64, 'base64'));
    if (typeof file.content === 'string') return expandUploadedSkillFile(filePath, Buffer.from(file.content, 'utf8'));
    throw new Error(`File ${filePath} must include content or base64.`);
  }).flat();
  return { files, displayTitle: body.display_title };
}

function isSkillFileField(key: string): boolean {
  return key === 'files' || key === 'files[]' || key.startsWith('files.');
}

function isFileLike(value: unknown): value is { name: string; webkitRelativePath?: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { name?: unknown }).name === 'string'
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function';
}

function normalizeSkillPackage(files: UploadedSkillFile[]): NormalizedSkillPackage {
  if (files.length === 0) {
    throw new Error('files is required.');
  }

  const totalBytes = files.reduce((sum, file) => sum + file.content.length, 0);
  if (totalBytes > MAX_SKILL_UPLOAD_BYTES) {
    throw new Error('Total skill package size must be 8MB or less.');
  }

  let topLevel: string | null = null;
  let skillContent: string | null = null;
  const normalizedFiles: NormalizedSkillPackage['files'] = [];
  const seenPaths = new Set<string>();

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.endsWith('/')) continue;
    if (isIgnoredArchiveEntry(normalizedPath)) continue;
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length < 2 || parts.some((part) => part === '..' || part === '.')) {
      throw new Error('All files must be in the same top-level directory and include SKILL.md at the root of that directory.');
    }
    if (!topLevel) {
      topLevel = parts[0];
      if (!SKILL_DIR_RE.test(topLevel)) {
        throw new Error('Top-level skill directory must use letters, numbers, dots, underscores, or hyphens.');
      }
    }
    if (parts[0] !== topLevel) {
      throw new Error('All files must be in the same top-level directory.');
    }

    const relativePath = parts.slice(1).join('/');
    if (seenPaths.has(relativePath)) {
      throw new Error(`Duplicate skill package file: ${parts.join('/')}.`);
    }
    seenPaths.add(relativePath);
    normalizedFiles.push({ relativePath, content: file.content });
    if (relativePath === 'SKILL.md') {
      skillContent = file.content.toString('utf8');
    }
  }

  if (!topLevel || !skillContent) {
    throw new Error('Upload must include SKILL.md at the root of the top-level directory.');
  }

  return { topLevel, files: normalizedFiles, skillContent };
}

function materializeCustomSkill(skill: Skill, displayTitle?: string): Skill {
  const now = new Date().toISOString();
  const version = String(Date.now());
  return {
    ...skill,
    display_title: displayTitle?.trim() || skill.display_title || skill.name,
    created_at: now,
    updated_at: now,
    latest_version: version,
    versions: [{ id: version, created_at: now, latest: true }],
  };
}

function safeJoin(root: string, relativePath: string): string {
  const rootPath = resolve(root);
  const targetPath = resolve(rootPath, relativePath);
  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + sep)) {
    throw new Error('Path escapes the skills directory.');
  }
  return targetPath;
}

function isManagedSkillStoragePath(path: string, dataDir: string): boolean {
  const root = resolve(dataDir, 'skills');
  const target = resolve(path);
  return target.startsWith(root + sep);
}

function isZipPackage(filePath: string, content: Buffer): boolean {
  const lower = filePath.toLowerCase();
  return (lower.endsWith('.zip') || lower.endsWith('.skill')) && content.length >= 4 && content.readUInt32LE(0) === 0x04034b50;
}

function expandUploadedSkillFile(filePath: string, content: Buffer): UploadedSkillFile[] {
  if (content.length > MAX_SKILL_UPLOAD_BYTES) {
    throw new Error('Total skill package size must be 8MB or less.');
  }
  return isZipPackage(filePath, content) ? extractZipEntries(content) : [{ path: filePath, content }];
}

function extractZipEntries(zip: Buffer): UploadedSkillFile[] {
  const eocdOffset = findEndOfCentralDirectory(zip);
  if (eocdOffset < 0) {
    throw new Error('Zip package is invalid.');
  }

  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);
  const entries: UploadedSkillFile[] = [];
  let totalUncompressedBytes = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Zip central directory is invalid.');
    }

    const compression = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const fileNameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const path = zip.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    cursor += 46 + fileNameLength + extraLength + commentLength;

    if (!path || path.endsWith('/') || isIgnoredArchiveEntry(path)) {
      continue;
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_SKILL_UPLOAD_BYTES) {
      throw new Error('Total skill package size must be 8MB or less.');
    }
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('Zip local file header is invalid.');
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    const content = compression === 0
      ? Buffer.from(compressed)
      : compression === 8
        ? inflateRawSync(compressed)
        : null;
    if (!content) {
      throw new Error(`Unsupported zip compression method for ${path}.`);
    }
    if (content.length !== uncompressedSize) {
      throw new Error(`Zip entry size mismatch for ${path}.`);
    }
    entries.push({ path, content });
  }

  return entries;
}

function isIgnoredArchiveEntry(path: string): boolean {
  return path.startsWith('__MACOSX/') || path.split('/').some((part) => part === '.DS_Store');
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const start = Math.max(0, zip.length - 65_557);
  for (let index = zip.length - 22; index >= start; index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }
  return -1;
}
