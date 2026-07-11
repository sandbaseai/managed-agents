/**
 * Unit tests for the Skills system (Requirement 4, Property 2 round-trip).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  parseSkill,
  serializeSkill,
  loadSkills,
  composeSystemPrompt,
  type Skill,
} from '@/core/skills/loader.js';

const SKILL_MD = `---
name: code-review
description: Reviews code for bugs and style
---

# Code Review Skill

When reviewing code:
1. Check for bugs
2. Check style
`;

describe('Skills', () => {
  describe('parseSkill', () => {
    it('parses frontmatter and body', () => {
      const skill = parseSkill(SKILL_MD, 'fallback')!;
      expect(skill.name).toBe('code-review');
      expect(skill.description).toBe('Reviews code for bugs and style');
      expect(skill.instructions).toContain('# Code Review Skill');
      expect(skill.instructions).toContain('Check for bugs');
    });

    it('falls back to filename when name missing', () => {
      const skill = parseSkill('# Just a body, no frontmatter', 'my-skill')!;
      expect(skill.name).toBe('my-skill');
      expect(skill.instructions).toContain('Just a body');
    });

    it('handles empty description', () => {
      const skill = parseSkill('---\nname: x\n---\nbody', 'f')!;
      expect(skill.description).toBe('');
    });
  });

  describe('round-trip (Property 2)', () => {
    it('parse → serialize → parse yields semantically equivalent skill', () => {
      const first = parseSkill(SKILL_MD, 'code-review')!;
      const serialized = serializeSkill(first);
      const second = parseSkill(serialized, 'code-review')!;

      expect(second.name).toBe(first.name);
      expect(second.description).toBe(first.description);
      expect(second.instructions).toBe(first.instructions);
    });
  });

  describe('loadSkills', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'ma-skills-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('loads .md files from a directory', () => {
      writeFileSync(join(dir, 'code-review.md'), SKILL_MD);
      writeFileSync(join(dir, 'web-search.md'), '---\nname: web-search\ndescription: Search the web\n---\nInstructions here');
      const result = loadSkills(dir);
      expect(result.skills).toHaveLength(2);
      expect(result.skills.map((s) => s.name).sort()).toEqual(['code-review', 'web-search']);
    });

    it('ignores non-md files', () => {
      writeFileSync(join(dir, 'skill.md'), SKILL_MD);
      writeFileSync(join(dir, 'readme.txt'), 'not a skill');
      const result = loadSkills(dir);
      expect(result.skills).toHaveLength(1);
    });

    it('returns empty for a missing directory', () => {
      const result = loadSkills(join(dir, 'nonexistent'));
      expect(result.skills).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('composeSystemPrompt', () => {
    const skills: Skill[] = [
      { name: 'a', description: 'skill A', instructions: 'do A', frontmatter: {}, file: 'a.md' },
      { name: 'b', description: 'skill B', instructions: 'do B', frontmatter: {}, file: 'b.md' },
    ];

    it('returns base prompt unchanged when no skills assigned', () => {
      expect(composeSystemPrompt('base', undefined, skills)).toBe('base');
      expect(composeSystemPrompt('base', [], skills)).toBe('base');
    });

    it('injects only the assigned skill subset (R4.5)', () => {
      const result = composeSystemPrompt('base', ['a'], skills);
      expect(result).toContain('base');
      expect(result).toContain('Skill: a');
      expect(result).toContain('do A');
      expect(result).not.toContain('do B'); // not assigned
    });

    it('ignores unknown skill names', () => {
      const result = composeSystemPrompt('base', ['nonexistent'], skills);
      expect(result).toBe('base'); // no matching skills → unchanged
    });
  });
});
