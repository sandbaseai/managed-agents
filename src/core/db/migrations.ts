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
];
