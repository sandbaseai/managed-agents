/**
 * Skills Loader (Requirement 4)
 *
 * Loads SKILL.md files from a project's skills/ directory. Compatible with the
 * Claude Code SKILL.md convention: YAML frontmatter (name, description, ...)
 * followed by a markdown body of instructions.
 *
 * Skills are injected into an agent's system prompt so the model knows the
 * available capabilities up-front (no read-tool round-trip needed).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface Skill {
  /** Unique skill name (from frontmatter `name`, else filename). */
  name: string;
  /** Short description (from frontmatter `description`). */
  description: string;
  /** Markdown body — the instructions the model should follow. */
  instructions: string;
  /** Original frontmatter (preserved for round-trip). */
  frontmatter: Record<string, unknown>;
  /** Source filename. */
  file: string;
}

export interface SkillLoadError {
  file: string;
  reason: string;
}

export interface SkillLoadResult {
  skills: Skill[];
  errors: SkillLoadError[];
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Parse a SKILL.md string into a structured Skill.
 * Returns null if required fields are missing.
 */
export function parseSkill(content: string, fallbackName: string): Skill | null {
  const match = FRONTMATTER_RE.exec(content);

  let frontmatter: Record<string, unknown> = {};
  let body = content;

  if (match) {
    try {
      frontmatter = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
    } catch {
      frontmatter = {};
    }
    body = match[2] ?? '';
  }

  const name = typeof frontmatter.name === 'string' && frontmatter.name.length > 0
    ? frontmatter.name
    : fallbackName;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';

  return {
    name,
    description,
    instructions: body.trim(),
    frontmatter,
    file: `${fallbackName}.md`,
  };
}

/**
 * Serialize a Skill back to SKILL.md format (Property 2 round-trip support).
 */
export function serializeSkill(skill: Skill): string {
  const fm = { name: skill.name, description: skill.description, ...skill.frontmatter };
  // Ensure name/description reflect the current values
  fm.name = skill.name;
  fm.description = skill.description;
  const yamlLines = Object.entries(fm)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
  return `---\n${yamlLines}\n---\n\n${skill.instructions}\n`;
}

/**
 * Load all skills from a directory. Malformed files are skipped with an error.
 */
export function loadSkills(skillsDir: string): SkillLoadResult {
  const skills: Skill[] = [];
  const errors: SkillLoadError[] = [];

  if (!existsSync(skillsDir)) {
    return { skills, errors };
  }

  const files = readdirSync(skillsDir).filter((f) => extname(f).toLowerCase() === '.md');

  for (const file of files) {
    try {
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      const fallbackName = basename(file, extname(file));
      const skill = parseSkill(content, fallbackName);
      if (skill) {
        skill.file = file;
        skills.push(skill);
      } else {
        errors.push({ file, reason: 'Could not parse skill (missing name)' });
      }
    } catch (err) {
      errors.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { skills, errors };
}

/**
 * Build the full system prompt for an agent by appending its assigned skills'
 * instructions to the base system. Only the named subset is included
 * (R4.5). Unknown skill names are ignored by the caller (warned at load time).
 */
export function composeSystemPrompt(
  basePrompt: string,
  assignedSkillNames: string[] | undefined,
  allSkills: Skill[],
): string {
  if (!assignedSkillNames || assignedSkillNames.length === 0) {
    return basePrompt;
  }

  const assigned = allSkills.filter((s) => assignedSkillNames.includes(s.name));
  if (assigned.length === 0) {
    return basePrompt;
  }

  const skillSections = assigned
    .map((s) => `## Skill: ${s.name}\n${s.description ? s.description + '\n\n' : ''}${s.instructions}`)
    .join('\n\n');

  return `${basePrompt}\n\n# Available Skills\n\nYou have the following skills available. Use them when relevant:\n\n${skillSections}`;
}
