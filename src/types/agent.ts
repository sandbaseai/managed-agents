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
  /** Model registry reference (required) */
  model: string;
  /** System prompt (required) */
  system_prompt: string;
  /** Human-readable description */
  description?: string;
  /** Skill references (filenames in skills/ directory) */
  skills?: string[];
  /** MCP server configurations */
  mcp_servers?: McpServerConfig[];
  /** Built-in tool names to enable */
  tools?: string[];
  /** Tool names that require explicit user confirmation before executing (CMA always_ask) */
  confirm_tools?: string[];
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

// ============================================================
// MCP Server Configuration
// ============================================================

export interface McpServerConfig {
  /** Identifier for this MCP server */
  name: string;
  /** Transport type */
  transport: 'stdio' | 'http';
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
