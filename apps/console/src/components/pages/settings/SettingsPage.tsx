import { Activity, Box, Brain, Copy, Database, FileText, Gauge, Keyboard, KeyRound, Layers, Lock, Monitor, Plus, Search, Settings, Shield, Terminal, Trash2, X, Zap } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { clearStoredApiKey, deleteJson, getPage, getStoredApiKey, postJson, setStoredApiKey } from '../../../api';
import { EmptyState, KeyValuePanel, RequiredMark, ResourceBadge, StatusPill, SummaryStrip } from '../../Common';
import { Modal } from '../../Modal';
import { copyText, formatDateShort, pathName, relativeDate, relativeWorkspacePath, truncateMiddle, workspaceConfigDir } from '../../../lib/format';
import type { ApiKey, ApiKeyCreateResponse, ConsoleData, RuntimeConfigState, RuntimeLogEntry, RuntimeLogLevel, ViewId, Workspace } from '../../../types';
import { SettingsLoopEngine, SettingsMemory, SettingsModels, SettingsSandbox, SettingsStorage } from './RuntimeSettings';
import { Observability, SettingsLogs } from './OperationsSettings';

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings, group: 'Project' },
  { id: 'workspace', label: 'Workspace', icon: Box, group: 'Project' },
  { id: 'models', label: 'Models', icon: Brain, group: 'Runtime' },
  { id: 'loop-engine', label: 'Loop engine', icon: Gauge, group: 'Runtime' },
  { id: 'storage', label: 'Storage', icon: Database, group: 'Runtime' },
  { id: 'memory', label: 'Memory', icon: Brain, group: 'Runtime' },
  { id: 'sandbox', label: 'Sandbox', icon: Shield, group: 'Runtime' },
  { id: 'api-keys', label: 'API keys', icon: KeyRound, group: 'Access' },
  { id: 'api-reference', label: 'API reference', icon: Keyboard, group: 'Developer' },
  { id: 'logs', label: 'Logs', icon: FileText, group: 'Operations' },
  { id: 'monitoring', label: 'Monitoring', icon: Activity, group: 'Operations' },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id'];

const SETTINGS_GROUPS = ['Project', 'Runtime', 'Access', 'Developer', 'Operations'] as const;

type ApiDocField = {
  name: string;
  type: string;
  description: string;
  required?: boolean;
};

type ApiDocEndpoint = {
  id: string;
  group: string;
  title: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  parameters?: ApiDocField[];
  response: ApiDocField[];
};

