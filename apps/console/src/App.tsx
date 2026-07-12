import {
  Activity,
  Box,
  Brain,
  Check,
  ChevronDown,
  CirclePlay,
  Database,
  FileText,
  Gauge,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Monitor,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

type Page<T> = {
  data: T[];
  has_more: boolean;
  first_id: string | null;
  last_id: string | null;
};

type Agent = {
  id: string;
  type: 'agent';
  name: string;
  description: string;
  system: string;
  model: { id: string; speed: string };
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

type AgentToolset = BuiltinToolset | McpToolset;

type BuiltinToolset = {
  type: 'agent_toolset_20260401';
  configs?: Record<string, ToolConfig>;
  default_config?: ToolConfig;
};

type McpToolset = {
  type: 'mcp_toolset';
  mcp_server_name: string;
  configs?: Record<string, ToolConfig>;
  default_config?: ToolConfig;
};

type ToolConfig = {
  enabled?: boolean;
  permission_policy?: { type: 'always_allow' | 'always_ask' | 'never_allow' };
};

type SkillRef = { type: 'custom'; skill_id: string; version?: string };

type Session = {
  id: string;
  type: 'session';
  title: string | null;
  agent: Agent | { id: string; type: 'agent'; name: string };
  environment_id: string;
  status: 'idle' | 'running' | 'terminated' | 'failed';
  resources: Array<Record<string, unknown>>;
  vault_ids: string[];
  usage: { input_tokens: number; output_tokens: number };
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type Environment = {
  id: string;
  type: 'environment';
  name: string;
  description: string;
  status: string;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type Vault = {
  id: string;
  type: 'credential_vault';
  name: string;
  description: string;
  status: string;
  credential_count: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type MemoryStore = {
  id: string;
  type: 'memory_store';
  name: string;
  description: string;
  provider: string;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type Skill = {
  id: string;
  type: 'skill';
  name: string;
  description: string;
  file: string;
};

type Template = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  summary: string;
  skill_ids: string[];
	  agent: {
	    name: string;
	    model: { id: string; speed: string };
    description?: string;
    system: string;
    mcp_servers?: Array<Record<string, unknown>>;
    tools: AgentToolset[];
    skills: SkillRef[];
    metadata?: Record<string, unknown>;
  };
};

type Runtime = {
  status: string;
  agents_loaded: number;
  skills_loaded: number;
  models: string[];
  sandbox_providers: string[];
  memory: string;
  auth_enabled: boolean;
};

type Workspace = {
  type: 'workspace';
  name: string;
  root?: string;
  dataDir?: string;
  agentsDir?: string;
  skillsDir?: string;
  configPath?: string;
  target?: string;
};

type ConsoleData = {
  agents: Agent[];
  sessions: Session[];
  environments: Environment[];
  vaults: Vault[];
  memoryStores: MemoryStore[];
  skills: Skill[];
  templates: Template[];
  runtime: Runtime | null;
  workspace: Workspace | null;
};

type ViewId =
  | 'quickstart'
  | 'agents'
  | 'sessions'
  | 'environments'
  | 'credential-vaults'
  | 'memory-stores'
  | 'skills'
  | 'files'
  | 'workspace'
  | 'runtime'
  | 'api-keys'
  | 'observability'
  | 'agent-detail'
  | 'settings';

type AgentTab = 'agent' | 'sessions' | 'deployments' | 'observability';

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> }> = [
  {
    label: 'Build',
    items: [
      { id: 'quickstart', label: 'Quickstart', icon: Sparkles },
      { id: 'files', label: 'Files', icon: FileText },
      { id: 'skills', label: 'Skills', icon: Zap },
    ],
  },
  {
    label: 'Managed Agents',
    items: [
      { id: 'agents', label: 'Agents', icon: Monitor },
      { id: 'sessions', label: 'Sessions', icon: MessageSquare },
      { id: 'environments', label: 'Environments', icon: Server },
      { id: 'credential-vaults', label: 'Credential Vaults', icon: Lock },
      { id: 'memory-stores', label: 'Memory Stores', icon: Database },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'workspace', label: 'Workspace', icon: Box },
      { id: 'runtime', label: 'Local Runtime', icon: Terminal },
      { id: 'api-keys', label: 'API Keys', icon: KeyRound },
      { id: 'observability', label: 'Observability', icon: Activity },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const TOOL_NAMES = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'web_search', 'web_fetch'];

function emptyData(): ConsoleData {
  return {
    agents: [],
    sessions: [],
    environments: [],
    vaults: [],
    memoryStores: [],
    skills: [],
    templates: [],
    runtime: null,
    workspace: null,
  };
}

export function App() {
  const [route, setRoute] = useHashRoute();
  const view = route.view;
  const [data, setData] = useState<ConsoleData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentModal, setAgentModal] = useState<Template | null | 'blank'>(null);
  const [agentEditModal, setAgentEditModal] = useState<Agent | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(route.agentId ?? null);
  const [agentTab, setAgentTab] = useState<AgentTab>('agent');
  const [sessionModal, setSessionModal] = useState<string | null>(null);
  const [resourceModal, setResourceModal] = useState<'environment' | 'credential_vault' | 'memory_store' | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [
        agents,
        sessions,
        environments,
        vaults,
        memoryStores,
        skills,
        templates,
        runtime,
        workspace,
      ] = await Promise.all([
        getPage<Agent>('/v1/agents'),
        getPage<Session>('/v1/sessions?limit=100'),
        getPage<Environment>('/v1/environments'),
        getPage<Vault>('/v1/credential-vaults'),
        getPage<MemoryStore>('/v1/memory-stores'),
        getPage<Skill>('/v1/x/skills'),
        getPage<Template>('/v1/x/templates'),
        getJson<Runtime>('/v1/x/runtime'),
        getJson<Workspace>('/v1/x/workspace'),
      ]);
      setData({
        agents: agents.data,
        sessions: sessions.data,
        environments: environments.data,
        vaults: vaults.data,
        memoryStores: memoryStores.data,
        skills: skills.data,
        templates: templates.data,
        runtime,
        workspace,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (route.agentId) setSelectedAgentId(route.agentId);
  }, [route.agentId]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">▣</span>
          <span>managed-agents</span>
        </div>
        <button className="workspaceSwitch" type="button" onClick={() => setRoute('workspace')}>
          <span className="workspaceAvatar">{(data.workspace?.name ?? 'W').slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{data.workspace?.name ?? 'Workspace'}</strong>
            <small>{data.workspace?.target ?? 'local'}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        <nav className="nav">
          {NAV_GROUPS.map((group) => (
            <div className="navGroup" key={group.label}>
              <div className="navLabel">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id || (view === 'agent-detail' && item.id === 'agents');
                return (
                  <button
                    type="button"
                    className={`navItem ${active ? 'active' : ''}`}
                    key={item.id}
                    onClick={() => setRoute(item.id)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main className="main">
        <header className="consoleNotice">
          <div>
            <Info size={17} />
            <span>{data.runtime ? 'Local runtime connected' : 'Local runtime starting'}</span>
          </div>
          <button className="iconButton quiet" type="button" title="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={17} />
          </button>
        </header>

        {error ? <div className="banner error">{error}</div> : null}
        {loading ? <LoadingState /> : (
          <View
            view={view}
              data={data}
              setView={setRoute}
              selectedAgentId={selectedAgentId}
              agentTab={agentTab}
              onAgentTab={setAgentTab}
              onOpenAgent={(agent) => {
                setSelectedAgentId(agent.id);
                setAgentTab('agent');
                setRoute('agent-detail', agent.id);
              }}
              onEditAgent={(agent) => setAgentEditModal(agent)}
              onNewAgent={(template) => setAgentModal(template)}
              onNewSession={(agentId) => setSessionModal(agentId ?? '')}
              onNewResource={(kind) => setResourceModal(kind)}
              onRefresh={() => void refresh()}
            />
        )}
      </main>

      {agentModal ? (
        <AgentModal
          template={agentModal === 'blank' ? undefined : agentModal}
          data={data}
          onClose={() => setAgentModal(null)}
          onSaved={() => {
            setAgentModal(null);
            void refresh();
            setRoute('agents');
          }}
        />
      ) : null}

      {agentEditModal ? (
        <AgentEditModal
          agent={agentEditModal}
          onClose={() => setAgentEditModal(null)}
          onSaved={() => {
            setAgentEditModal(null);
            void refresh();
          }}
        />
      ) : null}

      {sessionModal !== null ? (
        <SessionModal
          data={data}
          initialAgentId={sessionModal || undefined}
          onClose={() => setSessionModal(null)}
          onSaved={() => {
            setSessionModal(null);
            void refresh();
            setRoute('sessions');
          }}
        />
      ) : null}

      {resourceModal ? (
        <ResourceModal
          kind={resourceModal}
          onClose={() => setResourceModal(null)}
          onSaved={() => {
            setResourceModal(null);
            void refresh();
            setRoute(resourceModal === 'credential_vault' ? 'credential-vaults' : resourceModal === 'memory_store' ? 'memory-stores' : 'environments');
          }}
        />
      ) : null}
    </div>
  );
}

function View(props: {
  view: ViewId;
  data: ConsoleData;
  setView: (view: ViewId) => void;
  selectedAgentId: string | null;
  agentTab: AgentTab;
  onAgentTab: (tab: AgentTab) => void;
  onOpenAgent: (agent: Agent) => void;
  onEditAgent: (agent: Agent) => void;
  onNewAgent: (template: Template | 'blank') => void;
  onNewSession: (agentId?: string) => void;
  onNewResource: (kind: 'environment' | 'credential_vault' | 'memory_store') => void;
  onRefresh: () => void;
}) {
  switch (props.view) {
    case 'quickstart':
      return <Quickstart data={props.data} onNewAgent={props.onNewAgent} />;
    case 'agents':
      return <Agents data={props.data} onNewAgent={() => props.onNewAgent('blank')} onOpenAgent={props.onOpenAgent} />;
    case 'agent-detail': {
      const agent = props.data.agents.find((item) => item.id === props.selectedAgentId) ?? props.data.agents[0];
      return agent ? (
        <AgentDetail
          agent={agent}
          data={props.data}
          tab={props.agentTab}
          onTab={props.onAgentTab}
          onBack={() => props.setView('agents')}
          onEdit={() => props.onEditAgent(agent)}
          onNewSession={() => props.onNewSession(agent.id)}
          onRefresh={props.onRefresh}
        />
      ) : <EmptyState icon={<Monitor size={22} />} title="No agent selected" />;
    }
    case 'sessions':
      return <Sessions data={props.data} onNewSession={() => props.onNewSession()} />;
    case 'environments':
      return <ResourceList title="Environments" icon={<Server size={20} />} rows={props.data.environments} onNew={() => props.onNewResource('environment')} />;
    case 'credential-vaults':
      return <ResourceList title="Credential Vaults" icon={<Lock size={20} />} rows={props.data.vaults} onNew={() => props.onNewResource('credential_vault')} />;
    case 'memory-stores':
      return <ResourceList title="Memory Stores" icon={<Database size={20} />} rows={props.data.memoryStores} onNew={() => props.onNewResource('memory_store')} />;
    case 'skills':
      return <Skills data={props.data} />;
    case 'files':
      return <Files data={props.data} />;
    case 'workspace':
      return <WorkspaceView data={props.data} />;
    case 'runtime':
      return <RuntimeView data={props.data} />;
    case 'api-keys':
      return <ApiKeys data={props.data} />;
    case 'observability':
      return <Observability data={props.data} />;
    case 'settings':
      return <SettingsView data={props.data} />;
    default:
      return <Quickstart data={props.data} onNewAgent={props.onNewAgent} />;
  }
}

function Quickstart({ data, onNewAgent }: { data: ConsoleData; onNewAgent: (template: Template | 'blank') => void }) {
  const [query, setQuery] = useState('');
  const filtered = data.templates.filter((template) => {
    const q = query.toLowerCase();
    return template.name.toLowerCase().includes(q) || template.description.toLowerCase().includes(q);
  });
  const [selected, setSelected] = useState<Template | null>(data.templates[0] ?? null);

  useEffect(() => {
    if (data.templates.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !data.templates.some((template) => template.id === selected.id)) {
      setSelected(data.templates[0]);
    }
  }, [data.templates, selected]);

  return (
    <section className="quickstart">
      <div className="quickPrompt">
        <div className="stepper">
          {[1, 2, 3, 4].map((step) => <span key={step} className={step === 1 ? 'current' : ''}>{step}</span>)}
        </div>
        <div className="buildPrompt">
          <Sparkles size={22} />
          <h2>What do you want to build?</h2>
          <textarea placeholder="Describe your agent or start with a template." />
          <div className="promptActions">
            <button className="secondaryButton" type="button">
              <Upload size={16} />
              Import agent
            </button>
            <button className="primaryButton" type="button" onClick={() => onNewAgent(selected ?? 'blank')}>
              <Plus size={16} />
              Create agent
            </button>
          </div>
        </div>
      </div>

      <div className="panel templatesPanel">
        <div className="panelHeader">
          <div>
            <h2>Browse templates</h2>
            <p>{filtered.length} available</p>
          </div>
        </div>
        <div className="searchBox">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" />
        </div>
        <div className="templateGrid">
          {filtered.map((template) => (
            <button
              type="button"
              key={template.id}
              className={`templateCard ${selected?.id === template.id ? 'selected' : ''}`}
              onClick={() => setSelected(template)}
            >
              <strong>{template.name}</strong>
              <span>{template.description}</span>
              <small>{template.summary}</small>
            </button>
          ))}
        </div>
        {selected ? (
          <div className="codePreview">
            <div className="codeHeader">
              <span>{selected.agent.name}.yaml</span>
              <button className="textButton" type="button" onClick={() => onNewAgent(selected)}>Use template</button>
            </div>
            <pre>{agentYamlPreview(selected.agent)}</pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Agents({ data, onNewAgent, onOpenAgent }: { data: ConsoleData; onNewAgent: () => void; onOpenAgent: (agent: Agent) => void }) {
  const [query, setQuery] = useState('');
  const agents = data.agents.filter((agent) => {
    const q = query.toLowerCase();
    return agent.id.toLowerCase().includes(q) || agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q) || agent.model.id.toLowerCase().includes(q);
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Agents</h1>
          <p>Create and manage autonomous agents.</p>
        </div>
        <button className="darkButton" type="button" onClick={onNewAgent}>
          <Plus size={18} />
          Create agent
        </button>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={(
          <>
            <button className="filterButton" type="button">Created <strong>All time</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Status <strong>Active</strong> <ChevronDown size={15} /></button>
          </>
        )}
      />
      <div className="tablePanel agentsTablePanel">
        <table className="agentTable">
          <thead>
            <tr>
              <th className="selectCol"><input type="checkbox" aria-label="Select all agents" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Model</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id} className="clickableRow" onClick={() => onOpenAgent(agent)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${agent.name}`} /></td>
                <td className="monoCell">{shortId(agent.id)}</td>
                <td>
                  <strong>{agent.name}</strong>
                  <span>{agent.description || agent.id}</span>
                </td>
                <td>{agent.model.id}</td>
                <td><StatusPill status={agent.status} /></td>
                <td>{formatDate(agent.created_at)}</td>
                <td>{formatDate(agent.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {agents.length === 0 ? <EmptyState icon={<Monitor size={22} />} title="No agents" /> : null}
      </div>
      <div className="mobileAgentList">
        {agents.map((agent) => (
          <button className="mobileAgentCard" type="button" key={agent.id} onClick={() => onOpenAgent(agent)}>
            <span className="mobileAgentMain">
              <strong>{agent.name}</strong>
              <small className="monoText">{agent.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{agent.model.id}</span>
              <StatusPill status={agent.status} />
            </span>
          </button>
        ))}
        {agents.length === 0 ? <EmptyState icon={<Monitor size={22} />} title="No agents" /> : null}
      </div>
    </section>
  );
}

function AgentDetail({
  agent,
  data,
  tab,
  onTab,
  onBack,
  onEdit,
  onNewSession,
  onRefresh,
}: {
  agent: Agent;
  data: ConsoleData;
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
  onBack: () => void;
  onEdit: () => void;
  onNewSession: () => void;
  onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const agentSessions = data.sessions.filter((session) => session.agent.id === agent.id);
  const tokenIn = agentSessions.reduce((sum, session) => sum + session.usage.input_tokens, 0);
  const tokenOut = agentSessions.reduce((sum, session) => sum + session.usage.output_tokens, 0);

  const archive = async () => {
    await postJson(`/v1/agents/${agent.id}/archive`, {});
    setMenuOpen(false);
    onRefresh();
  };

  return (
    <section className="agentDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Agents</button>
        <span>/</span>
        <strong>{agent.name}</strong>
      </div>

      <div className="agentHero">
        <div>
          <div className="titleLine">
            <h1>{agent.name}</h1>
            <StatusPill status={agent.status} />
          </div>
          <p className="mutedLine"><span className="monoText">{agent.id}</span> · Last updated {formatDate(agent.updated_at)}</p>
          <p className="agentDescription">{agent.description || 'No description.'}</p>
        </div>
        <div className="agentHeroActions">
          <button className="secondaryButton largeAction" type="button" onClick={onEdit}>
            <Pencil size={18} />
            Edit
          </button>
          <div className="menuWrap">
            <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} title="Agent actions">
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="agentMenu">
                <button type="button" onClick={onNewSession}><Play size={18} />Start session</button>
                <button type="button" onClick={onEdit}><Sparkles size={18} />Guided edit</button>
                <button type="button" disabled title="Deployments are not implemented yet"><Plus size={18} />Create deployment</button>
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Lock size={18} />Archive</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="detailTabs">
        {(['agent', 'sessions', 'deployments', 'observability'] as AgentTab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? 'active' : ''}
            onClick={() => onTab(item)}
          >
            {item === 'agent' ? 'Agent' : item[0].toUpperCase() + item.slice(1)}
            {item === 'observability' ? <span className="newPill">New</span> : null}
          </button>
        ))}
      </div>

      {tab === 'agent' ? <AgentConfigTab agent={agent} /> : null}
      {tab === 'sessions' ? <AgentSessionsTab sessions={agentSessions} /> : null}
      {tab === 'deployments' ? <EmptyState icon={<Server size={22} />} title="No deployments" /> : null}
      {tab === 'observability' ? (
        <AgentObservability sessions={agentSessions} tokenIn={tokenIn} tokenOut={tokenOut} />
      ) : null}
    </section>
  );
}

function AgentConfigTab({ agent }: { agent: Agent }) {
  const builtinToolCount = toolNames(agent).length || 8;
  const mcpToolsets = agent.tools.filter((toolset): toolset is McpToolset => toolset.type === 'mcp_toolset');
  return (
    <div className="detailStack">
      <div className="versionRow">
        <button className="filterButton" type="button">Version <strong>v{agent.version}</strong> <ChevronDown size={15} /></button>
      </div>
      <div className="systemPreview">
        <pre>{agent.system}</pre>
      </div>

      <section className="detailSection">
        <h2>MCPs and tools</h2>
        <div className="toolsetCard">
          <div className="toolsetHeader">
            <div className="toolsetIcon"><Box size={22} /></div>
            <div>
              <strong>Built-in tools</strong>
              <span>agent_toolset_20260401</span>
            </div>
          </div>
          <div className="toolsetRow">
            <span><ChevronDown size={16} />Tool permissions <b>{builtinToolCount}</b></span>
            <span className="allowText"><Check size={16} />Always allow</span>
          </div>
        </div>
        {mcpToolsets.map((toolset) => (
          <div className="toolsetCard" key={toolset.mcp_server_name}>
            <div className="toolsetHeader">
              <div className="toolsetIcon"><Zap size={22} /></div>
              <div>
                <strong>{toolset.mcp_server_name}</strong>
                <span>mcp_toolset</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="detailSection">
        <h2>Skills</h2>
        {agent.skills.length ? (
          <div className="chipRow">{agent.skills.map((skill) => <span className="softChip" key={skill.skill_id}>{skill.skill_id}</span>)}</div>
        ) : <p className="emptyInline">No skills attached.</p>}
      </section>
    </div>
  );
}

function AgentSessionsTab({ sessions }: { sessions: Session[] }) {
  return (
    <div className="detailStack">
      <Toolbar
        query=""
        onQuery={() => {}}
        placeholder="Search sessions"
        actions={(
          <>
            <button className="filterButton" type="button">Created <strong>All time</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Version <strong>All</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Deployment <strong>All</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Status <strong>All</strong> <ChevronDown size={15} /></button>
          </>
        )}
      />
      <div className="tablePanel">
        <table>
          <thead><tr><th className="selectCol"><input type="checkbox" aria-label="Select sessions" /></th><th>ID</th><th>Name</th><th>Status</th><th>Version</th><th>Tokens in / out</th><th>Created</th></tr></thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="selectCol"><input type="checkbox" aria-label={`Select ${session.id}`} /></td>
                <td className="monoCell">{shortId(session.id)}</td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td>v1</td>
                <td>{session.usage.input_tokens || '-'} / {session.usage.output_tokens || '-'}</td>
                <td>{formatDate(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
      </div>
    </div>
  );
}

function AgentObservability({ sessions, tokenIn, tokenOut }: { sessions: Session[]; tokenIn: number; tokenOut: number }) {
  const failed = sessions.filter((session) => session.status === 'failed').length;
  const errorRate = sessions.length ? Math.round((failed / sessions.length) * 100) : 0;
  return (
    <div className="detailStack">
      <div className="metricGrid">
        <MetricCard title="Sessions" value={sessions.length} subtitle="in total" />
        <MetricCard title="Error rate" value={`${errorRate}%`} />
        <MetricCard title="Total input tokens" value={tokenIn} />
        <MetricCard title="Total output tokens" value={tokenOut} />
      </div>
      <div className="panel sessionActivity">
        <div className="panelHeader">
          <h2>Session activity</h2>
          <button className="filterButton" type="button">Version <strong>All</strong> <ChevronDown size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: ReactNode; subtitle?: string }) {
  return (
    <div className="metricCard">
      <strong>{title}</strong>
      <span>{value}</span>
      {subtitle ? <small>{subtitle}</small> : null}
    </div>
  );
}

function Sessions({ data, onNewSession }: { data: ConsoleData; onNewSession: () => void }) {
  const [query, setQuery] = useState('');
  const sessions = data.sessions.filter((session) => {
    const q = query.toLowerCase();
    return session.id.toLowerCase().includes(q) || session.agent.name.toLowerCase().includes(q) || (session.title ?? '').toLowerCase().includes(q);
  });
  return (
    <section className="stack">
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search sessions"
        actions={<button className="primaryButton" type="button" onClick={onNewSession}><Plus size={16} />New session</button>}
      />
      <div className="tablePanel">
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th>Agent</th>
              <th>Environment</th>
              <th>Resources</th>
              <th>Tokens</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>
                  <strong>{session.title || session.id}</strong>
                  <span>{session.id}</span>
                </td>
                <td>{session.agent.name}</td>
                <td>{session.environment_id}</td>
                <td>{session.resources.map((resource) => String(resource.type)).join(', ') || 'none'}</td>
                <td>{session.usage.input_tokens + session.usage.output_tokens}</td>
                <td><StatusPill status={session.status} /></td>
                <td>{formatDate(session.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResourceList({ title, icon, rows, onNew }: { title: string; icon: ReactNode; rows: Array<Environment | Vault | MemoryStore>; onNew: () => void }) {
  const [query, setQuery] = useState('');
  const filtered = rows.filter((row) => {
    const q = query.toLowerCase();
    return row.name.toLowerCase().includes(q) || row.description.toLowerCase().includes(q) || row.id.toLowerCase().includes(q);
  });
  return (
    <section className="stack">
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder={`Search ${title.toLowerCase()}`}
        actions={<button className="primaryButton" type="button" onClick={onNew}><Plus size={16} />New</button>}
      />
      <div className="resourceGrid">
        {filtered.map((row) => (
          <article className="resourceCard" key={row.id}>
            <div className="resourceIcon">{icon}</div>
            <div>
              <strong>{row.name}</strong>
              <span>{row.description || row.id}</span>
            </div>
            <StatusPill status={row.status} />
            {'provider' in row ? <small>{row.provider}</small> : null}
            {'credential_count' in row ? <small>{row.credential_count} credentials</small> : null}
          </article>
        ))}
        {filtered.length === 0 ? <EmptyState icon={icon} title={`No ${title.toLowerCase()}`} /> : null}
      </div>
    </section>
  );
}

function Skills({ data }: { data: ConsoleData }) {
  return (
    <section className="resourceGrid">
      {data.skills.map((skill) => (
        <article className="resourceCard" key={skill.id}>
          <div className="resourceIcon"><Zap size={20} /></div>
          <div>
            <strong>{skill.name}</strong>
            <span>{skill.description || skill.file}</span>
          </div>
          <small>{skill.file}</small>
        </article>
      ))}
      {data.skills.length === 0 ? <EmptyState icon={<Zap size={22} />} title="No skills" /> : null}
    </section>
  );
}

function Files({ data }: { data: ConsoleData }) {
  const rows = [
    ['Agents', data.workspace?.agentsDir],
    ['Skills', data.workspace?.skillsDir],
    ['Config', data.workspace?.configPath],
    ['Data', data.workspace?.dataDir],
  ];
  return <KeyValuePanel rows={rows} />;
}

function WorkspaceView({ data }: { data: ConsoleData }) {
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Workspace</h1>
          <p>Manage the local workspace that backs this console.</p>
        </div>
        <div className="toolbarActions">
          <button className="secondaryButton" type="button" disabled title="Workspace switching is not wired yet">
            <Layers size={16} />
            Switch workspace
          </button>
          <button className="secondaryButton" type="button" disabled title="Workspace creation is planned for the desktop shell">
            <Plus size={16} />
            Create workspace
          </button>
        </div>
      </div>
      <div className="workspaceNotice">
        <Info size={18} />
        <div>
          <strong>Single local workspace mode</strong>
          <span>Workspace switching is not exposed by the API yet. Start the server with another root/config to run a different workspace.</span>
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
            ['Root', data.workspace?.root],
            ['Target', data.workspace?.target],
            ['Config file', data.workspace?.configPath],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Project directories</h2>
          <p>Local folders used by the runtime.</p>
          <KeyValuePanel rows={[
            ['Agents directory', data.workspace?.agentsDir],
            ['Skills directory', data.workspace?.skillsDir],
            ['Data directory', data.workspace?.dataDir],
          ]} />
        </div>
      </div>
    </section>
  );
}

function RuntimeView({ data }: { data: ConsoleData }) {
  return (
    <section className="stack">
      <SummaryStrip
        items={[
          { label: 'Status', value: data.runtime?.status ?? 'unknown', icon: <Gauge size={18} /> },
          { label: 'Models', value: data.runtime?.models.length ?? 0, icon: <Brain size={18} /> },
          { label: 'Sandboxes', value: data.runtime?.sandbox_providers.join(', ') || 'none', icon: <Shield size={18} /> },
          { label: 'Memory', value: data.runtime?.memory ?? 'disabled', icon: <Database size={18} /> },
        ]}
      />
      <div className="tablePanel">
        <table>
          <thead><tr><th>Model</th><th>Provider</th><th>Status</th></tr></thead>
          <tbody>
            {(data.runtime?.models ?? []).map((model) => (
              <tr key={model}>
                <td><strong>{model}</strong></td>
                <td>configured</td>
                <td><StatusPill status="active" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ApiKeys({ data }: { data: ConsoleData }) {
  return (
    <section className="stack">
      <SummaryStrip items={[
        { label: 'Auth', value: data.runtime?.auth_enabled ? 'enabled' : 'disabled', icon: <KeyRound size={18} /> },
        { label: 'Mode', value: 'local', icon: <Shield size={18} /> },
      ]} />
      <div className="panel subtlePanel">
        <h2>API Keys</h2>
        <p>Managed through `managed-agents.config.yaml` and `MANAGED_AGENTS_API_KEY`.</p>
      </div>
    </section>
  );
}

function Observability({ data }: { data: ConsoleData }) {
  const tokenTotal = data.sessions.reduce((sum, session) => sum + session.usage.input_tokens + session.usage.output_tokens, 0);
  return (
    <section className="stack">
      <SummaryStrip items={[
        { label: 'Sessions', value: data.sessions.length, icon: <MessageSquare size={18} /> },
        { label: 'Running', value: data.sessions.filter((session) => session.status === 'running').length, icon: <CirclePlay size={18} /> },
        { label: 'Tokens', value: tokenTotal, icon: <Gauge size={18} /> },
        { label: 'Metrics', value: '/v1/x/metrics', icon: <Activity size={18} /> },
      ]} />
    </section>
  );
}

function SettingsView({ data }: { data: ConsoleData }) {
  return <KeyValuePanel rows={[
    ['Workspace', data.workspace?.name],
    ['Target', data.workspace?.target],
    ['Auth enabled', data.runtime?.auth_enabled ? 'yes' : 'no'],
    ['Memory', data.runtime?.memory],
  ]} />;
}

function AgentModal({ template, data, onClose, onSaved }: { template?: Template; data: ConsoleData; onClose: () => void; onSaved: () => void }) {
  const initialTemplate = template ?? data.templates[0];
  const [mode, setMode] = useState<'describe' | 'template'>(template ? 'template' : 'describe');
  const [selected, setSelected] = useState<Template | undefined>(initialTemplate);
  const [prompt, setPrompt] = useState('Summarizes new GitHub PRs and posts a digest to Slack.');
  const [yaml, setYaml] = useState(agentDefinitionYaml(initialTemplate?.agent ?? defaultAgentDraft(data)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const chooseTemplate = (next: Template) => {
    setSelected(next);
    setYaml(agentDefinitionYaml(next.agent));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson('/v1/agents', parseYaml(yaml));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create agent" subtitle="Start from a template or describe what you need." onClose={onClose} size="wide">
      <form className="agentComposer" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <section className="composerSection">
          <div className="sectionTitle"><ChevronDown size={18} /><strong>Starting point</strong>{selected && mode === 'template' ? <span>· {selected.name}</span> : null}</div>
          <div className="segment">
            <button type="button" className={mode === 'describe' ? 'active' : ''} onClick={() => setMode('describe')}>Describe your agent</button>
            <button type="button" className={mode === 'template' ? 'active' : ''} onClick={() => setMode('template')}>Template</button>
          </div>
          {mode === 'describe' ? (
            <div className="describeBox">
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              <button className="secondaryButton" type="button" disabled>Generate</button>
            </div>
          ) : (
            <div className="claudeTemplateGrid">
              {data.templates.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`claudeTemplateCard ${selected?.id === item.id ? 'selected' : ''}`}
                  onClick={() => chooseTemplate(item)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                  {item.tags.length ? <small>{item.tags.slice(0, 4).join(' · ')}</small> : null}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="composerSection">
          <h2>Agent config</h2>
          <YamlEditor value={yaml} onChange={setYaml} minRows={18} />
        </section>

        <div className="modalActions stickyActions">
          <button className="darkButton" type="submit" disabled={saving}>Create agent</button>
        </div>
      </form>
    </Modal>
  );
}

function AgentEditModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [yaml, setYaml] = useState(agentDefinitionYaml(agentDraftFromApi(agent)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await putJson(`/v1/agents/${agent.id}`, parseYaml(yaml));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit agent" onClose={onClose} size="medium">
      <form className="agentComposer" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <YamlEditor value={yaml} onChange={setYaml} minRows={16} />
        <div className="modalActions stickyActions">
          <button className="darkButton" type="submit" disabled={saving}>Save new version</button>
        </div>
      </form>
    </Modal>
  );
}

type AgentDraft = {
  name: string;
  description?: string;
  model: { id: string; speed: string };
  system: string;
  mcp_servers?: Array<Record<string, unknown>>;
  tools?: AgentToolset[];
  skills?: SkillRef[];
  metadata?: Record<string, unknown>;
};

function YamlEditor({ value, onChange, minRows }: { value: string; onChange: (value: string) => void; minRows: number }) {
  return (
    <div className="yamlShell">
      <div className="yamlToolbar">
        <button type="button">YAML <ChevronDown size={16} /></button>
        <FileText size={17} />
      </div>
      <textarea
        className="yamlTextarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={minRows}
        spellCheck={false}
      />
    </div>
  );
}

function defaultAgentDraft(data: ConsoleData): AgentDraft {
  return {
	    name: 'Untitled agent',
	    description: 'A blank starting point with the core toolset.',
	    model: { id: data.runtime?.models[0] ?? 'claude-sonnet-5', speed: 'standard' },
    system: 'You are a general-purpose agent that can research, write code, run commands, and use connected tools to complete the user\'s task end to end.',
    mcp_servers: [],
    tools: [{ type: 'agent_toolset_20260401' }],
    skills: [],
    metadata: {},
  };
}

function agentDraftFromApi(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    model: { id: agent.model.id, speed: agent.model.speed },
    description: agent.description,
    system: agent.system,
    mcp_servers: agent.mcp_servers,
    tools: agent.tools,
    skills: agent.skills,
    metadata: agent.metadata ?? {},
  };
}

function agentDefinitionYaml(agent: AgentDraft): string {
  return stringifyYaml({
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    model: agent.model,
    system: agent.system,
    mcp_servers: agent.mcp_servers ?? [],
    tools: agent.tools ?? [{ type: 'agent_toolset_20260401' }],
    skills: agent.skills ?? [],
    metadata: agent.metadata ?? {},
  }, { blockQuote: 'literal', lineWidth: 100 });
}

function SessionModal({ data, initialAgentId, onClose, onSaved }: { data: ConsoleData; initialAgentId?: string; onClose: () => void; onSaved: () => void }) {
  const [agent, setAgent] = useState(initialAgentId ?? data.agents[0]?.id ?? '');
  const [environment, setEnvironment] = useState(data.environments[0]?.id ?? 'env_default');
  const [title, setTitle] = useState('');
  const [memoryStore, setMemoryStore] = useState('');
  const [vault, setVault] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const resources = memoryStore ? [{ type: 'memory_store', memory_store_id: memoryStore }] : [];
      await postJson('/v1/sessions', {
        agent,
        environment_id: environment,
        title,
        resources,
        vault_ids: vault ? [vault] : [],
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New session" onClose={onClose}>
      <form className="modalForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label>Agent<select value={agent} onChange={(event) => setAgent(event.target.value)} required>{data.agents.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Environment<select value={environment} onChange={(event) => setEnvironment(event.target.value)}>{data.environments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Session title" /></label>
        <label>Memory store<select value={memoryStore} onChange={(event) => setMemoryStore(event.target.value)}><option value="">None</option>{data.memoryStores.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Credential vault<select value={vault} onChange={(event) => setVault(event.target.value)}><option value="">None</option>{data.vaults.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="modalActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={saving}><CirclePlay size={16} />Start</button>
        </div>
      </form>
    </Modal>
  );
}

function ResourceModal({ kind, onClose, onSaved }: { kind: 'environment' | 'credential_vault' | 'memory_store'; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('sqlite');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const path = kind === 'environment' ? '/v1/environments' : kind === 'credential_vault' ? '/v1/credential-vaults' : '/v1/memory-stores';
    try {
      await postJson(path, {
        name,
        description,
        ...(kind === 'memory_store' ? { provider } : {}),
        ...(kind === 'environment' ? { config: { sandbox_provider: 'local', timeout: 300 } } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`New ${kind.replace('_', ' ')}`} onClose={onClose}>
      <form className="modalForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {kind === 'memory_store' ? <label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)} required /></label> : null}
        <div className="modalActions">
          <button className="secondaryButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={saving}><Plus size={16} />Create</button>
        </div>
      </form>
    </Modal>
  );
}

function Toolbar({ query, onQuery, placeholder, actions }: { query: string; onQuery: (value: string) => void; placeholder: string; actions: ReactNode }) {
  return (
    <div className="toolbar">
      <div className="searchBox">
        <Search size={17} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} />
      </div>
      <div className="toolbarActions">{actions}</div>
    </div>
  );
}

function SummaryStrip({ items }: { items: Array<{ label: string; value: ReactNode; icon: ReactNode }> }) {
  return (
    <div className="summaryStrip">
      {items.map((item) => (
        <div className="summaryItem" key={item.label}>
          <span>{item.icon}</span>
          <div>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyValuePanel({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="tablePanel kv">
      {rows.map(([key, value]) => (
        <div className="kvRow" key={key}>
          <span>{key}</span>
          <strong>{value || 'not configured'}</strong>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="emptyState">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function LoadingState() {
  return <div className="loading"><RefreshCw size={18} />Loading console</div>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function Modal({ title, subtitle, children, onClose, size = 'default' }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; size?: 'default' | 'medium' | 'wide' }) {
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="iconButton" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

type HashRoute = {
  view: ViewId;
  agentId?: string;
};

function useHashRoute(): [HashRoute, (view: ViewId, agentId?: string) => void] {
  const [route, setRouteState] = useState<HashRoute>(() => parseHashRoute());
  useEffect(() => {
    const onHash = () => {
      setRouteState(parseHashRoute());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setRoute = (view: ViewId, agentId?: string) => {
    const next = view === 'agent-detail' && agentId ? `agents/${encodeURIComponent(agentId)}` : view;
    window.location.hash = next;
    setRouteState(parseHashRoute(next));
  };
  return [route, setRoute];
}

function parseHashRoute(hash = window.location.hash.replace(/^#/, '')): HashRoute {
  const value = hash || 'quickstart';
  if (value.startsWith('agents/')) {
    const agentId = decodeURIComponent(value.slice('agents/'.length));
    return agentId ? { view: 'agent-detail', agentId } : { view: 'agents' };
  }
  if (value === 'agent-detail') return { view: 'agent-detail' };
  return isView(value) ? { view: value } : { view: 'quickstart' };
}

function isView(value: string): value is ViewId {
  return value === 'agent-detail' || NAV_GROUPS.some((group) => group.items.some((item) => item.id === value));
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function getPage<T>(path: string): Promise<Page<T>> {
  return getJson<Page<T>>(path);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'POST', body);
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'PUT', body);
}

async function requestJson<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(detail?.error?.message ?? `${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function buildToolset(tools: Set<string>, askTools: Set<string>): AgentToolset {
  const configs: Record<string, ToolConfig> = {};
  for (const tool of tools) {
    configs[tool] = {
      enabled: true,
      permission_policy: { type: askTools.has(tool) ? 'always_ask' : 'always_allow' },
    };
  }
  return {
    type: 'agent_toolset_20260401',
    default_config: {
      enabled: true,
      permission_policy: { type: 'always_allow' },
    },
    configs,
  };
}

function toggleSet<T>(value: T, checked: boolean, setter: Dispatch<SetStateAction<Set<T>>>) {
  setter((current) => {
    const next = new Set(current);
    if (checked) next.add(value);
    else next.delete(value);
    return next;
  });
}

function toolNames(agent: Pick<Agent, 'tools'>): string[] {
  const names = new Set<string>();
  for (const toolset of agent.tools ?? []) {
    for (const [name, config] of Object.entries(toolset.configs ?? {})) {
      if (config.enabled !== false && config.permission_policy?.type !== 'never_allow') names.add(name);
    }
  }
  return [...names];
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function shortId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function agentYamlPreview(agent: Template['agent']): string {
  return agentDefinitionYaml(agent);
}
