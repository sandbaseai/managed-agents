/**
 * Agent Definition Schema Validator
 *
 * Uses Zod to validate AgentDefinition objects loaded from YAML/JSON.
 * Returns structured errors with field path and reason on failure.
 */

import { z } from 'zod';
import type { AgentDefinition } from '@/types/agent.js';

// ============================================================
// MCP Server Config Schema
// ============================================================

const mcpServerConfigSchema = z.object({
  name: z.string().min(1, 'MCP server name is required'),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
}).refine(
  (data) => {
    if (data.transport === 'stdio' && !data.command) {
      return false;
    }
    if (data.transport === 'http' && !data.url) {
      return false;
    }
    return true;
  },
  {
    message: 'stdio transport requires "command"; http transport requires "url"',
  },
);

// ============================================================
// Agent Definition Schema
// ============================================================

export const agentDefinitionSchema = z.object({
  name: z
    .string()
    .min(1, 'Agent name is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Agent name must be alphanumeric with hyphens/underscores'),
  model: z.string().min(1, 'Model reference is required'),
  system_prompt: z.string().min(1, 'System prompt is required'),
  description: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcp_servers: z.array(mcpServerConfigSchema).optional(),
  tools: z.array(z.string()).optional(),
  confirm_tools: z.array(z.string()).optional(),
  max_turns: z.number().int().positive().max(1000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  delegations: z.array(z.string()).optional(),
  enable_general_subagent: z.boolean().optional(),
  strategy: z.string().optional(),
  environment: z.string().optional(),
});

// ============================================================
// Validation Result Types
// ============================================================

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  data?: AgentDefinition;
  errors?: ValidationError[];
}

// ============================================================
// Validation Function
// ============================================================

/**
 * Validate an unknown object against the AgentDefinition schema.
 * Returns structured errors with field paths on failure.
 */
export function validateAgentDefinition(input: unknown): ValidationResult {
  const result = agentDefinitionSchema.safeParse(input);

  if (result.success) {
    return { valid: true, data: result.data as AgentDefinition };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  return { valid: false, errors };
}
