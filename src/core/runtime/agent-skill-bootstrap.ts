import type { Database } from '../db/database.js';
import { loadAgents } from '../agent/loader.js';
import { importAgentSeeds, loadActiveAgentsFromDb, refreshAgentsFromDb } from '../agent/store.js';
import { loadSkills, type Skill, type SkillLoadError } from '../skills/loader.js';
import { BUILTIN_SKILLS } from '../skills/catalog.js';
import { importSkillSeeds, loadCustomSkillsFromDb } from '../skills/store.js';
import type { AgentDefinition, AgentLoadError, AgentLoadResult } from '@/types/agent.js';

export interface RuntimeAgentSkillState {
  agents: AgentDefinition[];
  skills: Skill[];
  agentLoadErrors: AgentLoadError[];
  agentSeedErrors: AgentLoadError[];
  skillLoadErrors: SkillLoadError[];
}

export interface RuntimeAgentSkillBootstrapOptions {
  db: Database;
  agentsDir: string;
  skillsDir: string;
  writeError?: (message: string) => void;
}

export interface RuntimeAgentReloadOptions {
  db: Database;
  agentsDir: string;
  agents: AgentDefinition[];
}

export function loadRuntimeAgentSkillState(options: RuntimeAgentSkillBootstrapOptions): RuntimeAgentSkillState {
  const { db, agentsDir, skillsDir, writeError = console.error } = options;

  const agentLoadResult = loadAgents(agentsDir);
  writeAgentLoadErrors(agentLoadResult.errors, writeError);

  const agentSeedErrors = importAgentSeeds(db, agentLoadResult.agents);
  writeAgentSeedErrors(agentSeedErrors, writeError);
  const agents = loadActiveAgentsFromDb(db);

  const skillLoadResult = loadSkills(skillsDir);
  writeSkillLoadErrors(skillLoadResult.errors, writeError);
  importSkillSeeds(db, skillLoadResult.skills);
  const skills = loadCustomSkillsFromDb(db);

  writeUnknownSkillReferences(agents, skills, writeError);

  return {
    agents,
    skills,
    agentLoadErrors: agentLoadResult.errors,
    agentSeedErrors,
    skillLoadErrors: skillLoadResult.errors,
  };
}

export function reloadRuntimeAgents(options: RuntimeAgentReloadOptions): AgentLoadResult {
  const result = loadAgents(options.agentsDir);
  importAgentSeeds(options.db, result.agents);
  const agents = refreshAgentsFromDb(options.db, options.agents);
  return { agents, errors: result.errors };
}

function writeAgentLoadErrors(errors: AgentLoadError[], writeError: (message: string) => void): void {
  for (const err of errors) {
    writeError(`[AGENT_LOAD] ${err.file} - ${err.reason}${err.field ? ` (field: ${err.field})` : ''}`);
  }
}

function writeAgentSeedErrors(errors: AgentLoadError[], writeError: (message: string) => void): void {
  for (const err of errors) {
    writeError(`[AGENT_SEED] ${err.file} - ${err.reason}${err.field ? ` (field: ${err.field})` : ''}`);
  }
}

function writeSkillLoadErrors(errors: SkillLoadError[], writeError: (message: string) => void): void {
  for (const err of errors) {
    writeError(`[SKILL_LOAD] ${err.file} - ${err.reason}`);
  }
}

function writeUnknownSkillReferences(
  agents: AgentDefinition[],
  customSkills: Skill[],
  writeError: (message: string) => void,
): void {
  const knownSkills = [...customSkills, ...BUILTIN_SKILLS];
  const skillNames = new Set(knownSkills.map((skill) => skill.name));
  const skillIds = new Set(knownSkills.map((skill) => skill.id));
  for (const agent of agents) {
    for (const ref of agent.skills ?? []) {
      if (!skillNames.has(ref.skill_id) && !skillIds.has(ref.skill_id)) {
        writeError(`[SKILL_REF] agent "${agent.name}" references unknown skill "${ref.skill_id}" (ignored)`);
      }
    }
  }
}
