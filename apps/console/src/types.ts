export type Page<T> = {
  data: T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
};

export type Agent = {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  system: string;
  model: string;
  model_config?: { speed: string };
  tools: AgentToolset[];
  skills: SkillRef[];
  mcp_servers: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  status: string;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  archived_at: string | null;
};

export type AgentToolset = BuiltinToolset | McpToolset;

export type BuiltinToolset = {
  type: 'agent_toolset_20260401';
  configs?: Record<string, ToolConfig>;
  default_config?: ToolConfig;
};

export type McpToolset = {
  type: 'mcp_toolset';
  mcp_server_name: string;
  configs?: Record<string, ToolConfig>;
  default_config?: ToolConfig;
};

export type ToolConfig = {
  enabled?: boolean;
  permission_policy?: { type: 'always_allow' | 'always_ask' | 'never_allow' };
};

export type SkillRef = { type: 'custom' | 'anthropic'; skill_id: string; version?: string };

export type Session = {
  id: string;
  type: 'session';
  title: string | null;
  agent: Agent | { id: string; type: 'agent'; name: string };
  environment_id: string;
  status: 'idle' | 'running' | 'terminated' | 'failed';
  resources: Array<Record<string, unknown>>;
  vault_ids: string[];
  usage: { input_tokens: number; output_tokens: number };
  stats: Record<string, number>;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type SessionEvent = {
  id: string;
  type: string;
  content: unknown[] | null;
  delta?: string;
  message_id?: string;
  created_at: string | null;
  processed_at: string | null;
  parent_event_id: string | null;
};

export type SessionResourceDraft =
  | { type: 'file'; file_id: string; mount_path: string }
  | { type: 'github_repository'; url: string; authorization_token: string; checkout: string; mount_path: string }
  | { type: 'memory_store'; memory_store_id: string; access: 'read_write' | 'read_only'; instructions: string };

export type WorkspaceFile = {
  id: string;
  type: 'file';
  name: string;
  media_type: string;
  size_bytes: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  preview: string | null;
  preview_truncated: boolean;
};

export type ApiKey = {
  id: string;
  type: 'api_key';
  name: string;
  source: 'managed' | 'config_env';
  key_prefix: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  last_used_at: string | null;
  archived_at: string | null;
};

export type ApiKeyCreateResponse = ApiKey & {
  secret_key: string;
};

export type EnvironmentHostingType = 'cloud' | 'local' | 'self_hosted';
export type EnvironmentNetworkType = 'limited' | 'unrestricted';
export type EnvironmentPackageDraft = { id: string; manager: string; package: string };
export type MetadataDraft = { id: string; key: string; value: string };

export type EnvironmentDraft = {
  name: string;
  description: string;
  hostingType: EnvironmentHostingType;
  networkType: EnvironmentNetworkType;
  allowMcpServerNetworkAccess: boolean;
  allowPackageManagerNetworkAccess: boolean;
  allowedHosts: string;
  packages: EnvironmentPackageDraft[];
  metadata: MetadataDraft[];
  preservedMetadata: Record<string, unknown>;
};

export type Environment = {
  id: string;
  type: 'environment';
  name: string;
  description: string;
  hosting_type: EnvironmentHostingType;
  sandbox_provider: string | null;
  network: Record<string, unknown>;
  packages: unknown[];
  status: string;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Vault = {
  id: string;
  type: 'credential_vault';
  name: string;
  description: string;
  status: string;
  credential_count: number;
  credentials: VaultCredential[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type CredentialAuthType = 'mcp_oauth' | 'bearer_token' | 'environment_variable';

export type VaultCredential = {
  id: string;
  type: 'credential';
  vault_id: string;
  name: string;
  auth_type: CredentialAuthType;
  mcp_server_url: string;
  variable_name: string;
  value_hint: string;
  network: Record<string, unknown>;
  injection_locations: string[];
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
};

export type MemoryStore = {
  id: string;
  type: 'memory_store';
  name: string;
  description: string;
  provider: string;
  status: string;
  memory_count: number;
  memories: MemoryRecord[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type MemoryRecord = {
  id: string;
  type: 'memory';
  store_id: string;
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Skill = {
  id: string;
  type: 'skill';
  name: string;
  display_title: string | null;
  description: string;
  source: 'custom' | 'anthropic';
  latest_version: string | null;
  versions: Array<{ id: string; created_at: string | null; latest: boolean }>;
  created_at: string | null;
  updated_at: string | null;
  file: string | null;
};

export type Template = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  summary: string;
  skill_ids: string[];
  agent: {
    name: string;
    model: string;
    model_config?: { speed: string };
    description?: string;
    system: string;
    mcp_servers?: Array<Record<string, unknown>>;
    tools: AgentToolset[];
    skills: SkillRef[];
    metadata?: Record<string, unknown>;
  };
};

export type RuntimeConfigState = 'configured' | 'missing_env' | 'not_set';

export type RuntimeModel = {
  name: string;
  provider: string;
  model: string;
  api_key_state: RuntimeConfigState;
  base_url_state: RuntimeConfigState;
};

export type Runtime = {
  status: string;
  agents_loaded: number;
  skills_loaded: number;
  models: RuntimeModel[];
  sandbox_providers: string[];
  memory: string;
  auth_enabled: boolean;
};

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type RuntimeLogEntry = {
  level: RuntimeLogLevel;
  time: string;
  msg: string;
  line: string;
  [key: string]: unknown;
};

export type Workspace = {
  type: 'workspace';
  name: string;
  root?: string;
  configDir?: string;
  dataDir?: string;
  agentsDir?: string;
  skillsDir?: string;
  configPath?: string;
  target?: string;
  directories?: {
    root?: string;
    agents?: string;
    skills?: string;
    data?: string;
    config?: string;
  };
};

export type ConsoleData = {
  agents: Agent[];
  sessions: Session[];
  environments: Environment[];
  vaults: Vault[];
  memoryStores: MemoryStore[];
  files: WorkspaceFile[];
  apiKeys: ApiKey[];
  skills: Skill[];
  templates: Template[];
  runtime: Runtime | null;
  workspace: Workspace | null;
};

export type ViewId =
  | 'quickstart'
  | 'agents'
  | 'sessions'
  | 'environments'
  | 'environment-detail'
  | 'credential-vaults'
  | 'credential-vault-detail'
  | 'memory-stores'
  | 'memory-store-detail'
  | 'skills'
  | 'files'
  | 'workspace'
  | 'runtime'
  | 'api-keys'
  | 'observability'
  | 'agent-detail'
  | 'session-detail'
  | 'settings';

export type AgentTab = 'agent' | 'sessions' | 'deployments' | 'observability';
