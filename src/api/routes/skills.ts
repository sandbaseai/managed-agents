import { Hono } from 'hono';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ServerDeps } from '../server.js';
import { parseSkill } from '@/core/skills/loader.js';
import { getSkillStoragePath, insertSkill } from '@/core/skills/store.js';
import {
  isManagedSkillStoragePath,
  normalizeSkillPackage,
  readCreateSkillRequest,
  safeJoin,
} from './skill-packages.js';
import {
  createUniqueSkillId,
  findSkill,
  listSkillResources,
  materializeCustomSkill,
  skillPage,
  skillResource,
  type SkillSourceFilter,
} from './skill-resources.js';

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
