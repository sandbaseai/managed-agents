/**
 * Agent YAML Loader
 *
 * Scans a directory for .yaml/.json Agent definition files,
 * parses and validates each, returns loaded agents and errors.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateAgentDefinition } from './schema.js';
import type { AgentDefinition, AgentLoadResult, AgentLoadError } from '@/types/agent.js';

/**
 * Load all Agent definitions from a directory.
 * Supports .yaml, .yml, and .json files.
 * On validation failure: logs error, skips agent, continues loading others.
 */
export function loadAgents(agentsDir: string): AgentLoadResult {
  const agents: AgentDefinition[] = [];
  const errors: AgentLoadError[] = [];

  if (!existsSync(agentsDir)) {
    return { agents, errors };
  }

  const files = readdirSync(agentsDir).filter((f) => {
    const ext = extname(f).toLowerCase();
    return ext === '.yaml' || ext === '.yml' || ext === '.json';
  });

  for (const file of files) {
    const filePath = join(agentsDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const ext = extname(file).toLowerCase();

      let parsed: unknown;
      if (ext === '.json') {
        parsed = JSON.parse(content);
      } else {
        parsed = parseYaml(content);
      }

      const result = validateAgentDefinition(parsed);
      if (result.valid && result.data) {
        agents.push(result.data);
      } else {
        for (const err of result.errors ?? []) {
          errors.push({
            file,
            reason: err.message,
            field: err.path,
          });
        }
      }
    } catch (err) {
      errors.push({
        file,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { agents, errors };
}
