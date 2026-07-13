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

const mcpServerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('url'),
    name: z.string().min(1, 'MCP server name is required'),
    url: z.string().url(),
    timeout: z.number().positive().optional(),
  }),
  z.object({
    type: z.literal('stdio'),
    name: z.string().min(1, 'MCP server name is required'),
    command: z.string().min(1, 'stdio MCP server command is required'),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    timeout: z.number().positive().optional(),
  }),
]);

const permissionPolicySchema = z.object({
  type: z.enum(['always_allow', 'always_ask', 'never_allow']),
});

const agentToolConfigSchema = z.object({
  enabled: z.boolean().optional(),
  permission_policy: permissionPolicySchema.optional(),
});

const toolConfigsSchema = z.preprocess(
  (value) => Array.isArray(value) ? {} : value,
  z.record(agentToolConfigSchema).default({}),
);

const agentToolsetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent_toolset_20260401'),
    configs: toolConfigsSchema,
    default_config: agentToolConfigSchema.optional(),
  }),
  z.object({
    type: z.literal('mcp_toolset'),
    mcp_server_name: z.string().min(1, 'MCP toolset server name is required'),
    configs: toolConfigsSchema,
    default_config: agentToolConfigSchema.optional(),
  }),
]);

const skillRefSchema = z.object({
  type: z.enum(['custom', 'anthropic']),
  skill_id: z.string().min(1, 'Skill id is required'),
  version: z.string().optional(),
});

const agentModelSchema = z.object({
  id: z.string().min(1, 'Model id is required'),
  speed: z.enum(['fast', 'standard', 'extended']).default('standard'),
});

// ============================================================
// Agent Definition Schema
// ============================================================

export const agentDefinitionSchema = z.object({
  name: z
    .string()
    .min(1, 'Agent name is required')
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/, 'Agent name must be alphanumeric with spaces, hyphens, or underscores'),
  model: agentModelSchema,
  system: z.string().min(1, 'System instructions are required'),
  description: z.string().optional(),
  skills: z.array(skillRefSchema).optional(),
  mcp_servers: z.array(mcpServerConfigSchema).optional(),
  tools: z.array(agentToolsetSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
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