const API_REFERENCE_DOCS: ApiDocEndpoint[] = [
  {
    id: 'sessions-create',
    group: 'Sessions',
    title: 'Create session',
    method: 'POST',
    path: '/v1/sessions',
    summary: 'Create an executable agent session in an environment. Sessions persist a resumable event log and can be continued with messages or raw events.',
    parameters: [
      { name: 'agent', type: 'string | object', required: true, description: 'Agent id, or an object with an id and optional version.' },
      { name: 'environment_id', type: 'string', required: true, description: 'Environment template used to prepare the session runtime.' },
      { name: 'resources', type: 'array', description: 'Files, GitHub repositories, or memory stores mounted into the session.' },
      { name: 'vault_ids', type: 'string[]', description: 'Credential vault ids available to tools during this session.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated sess_... identifier.' },
      { name: 'status', type: 'idle | running | error | archived', description: 'Current session lifecycle state.' },
      { name: 'agent', type: 'object', description: 'Pinned agent id, name, and version used by this session.' },
    ],
  },
  {
    id: 'sessions-message',
    group: 'Sessions',
    title: 'Send message',
    method: 'POST',
    path: '/v1/sessions/{session_id}/messages',
    summary: 'Append a user message and run the agent loop. Set stream to true for Server-Sent Events.',
    parameters: [
      { name: 'content', type: 'string | content[]', required: true, description: 'User message text or structured content blocks.' },
      { name: 'stream', type: 'boolean', description: 'When true, returns an SSE stream of session and agent events.' },
    ],
    response: [
      { name: 'event', type: 'SSE event', description: 'Streaming event when stream is true.' },
      { name: 'session', type: 'object', description: 'Updated session envelope for non-streaming calls.' },
    ],
  },
  {
    id: 'agents-create',
    group: 'Agents',
    title: 'Create agent',
    method: 'POST',
    path: '/v1/agents',
    summary: 'Create a managed agent definition using the Claude-style runtime shape. Updates are versioned.',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Human-readable agent name.' },
      { name: 'model', type: 'string | object', required: true, description: 'Model reference used by the runtime provider.' },
      { name: 'system', type: 'string', required: true, description: 'System prompt used to drive the agent.' },
      { name: 'tools', type: 'array', description: 'Built-in and MCP toolsets with permission policy configuration.' },
      { name: 'skills', type: 'array', description: 'Skill references attached to this agent.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated agent_... identifier.' },
      { name: 'version', type: 'number', description: 'Initial version, incremented by updates.' },
      { name: 'status', type: 'active | archived', description: 'Current agent state.' },
    ],
  },
  {
    id: 'skills-create',
    group: 'Skills',
    title: 'Create skill',
    method: 'POST',
    path: '/v1/skills',
    summary: 'Upload a reusable Skill package. A valid package contains one top-level folder with SKILL.md at its root.',
    parameters: [
      { name: 'files', type: 'multipart file[] | JSON file[]', required: true, description: 'Zip, .skill file, directory upload, or JSON file list.' },
      { name: 'display_title', type: 'string', description: 'Optional human label not included in model prompts.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated skill_... identifier for custom uploads.' },
      { name: 'latest_version', type: 'string', description: 'Latest uploaded version identifier.' },
    ],
  },
  {
    id: 'files-upload',
    group: 'Files',
    title: 'Upload file',
    method: 'POST',
    path: '/v1/files',
    summary: 'Upload files once and mount them into sessions as resources.',
    parameters: [
      { name: 'file', type: 'multipart file', required: true, description: 'File payload for multipart uploads.' },
      { name: 'content', type: 'string', description: 'JSON upload content, encoded as utf8 or base64.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated file_... identifier.' },
      { name: 'filename', type: 'string', description: 'Original or supplied filename.' },
      { name: 'size_bytes', type: 'number', description: 'Stored file size.' },
    ],
  },
  {
    id: 'environments-create',
    group: 'Environments',
    title: 'Create environment',
    method: 'POST',
    path: '/v1/environments',
    summary: 'Create a reusable local environment template for package policy, sandboxing, and network access.',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Human-readable environment name.' },
      { name: 'hosting_type', type: 'local', description: 'Use local for the v1 quick-start path. Advanced workers are configured separately.' },
      { name: 'sandbox_provider', type: 'local', description: 'The default local sandbox provider.' },
      { name: 'network', type: 'object', description: 'Limited or unrestricted network policy.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated env_... identifier.' },
      { name: 'status', type: 'active | archived', description: 'Current environment state.' },
    ],
  },
  {
    id: 'vaults-credential-create',
    group: 'Credential vaults',
    title: 'Add credential',
    method: 'POST',
    path: '/v1/credential-vaults/{vault_id}/credentials',
    summary: 'Add an OAuth, bearer token, or environment variable credential to a workspace vault.',
    parameters: [
      { name: 'auth_type', type: 'mcp_oauth | bearer_token | environment_variable', required: true, description: 'Credential type and injection mode.' },
      { name: 'value', type: 'string', description: 'Secret value. Stored encrypted and never returned in list responses.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated vcrd_... identifier.' },
      { name: 'value_hint', type: 'string', description: 'Masked hint for the stored secret.' },
    ],
  },
  {
    id: 'memory-create',
    group: 'Memory stores',
    title: 'Create memory',
    method: 'POST',
    path: '/v1/memory_stores/{memory_store_id}/memories',
    summary: 'Write a persistent memory entry into a mounted store.',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'Absolute memory path, such as /notes/release.' },
      { name: 'content', type: 'string', required: true, description: 'Memory text content.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated mem_... identifier.' },
      { name: 'path', type: 'string', description: 'Normalized memory path.' },
    ],
  },
  {
    id: 'api-keys-create',
    group: 'API keys',
    title: 'Create API key',
    method: 'POST',
    path: '/v1/api-keys',
    summary: 'Create a local bearer token for shared dashboard or API access. The full secret is returned once.',
    parameters: [
      { name: 'name', type: 'string', required: true, description: 'Human-readable key label.' },
    ],
    response: [
      { name: 'id', type: 'string', description: 'Server-generated key_... identifier.' },
      { name: 'secret_key', type: 'string', description: 'Full bearer token, returned only on create.' },
    ],
  },
  {
    id: 'logs-list',
    group: 'Operations',
    title: 'List runtime logs',
    method: 'GET',
    path: '/v1/x/logs',
    summary: 'Read recent structured runtime logs from the current process.',
    parameters: [
      { name: 'limit', type: 'number', description: 'Maximum log lines to return.' },
      { name: 'level', type: 'debug | info | warn | error', description: 'Minimum severity filter.' },
    ],
    response: [
      { name: 'data', type: 'RuntimeLogEntry[]', description: 'Recent structured log lines.' },
    ],
  },
];

