/**
 * Database Migrations (embedded)
 *
 * Migrations are embedded as TypeScript string constants rather than loaded
 * from .sql files at runtime. This ensures they survive bundling (tsup emits
 * a single dist/index.js — external .sql files would not be found) and works
 * identically in dev, tests, and the shipped binary.
 *
 * To add a migration: append a new entry with the next version number.
 * Migrations run in ascending version order, each exactly once (tracked in
 * the _migrations table).
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const M001_INITIAL = `
-- Agent runtime state (cached from YAML)
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  error_message TEXT,
  loaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Environment definitions
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session state machine
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  title TEXT,
  context_id TEXT,
  metadata TEXT,
  sandbox_type TEXT,
  sandbox_state TEXT,
  usage_tokens_in INTEGER DEFAULT 0,
  usage_tokens_out INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (environment_id) REFERENCES environments(id)
);

CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_context ON sessions(context_id);
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);

-- Event Log (append-only)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  model_used TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  stop_reason TEXT,
  duration_ms INTEGER,
  parent_event_id TEXT,
  delegation_depth INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_events_session_seq ON events(session_id, seq);
CREATE INDEX idx_events_session_time ON events(session_id, created_at);
CREATE INDEX idx_events_type ON events(session_id, type);

-- Context compaction boundaries
CREATE TABLE compaction_boundaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  event_id_before TEXT NOT NULL,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Model registry (cached from config)
CREATE TABLE models (
  name TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  base_url TEXT,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Workspace snapshots (optional feature)
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`;

const M002_MEMORY = `
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_memories_context ON memories(context_id);
`;

const M003_WORK_ITEMS = `
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  claimed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_work_items_status ON work_items(status, created_at);
CREATE INDEX idx_work_items_session ON work_items(session_id);
`;

const M004_CONSOLE_RESOURCES = `
ALTER TABLE environments ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE environments ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE environments ADD COLUMN updated_at TEXT;
ALTER TABLE environments ADD COLUMN archived_at TEXT;
UPDATE environments SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE sessions ADD COLUMN resources TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN vault_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE credential_vaults (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE memory_stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'sqlite',
  status TEXT NOT NULL DEFAULT 'active',
  config TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
`;

const M005_AGENT_VERSIONING = `
ALTER TABLE agents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agents ADD COLUMN archived_at TEXT;
`;

const M006_CREDENTIAL_RECORDS = `
CREATE TABLE credential_records (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL,
  mcp_server_url TEXT,
  variable_name TEXT,
  value_hint TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT '{}',
  injection_locations TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (vault_id) REFERENCES credential_vaults(id)
);

CREATE INDEX idx_credential_records_vault ON credential_records(vault_id, created_at DESC);
CREATE INDEX idx_credential_records_status ON credential_records(status, created_at DESC);
`;

const M007_MEMORY_RECORDS = `
CREATE TABLE memory_records (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  FOREIGN KEY (store_id) REFERENCES memory_stores(id),
  UNIQUE (store_id, path)
);

CREATE INDEX idx_memory_records_store ON memory_records(store_id, path);
CREATE INDEX idx_memory_records_updated ON memory_records(store_id, updated_at DESC);
`;

const M008_CREDENTIAL_SECRET_STORAGE = `
ALTER TABLE credential_records ADD COLUMN secret_ciphertext TEXT NOT NULL DEFAULT '';
ALTER TABLE credential_records ADD COLUMN secret_nonce TEXT NOT NULL DEFAULT '';
ALTER TABLE credential_records ADD COLUMN secret_tag TEXT NOT NULL DEFAULT '';
`;

const M009_MEMORY_ACTIVE_PATH_INDEX = `
CREATE TABLE memory_records_next (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  FOREIGN KEY (store_id) REFERENCES memory_stores(id)
);

INSERT INTO memory_records_next (
  id, store_id, path, content, metadata, created_at, updated_at, archived_at
)
SELECT id, store_id, path, content, metadata, created_at, updated_at, archived_at
FROM memory_records;

DROP TABLE memory_records;
ALTER TABLE memory_records_next RENAME TO memory_records;

CREATE INDEX idx_memory_records_store ON memory_records(store_id, path);
CREATE INDEX idx_memory_records_updated ON memory_records(store_id, updated_at DESC);
CREATE UNIQUE INDEX idx_memory_records_active_path
  ON memory_records(store_id, path)
  WHERE archived_at IS NULL;
`;

const M010_FILE_RESOURCES = `
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX idx_files_status_created ON files(status, created_at DESC);
`;

const M011_SKILL_RESOURCES = `
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_title TEXT,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  frontmatter TEXT NOT NULL DEFAULT '{}',
  file TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'custom',
  latest_version TEXT,
  versions TEXT NOT NULL DEFAULT '[]',
  storage_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX idx_skills_source_updated ON skills(source, updated_at DESC);
CREATE UNIQUE INDEX idx_skills_active_name
  ON skills(name)
  WHERE archived_at IS NULL;
`;

const M012_API_KEYS = `
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  archived_at TEXT
);

CREATE INDEX idx_api_keys_status_created ON api_keys(status, created_at DESC);
`;

const M013_STANDARD_OBJECT_IDS = `
CREATE TABLE agents_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  error_message TEXT,
  loaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);

INSERT INTO agents_next (
  id, name, definition, status, error_message, loaded_at, updated_at, version, archived_at
)
SELECT id, name, definition, status, error_message, loaded_at, updated_at, version, archived_at
FROM agents;

DROP TABLE agents;
ALTER TABLE agents_next RENAME TO agents;
CREATE INDEX idx_agents_status_loaded ON agents(status, loaded_at ASC);

CREATE TABLE memory_stores_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'sqlite',
  status TEXT NOT NULL DEFAULT 'active',
  config TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

INSERT INTO memory_stores_next (
  id, name, description, provider, status, config, metadata, created_at, updated_at, archived_at
)
SELECT id, name, description, provider, status, config, metadata, created_at, updated_at, archived_at
FROM memory_stores;

DROP TABLE memory_stores;
ALTER TABLE memory_stores_next RENAME TO memory_stores;
CREATE INDEX idx_memory_stores_status_created ON memory_stores(status, created_at DESC);
`;

const M014_ENVIRONMENT_OBJECT_IDS = `
CREATE TABLE environments_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  archived_at TEXT
);

INSERT INTO environments_next (
  id, name, config, created_at, description, metadata, updated_at, archived_at
)
SELECT id, name, config, created_at, description, metadata, updated_at, archived_at
FROM environments;

DROP TABLE environments;
ALTER TABLE environments_next RENAME TO environments;
CREATE INDEX idx_environments_status_created ON environments(archived_at, created_at DESC);
`;

const M015_CREDENTIAL_VAULT_OBJECT_IDS = `
CREATE TABLE credential_vaults_next (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

INSERT INTO credential_vaults_next (
  id, name, description, status, metadata, created_at, updated_at, archived_at
)
SELECT id, name, description, status, metadata, created_at, updated_at, archived_at
FROM credential_vaults;

DROP TABLE credential_vaults;
ALTER TABLE credential_vaults_next RENAME TO credential_vaults;
CREATE INDEX idx_credential_vaults_status_created ON credential_vaults(status, created_at DESC);
`;

const M016_MODEL_PROVIDER_SETTINGS = `
ALTER TABLE models ADD COLUMN api_key TEXT;
ALTER TABLE models ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN updated_at TEXT;

UPDATE models
SET updated_at = created_at
WHERE updated_at IS NULL;

UPDATE models
SET is_default = 1
WHERE name = (
  SELECT name FROM models ORDER BY created_at ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM models WHERE is_default = 1
);

CREATE UNIQUE INDEX idx_models_default
  ON models(is_default)
  WHERE is_default = 1;
`;

const M017_MEMORY_PROVIDER_SETTINGS = `
CREATE TABLE memory_providers (
  name TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  connection_url TEXT,
  api_key TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO memory_providers (
  name, provider, connection_url, api_key, config, is_default, status, created_at, updated_at
)
VALUES (
  'local-sqlite', 'sqlite', NULL, NULL, '{}', 1, 'active', datetime('now'), datetime('now')
);

CREATE UNIQUE INDEX idx_memory_providers_default
  ON memory_providers(is_default)
  WHERE is_default = 1;
`;

const M018_STORAGE_PROVIDER_SETTINGS = `
CREATE TABLE storage_providers (
  name TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_url TEXT,
  bucket TEXT,
  region TEXT,
  base_path TEXT,
  access_key TEXT,
  secret_key TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  initialized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO storage_providers (
  name, role, provider, connection_url, bucket, region, base_path, access_key, secret_key,
  config, is_default, status, initialized_at, created_at, updated_at
)
VALUES
  (
    'metadata-sqlite', 'metadata', 'sqlite', NULL, NULL, NULL, NULL, NULL, NULL,
    '{}', 1, 'active', datetime('now'), datetime('now'), datetime('now')
  ),
  (
    'local-artifacts', 'artifact', 'local_filesystem', NULL, NULL, NULL, 'files', NULL, NULL,
    '{}', 1, 'active', datetime('now'), datetime('now'), datetime('now')
  );

CREATE UNIQUE INDEX idx_storage_providers_default_role
  ON storage_providers(role, is_default)
  WHERE is_default = 1;

CREATE INDEX idx_storage_providers_role
  ON storage_providers(role, created_at DESC);
`;

const M019_RUNTIME_SETTINGS = `
CREATE TABLE runtime_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  schema_version INTEGER NOT NULL,
  config TEXT NOT NULL,
  effective_config TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  effective_revision INTEGER NOT NULL DEFAULT 1,
  restart_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const M020_RUNTIME_SETTINGS_SECRETS = `
CREATE TABLE runtime_settings_secrets (
  path TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const M021_RUNTIME_SETTINGS_ACTIVATION_STATE = `
ALTER TABLE runtime_settings ADD COLUMN activation_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE runtime_settings ADD COLUMN activation_errors TEXT NOT NULL DEFAULT '[]';
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: '001_initial', sql: M001_INITIAL },
  { version: 2, name: '002_memory', sql: M002_MEMORY },
  { version: 3, name: '003_work_items', sql: M003_WORK_ITEMS },
  { version: 4, name: '004_console_resources', sql: M004_CONSOLE_RESOURCES },
  { version: 5, name: '005_agent_versioning', sql: M005_AGENT_VERSIONING },
  { version: 6, name: '006_credential_records', sql: M006_CREDENTIAL_RECORDS },
  { version: 7, name: '007_memory_records', sql: M007_MEMORY_RECORDS },
  { version: 8, name: '008_credential_secret_storage', sql: M008_CREDENTIAL_SECRET_STORAGE },
  { version: 9, name: '009_memory_active_path_index', sql: M009_MEMORY_ACTIVE_PATH_INDEX },
  { version: 10, name: '010_file_resources', sql: M010_FILE_RESOURCES },
  { version: 11, name: '011_skill_resources', sql: M011_SKILL_RESOURCES },
  { version: 12, name: '012_api_keys', sql: M012_API_KEYS },
  { version: 13, name: '013_standard_object_ids', sql: M013_STANDARD_OBJECT_IDS },
  { version: 14, name: '014_environment_object_ids', sql: M014_ENVIRONMENT_OBJECT_IDS },
  { version: 15, name: '015_credential_vault_object_ids', sql: M015_CREDENTIAL_VAULT_OBJECT_IDS },
  { version: 16, name: '016_model_provider_settings', sql: M016_MODEL_PROVIDER_SETTINGS },
  { version: 17, name: '017_memory_provider_settings', sql: M017_MEMORY_PROVIDER_SETTINGS },
  { version: 18, name: '018_storage_provider_settings', sql: M018_STORAGE_PROVIDER_SETTINGS },
  { version: 19, name: '019_runtime_settings', sql: M019_RUNTIME_SETTINGS },
  { version: 20, name: '020_runtime_settings_secrets', sql: M020_RUNTIME_SETTINGS_SECRETS },
  { version: 21, name: '021_runtime_settings_activation_state', sql: M021_RUNTIME_SETTINGS_ACTIVATION_STATE },
];
