/**
 * Agent Definition Types
 *
 * Declarative agent configuration loaded from YAML/JSON files.
 */

// ============================================================
// Agent Definition (loaded from YAML)
// ============================================================

export interface AgentDefinition {
  /** Unique identifier (required) */
  name: string;
  /** Model registry reference (required). Public/config field follows Claude's string model id shape. */
  model: string;
  /** System instructions (required). Public/config field follows Claude's `system`. */
  system: string;
  /** Human-readable description */
  description?: string;
  /** Skill references attached to this agent. */
  skills?: AgentSkillRef[];
  /** MCP server configurations. */
  mcp_servers?: McpServerConfig[];
  /** Built-in toolsets enabled for this agent. */
  tools?: AgentToolset[];
  /** Optional local runtime model policy. Not included in Claude's minimal template shape. */
  model_config?: AgentModelConfig;
  /** Free-form metadata for templates, provenance, UI hints, etc. */
  metadata?: Record<string, unknown>;
  /** Maximum conversation turns before forced stop */
  max_turns?: number;
  /** Model temperature */
  temperature?: number;
  /** Agent names this agent can delegate to (CMA callable_agents roster) */
  delegations?: string[];
  /** Enable CMA general_subagent tool for ad-hoc sub-task delegation */
  enable_general_subagent?: boolean;
  /** Strategy name (default: 'default') */
  strategy?: string;
  /** Environment name (default: 'local') */
  environment?: string;
}

export type AgentModelSpeed = 'fast' | 'standard' | 'extended';

export interface AgentModelConfig {
  id: string;
  speed: AgentModelSpeed;
}

// ============================================================
// MCP Server Configuration
// ============================================================

export interface McpServerConfig {
  /** MCP server transport type. `url` mirrors Claude's managed-agent MCP shape; `stdio` is local-first. */
  type: 'url' | 'stdio';
  /** Identifier for this MCP server */
  name: string;
  /** Command to run (stdio transport) */
  command?: string;
  /** Command arguments (stdio transport) */
  args?: string[];
  /** HTTP endpoint URL (http transport) */
  url?: string;
  /** Environment variables (supports ${ENV_VAR} syntax) */
  env?: Record<string, string>;
  /** Connection timeout in seconds (default: 30) */
  timeout?: number;
}

export interface AgentSkillRef {
  type: 'custom' | 'anthropic';
  skill_id: string;
  version?: string;
}

export type PermissionPolicyType = 'always_allow' | 'always_ask' | 'never_allow';

export interface AgentToolConfig {
  enabled?: boolean;
  permission_policy?: {
    type: PermissionPolicyType;
  };
}

export interface NamedAgentToolConfig extends AgentToolConfig {
  name: string;
}

export type AgentToolset = BuiltinAgentToolset | McpToolset;

export interface BuiltinAgentToolset {
  type: 'agent_toolset_20260401';
  configs?: NamedAgentToolConfig[];
  default_config?: AgentToolConfig;
}

export interface McpToolset {
  type: 'mcp_toolset';
  mcp_server_name: string;
  configs?: NamedAgentToolConfig[];
  default_config?: AgentToolConfig;
}

// ============================================================
// Agent Runtime State
// ============================================================

export type AgentStatus = 'active' | 'error' | 'disabled';

export interface AgentRecord {
  id: string; // agent_xxx
  name: string;
  definition: AgentDefinition;
  status: AgentStatus;
  errorMessage?: string;
  loadedAt: Date;
  updatedAt: Date;
}

// ============================================================
// Agent Load Result
// ============================================================

export interface AgentLoadError {
  file: string;
  reason: string;
  field?: string;
}

export interface AgentLoadResult {
  agents: AgentDefinition[];
  errors: AgentLoadError[];
}