export function SettingsView({
  data,
  section,
  onRefresh,
  setView,
}: {
  data: ConsoleData;
  section: SettingsSection;
  onRefresh: () => void;
  setView: (view: ViewId) => void;
}) {
  const [active, setActive] = useState<SettingsSection>(section);
  const [settingsQuery, setSettingsQuery] = useState('');

  useEffect(() => {
    setActive(section);
  }, [section]);

  const visibleSettingsSections = useMemo(() => {
    const query = settingsQuery.trim().toLowerCase();
    if (!query) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter((item) => {
      return item.label.toLowerCase().includes(query)
        || item.group.toLowerCase().includes(query)
        || item.id.toLowerCase().includes(query);
    });
  }, [settingsQuery]);

  return (
    <section className="settingsShell">
      <aside className="settingsSidebar" aria-label="Settings sections">
        <div className="settingsSidebarHeader">
          <strong>Settings</strong>
          <button className="iconButton quiet" type="button" title="Back to console" onClick={() => setView('agents')}>
            <X size={17} />
          </button>
        </div>
        <div className="settingsSearch">
          <Search size={16} />
          <input
            aria-label="Search settings"
            placeholder="Search settings..."
            value={settingsQuery}
            onChange={(event) => setSettingsQuery(event.target.value)}
          />
        </div>
        {SETTINGS_GROUPS.map((group) => (
          <div className="settingsNavGroup" key={group} hidden={!visibleSettingsSections.some((item) => item.group === group)}>
            <div className="settingsGroupLabel">{group}</div>
            <div className="settingsNav">
              {visibleSettingsSections.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const nextView: ViewId = item.id === 'general' ? 'settings' : item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`settingsNavItem ${active === item.id ? 'active' : ''}`}
                    aria-current={active === item.id ? 'page' : undefined}
                    onClick={() => {
                      setActive(item.id);
                      setView(nextView);
                    }}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {visibleSettingsSections.length === 0 ? <div className="settingsNoResults">No settings match “{settingsQuery}”.</div> : null}
      </aside>
      <div className="settingsContent">
        {active === 'general' ? <SettingsGeneral data={data} setView={setView} /> : null}
        {active === 'workspace' ? <WorkspaceView data={data} /> : null}
        {active === 'models' ? <SettingsModels data={data} onRefresh={onRefresh} /> : null}
        {active === 'loop-engine' ? <SettingsLoopEngine data={data} onRefresh={onRefresh} /> : null}
        {active === 'storage' ? <SettingsStorage data={data} onRefresh={onRefresh} /> : null}
        {active === 'memory' ? <SettingsMemory data={data} onRefresh={onRefresh} /> : null}
        {active === 'sandbox' ? <SettingsSandbox data={data} onRefresh={onRefresh} /> : null}
        {active === 'api-keys' ? <ApiKeys data={data} onRefresh={onRefresh} /> : null}
        {active === 'api-reference' ? <SettingsApiReference data={data} /> : null}
        {active === 'logs' ? <SettingsLogs data={data} /> : null}
        {active === 'monitoring' ? <Observability data={data} /> : null}
      </div>
    </section>
  );
}

function SettingsGeneral({ data, setView }: { data: ConsoleData; setView: (view: ViewId) => void }) {
  const workspaceLabel = data.workspace?.name && data.workspace.name !== 'managed-agents'
    ? data.workspace.name
    : 'Default';
  const modelProvider = data.settings?.model_provider?.vendor ?? 'Needs setup';
  const loopEngine = data.settings?.loop_engine?.type ?? 'managed-agents';
  const metadataStorage = data.settings?.storage?.metadata?.type ?? 'sqlite';
  const artifactStorage = data.settings?.storage?.artifacts?.type ?? 'local_filesystem';
  const memoryBackend = data.settings?.memory?.backend?.type ?? data.runtime?.memory ?? 'sqlite';
  const sandboxBackend = data.settings?.sandbox?.type ?? data.runtime?.sandbox_providers.join(', ') ?? 'local';
  const cards: Array<{ id: ViewId; title: string; body: string; icon: ReactNode; meta: string | number }> = [
    { id: 'models', title: 'Models', body: 'One runtime provider: vendor, base URL, and API key reference.', icon: <Brain size={20} />, meta: modelProvider },
    { id: 'loop-engine', title: 'Loop engine', body: 'One active engine now; harness, Codex, and Claude are roadmap adapters.', icon: <Gauge size={20} />, meta: loopEngine },
    { id: 'storage', title: 'Storage', body: 'Flat metadata and artifact storage settings.', icon: <Database size={20} />, meta: `${metadataStorage}/${artifactStorage}` },
    { id: 'memory', title: 'Memory', body: 'Context memory backend, separate from Memory Stores.', icon: <Brain size={20} />, meta: memoryBackend },
    { id: 'sandbox', title: 'Sandbox', body: 'One active sandbox backend plus environment templates.', icon: <Shield size={20} />, meta: sandboxBackend },
    { id: 'api-keys', title: 'API keys', body: 'Bearer tokens for local API access and dashboard auth.', icon: <KeyRound size={20} />, meta: data.apiKeys.filter((key) => key.status === 'active').length },
    { id: 'api-reference', title: 'API reference', body: 'HTTP endpoints, SDK snippets, and Skill upload examples.', icon: <Keyboard size={20} />, meta: '/v1' },
    { id: 'logs', title: 'Logs', body: 'Runtime logs, refresh, and process restart controls.', icon: <FileText size={20} />, meta: data.runtime?.status ?? 'starting' },
    { id: 'monitoring', title: 'Monitoring', body: 'Metrics endpoint and workspace activity counters.', icon: <Activity size={20} />, meta: data.sessions.length },
  ];
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Settings</h1>
          <p>Configure models, loop engine behavior, storage, sandboxing, access, logs, and monitoring from one place.</p>
        </div>
      </div>
      <SummaryStrip items={[
        { label: 'Workspace', value: workspaceLabel, icon: <Box size={18} /> },
        { label: 'Target', value: data.workspace?.target ?? 'local', icon: <Layers size={18} /> },
        { label: 'Runtime', value: data.runtime?.status ?? 'starting', icon: <Terminal size={18} /> },
        { label: 'Auth', value: data.runtime?.auth_enabled ? 'enabled' : 'disabled', icon: <KeyRound size={18} /> },
      ]} />
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Project</h2>
          <p>Runtime records are stored outside the source tree, while seed directories stay in the project.</p>
          <KeyValuePanel rows={[
            ['Workspace', workspaceLabel],
            ['Root folder', pathName(data.workspace?.root) || data.workspace?.name],
            ['Configuration folder', workspaceConfigDir(data.workspace)],
            ['Memory backend', memoryBackend],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Capabilities</h2>
          <p>Live summary reported by the local runtime.</p>
          <KeyValuePanel rows={[
            ['Model provider', modelProvider],
            ['Loop engine', loopEngine],
            ['Sandbox', sandboxBackend],
            ['API auth', data.runtime?.auth_enabled ? 'enabled' : 'disabled'],
            ['Storage', `${metadataStorage}/${artifactStorage}`],
          ]} />
        </div>
      </div>
      <div className="settingsOverviewGrid">
        {cards.map((card) => (
          <button className="settingsOverviewCard" type="button" key={card.id} onClick={() => setView(card.id)}>
            <span className="settingsOverviewIcon">{card.icon}</span>
            <span>
              <strong>{card.title}</strong>
              <small>{card.body}</small>
            </span>
            <em>{card.meta}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function WorkspaceView({ data }: { data: ConsoleData }) {
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Workspace</h1>
          <p>Manage the local workspace that backs this console.</p>
        </div>
      </div>
      <div className="workspaceNotice">
        <Activity size={18} />
        <div>
          <strong>Single local workspace mode</strong>
          <span>Start the server with another root or config directory to run a different workspace.</span>
        </div>
      </div>
      <SummaryStrip
        items={[
          { label: 'Target', value: data.workspace?.target ?? 'local', icon: <Layers size={18} /> },
          { label: 'Agents', value: data.agents.length, icon: <Monitor size={18} /> },
          { label: 'Skills', value: data.skills.length, icon: <Zap size={18} /> },
          { label: 'Memory stores', value: data.memoryStores.length, icon: <Brain size={18} /> },
        ]}
      />
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Current workspace</h2>
          <p>{data.workspace?.name ?? 'local workspace'}</p>
          <KeyValuePanel rows={[
            ['Target', data.workspace?.target],
            ['Runtime status', data.runtime?.status ?? 'starting'],
            ['Root folder', pathName(data.workspace?.root) || data.workspace?.name],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Configuration</h2>
          <p>Local files used by the runtime.</p>
          <WorkspacePathsPanel workspace={data.workspace} />
        </div>
      </div>
    </section>
  );
}

function WorkspacePathsPanel({ workspace }: { workspace: Workspace | null }) {
  const configDir = workspaceConfigDir(workspace);
  const directoryRows = [
    { label: 'Agent seed directory', path: workspace?.directories?.agents ?? workspace?.agentsDir, defaultLabel: 'agents/', kind: 'directory' as const },
    { label: 'Skill seed directory', path: workspace?.directories?.skills ?? workspace?.skillsDir, defaultLabel: 'skills/', kind: 'directory' as const },
    { label: 'Runtime data directory', path: workspace?.directories?.data ?? workspace?.dataDir, defaultLabel: '~/.managed-agents/<workspace>/', kind: 'directory' as const },
    { label: 'Config file', path: workspace?.directories?.config ?? workspace?.configPath, defaultLabel: 'managed-agents.config.yaml', kind: 'file' as const },
  ];

  return (
    <div className="configFolderPanel">
      <div className="configFolderHeader">
        <div className="configFolderIcon"><Box size={20} /></div>
        <div>
          <span>Configuration folder</span>
          <strong title={configDir}>{pathName(configDir) || workspace?.name || 'workspace'}</strong>
        </div>
        {configDir ? (
          <button className="iconButton quiet" type="button" title={configDir} onClick={() => copyText(configDir)}>
            <Copy size={16} />
          </button>
        ) : null}
      </div>
      <div className="configPathList">
        {directoryRows.map((row) => (
          <div className="configPathRow" key={row.label} title={row.path ?? undefined}>
            <span>{row.label}</span>
            <strong>{relativeWorkspacePath(row.path, configDir, row.kind) ?? row.defaultLabel}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiKeys({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [storedKey, setStoredKey] = useState(() => getStoredApiKey());
  const activeKeys = data.apiKeys.filter((key) => key.status === 'active');
  const managedKeys = data.apiKeys.filter((key) => key.source === 'managed');
  const configuredKeys = data.apiKeys.filter((key) => key.source === 'config_env');

  const saveStoredKey = () => {
    setStoredApiKey(storedKey);
    onRefresh();
  };

  const clearBrowserKey = () => {
    clearStoredApiKey();
    setStoredKey('');
  };

  const deleteKey = async (key: ApiKey) => {
    if (key.source !== 'managed') return;
    if (!window.confirm(`Delete API key "${key.name}"? This cannot be undone.`)) return;
    await deleteJson(`/v1/api-keys/${encodeURIComponent(key.id)}`);
    onRefresh();
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>API keys</h1>
          <p>Create and manage bearer tokens for the local API.</p>
        </div>
        <button className="primaryButton" type="button" onClick={() => setModalOpen(true)}>
          <Plus size={18} />Create key
        </button>
      </div>
      <SummaryStrip items={[
        { label: 'Auth', value: data.runtime?.auth_enabled ? 'enabled' : 'disabled', icon: <KeyRound size={18} /> },
        { label: 'Active keys', value: String(activeKeys.length), icon: <Shield size={18} /> },
        { label: 'Managed keys', value: String(managedKeys.length), icon: <Lock size={18} /> },
        { label: 'Configured keys', value: String(configuredKeys.length), icon: <Settings size={18} /> },
      ]} />
      <div className="tablePanel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Source</th>
              <th>Status</th>
              <th>Key prefix</th>
              <th>Last used</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.apiKeys.map((key) => (
              <tr key={key.id}>
                <td><code>{truncateMiddle(key.id, 18)}</code></td>
                <td><strong>{key.name}</strong></td>
                <td><ResourceBadge>{key.source === 'managed' ? 'Managed' : 'Config / env'}</ResourceBadge></td>
                <td><StatusPill status={key.status} /></td>
                <td><code>{key.key_prefix}</code></td>
                <td>{key.last_used_at ? relativeDate(key.last_used_at) : 'Never'}</td>
                <td>{formatDateShort(key.created_at)}</td>
                <td className="rowActionsCell">
                  <button className="iconButton quiet" type="button" title="Copy key prefix" onClick={() => void copyText(key.key_prefix)}>
                    <Copy size={16} />
                  </button>
                  {key.source === 'managed' ? (
                    <button className="iconButton danger" type="button" title="Delete API key" onClick={() => void deleteKey(key)}>
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.apiKeys.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={22} />}
            title="No API keys"
            body="Create a key to require bearer-token authentication for the API."
            action={<button className="primaryButton" type="button" onClick={() => setModalOpen(true)}><Plus size={18} />Create key</button>}
          />
        ) : null}
      </div>
      <div className="panel subtlePanel">
        <div className="browserTokenHeader">
          <div>
            <h2>Browser token</h2>
            <p>Store a key locally in this browser so Console requests can authenticate when API auth is enabled.</p>
          </div>
          <ResourceBadge>{storedKey ? 'Stored locally' : 'Not stored'}</ResourceBadge>
        </div>
        <div className="inlineForm">
          <input value={storedKey} onChange={(event) => setStoredKey(event.target.value)} placeholder="ma_..." type="password" />
          <button className="secondaryButton" type="button" onClick={saveStoredKey}>Save token</button>
          <button type="button" className="ghostButton" onClick={clearBrowserKey}>Clear</button>
        </div>
      </div>
      {modalOpen ? (
        <ApiKeyModal
          onClose={() => setModalOpen(false)}
          onSaved={(secret) => {
            setStoredApiKey(secret);
            setStoredKey(secret);
            onRefresh();
          }}
        />
      ) : null}
    </section>
  );
}

function ApiKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: (secret: string) => void }) {
  const [name, setName] = useState('Default API key');
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (created) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await postJson<ApiKeyCreateResponse>('/v1/api-keys', { name });
      setCreated(response);
      onSaved(response.secret_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create API key" onClose={onClose}>
      <form className="modalForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        {!created ? (
          <>
            <label>
              <span>Name <RequiredMark /></span>
              <input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="Production key" required />
            </label>
            <p className="formHint">The generated key will be shown once. Store it before closing this dialog.</p>
          </>
        ) : (
          <div className="secretReveal">
            <div>
              <strong>{created.name}</strong>
              <span>{created.key_prefix}</span>
            </div>
            <code>{created.secret_key}</code>
            <button type="button" onClick={() => void copyText(created.secret_key)}>
              <Copy size={16} />Copy key
            </button>
          </div>
        )}
        <div className="modalActions">
          <button type="button" onClick={onClose}>{created ? 'Done' : 'Cancel'}</button>
          {!created ? <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create key'}</button> : null}
        </div>
      </form>
    </Modal>
  );
}

function SettingsApiReference({ data }: { data: ConsoleData }) {
  const baseUrl = typeof window === 'undefined' ? 'http://127.0.0.1:3000' : window.location.origin;
  const authEnabled = data.runtime?.auth_enabled ?? false;
  const firstAgentId = data.agents[0]?.id ?? 'agent_...';
  const firstEnvironmentId = data.environments[0]?.id ?? 'env_...';
  const firstSessionId = data.sessions[0]?.id ?? 'sess_...';
  const authCurl = authEnabled ? "  -H 'Authorization: Bearer ma_...' \\\n" : '';
  const sdkAuth = authEnabled ? "\n  apiKey: process.env.MANAGED_AGENTS_API_KEY," : '';
  const [activeEndpointId, setActiveEndpointId] = useState('sessions-create');
  const [endpointQuery, setEndpointQuery] = useState('');
  const filteredApiDocs = useMemo(() => {
    const query = endpointQuery.trim().toLowerCase();
    if (!query) return API_REFERENCE_DOCS;
    return API_REFERENCE_DOCS.filter((endpoint) => {
      return endpoint.title.toLowerCase().includes(query)
        || endpoint.group.toLowerCase().includes(query)
        || endpoint.path.toLowerCase().includes(query)
        || endpoint.summary.toLowerCase().includes(query)
        || endpoint.method.toLowerCase().includes(query);
    });
  }, [endpointQuery]);
  const visibleApiGroups = useMemo(() => Array.from(new Set(filteredApiDocs.map((endpoint) => endpoint.group))), [filteredApiDocs]);
  const activeEndpoint = filteredApiDocs.find((endpoint) => endpoint.id === activeEndpointId)
    ?? filteredApiDocs[0]
    ?? API_REFERENCE_DOCS[0];
  const headers: ApiDocField[] = [
    { name: 'Content-Type', type: 'application/json', description: 'Required for JSON request bodies.', required: activeEndpoint.method !== 'GET' },
    { name: 'Authorization', type: 'Bearer token', description: authEnabled ? 'Required when local API authentication is enabled.' : 'Optional while local API authentication is disabled.' },
    { name: 'anthropic-beta', type: 'string', description: 'Parsed for Claude-style compatibility; unsupported beta features must be rejected or surfaced as warnings.' },
  ];
  const skillUploadSnippet = [
    'zip -r code-review-assistant.zip code-review-assistant',
    '',
    `curl -sS -X POST '${baseUrl}/v1/skills' \\`,
    authCurl.trimEnd(),
    "  -F 'files=@code-review-assistant.zip'",
  ].filter(Boolean).join('\n');
  const sessionCurl = [
    `curl -sS -X POST '${baseUrl}/v1/sessions' \\`,
    "  -H 'Content-Type: application/json' \\",
    authCurl.trimEnd(),
    `  -d '{"agent":"${firstAgentId}","environment_id":"${firstEnvironmentId}","title":"API smoke test"}'`,
    '',
    `curl -N -X POST '${baseUrl}/v1/sessions/${firstSessionId}/messages' \\`,
    "  -H 'Content-Type: application/json' \\",
    authCurl.trimEnd(),
    "  -d '{\"content\":\"Hello from the API\",\"stream\":true}'",
  ].filter(Boolean).join('\n');
  const sdkSnippet = `import { ManagedAgentsClient } from 'managed-agents/sdk';

const client = new ManagedAgentsClient({
  baseUrl: '${baseUrl}',${sdkAuth}
});

const session = await client.sessions.create({
  agent: '${firstAgentId}',
  environment_id: '${firstEnvironmentId}',
  title: 'SDK smoke test',
});

for await (const event of client.sessions.chat(session.id, 'Hello')) {
  if (event.type === 'agent.message_chunk') {
    process.stdout.write(event.delta ?? '');
  }
}`;
  const skillJsonSnippet = `{
  "files": [
    {
      "path": "code-review-assistant/SKILL.md",
      "content": "---\\nname: code-review-assistant\\ndescription: Review TypeScript changes for correctness, tests, and API compatibility.\\n---\\n\\nUse this skill when reviewing code changes."
    }
  ],
  "display_title": "Code review assistant"
}`;
  const skillAttachSnippet = `name: Incident commander
description: Triages a Sentry alert and runs the war room.
model: default
system: |-
  You are an on-call incident commander.
tools:
  - type: agent_toolset_20260401
skills:
  - type: custom
    skill_id: skill_...`;
  const endpointExample = useMemo(() => {
    if (activeEndpoint.id === 'sessions-create') return sessionCurl;
    if (activeEndpoint.id === 'sessions-message') {
      return [
        `curl -N -X POST '${baseUrl}/v1/sessions/${firstSessionId}/messages' \\`,
        "  -H 'Content-Type: application/json' \\",
        authCurl.trimEnd(),
        "  -d '{\"content\":\"Hello from the API\",\"stream\":true}'",
      ].filter(Boolean).join('\n');
    }
    if (activeEndpoint.id === 'agents-create') {
      return [
        `curl -sS -X POST '${baseUrl}/v1/agents' \\`,
        "  -H 'Content-Type: application/json' \\",
        authCurl.trimEnd(),
        "  -d '{\"name\":\"assistant\",\"model\":\"default\",\"system\":\"You are helpful.\",\"tools\":[{\"type\":\"agent_toolset_20260401\"}]}'",
      ].filter(Boolean).join('\n');
    }
    if (activeEndpoint.id === 'skills-create') return skillUploadSnippet;
    if (activeEndpoint.id === 'files-upload') return [`curl -sS -X POST '${baseUrl}/v1/files' \\`, authCurl.trimEnd(), "  -F 'file=@notes.txt'"].filter(Boolean).join('\n');
    if (activeEndpoint.id === 'environments-create') return [`curl -sS -X POST '${baseUrl}/v1/environments' \\`, "  -H 'Content-Type: application/json' \\", authCurl.trimEnd(), "  -d '{\"name\":\"local-dev\",\"hosting_type\":\"local\",\"sandbox_provider\":\"local\",\"network\":{\"type\":\"limited\"}}'"].filter(Boolean).join('\n');
    if (activeEndpoint.id === 'vaults-credential-create') return [`curl -sS -X POST '${baseUrl}/v1/credential-vaults/vlt_.../credentials' \\`, "  -H 'Content-Type: application/json' \\", authCurl.trimEnd(), "  -d '{\"auth_type\":\"environment_variable\",\"variable_name\":\"GITHUB_TOKEN\",\"value\":\"ghp_example\"}'"].filter(Boolean).join('\n');
    if (activeEndpoint.id === 'memory-create') return [`curl -sS -X POST '${baseUrl}/v1/memory_stores/memstore_.../memories' \\`, "  -H 'Content-Type: application/json' \\", authCurl.trimEnd(), "  -d '{\"path\":\"/notes/release\",\"content\":\"Keep release notes concise.\"}'"].filter(Boolean).join('\n');
    if (activeEndpoint.id === 'api-keys-create') return [`curl -sS -X POST '${baseUrl}/v1/api-keys' \\`, "  -H 'Content-Type: application/json' \\", authCurl.trimEnd(), "  -d '{\"name\":\"Local Console\"}'"].filter(Boolean).join('\n');
    return `curl -sS '${baseUrl}${activeEndpoint.path}'`;
  }, [activeEndpoint, authCurl, baseUrl, firstSessionId, sessionCurl, skillUploadSnippet]);

  return (
    <section className="stack apiReference">
      <div className="pageIntro">
        <div>
          <h1>API reference</h1>
          <p>Use these endpoints to automate managed-agents from local scripts, SDKs, CI jobs, and external tools.</p>
        </div>
      </div>

      <div className="apiDocsShell">
        <aside className="apiDocsNav" aria-label="API endpoints">
          <div className="apiDocsSearch">
            <Search size={15} />
            <input
              aria-label="Search API endpoints"
              placeholder="Search endpoints..."
              value={endpointQuery}
              onChange={(event) => setEndpointQuery(event.target.value)}
            />
          </div>
          <div className="apiDocsRuntime">
            <span>Base URL</span>
            <code>{baseUrl}</code>
          </div>
          {visibleApiGroups.map((group) => (
            <div className="apiDocsNavGroup" key={group}>
              <strong>{group}</strong>
              {filteredApiDocs.filter((endpoint) => endpoint.group === group).map((endpoint) => (
                <button
                  type="button"
                  key={endpoint.id}
                  className={`apiDocsNavItem ${endpoint.id === activeEndpoint.id ? 'active' : ''}`}
                  onClick={() => setActiveEndpointId(endpoint.id)}
                >
                  <span className={`methodSquare method${endpoint.method}`}>{endpoint.method}</span>
                  <span>{endpoint.title}</span>
                </button>
              ))}
            </div>
          ))}
          {filteredApiDocs.length === 0 ? <div className="apiDocsNoResults">No endpoints match “{endpointQuery}”.</div> : null}
        </aside>

        {filteredApiDocs.length === 0 ? (
          <article className="apiDocsArticle apiDocsEmptyArticle">
            <EmptyState icon={<Keyboard size={22} />} title="No matching endpoints" body="Clear the endpoint search to return to the full local API reference." />
          </article>
        ) : (
        <article className="apiDocsArticle">
          <div className="apiDocsArticleHeader">
            <div>
              <h2>{activeEndpoint.title}</h2>
              <div className="apiDocsPath">
                <span className={`methodPill method${activeEndpoint.method}`}>{activeEndpoint.method}</span>
                <code>{activeEndpoint.path}</code>
              </div>
            </div>
            <button className="secondaryButton" type="button" onClick={() => copyText(`${activeEndpoint.method} ${activeEndpoint.path}`)}>
              <Copy size={15} /> Copy endpoint
            </button>
          </div>
          <p className="apiDocsSummary">{activeEndpoint.summary}</p>

          <ApiParamSection title="Header parameters" fields={headers} />
          <ApiParamSection title={activeEndpoint.method === 'GET' ? 'Query parameters' : 'Body parameters'} fields={activeEndpoint.parameters ?? []} />
          <ApiParamSection title="Returns" fields={activeEndpoint.response} />

          <section className="apiDocsSection">
            <h3>Skills package notes</h3>
            <p>Skill uploads follow Claude's package rule: one top-level folder containing <code>SKILL.md</code> at its root. The runtime derives the custom skill name from that package metadata and generates a random <code>skill_...</code> id.</p>
            <pre className="metricsPreview">code-review-assistant/{'\n'}  SKILL.md{'\n'}  references/checklist.md</pre>
          </section>

          <section className="apiDocsSection apiDocsExamples" aria-label="API examples">
            <h3>Examples</h3>
            <div className="apiDocsExampleGrid">
              <ApiCodeCard title="Example request" code={endpointExample} />
              <ApiCodeCard title="TypeScript SDK" code={sdkSnippet} />
              <ApiCodeCard title="Skill JSON upload" code={skillJsonSnippet} />
              <div className="apiDocsCodeCard">
                <h2>Agent skill reference</h2>
                <pre className="metricsPreview apiSnippet">{skillAttachSnippet}</pre>
              </div>
            </div>
          </section>
        </article>
        )}
      </div>
    </section>
  );
}

function ApiParamSection({ title, fields }: { title: string; fields: ApiDocField[] }) {
  return (
    <section className="apiDocsSection">
      <h3>{title}</h3>
      <div className="apiParamList">
        {fields.map((field) => (
          <div className="apiParamRow" key={field.name}>
            <div>
              <strong>{field.name}</strong>
              {field.required === undefined ? <span>{field.type}</span> : field.required ? <span>required</span> : <span>optional</span>}
            </div>
            <p><code>{field.type}</code> {field.description}</p>
          </div>
        ))}
        {fields.length === 0 ? <div className="apiParamEmpty">No parameters.</div> : null}
      </div>
    </section>
  );
}

function ApiCodeCard({ title, code }: { title: string; code: string }) {
  return (
    <div className="apiDocsCodeCard">
      <div className="snippetHeader">
        <h2>{title}</h2>
        <button className="iconButton" type="button" title={`Copy ${title}`} aria-label={`Copy ${title}`} onClick={() => copyText(code)}>
          <Copy size={15} />
        </button>
      </div>
      <pre className="metricsPreview apiSnippet">{code}</pre>
    </div>
  );
}

function RuntimeConfigStatePill({ state }: { state: RuntimeConfigState }) {
  const status = state === 'configured' ? 'active' : state === 'missing_env' ? 'failed' : 'idle';
  const label = state === 'missing_env' ? 'missing env' : state === 'not_set' ? 'not set' : 'configured';
  return <span className={`status ${status}`}>{label}</span>;
}

export function RuntimeView({ data }: { data: ConsoleData }) {
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logLevel, setLogLevel] = useState<RuntimeLogLevel | 'all'>('all');
  const [restartStatus, setRestartStatus] = useState('');
  const [restarting, setRestarting] = useState(false);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (logLevel !== 'all') params.set('level', logLevel);
      const page = await getPage<RuntimeLogEntry>(`/v1/x/logs?${params.toString()}`);
      setLogs(page.data);
      setLogsError('');
    } catch (err: any) {
      setLogsError(err?.message ?? String(err));
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 5000);
    return () => window.clearInterval(timer);
  }, [logLevel]);

  const restartRuntime = async () => {
    if (!window.confirm('Restart the local runtime? Active sessions will be interrupted.')) return;
    setRestarting(true);
    setRestartStatus('Scheduling runtime restart...');
    try {
      await postJson<{ restarting: boolean; status: string }>('/v1/x/restart', {});
      setRestartStatus('Restart scheduled. The Console will reconnect when the runtime is back.');
    } catch (err: any) {
      setRestartStatus(err?.message ?? String(err));
      setRestarting(false);
    }
  };
  const activeModel = data.runtime?.models[0] ?? null;
  const activeProvider = activeModel?.provider ?? data.settings?.model_provider?.vendor ?? 'Needs setup';
  const activeMemory = data.settings?.memory?.backend?.type ?? data.runtime?.memory ?? 'disabled';
  const activeSandbox = data.settings?.sandbox?.type ?? data.runtime?.sandbox_providers.join(', ') ?? 'none';

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Runtime diagnostics</h1>
          <p>Inspect the local process, active provider boundary, sandbox availability, workspace paths, and recent logs.</p>
        </div>
        <div className="topActions">
          <button className="secondaryButton" type="button" onClick={() => void loadLogs()} disabled={logsLoading}>
            Refresh logs
          </button>
          <button className="primaryButton" type="button" onClick={() => void restartRuntime()} disabled={restarting}>
            Restart runtime
          </button>
        </div>
      </div>
      <SummaryStrip
        items={[
          { label: 'Status', value: data.runtime?.status ?? 'unknown', icon: <Gauge size={18} /> },
          { label: 'Provider', value: activeProvider, icon: <Brain size={18} /> },
          { label: 'Sandbox', value: activeSandbox, icon: <Shield size={18} /> },
          { label: 'Memory', value: activeMemory, icon: <Database size={18} /> },
        ]}
      />
      <div className="resourceTruthStrip" aria-label="Runtime diagnostics truth model">
        <div><span>Read-only view</span><strong>Runtime diagnostics reports the active process; configuration changes live in Settings.</strong></div>
        <div><span>Provider boundary</span><strong>Model provider status is health metadata, not a model catalog.</strong></div>
        <div><span>Local process</span><strong>Restart controls affect this local runtime and can interrupt active sessions.</strong></div>
      </div>
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Model provider boundary</h2>
          <p>Runtime diagnostics show provider health only. Configure the single active provider in Settings → Models.</p>
          <KeyValuePanel rows={[
            ['Provider', activeModel?.provider ?? data.settings?.model_provider?.vendor ?? 'Needs setup'],
            ['Runtime alias', activeModel?.name ?? 'default'],
            ['API key', activeModel ? <RuntimeConfigStatePill state={activeModel.api_key_state} /> : 'Needs setup'],
            ['Base URL', activeModel ? <RuntimeConfigStatePill state={activeModel.base_url_state} /> : data.settings?.model_provider?.base_url ?? 'default'],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Execution boundary</h2>
          <p>These values are reported by the running process and should match Settings validation.</p>
          <KeyValuePanel rows={[
            ['Sandbox providers', data.runtime?.sandbox_providers.join(', ') || 'none'],
            ['Memory backend', data.runtime?.memory ?? 'disabled'],
            ['API auth', data.runtime?.auth_enabled ? 'enabled' : 'disabled'],
            ['Workspace target', data.workspace?.target ?? 'local'],
          ]} />
        </div>
      </div>
      <WorkspacePathsPanel workspace={data.workspace} />
      <div className="sectionHeaderRow">
        <div>
          <h2>Runtime logs</h2>
          <p>Recent structured logs from the current runtime process.</p>
        </div>
        <div className="toolbarActions">
          <select
            className="compactSelect"
            value={logLevel}
            onChange={(event) => setLogLevel(event.target.value as RuntimeLogLevel | 'all')}
            aria-label="Log level"
          >
            <option value="all">All levels</option>
            <option value="debug">Debug and above</option>
            <option value="info">Info and above</option>
            <option value="warn">Warn and above</option>
            <option value="error">Errors only</option>
          </select>
        </div>
      </div>
      <div className="runtimeLogPanel">
        {restartStatus ? <div className="runtimeStatus">{restartStatus}</div> : null}
        {logsError ? <div className="runtimeStatus error">{logsError}</div> : null}
        {logs.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title={logsLoading ? 'Loading logs' : 'No runtime logs'}
            body={logsLoading ? 'Reading recent structured log entries from the local runtime.' : 'No structured log entries have been captured by this process yet.'}
          />
        ) : (
          <div className="runtimeLogList" role="log" aria-live="polite">
            {logs.map((entry, index) => (
              <div className={`runtimeLogLine ${entry.level}`} key={`${entry.time}-${index}`}>
                <span className="runtimeLogMeta">{formatRuntimeLogTime(entry.time)} {entry.level.toUpperCase()}</span>
                <span className="runtimeLogMessage">{formatRuntimeLog(entry)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function formatRuntimeLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRuntimeLog(entry: RuntimeLogEntry) {
  const extras = Object.entries(entry)
    .filter(([key]) => !['level', 'time', 'msg', 'line'].includes(key))
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatRuntimeLogValue(value)}`);
  return extras.length > 0 ? `${entry.msg} ${extras.join(' ')}` : entry.msg;
}

function formatRuntimeLogValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
