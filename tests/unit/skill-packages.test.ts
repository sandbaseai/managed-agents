import { describe, expect, it } from 'vitest';
import { normalizeSkillPackage, safeJoin, isManagedSkillStoragePath } from '@/api/routes/skill-packages.js';

const skillContent = Buffer.from('---\nname: demo\ndescription: Demo skill\n---\nBody', 'utf8');

describe('skill package helpers', () => {
  it('normalizes a single top-level skill package', () => {
    const normalized = normalizeSkillPackage([
      { path: 'demo/SKILL.md', content: skillContent },
      { path: 'demo/resources/example.txt', content: Buffer.from('example') },
      { path: 'demo/.DS_Store', content: Buffer.from('ignored') },
    ]);

    expect(normalized.topLevel).toBe('demo');
    expect(normalized.skillContent).toContain('name: demo');
    expect(normalized.files.map((file) => file.relativePath)).toEqual([
      'SKILL.md',
      'resources/example.txt',
    ]);
  });

  it('rejects mixed top-level directories and path traversal', () => {
    expect(() => normalizeSkillPackage([
      { path: 'demo/SKILL.md', content: skillContent },
      { path: 'other/SKILL.md', content: skillContent },
    ])).toThrow('All files must be in the same top-level directory.');

    expect(() => normalizeSkillPackage([
      { path: 'demo/../SKILL.md', content: skillContent },
    ])).toThrow('All files must be in the same top-level directory');
  });

  it('guards skill storage paths', () => {
    const root = '/tmp/workspace/skills/skill_abc';

    expect(safeJoin(root, 'resources/file.txt')).toBe('/tmp/workspace/skills/skill_abc/resources/file.txt');
    expect(() => safeJoin(root, '../escape.txt')).toThrow('Path escapes the skills directory.');
    expect(isManagedSkillStoragePath('/tmp/workspace/skills/skill_abc', '/tmp/workspace')).toBe(true);
    expect(isManagedSkillStoragePath('/tmp/other/skill_abc', '/tmp/workspace')).toBe(false);
  });
});
