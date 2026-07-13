import {
  Activity,
  Archive,
  Box,
  Brain,
  Check,
  ChevronDown,
  CirclePlay,
  Clock,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Globe,
  Info,
  Keyboard,
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
  Square,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Dispatch, FormEvent, ReactNode, SetStateAction, useEffect, useMemo, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { clearStoredApiKey, deleteJson, getJson, getPage, getStoredApiKey, getText, postJson, putJson, setStoredApiKey } from './api';
import { EmptyState, KeyValuePanel, LoadingState, RequiredMark, ResourceBadge, StatusPill, SummaryStrip, Toolbar } from './components/Common';
import { Modal } from './components/Modal';
import { Files, Skills } from './components/pages/BuildPages';
import { useHashRoute } from './hooks/useHashRoute';
import { copyText, downloadJson, formatDate, formatDateShort, formatDuration, formatUsage, pathName, relativeDate, relativeWorkspacePath, shortId, titleCase, truncateMiddle, workspaceConfigDir } from './lib/format';
import type {
  Agent,
  AgentTab,
  AgentToolset,
  ApiKey,
  ApiKeyCreateResponse,
  ConsoleData,
  CredentialAuthType,
  Environment,
  EnvironmentDraft,
  EnvironmentHostingType,
  EnvironmentNetworkType,
  EnvironmentPackageDraft,
  MemoryRecord,
  MemoryStore,
  MetadataDraft,
  McpToolset,
  Runtime,
  RuntimeConfigState,
  Session,
  SessionEvent,
  SessionResourceDraft,
  Skill,
  SkillRef,
  Template,
  Vault,
  VaultCredential,
  ViewId,
  Workspace,
  WorkspaceFile,
} from './types';

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

const SESSION_EVENT_KINDS = ['user', 'agent', 'tool', 'error', 'system'] as const;
type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

function emptyData(): ConsoleData {
  return {
    agents: [],
    sessions: [],
    environments: [],
    vaults: [],
    memoryStores: [],
    files: [],
    apiKeys: [],
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(route.sessionId ?? null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(route.environmentId ?? null);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(route.vaultId ?? null);
  const [selectedMemoryStoreId, setSelectedMemoryStoreId] = useState<string | null>(route.memoryStoreId ?? null);
  const [credentialModalVaultId, setCredentialModalVaultId] = useState<string | null>(null);
  const [memoryModalStoreId, setMemoryModalStoreId] = useState<string | null>(null);
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
        files,
        apiKeys,
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
        getPage<WorkspaceFile>('/v1/files'),
        getPage<ApiKey>('/v1/api-keys'),
        getPage<Skill>('/v1/skills'),
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
        files: files.data,
        apiKeys: apiKeys.data,
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

  useEffect(() => {
    if (route.sessionId) setSelectedSessionId(route.sessionId);
  }, [route.sessionId]);

  useEffect(() => {
    if (route.environmentId) setSelectedEnvironmentId(route.environmentId);
  }, [route.environmentId]);

  useEffect(() => {
    if (route.vaultId) setSelectedVaultId(route.vaultId);
  }, [route.vaultId]);

  useEffect(() => {
    if (route.memoryStoreId) setSelectedMemoryStoreId(route.memoryStoreId);
  }, [route.memoryStoreId]);

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
                const active = view === item.id
                  || (view === 'agent-detail' && item.id === 'agents')
                  || (view === 'session-detail' && item.id === 'sessions')
                  || (view === 'environment-detail' && item.id === 'environments')
                  || (view === 'credential-vault-detail' && item.id === 'credential-vaults')
                  || (view === 'memory-store-detail' && item.id === 'memory-stores');
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
              selectedSessionId={selectedSessionId}
              selectedEnvironmentId={selectedEnvironmentId}
              selectedVaultId={selectedVaultId}
              selectedMemoryStoreId={selectedMemoryStoreId}
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
              onOpenSession={(session) => {
                setSelectedSessionId(session.id);
                setRoute('session-detail', session.id);
              }}
              onOpenEnvironment={(environment) => {
                setSelectedEnvironmentId(environment.id);
                setRoute('environment-detail', environment.id);
              }}
              onOpenVault={(vault) => {
                setSelectedVaultId(vault.id);
                setRoute('credential-vault-detail', vault.id);
              }}
              onOpenMemoryStore={(store) => {
                setSelectedMemoryStoreId(store.id);
                setRoute('memory-store-detail', store.id);
              }}
              onNewCredential={(vaultId) => setCredentialModalVaultId(vaultId)}
              onNewMemory={(storeId) => setMemoryModalStoreId(storeId)}
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
          onNavigate={(next) => {
            setSessionModal(null);
            setRoute(next);
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

      {credentialModalVaultId ? (
        <AddCredentialModal
          vaultId={credentialModalVaultId}
          onClose={() => setCredentialModalVaultId(null)}
          onSaved={() => {
            setCredentialModalVaultId(null);
            void refresh();
          }}
        />
      ) : null}

      {memoryModalStoreId ? (
        <AddMemoryModal
          storeId={memoryModalStoreId}
          onClose={() => setMemoryModalStoreId(null)}
          onSaved={() => {
            setMemoryModalStoreId(null);
            void refresh();
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
  selectedSessionId: string | null;
  selectedEnvironmentId: string | null;
  selectedVaultId: string | null;
  selectedMemoryStoreId: string | null;
  agentTab: AgentTab;
  onAgentTab: (tab: AgentTab) => void;
  onOpenAgent: (agent: Agent) => void;
  onOpenSession: (session: Session) => void;
  onOpenEnvironment: (environment: Environment) => void;
  onOpenVault: (vault: Vault) => void;
  onOpenMemoryStore: (store: MemoryStore) => void;
  onEditAgent: (agent: Agent) => void;
  onNewAgent: (template: Template | 'blank') => void;
  onNewSession: (agentId?: string) => void;
  onNewCredential: (vaultId: string) => void;
  onNewMemory: (storeId: string) => void;
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
          onOpenSession={props.onOpenSession}
          onRefresh={props.onRefresh}
        />
      ) : <EmptyState icon={<Monitor size={22} />} title="No agent selected" />;
    }
    case 'sessions':
      return <Sessions data={props.data} onNewSession={() => props.onNewSession()} onOpenSession={props.onOpenSession} />;
    case 'session-detail': {
      const session = props.data.sessions.find((item) => item.id === props.selectedSessionId);
      return session ? (
        <SessionDetail
          session={session}
          data={props.data}
          onBack={() => props.setView('sessions')}
          onRefresh={props.onRefresh}
          onOpenAgent={(agent) => props.onOpenAgent(agent)}
        />
      ) : <EmptyState icon={<MessageSquare size={22} />} title="No session selected" />;
    }
    case 'environments':
      return <Environments data={props.data} onNew={() => props.onNewResource('environment')} onOpenEnvironment={props.onOpenEnvironment} />;
    case 'environment-detail': {
      const environment = props.data.environments.find((item) => item.id === props.selectedEnvironmentId);
      return environment ? (
        <EnvironmentDetail
          environment={environment}
          data={props.data}
          onBack={() => props.setView('environments')}
          onRefresh={props.onRefresh}
        />
      ) : <EmptyState icon={<Server size={22} />} title="No environment selected" />;
    }
    case 'credential-vaults':
      return <CredentialVaults data={props.data} onNew={() => props.onNewResource('credential_vault')} onOpenVault={props.onOpenVault} />;
    case 'credential-vault-detail': {
      const vault = props.data.vaults.find((item) => item.id === props.selectedVaultId);
      return vault ? (
        <CredentialVaultDetail
          vault={vault}
          onBack={() => props.setView('credential-vaults')}
          onRefresh={props.onRefresh}
          onNewCredential={() => props.onNewCredential(vault.id)}
        />
      ) : <EmptyState icon={<Lock size={22} />} title="No credential vault selected" />;
    }
    case 'memory-stores':
      return <MemoryStores data={props.data} onNew={() => props.onNewResource('memory_store')} onOpenMemoryStore={props.onOpenMemoryStore} />;
    case 'memory-store-detail': {
      const store = props.data.memoryStores.find((item) => item.id === props.selectedMemoryStoreId);
      return store ? (
        <MemoryStoreDetail
          store={store}
          onBack={() => props.setView('memory-stores')}
          onRefresh={props.onRefresh}
          onNewMemory={() => props.onNewMemory(store.id)}
        />
      ) : <EmptyState icon={<Database size={22} />} title="No memory store selected" />;
    }
    case 'skills':
      return <Skills data={props.data} onRefresh={props.onRefresh} />;
    case 'files':
      return <Files data={props.data} onRefresh={props.onRefresh} />;
    case 'workspace':
      return <WorkspaceView data={props.data} />;
    case 'runtime':
      return <RuntimeView data={props.data} />;
    case 'api-keys':
      return <ApiKeys data={props.data} onRefresh={props.onRefresh} />;
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
        <h1 className="quickstartTitle">Quickstart</h1>
        <div className="stepper">
          {[1, 2, 3, 4].map((step) => <span key={step} className={step === 1 ? 'current' : ''}>{step}</span>)}
        </div>
        <div className="buildPrompt">
          <Sparkles size={22} />
          <h2>What do you want to build?</h2>
          <div className="promptActions">
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
    return agent.id.toLowerCase().includes(q) || agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q) || agent.model.toLowerCase().includes(q);
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
                <td>{agent.model}</td>
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
              <span>{agent.model}</span>
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
  onOpenSession,
  onRefresh,
}: {
  agent: Agent;
  data: ConsoleData;
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
  onBack: () => void;
  onEdit: () => void;
  onNewSession: () => void;
  onOpenSession: (session: Session) => void;
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
      {tab === 'sessions' ? <AgentSessionsTab sessions={agentSessions} onOpenSession={onOpenSession} /> : null}
      {tab === 'deployments' ? <EmptyState icon={<Server size={22} />} title="Deployments are not configured for this local runtime" /> : null}
      {tab === 'observability' ? (
        <AgentObservability sessions={agentSessions} tokenIn={tokenIn} tokenOut={tokenOut} />
      ) : null}
    </section>
  );
}

function AgentConfigTab({ agent }: { agent: Agent }) {
  const builtinToolCount = toolNames(agent).length;
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

function AgentSessionsTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (session: Session) => void }) {
  const [query, setQuery] = useState('');
  const filtered = sessions.filter((session) => {
    const q = query.toLowerCase();
    return session.id.toLowerCase().includes(q) || (session.title ?? '').toLowerCase().includes(q);
  });
  return (
    <div className="detailStack">
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by session ID"
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
            {filtered.map((session) => (
              <tr key={session.id} className="clickableRow" onClick={() => onOpenSession(session)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${session.id}`} /></td>
                <td className="monoCell">{shortId(session.id)}</td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td>v1</td>
                <td>{formatUsage(session.usage)}</td>
                <td>{formatDateShort(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
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

function Sessions({ data, onNewSession, onOpenSession }: { data: ConsoleData; onNewSession: () => void; onOpenSession: (session: Session) => void }) {
  const [query, setQuery] = useState('');
  const sessions = data.sessions.filter((session) => {
    const q = query.toLowerCase();
    return session.id.toLowerCase().includes(q) || session.agent.name.toLowerCase().includes(q) || (session.title ?? '').toLowerCase().includes(q);
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Sessions</h1>
          <p>Trace and debug managed agent sessions.</p>
        </div>
        <button className="darkButton" type="button" onClick={onNewSession}>
          <Plus size={18} />
          Create session
        </button>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by session ID"
        actions={(
          <>
            <button className="filterButton" type="button">Created <strong>All time</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Agent <strong>All</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Deployment <strong>All</strong> <ChevronDown size={15} /></button>
            <button className="filterButton" type="button">Status <strong>Active</strong> <ChevronDown size={15} /></button>
          </>
        )}
      />
      <div className="tablePanel sessionsTablePanel">
        <table className="sessionTable">
          <thead>
            <tr>
              <th className="selectCol"><input type="checkbox" aria-label="Select all sessions" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Tokens in / out</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="clickableRow" onClick={() => onOpenSession(session)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${session.id}`} /></td>
                <td>
                  <strong className="monoText">{shortId(session.id)}</strong>
                </td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td><ResourceBadge icon={<Monitor size={15} />} label={session.agent.name} /></td>
                <td>{formatUsage(session.usage)}</td>
                <td>{formatDateShort(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
      </div>
      <div className="mobileSessionList">
        {sessions.map((session) => (
          <button className="mobileAgentCard" type="button" key={session.id} onClick={() => onOpenSession(session)}>
            <span className="mobileAgentMain">
              <strong>{session.title || session.id}</strong>
              <small className="monoText">{session.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{session.agent.name}</span>
              <StatusPill status={session.status} />
            </span>
          </button>
        ))}
        {sessions.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
      </div>
    </section>
  );
}

function SessionDetail({
  session,
  data,
  onBack,
  onRefresh,
  onOpenAgent,
}: {
  session: Session;
  data: ConsoleData;
  onBack: () => void;
  onRefresh: () => void;
  onOpenAgent: (agent: Agent) => void;
}) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventError, setEventError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mode, setMode] = useState<'transcript' | 'debug'>('transcript');
  const [detailMode, setDetailMode] = useState<'rendered' | 'raw'>('rendered');
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<Set<SessionEventKind>>(new Set(SESSION_EVENT_KINDS));
  const [query, setQuery] = useState('');

  const agent = data.agents.find((item) => item.id === session.agent.id);
  const environment = data.environments.find((item) => item.id === session.environment_id);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;

  const loadEvents = async () => {
    setLoadingEvents(true);
    setEventError('');
    try {
      const page = await getPage<SessionEvent>(`/v1/sessions/${encodeURIComponent(session.id)}/events?limit=1000`);
      setEvents(page.data);
      setSelectedEventId((current) => current && page.data.some((event) => event.id === current) ? current : page.data.at(-1)?.id ?? null);
    } catch (err) {
      setEventError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [session.id]);

  const visibleEvents = events.filter((event) => {
    const kind = eventKind(event);
    if (mode === 'transcript' && !['user', 'agent', 'tool', 'error'].includes(kind)) return false;
    if (!selectedKinds.has(kind)) return false;
    const text = `${event.type} ${eventText(event)} ${event.id}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const interrupt = async () => {
    await postJson(`/v1/sessions/${session.id}/events`, { events: [{ type: 'user.interrupt', content: [{ type: 'text', text: 'Run interrupted by the user.' }] }] });
    setActionsOpen(false);
    await loadEvents();
    onRefresh();
  };

  const archive = async () => {
    await deleteJson(`/v1/sessions/${session.id}`);
    setActionsOpen(false);
    onBack();
    onRefresh();
  };

  return (
    <section className="sessionDetail">
      <div className="sessionCrumb">
        <button type="button" className="textButton" onClick={onBack}>Sessions</button>
        <span>/</span>
        <strong>{shortId(session.id)}</strong>
      </div>

      <div className="sessionHero">
        <div className="sessionHeroMain">
          <div className="titleLine">
            <h1>{session.id}</h1>
            <StatusPill status={session.status} />
          </div>
          <div className="sessionMetaRow">
            <button className="resourceBadge" type="button" onClick={() => agent ? onOpenAgent(agent) : undefined}>
              <Monitor size={15} />
              {session.agent.name}
            </button>
            <ResourceBadge icon={<Cloud size={15} />} label={environment?.name ?? session.environment_id} />
            <span><Clock size={15} />{formatDuration(session.created_at, session.updated_at)}</span>
            <span><Clock size={15} />{relativeDate(session.created_at)}</span>
          </div>
        </div>
        <div className="sessionHeroActions">
          <div className="menuWrap">
            <button className="secondaryButton largeAction" type="button" onClick={() => setActionsOpen((open) => !open)}>
              Actions <ChevronDown size={16} />
            </button>
            {actionsOpen ? (
              <div className="agentMenu sessionActionsMenu">
                <button type="button" onClick={() => void interrupt()}><Square size={18} />Send interrupt</button>
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Archive size={18} />Archive session</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sessionToolbar">
        <div className="segment compactSegment">
          <button type="button" className={mode === 'transcript' ? 'active' : ''} onClick={() => setMode('transcript')}>Transcript</button>
          <button type="button" className={mode === 'debug' ? 'active' : ''} onClick={() => setMode('debug')}>Debug</button>
        </div>
        <div className="filterWrap">
          <button className="filterButton" type="button" onClick={() => setFilterOpen((open) => !open)}>All events <ChevronDown size={15} /></button>
          {filterOpen ? (
            <div className="eventFilterMenu">
              {SESSION_EVENT_KINDS.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={selectedKinds.has(kind)}
                    onChange={(event) => toggleSet(kind, event.target.checked, setSelectedKinds)}
                  />
                  <span>{kind[0].toUpperCase() + kind.slice(1)}</span>
                </label>
              ))}
              <button type="button" onClick={() => setSelectedKinds(new Set(SESSION_EVENT_KINDS))}>Select all</button>
            </div>
          ) : null}
        </div>
        <div className="sessionSearch">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search events" />
        </div>
        <div className="sessionIconActions">
          <button className="iconButton" type="button" title="Keyboard shortcuts"><Keyboard size={18} /></button>
          <button className="iconButton" type="button" title="Copy session id" onClick={() => void navigator.clipboard?.writeText(session.id)}><Copy size={18} /></button>
          <button className="iconButton" type="button" title="Download event JSON" onClick={() => downloadJson(`${session.id}-events.json`, events)}><Download size={18} /></button>
        </div>
      </div>

      <div className="sessionTimeline">
        <div className="eventMiniMap">
          {events.slice(0, 42).map((event) => <span key={event.id} className={`miniEvent ${eventKind(event)}`} title={event.type} />)}
        </div>
        <div className="eventPane">
          <div className="eventList">
            {eventError ? <div className="banner error inlineBanner">{eventError}</div> : null}
            {loadingEvents ? <LoadingState /> : null}
            {!loadingEvents && visibleEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                className={`eventRow ${selectedEvent?.id === event.id ? 'active' : ''}`}
                onClick={() => setSelectedEventId(event.id)}
              >
                <span className={`eventType ${eventKind(event)}`}>{eventLabel(event, mode)}</span>
                <strong>{eventTitle(event)}</strong>
                <time>{eventTime(event)}</time>
              </button>
            ))}
            {!loadingEvents && visibleEvents.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No events" /> : null}
          </div>
          <div className="eventInspector">
            {selectedEvent ? (
              <>
                <div className="eventInspectorHeader">
                  <button className="iconButton" type="button" title="Close selection" onClick={() => setSelectedEventId(null)}><X size={18} /></button>
                  <div>
                    <span className={`eventType ${eventKind(selectedEvent)}`}>{selectedEvent.type}</span>
                    <h2>{eventTitle(selectedEvent)}</h2>
                    <p>{eventTime(selectedEvent)}</p>
                  </div>
                  <div className="segment tinySegment">
                    <button type="button" className={detailMode === 'rendered' ? 'active' : ''} onClick={() => setDetailMode('rendered')}>Rendered</button>
                    <button type="button" className={detailMode === 'raw' ? 'active' : ''} onClick={() => setDetailMode('raw')}>Raw</button>
                  </div>
                </div>
                {detailMode === 'rendered' ? (
                  <div className="renderedEvent">{eventText(selectedEvent) || 'No rendered content.'}</div>
                ) : (
                  <pre className="rawEvent">{JSON.stringify(selectedEvent, null, 2)}</pre>
                )}
              </>
            ) : (
              <EmptyState icon={<MessageSquare size={22} />} title="Select an event" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Environments({ data, onNew, onOpenEnvironment }: { data: ConsoleData; onNew: () => void; onOpenEnvironment: (environment: Environment) => void }) {
  const [query, setQuery] = useState('');
  const environments = data.environments.filter((environment) => {
    const q = query.toLowerCase();
    return environment.id.toLowerCase().includes(q) || environment.name.toLowerCase().includes(q) || environment.description.toLowerCase().includes(q);
  });

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Environments</h1>
          <p>Configuration template for containers, such as sessions or code execution.</p>
        </div>
        <div className="toolbarActions">
          <button className="darkButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create environment
          </button>
          <button className="iconButton" type="button" title="Documentation">
            <FileText size={18} />
          </button>
        </div>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={<button className="filterButton" type="button">Status <strong>All</strong> <ChevronDown size={15} /></button>}
      />
      <div className="tablePanel environmentsTablePanel">
        <table className="resourceTable">
          <thead>
            <tr>
              <th className="selectCol"><input type="checkbox" aria-label="Select all environments" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Type</th>
              <th>Updated at</th>
              <th className="actionsCol" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {environments.map((environment) => (
              <tr key={environment.id} className="clickableRow" onClick={() => onOpenEnvironment(environment)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${environment.id}`} /></td>
                <td><strong className="monoText">{shortId(environment.id)}</strong></td>
                <td>{environment.name}</td>
                <td><StatusPill status={environment.status} /></td>
                <td><span className="softChip inlineChip">{environmentKind(environment)}</span></td>
                <td>{formatDateShort(environment.updated_at)}</td>
                <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                  <button className="iconButton quiet" type="button" title="Environment actions"><MoreVertical size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {environments.length === 0 ? <EmptyState icon={<Server size={22} />} title="No environments" /> : null}
      </div>
      <div className="mobileResourceList">
        {environments.map((environment) => (
          <button className="mobileAgentCard" type="button" key={environment.id} onClick={() => onOpenEnvironment(environment)}>
            <span className="mobileAgentMain">
              <strong>{environment.name}</strong>
              <small className="monoText">{environment.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{environmentKind(environment)}</span>
              <StatusPill status={environment.status} />
            </span>
          </button>
        ))}
        {environments.length === 0 ? <EmptyState icon={<Server size={22} />} title="No environments" /> : null}
      </div>
    </section>
  );
}

function EnvironmentDetail({ environment, data, onBack, onRefresh }: { environment: Environment; data: ConsoleData; onBack: () => void; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const environmentSessions = data.sessions.filter((session) => session.environment_id === environment.id);
  const isSelfHosted = environmentHostingType(environment) === 'self_hosted';

  useEffect(() => {
    setEditing(false);
    setMenuOpen(false);
  }, [environment.id]);

  const archive = async () => {
    await postJson(`/v1/environments/${environment.id}/archive`, {});
    setMenuOpen(false);
    onBack();
    onRefresh();
  };

  if (editing) {
    return (
      <EnvironmentEditor
        environment={environment}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onRefresh();
        }}
      />
    );
  }

  return (
    <section className="environmentDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Environments</button>
        <span>/</span>
        <strong>{environment.name}</strong>
      </div>
      <div className="resourceHero">
        <div>
          <div className="titleLine">
            <h1>{environment.name}</h1>
            <span className="softChip inlineChip">{environmentKind(environment)}</span>
            <Globe size={19} className="mutedIcon" />
          </div>
          <p className="mutedLine"><span className="monoText">{shortId(environment.id)}</span> · Last updated {formatDateShort(environment.updated_at)}</p>
          <p className="agentDescription">{environment.description || 'No description.'}</p>
        </div>
        <div className="agentHeroActions">
          <button className="secondaryButton largeAction" type="button" onClick={() => setEditing(true)}>
            <Pencil size={18} />
            Edit
          </button>
          <div className="menuWrap">
            <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} title="Environment actions">
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="agentMenu">
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Archive size={18} />Archive</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isSelfHosted ? <SelfHostedEnvironment environment={environment} sessions={environmentSessions} /> : <CloudEnvironment environment={environment} />}
    </section>
  );
}

function CloudEnvironment({ environment }: { environment: Environment }) {
  const network = environmentNetwork(environment);
  const packages = environmentPackages(environment);
  const metadata = environmentMetadataEntries(environment);
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Networking</h2>
        <p>Configure network access policies for this environment.</p>
        <div className="readonlyFields">
          <ReadonlyField label="Type" value={titleCase(network.type)} />
          <ReadonlyField label="Allow MCP server network access" value={network.allowMcp ? 'Enabled' : 'Disabled'} />
          <ReadonlyField label="Allow package manager network access" value={network.allowPackageManager ? 'Enabled' : 'Disabled'} />
          <ReadonlyField label="Allowed hosts" value={network.allowedHosts.length ? network.allowedHosts.join(', ') : 'None provided'} wide />
        </div>
      </section>
      <section className="environmentSection">
        <h2>Packages</h2>
        <p>Specify packages and their versions available in this environment. Separate multiple values with spaces.</p>
        <ReadonlyTable
          empty="No packages configured"
          rows={packages.map((item) => [item.manager, item.package])}
          columns={['Manager', 'Package']}
        />
      </section>
      <section className="environmentSection">
        <h2>Metadata</h2>
        <p>Add custom key-value pairs to tag and organize this environment. Keys must be lowercase.</p>
        <ReadonlyTable
          empty="No metadata"
          rows={metadata}
          columns={['Key', 'Value']}
        />
      </section>
    </div>
  );
}

function SelfHostedEnvironment({ environment, sessions }: { environment: Environment; sessions: Session[] }) {
  const keys = environmentKeys(environment);
  const idleSessions = sessions.filter((session) => session.status === 'idle');
  const runningSessions = sessions.filter((session) => session.status === 'running');
  const completedSessions = sessions.filter((session) => session.status === 'terminated');
  const oldestActiveSession = [...idleSessions, ...runningSessions].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Overview</h2>
        <p>Live session activity for this self-hosted environment. Updates every few seconds.</p>
        <div className="metricGrid compactMetrics">
          <MetricCard title="Idle sessions" value={idleSessions.length} />
          <MetricCard title="Running sessions" value={runningSessions.length} />
          <MetricCard title="Completed sessions" value={completedSessions.length} />
          <MetricCard title="Oldest active session" value={oldestActiveSession ? relativeDate(oldestActiveSession.created_at) : 'None'} />
        </div>
      </section>
      <div className="selfHostedGrid">
        <section className="environmentSection">
          <h2>Environment keys</h2>
          <p>An environment key lets a runner on your infrastructure connect to this environment and pull jobs. Generate one per host so you can revoke access individually.</p>
          <ReadonlyTable
            empty="No environment keys"
            rows={keys.map((key) => [key.name, shortId(key.id), formatDateShort(key.created_at), formatDateShort(key.expires_at)])}
            columns={['Name', 'ID', 'Created', 'Expires at']}
          />
        </section>
        <section className="setupCard">
          <div className="setupHeader">
            <h2>Set up your self-hosted environment</h2>
            <button className="iconButton quiet" type="button" title="Dismiss setup"><X size={18} /></button>
          </div>
          <p>These instructions guide you through a low-code CLI worker setup. Additional options are also available in public documentation.</p>
          <SetupStep index={1} title="Register an environment key" body="Generate an environment key authenticating your infrastructure with this environment." />
          <SetupStep index={2} title="Export environment key as env var" body="This authorizes the environment worker to pull for work." code={`export MANAGED_AGENTS_ENVIRONMENT_KEY='env-key-...'`} />
          <SetupStep index={3} title="Install managed-agents CLI" body="Run this command on the machine where you want the environment worker to run." code={`npm install -g managed-agents`} />
          <SetupStep index={4} title="Invoke the worker" body="Poll for jobs and execute them locally." code={`managed-agents worker poll \\\n  --environment-id "${environment.id}" \\\n  --workdir "/workspace"`} />
        </section>
      </div>
    </div>
  );
}

function EnvironmentEditor({ environment, onCancel, onSaved }: { environment: Environment; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<EnvironmentDraft>(() => environmentDraftFromApi(environment));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(environmentDraftFromApi(environment));
  }, [environment.id]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await putJson(`/v1/environments/${environment.id}`, environmentPayloadFromDraft(draft));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="environmentDetail editingEnvironment">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onCancel}>Environments</button>
        <span>/</span>
        <strong>{environment.name}</strong>
      </div>
      {error ? <div className="banner error inlineBanner">{error}</div> : null}
      <div className="resourceHero editHero">
        <div className="editTitleGroup">
          <input className="titleInput" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 50) })} />
          <span className="softChip inlineChip">{hostingLabel(draft.hostingType)}</span>
          <Globe size={19} className="mutedIcon" />
        </div>
        <div className="agentHeroActions">
          <button className="secondaryButton largeAction" type="button" onClick={onCancel}>Cancel</button>
          <button className="darkButton largeAction" type="button" onClick={() => void save()} disabled={saving || !draft.name.trim()}>Save</button>
        </div>
      </div>

      <label className="editField">
        Description
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Add a description for this environment (optional)" />
      </label>

      {draft.hostingType === 'cloud' ? (
        <EnvironmentNetworkEditor draft={draft} onDraft={setDraft} />
      ) : (
        <SelfHostedEnvironment environment={environment} sessions={[]} />
      )}
    </section>
  );
}

function EnvironmentNetworkEditor({ draft, onDraft }: { draft: EnvironmentDraft; onDraft: (draft: EnvironmentDraft) => void }) {
  const updatePackage = (id: string, patch: Partial<EnvironmentPackageDraft>) => {
    onDraft({ ...draft, packages: draft.packages.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateMetadata = (id: string, patch: Partial<MetadataDraft>) => {
    onDraft({ ...draft, metadata: draft.metadata.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Networking</h2>
        <p>Configure network access policies for this environment.</p>
        <label className="editField">
          Type
          <select value={draft.networkType} onChange={(event) => onDraft({ ...draft, networkType: event.target.value as EnvironmentNetworkType })}>
            <option value="unrestricted">Unrestricted</option>
            <option value="limited">Limited</option>
          </select>
        </label>
        <SwitchRow
          label="Allow MCP server network access"
          checked={draft.allowMcpServerNetworkAccess}
          onChecked={(checked) => onDraft({ ...draft, allowMcpServerNetworkAccess: checked })}
        />
        <SwitchRow
          label="Allow package manager network access"
          checked={draft.allowPackageManagerNetworkAccess}
          onChecked={(checked) => onDraft({ ...draft, allowPackageManagerNetworkAccess: checked })}
        />
        <label className="editField">
          Allowed hosts
          <textarea value={draft.allowedHosts} onChange={(event) => onDraft({ ...draft, allowedHosts: event.target.value })} placeholder="www.example1.com, www.example2.com" />
        </label>
      </section>
      <section className="environmentSection editableListSection">
        <div className="sectionHeaderRow">
          <div>
            <h2>Packages</h2>
            <p>Specify packages and their versions available in this environment. Separate multiple values with spaces.</p>
          </div>
          <button className="iconButton" type="button" onClick={() => onDraft({ ...draft, packages: [...draft.packages, { id: newDraftId(), manager: 'pip', package: '' }] })}><Plus size={18} /></button>
        </div>
        {draft.packages.length === 0 ? <ReadonlyTable empty="No packages configured" rows={[]} columns={['Manager', 'Package']} /> : null}
        {draft.packages.map((item) => (
          <div className="editableRow" key={item.id}>
            <select value={item.manager} onChange={(event) => updatePackage(item.id, { manager: event.target.value })}>
              <option value="pip">pip</option>
              <option value="npm">npm</option>
              <option value="apt">apt</option>
              <option value="brew">brew</option>
            </select>
            <input value={item.package} onChange={(event) => updatePackage(item.id, { package: event.target.value })} placeholder="package package==1.0.0" />
            <button className="iconButton quiet" type="button" onClick={() => onDraft({ ...draft, packages: draft.packages.filter((candidate) => candidate.id !== item.id) })}><Trash2 size={18} /></button>
          </div>
        ))}
      </section>
      <section className="environmentSection editableListSection">
        <div className="sectionHeaderRow">
          <div>
            <h2>Metadata</h2>
            <p>Add custom key-value pairs to tag and organize this environment. Keys must be lowercase.</p>
          </div>
          <button className="iconButton" type="button" onClick={() => onDraft({ ...draft, metadata: [...draft.metadata, { id: newDraftId(), key: '', value: '' }] })}><Plus size={18} /></button>
        </div>
        {draft.metadata.length === 0 ? <ReadonlyTable empty="No metadata" rows={[]} columns={['Key', 'Value']} /> : null}
        {draft.metadata.map((item) => (
          <div className="editableRow metadataRow" key={item.id}>
            <input value={item.key} onChange={(event) => updateMetadata(item.id, { key: event.target.value.toLowerCase() })} placeholder="client_key..." />
            <input value={item.value} onChange={(event) => updateMetadata(item.id, { value: event.target.value })} placeholder="Value" />
            <button className="iconButton quiet" type="button" onClick={() => onDraft({ ...draft, metadata: draft.metadata.filter((candidate) => candidate.id !== item.id) })}><Trash2 size={18} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}

function ReadonlyField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`readonlyField ${wide ? 'wide' : ''}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function ReadonlyTable({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="readonlyTable">
      {rows.length === 0 ? <div className="emptyValue">{empty}</div> : (
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.join('-')}-${index}`}>
                {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SwitchRow({ label, checked, onChecked }: { label: string; checked: boolean; onChecked: (checked: boolean) => void }) {
  return (
    <label className="switchRow">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} />
    </label>
  );
}

function SetupStep({ index, title, body, code }: { index: number; title: string; body: string; code?: string }) {
  return (
    <div className="setupStep">
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {code ? <pre>{code}</pre> : null}
      </div>
    </div>
  );
}

function CredentialVaults({ data, onNew, onOpenVault }: { data: ConsoleData; onNew: () => void; onOpenVault: (vault: Vault) => void }) {
  const [query, setQuery] = useState('');
  const vaults = data.vaults.filter((vault) => {
    const q = query.toLowerCase();
    return vault.id.toLowerCase().includes(q) || vault.name.toLowerCase().includes(q);
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Credential vaults</h1>
          <p>Manage credential vaults that provide your agents with access to MCP servers and other tools.</p>
        </div>
        <div className="toolbarActions">
          <button className="darkButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create vault
          </button>
          <button className="iconButton" type="button" title="Documentation"><FileText size={18} /></button>
        </div>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={<button className="filterButton" type="button">Status <strong>All</strong> <ChevronDown size={15} /></button>}
      />
      <div className="tablePanel resourceTablePanel">
        <table className="resourceTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Created</th>
              <th className="actionsCol" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {vaults.map((vault) => (
              <tr key={vault.id} className="clickableRow" onClick={() => onOpenVault(vault)}>
                <td><strong className="monoText">{shortId(vault.id)}</strong></td>
                <td>{vault.name}</td>
                <td><StatusPill status={vault.status} /></td>
                <td>{formatDateShort(vault.created_at)}</td>
                <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                  <button className="iconButton quiet" type="button" title="Vault actions"><MoreVertical size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vaults.length === 0 ? <EmptyState icon={<Lock size={22} />} title="No credential vaults" /> : null}
      </div>
    </section>
  );
}

function CredentialVaultDetail({
  vault,
  onBack,
  onRefresh,
  onNewCredential,
}: {
  vault: Vault;
  onBack: () => void;
  onRefresh: () => void;
  onNewCredential: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [credentialMenuId, setCredentialMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const credentials = vault.credentials.filter((credential) => {
    const q = query.toLowerCase();
    return credential.id.toLowerCase().includes(q)
      || credential.name.toLowerCase().includes(q)
      || credentialAuthLabel(credential.auth_type).toLowerCase().includes(q)
      || credential.mcp_server_url.toLowerCase().includes(q)
      || credential.variable_name.toLowerCase().includes(q);
  });

  const archiveVault = async () => {
    await postJson(`/v1/credential-vaults/${vault.id}/archive`, {});
    setMenuOpen(false);
    onBack();
    onRefresh();
  };
  const archiveCredential = async (credential: VaultCredential) => {
    await postJson(`/v1/credential-vaults/${vault.id}/credentials/${credential.id}/archive`, {});
    setCredentialMenuId(null);
    onRefresh();
  };
  const deleteCredential = async (credential: VaultCredential) => {
    await deleteJson(`/v1/credential-vaults/${vault.id}/credentials/${credential.id}`);
    setCredentialMenuId(null);
    onRefresh();
  };

  return (
    <section className="environmentDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Credential vaults</button>
        <span>/</span>
        <strong>{vault.name}</strong>
      </div>
      <div className="resourceHero">
        <div>
          <div className="titleLine">
            <h1>{vault.name}</h1>
            <StatusPill status={vault.status} />
          </div>
          <p className="mutedLine"><span className="monoText">{vault.id}</span> · Created {formatDateShort(vault.created_at)} · Updated {formatDateShort(vault.updated_at)}</p>
        </div>
        <div className="agentHeroActions">
          <button className="darkButton largeAction" type="button" onClick={onNewCredential}>
            <Plus size={18} />
            Add credential
          </button>
          <div className="menuWrap">
            <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} title="Vault actions">
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="agentMenu">
                <button type="button" className="dangerMenuItem" onClick={() => void archiveVault()}><Archive size={18} />Archive</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="detailStack wideDetailStack">
        <Toolbar
          query={query}
          onQuery={setQuery}
          placeholder="Search credentials"
          actions={<button className="filterButton" type="button">Status <strong>All</strong> <ChevronDown size={15} /></button>}
        />
        <div className="tablePanel">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Auth</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Updated</th>
                <th className="actionsCol" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {credentials.map((credential) => (
                <tr key={credential.id}>
                  <td><strong className="monoText">{shortId(credential.id)}</strong></td>
                  <td>{credential.name || credentialAuthLabel(credential.auth_type)}</td>
                  <td><CredentialAuthCell credential={credential} /></td>
                  <td><StatusPill status={credential.status} /></td>
                  <td>{credential.last_used_at ? relativeDate(credential.last_used_at) : 'Never'}</td>
                  <td>{formatDateShort(credential.updated_at)}</td>
                  <td className="actionsCol">
                    <div className="menuWrap">
                      <button className="iconButton quiet" type="button" title="Credential actions" onClick={() => setCredentialMenuId((current) => current === credential.id ? null : credential.id)}>
                        <MoreVertical size={18} />
                      </button>
                      {credentialMenuId === credential.id ? (
                        <div className="agentMenu rowMenu">
                          <button type="button" onClick={() => void archiveCredential(credential)}><Archive size={18} />Archive</button>
                          <button type="button" className="dangerMenuItem" onClick={() => void deleteCredential(credential)}><Trash2 size={18} />Delete</button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {credentials.length === 0 ? <EmptyState icon={<Shield size={22} />} title="No credentials" /> : null}
        </div>
      </div>
    </section>
  );
}

function CredentialAuthCell({ credential }: { credential: VaultCredential }) {
  const secondary = credential.auth_type === 'mcp_oauth'
    ? credential.mcp_server_url
    : credential.auth_type === 'environment_variable'
      ? credential.variable_name
      : credential.value_hint;
  return (
    <span className="authCell">
      <strong>{credentialAuthLabel(credential.auth_type)}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </span>
  );
}

function MemoryStores({ data, onNew, onOpenMemoryStore }: { data: ConsoleData; onNew: () => void; onOpenMemoryStore: (store: MemoryStore) => void }) {
  const [query, setQuery] = useState('');
  const stores = data.memoryStores.filter((store) => {
    const q = query.toLowerCase();
    return store.id.toLowerCase().includes(q) || store.name.toLowerCase().includes(q) || store.description.toLowerCase().includes(q);
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Memory stores</h1>
          <p>Browse and manage persistent memory for your agents.</p>
        </div>
        <div className="toolbarActions">
          <button className="darkButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create memory store
          </button>
          <button className="iconButton" type="button" title="Documentation"><FileText size={18} /></button>
        </div>
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
      <div className="tablePanel resourceTablePanel">
        <table className="resourceTable">
          <thead>
            <tr>
              <th className="selectCol"><input type="checkbox" aria-label="Select memory stores" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Created</th>
              <th className="actionsCol" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.id} className="clickableRow" onClick={() => onOpenMemoryStore(store)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${store.id}`} /></td>
                <td><strong className="monoText">{shortId(store.id)}</strong></td>
                <td>{store.name}</td>
                <td><StatusPill status={store.status} /></td>
                <td>{formatDateShort(store.created_at)}</td>
                <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                  <button className="iconButton quiet" type="button" title="Memory store actions"><MoreVertical size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stores.length === 0 ? <EmptyState icon={<Database size={22} />} title="No memory stores" /> : null}
      </div>
    </section>
  );
}

function MemoryStoreDetail({
  store,
  onBack,
  onRefresh,
  onNewMemory,
}: {
  store: MemoryStore;
  onBack: () => void;
  onRefresh: () => void;
  onNewMemory: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(store.memories[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const selected = store.memories.find((memory) => memory.id === selectedId) ?? null;
  const [content, setContent] = useState(selected?.content ?? '');

  useEffect(() => {
    setSelectedId((current) => current && store.memories.some((memory) => memory.id === current) ? current : store.memories[0]?.id ?? null);
  }, [store.id, store.memories]);

  useEffect(() => {
    setContent(selected?.content ?? '');
    setEditing(false);
  }, [selected?.id]);

  const save = async () => {
    if (!selected) return;
    await putJson(`/v1/memory-stores/${store.id}/memories/${selected.id}`, { content });
    setEditing(false);
    onRefresh();
  };

  return (
    <section className="environmentDetail memoryStoreDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Memory stores</button>
        <span>/</span>
        <strong>{store.name}</strong>
      </div>
      <div className="resourceHero">
        <div>
          <div className="titleLine">
            <h1>{store.name}</h1>
            <StatusPill status={store.status} />
          </div>
          <p className="mutedLine"><span className="monoText">{shortId(store.id)}</span> · Created {formatDateShort(store.created_at)}</p>
          {store.description ? <p className="agentDescription">{store.description}</p> : null}
        </div>
        <button className="darkButton largeAction" type="button" onClick={onNewMemory}>
          <Plus size={18} />
          Add memory
        </button>
      </div>

      <div className="memoryBrowser tablePanel">
        <div className="memoryTree">
          <MemoryTree memories={store.memories} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </div>
        <div className="memoryContent">
          {selected ? (
            <>
              <div className="memoryContentHeader">
                <div>
                  <h2>{selected.path}</h2>
                  <p><span className="monoText">{shortId(selected.id)}</span> · Updated {formatDateShort(selected.updated_at)}</p>
                </div>
                {editing ? (
                  <div className="toolbarActions">
                    <button className="secondaryButton" type="button" onClick={() => { setEditing(false); setContent(selected.content); }}><X size={16} />Cancel</button>
                    <button className="darkButton" type="button" onClick={() => void save()}><Check size={16} />Save</button>
                  </div>
                ) : (
                  <button className="secondaryButton" type="button" onClick={() => setEditing(true)}><Pencil size={18} />Edit</button>
                )}
              </div>
              {editing ? (
                <textarea className="memoryEditor" value={content} onChange={(event) => setContent(event.target.value)} />
              ) : (
                <pre className="memoryPreview">{selected.content}</pre>
              )}
            </>
          ) : (
            <EmptyState icon={<Database size={24} />} title="Select a memory" />
          )}
        </div>
      </div>
    </section>
  );
}

function MemoryTree({ memories, selectedId, onSelect }: { memories: MemoryRecord[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const groups = useMemo(() => groupMemoriesByFolder(memories), [memories]);
  if (memories.length === 0) return <div className="memoryTreeEmpty">No memories</div>;
  return (
    <>
      {groups.map((group) => (
        <div className="memoryFolder" key={group.folder}>
          <div className="memoryFolderTitle">
            <ChevronDown size={16} />
            <Database size={16} />
            <span>{group.folder}</span>
          </div>
          {group.items.map((memory) => (
            <button
              type="button"
              key={memory.id}
              className={`memoryNode ${selectedId === memory.id ? 'active' : ''}`}
              onClick={() => onSelect(memory.id)}
            >
              <FileText size={15} />
              <span>{memoryName(memory.path)}</span>
              <small>{memory.content.length} B</small>
            </button>
          ))}
        </div>
      ))}
    </>
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
        <Info size={18} />
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
            ['Mode', data.runtime ? 'Local runtime connected' : 'Local runtime starting'],
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

function RuntimeView({ data }: { data: ConsoleData }) {
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Local runtime</h1>
          <p>Inspect the runtime process, available model adapters, sandbox providers, and managed project paths.</p>
        </div>
      </div>
      <div className="sectionHeaderRow">
        <div>
          <h2>Runtime capabilities</h2>
          <p>Live capability summary for the Console and local API.</p>
        </div>
      </div>
      <SummaryStrip
        items={[
          { label: 'Status', value: data.runtime?.status ?? 'unknown', icon: <Gauge size={18} /> },
          { label: 'Models', value: data.runtime?.models.length ?? 0, icon: <Brain size={18} /> },
          { label: 'Sandboxes', value: data.runtime?.sandbox_providers.join(', ') || 'none', icon: <Shield size={18} /> },
          { label: 'Memory', value: data.runtime?.memory ?? 'disabled', icon: <Database size={18} /> },
        ]}
      />
      <div className="sectionHeaderRow">
        <div>
          <h2>Model registry</h2>
          <p>Configured model identifiers exposed by the runtime.</p>
        </div>
      </div>
      <div className="tablePanel">
        <table>
          <thead><tr><th>Name</th><th>Provider</th><th>Model ID</th><th>API key</th><th>Base URL</th></tr></thead>
          <tbody>
            {(data.runtime?.models ?? []).map((model) => (
              <tr key={model.name}>
                <td><strong>{model.name}</strong></td>
                <td>{model.provider}</td>
                <td><code>{model.model}</code></td>
                <td><RuntimeConfigStatePill state={model.api_key_state} /></td>
                <td><RuntimeConfigStatePill state={model.base_url_state} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data.runtime?.models.length ?? 0) === 0 ? <div className="emptyValue">No models configured</div> : null}
      </div>
      <div className="sectionHeaderRow">
        <div>
          <h2>Runtime paths</h2>
          <p>Project folders and configuration files used by this runtime.</p>
        </div>
      </div>
      <WorkspacePathsPanel workspace={data.workspace} />
    </section>
  );
}

function RuntimeConfigStatePill({ state }: { state: RuntimeConfigState }) {
  const status = state === 'configured' ? 'active' : state === 'missing_env' ? 'failed' : 'idle';
  const label = state === 'missing_env' ? 'missing env' : state === 'not_set' ? 'not set' : 'configured';
  return <span className={`status ${status}`}>{label}</span>;
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
      <SummaryStrip items={[
        { label: 'Auth', value: data.runtime?.auth_enabled ? 'enabled' : 'disabled', icon: <KeyRound size={18} /> },
        { label: 'Active keys', value: String(activeKeys.length), icon: <Shield size={18} /> },
        { label: 'Managed keys', value: String(managedKeys.length), icon: <Lock size={18} /> },
        { label: 'Configured keys', value: String(configuredKeys.length), icon: <Settings size={18} /> },
      ]} />
      <div className="sectionHeaderRow">
        <div>
          <h1>API Keys</h1>
          <p>Create and manage bearer tokens for the local Managed Agents API.</p>
        </div>
        <button className="primaryButton" type="button" onClick={() => setModalOpen(true)}>
          <Plus size={18} />Create key
        </button>
      </div>
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
        <h2>Browser token</h2>
        <p>Store a key locally in this browser so Console requests can authenticate when API auth is enabled.</p>
        <div className="inlineForm">
          <input
            value={storedKey}
            onChange={(event) => setStoredKey(event.target.value)}
            placeholder="ma_..."
            type="password"
          />
          <button type="button" onClick={saveStoredKey}>Save token</button>
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

type ParsedMetrics = {
  disabled: boolean;
  httpRequests?: number;
  httpErrors?: number;
  httpRequestDurationCount?: number;
  httpRequestDurationSum: number;
};

function parsePrometheusMetrics(text: string): ParsedMetrics {
  const disabled = text.trim() === '# metrics disabled';
  return {
    disabled,
    httpRequests: readPrometheusMetric(text, 'http_requests_total'),
    httpErrors: readPrometheusMetric(text, 'http_errors_total'),
    httpRequestDurationCount: readPrometheusMetric(text, 'http_request_duration_ms_count'),
    httpRequestDurationSum: readPrometheusMetric(text, 'http_request_duration_ms_sum') ?? 0,
  };
}

function readPrometheusMetric(text: string, name: string): number | undefined {
  const line = text.split('\n').find((item) => item.startsWith(`${name} `));
  if (!line) return undefined;
  const value = Number(line.split(/\s+/)[1]);
  return Number.isFinite(value) ? value : undefined;
}

function Observability({ data }: { data: ConsoleData }) {
  const [metricsText, setMetricsText] = useState('');
  const [metricsError, setMetricsError] = useState('');
  useEffect(() => {
    let mounted = true;
    getText('/v1/x/metrics')
      .then((text) => {
        if (!mounted) return;
        setMetricsText(text);
        setMetricsError('');
      })
      .catch((error: Error) => {
        if (!mounted) return;
        setMetricsText('');
        setMetricsError(error.message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const tokenTotal = data.sessions.reduce((sum, session) => sum + session.usage.input_tokens + session.usage.output_tokens, 0);
  const metrics = parsePrometheusMetrics(metricsText);
  const averageRequestMs = metrics.httpRequestDurationCount
    ? Math.round(metrics.httpRequestDurationSum / metrics.httpRequestDurationCount)
    : null;
  const metricsStatus = metricsError || (metricsText ? (metrics.disabled ? 'disabled' : 'enabled') : 'loading');
  const requestCount = metrics.disabled ? 'disabled' : (metrics.httpRequests ?? 0);
  const errorCount = metrics.disabled ? 'disabled' : (metrics.httpErrors ?? 0);
  const requestSamples = metrics.disabled ? 'disabled' : (metrics.httpRequestDurationCount ?? 0);
  const averageDuration = metrics.disabled ? 'disabled' : (averageRequestMs === null ? 'No samples yet' : `${averageRequestMs} ms`);
  return (
    <section className="stack">
      <SummaryStrip items={[
        { label: 'Sessions', value: data.sessions.length, icon: <MessageSquare size={18} /> },
        { label: 'Running', value: data.sessions.filter((session) => session.status === 'running').length, icon: <CirclePlay size={18} /> },
        { label: 'HTTP requests', value: requestCount, icon: <Activity size={18} /> },
        { label: 'HTTP errors', value: errorCount, icon: <Gauge size={18} /> },
      ]} />
      <div className="workspaceGrid">
        <div className="panel subtlePanel">
          <h2>Runtime metrics</h2>
          <p>Live process counters from <code>/v1/x/metrics</code>.</p>
          <KeyValuePanel rows={[
            ['Metrics status', metricsStatus],
            ['Request samples', requestSamples],
            ['Average request duration', averageDuration],
            ['Session tokens', tokenTotal],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Prometheus endpoint</h2>
          <p>Raw text returned by the local runtime.</p>
          <pre className="metricsPreview">{metricsError || metricsText || '# metrics not loaded yet'}</pre>
        </div>
      </div>
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
  const [selected, setSelected] = useState<Template | undefined>(initialTemplate);
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
    <Modal title="Create agent" subtitle="Start from a template and edit the YAML config." onClose={onClose} size="wide">
      <form className="agentComposer" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <section className="composerSection">
          <div className="sectionTitle"><ChevronDown size={18} /><strong>Starting point</strong>{selected ? <span>· {selected.name}</span> : null}</div>
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
  model: string;
  model_config?: { speed: string };
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
    model: data.runtime?.models[0]?.name ?? 'claude-sonnet-5',
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
    model: agent.model,
    model_config: agent.model_config,
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
    ...(agent.model_config && agent.model_config.speed !== 'standard' ? { model_config: agent.model_config } : {}),
    system: agent.system,
    mcp_servers: agent.mcp_servers ?? [],
    tools: agent.tools ?? [{ type: 'agent_toolset_20260401' }],
    skills: agent.skills ?? [],
    metadata: agent.metadata ?? {},
  }, { blockQuote: 'literal', lineWidth: 100 });
}

function SessionModal({
  data,
  initialAgentId,
  onClose,
  onSaved,
  onNavigate,
}: {
  data: ConsoleData;
  initialAgentId?: string;
  onClose: () => void;
  onSaved: () => void;
  onNavigate: (view: ViewId) => void;
}) {
  const [agent, setAgent] = useState(initialAgentId ?? '');
  const [environment, setEnvironment] = useState('');
  const [title, setTitle] = useState('');
  const [vaultIds, setVaultIds] = useState<Set<string>>(new Set());
  const [resources, setResources] = useState<SessionResourceDraft[]>([]);
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson('/v1/sessions', {
        agent,
        environment_id: environment,
        title: title || undefined,
        resources: resources.map(toSessionResourcePayload),
        vault_ids: Array.from(vaultIds),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addResource = (type: SessionResourceDraft['type']) => {
    setResources((current) => [...current, createResourceDraft(type)]);
    setResourceMenuOpen(false);
  };

  const updateResource = (index: number, resource: SessionResourceDraft) => {
    setResources((current) => current.map((item, itemIndex) => itemIndex === index ? resource : item));
  };

  const removeResource = (index: number) => {
    setResources((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <Modal title="Create session" subtitle="Set up an instance of your agent in its environment." onClose={onClose} size="wide">
      <form className="sessionForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label className="sessionField">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional - name this run" />
        </label>

        <SelectPicker
          label="Agent"
          placeholder="Select an agent"
          searchPlaceholder="Search agents by name or exact ID"
          manageLabel="Manage agents"
          onManage={() => onNavigate('agents')}
          value={agent}
          onValue={setAgent}
          options={data.agents.map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: formatDateShort(item.created_at),
          }))}
        />

        <SelectPicker
          label="Environment"
          placeholder="Select an environment"
          searchPlaceholder="Search environments by name or exact ID"
          manageLabel="Manage environments"
          onManage={() => onNavigate('environments')}
          value={environment}
          onValue={setEnvironment}
          options={data.environments.map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: formatDateShort(item.created_at),
            badge: environmentKind(item),
          }))}
        />

        <VaultPicker
          vaults={data.vaults}
          selected={vaultIds}
          onSelected={setVaultIds}
          onManage={() => onNavigate('credential-vaults')}
        />

        <div className="sessionResources">
          <div>
            <h3>Resources</h3>
            <p>Mount files, GitHub repositories, or memory stores into the session.</p>
          </div>
          {resources.map((resource, index) => (
            <SessionResourceEditor
              key={`${resource.type}-${index}`}
              resource={resource}
              data={data}
              onChange={(next) => updateResource(index, next)}
              onRemove={() => removeResource(index)}
              onNavigate={onNavigate}
            />
          ))}
          <div className="menuWrap resourceAddWrap">
            <button className="secondaryButton resourceAddButton" type="button" onClick={() => setResourceMenuOpen((open) => !open)}>
              <Plus size={18} />
              Resource
              <ChevronDown size={16} />
            </button>
            {resourceMenuOpen ? (
              <div className="resourceMenu">
                <button type="button" onClick={() => addResource('github_repository')}>GitHub repository</button>
                <button type="button" onClick={() => addResource('file')}>File</button>
                <button type="button" onClick={() => addResource('memory_store')}>Memory store</button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="modalActions stickyActions">
          <button className="darkButton" type="submit" disabled={saving || !agent || !environment}>
            Create session
          </button>
        </div>
      </form>
    </Modal>
  );
}

type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
};

function SelectPicker({
  label,
  placeholder,
  searchPlaceholder,
  manageLabel,
  onManage,
  value,
  onValue,
  options,
}: {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  manageLabel: string;
  onManage: () => void;
  value: string;
  onValue: (value: string) => void;
  options: PickerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.id === value);
  const filtered = options.filter((option) => {
    const q = query.toLowerCase();
    return option.id.toLowerCase().includes(q) || option.title.toLowerCase().includes(q) || (option.subtitle ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="sessionField pickerWrap">
      <span className="fieldHeader">
        {label}
        <button className="linkButton" type="button" onClick={onManage}>{manageLabel} <ExternalLink size={15} /></button>
      </span>
      <button className={`pickerButton ${selected ? 'selected' : ''}`} type="button" onClick={() => setOpen((current) => !current)}>
        <span>
          <strong>{selected?.title ?? placeholder}</strong>
          {selected?.subtitle ? <small>{selected.subtitle}</small> : null}
        </span>
        {selected?.badge ? <b>{selected.badge}</b> : null}
        <ChevronDown size={18} />
      </button>
      {open ? (
        <div className="pickerPopover">
          <div className="pickerSearch">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus />
          </div>
          <div className="pickerOptions">
            {filtered.map((option) => (
              <button
                type="button"
                className={`pickerOption ${option.id === value ? 'active' : ''}`}
                key={option.id}
                onClick={() => {
                  onValue(option.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span>
                  <strong>{option.title}</strong>
                  {option.subtitle ? <small>{option.subtitle}</small> : null}
                </span>
                {option.badge ? <b>{option.badge}</b> : null}
              </button>
            ))}
            {filtered.length === 0 ? <span className="pickerEmpty">No matches</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VaultPicker({
  vaults,
  selected,
  onSelected,
  onManage,
}: {
  vaults: Vault[];
  selected: Set<string>;
  onSelected: Dispatch<SetStateAction<Set<string>>>;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = vaults.filter((vault) => {
    const q = query.toLowerCase();
    return vault.id.toLowerCase().includes(q) || vault.name.toLowerCase().includes(q) || vault.description.toLowerCase().includes(q);
  });
  const selectedNames = vaults.filter((vault) => selected.has(vault.id)).map((vault) => vault.name);

  return (
    <div className="sessionField pickerWrap">
      <span className="fieldHeader">
        Credential vaults
        <button className="linkButton" type="button" onClick={onManage}>Manage credential vaults <ExternalLink size={15} /></button>
      </span>
      <button className={`pickerButton ${selectedNames.length ? 'selected' : ''}`} type="button" onClick={() => setOpen((current) => !current)}>
        <span>
          <strong>{selectedNames.length ? selectedNames.join(', ') : 'Select one or more vaults'}</strong>
          {selectedNames.length ? <small>{selectedNames.length} selected</small> : null}
        </span>
        <ChevronDown size={18} />
      </button>
      {open ? (
        <div className="pickerPopover">
          <div className="pickerSearch">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vaults by name or exact ID" autoFocus />
          </div>
          <div className="pickerOptions">
            {filtered.map((vault) => (
              <label className="pickerOption vaultOption" key={vault.id}>
                <input
                  type="checkbox"
                  checked={selected.has(vault.id)}
                  onChange={(event) => toggleSet(vault.id, event.target.checked, onSelected)}
                />
                <span>
                  <strong>{vault.name}</strong>
                  <small>{formatDateShort(vault.created_at)}</small>
                </span>
                <Shield size={17} />
              </label>
            ))}
            {filtered.length === 0 ? <span className="pickerEmpty">No credential vaults</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionResourceEditor({
  resource,
  data,
  onChange,
  onRemove,
  onNavigate,
}: {
  resource: SessionResourceDraft;
  data: ConsoleData;
  onChange: (resource: SessionResourceDraft) => void;
  onRemove: () => void;
  onNavigate: (view: ViewId) => void;
}) {
  if (resource.type === 'file') {
    return (
      <div className="resourceEditor">
        <ResourceEditorHeader title="File" onRemove={onRemove} />
        <label>
          <span className="fieldHeader">
            File ID <RequiredMark />
            <button className="linkButton" type="button" onClick={() => onNavigate('files')}>Manage files <ExternalLink size={15} /></button>
          </span>
          <input value={resource.file_id} onChange={(event) => onChange({ ...resource, file_id: event.target.value })} placeholder="file_abc123..." required />
        </label>
        <label>
          Mount path <RequiredMark />
          <input value={resource.mount_path} onChange={(event) => onChange({ ...resource, mount_path: event.target.value })} placeholder="/uploads/myfile.txt" required />
          <small>Must start with /uploads/</small>
        </label>
      </div>
    );
  }

  if (resource.type === 'github_repository') {
    return (
      <div className="resourceEditor">
        <ResourceEditorHeader title="GitHub repository" onRemove={onRemove} />
        <label>
          URL <RequiredMark />
          <input value={resource.url} onChange={(event) => onChange({ ...resource, url: event.target.value })} placeholder="https://github.com/owner/repo" required />
        </label>
        <label>
          Authorization token <RequiredMark />
          <input value={resource.authorization_token} onChange={(event) => onChange({ ...resource, authorization_token: event.target.value })} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" required />
        </label>
        <label className="shortField">
          Checkout
          <select value={resource.checkout} onChange={(event) => onChange({ ...resource, checkout: event.target.value })}>
            <option value="">None</option>
            <option value="default_branch">Default branch</option>
            <option value="commit">Commit SHA</option>
            <option value="branch">Branch</option>
          </select>
        </label>
        <label>
          Mount path
          <input value={resource.mount_path} onChange={(event) => onChange({ ...resource, mount_path: event.target.value })} placeholder="/workspace/repo-name (default)" />
        </label>
      </div>
    );
  }

  return (
    <div className="resourceEditor">
      <ResourceEditorHeader title="Memory store" onRemove={onRemove} />
      <label>
        <span className="fieldHeader">
          Memory store <RequiredMark />
          <button className="linkButton" type="button" onClick={() => onNavigate('memory-stores')}>Manage memory stores <ExternalLink size={15} /></button>
        </span>
        <select value={resource.memory_store_id} onChange={(event) => onChange({ ...resource, memory_store_id: event.target.value })} required>
          <option value="">Select a memory store</option>
          {data.memoryStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>
      <label>
        Access
        <select value={resource.access} onChange={(event) => onChange({ ...resource, access: event.target.value as 'read_write' | 'read_only' })}>
          <option value="read_write">Read & write</option>
          <option value="read_only">Read only</option>
        </select>
      </label>
      <label>
        Instructions (optional)
        <textarea value={resource.instructions} onChange={(event) => onChange({ ...resource, instructions: event.target.value })} placeholder="Tell the agent what this store contains and when to use it." />
      </label>
    </div>
  );
}

function ResourceEditorHeader({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="resourceEditorHeader">
      <strong>{title}</strong>
      <button className="iconButton quiet" type="button" onClick={onRemove} aria-label={`Remove ${title}`}>
        <Trash2 size={19} />
      </button>
    </div>
  );
}

function ResourceModal({ kind, onClose, onSaved }: { kind: 'environment' | 'credential_vault' | 'memory_store'; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hostingType, setHostingType] = useState<EnvironmentHostingType>('cloud');
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
        ...(kind !== 'credential_vault' ? { description } : {}),
        ...(kind === 'environment' ? {
          config: {
            hosting_type: hostingType,
            sandbox_provider: hostingType === 'self_hosted' ? 'self_hosted' : 'cloud',
            network: {
              type: 'limited',
              allow_mcp_server_network_access: false,
              allow_package_manager_network_access: false,
              allowed_hosts: [],
            },
            packages: [],
          },
        } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (kind === 'environment') {
    return (
      <Modal title="Create environment" onClose={onClose} size="medium">
        <form className="environmentCreateForm" onSubmit={submit}>
          {error ? <div className="banner error inlineBanner">{error}</div> : null}
          <label className="editField">
            Name
            <input value={name} onChange={(event) => setName(event.target.value.slice(0, 50))} placeholder="E.g. My Environment" required />
            <small>50 characters or fewer.</small>
          </label>
          <label className="editField">
            Hosting type
            <select value={hostingType} onChange={(event) => setHostingType(event.target.value as EnvironmentHostingType)}>
              <option value="cloud">Cloud</option>
              <option value="self_hosted">Self-hosted</option>
            </select>
          </label>
          <label className="editField">
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description for this environment" />
          </label>
          <div className="modalActions">
            <button className="secondaryButton largeAction" type="button" onClick={onClose}>Cancel</button>
            <button className="darkButton largeAction" type="submit" disabled={saving || !name.trim()}>Create environment</button>
          </div>
        </form>
      </Modal>
    );
  }

  if (kind === 'credential_vault') {
    return (
      <Modal title="Create vault" onClose={onClose} size="medium">
        <form className="vaultCreateForm" onSubmit={submit}>
          {error ? <div className="banner error inlineBanner">{error}</div> : null}
          <div className="warningNotice">
            <Info size={18} />
            <span>Vaults are shared across this workspace. Credentials added to this vault will be usable by anyone with API key access. Learn more <a href="#settings">here</a>.</span>
          </div>
          <label className="editField">
            Name
            <input value={name} onChange={(event) => setName(event.target.value.slice(0, 50))} placeholder="Production vault" required />
            <small>50 characters or fewer.</small>
          </label>
          <div className="modalActions">
            <button className="darkButton largeAction" type="submit" disabled={saving || !name.trim()}>Continue</button>
          </div>
        </form>
      </Modal>
    );
  }

  if (kind === 'memory_store') {
    return (
      <Modal title="Create memory store" onClose={onClose} size="medium">
        <form className="memoryCreateForm" onSubmit={submit}>
          {error ? <div className="banner error inlineBanner">{error}</div> : null}
          <label className="editField">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My memory store" required />
          </label>
          <label className="editField">
            Description (optional)
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this store contains and how agents should use it" />
            <small>Name and description are rendered in the agent system prompt when this store is attached.</small>
          </label>
          <div className="modalActions">
            <button className="darkButton largeAction" type="submit" disabled={saving || !name.trim()}>Create memory store</button>
          </div>
        </form>
      </Modal>
    );
  }

  throw new Error(`Unsupported resource kind: ${kind}`);
}

const MCP_REGISTRY_OPTIONS = [
  { name: 'Google Drive', url: 'https://drivemcp.googleapis.com/mcp/v1' },
  { name: 'Gmail', url: 'https://gmailmcp.googleapis.com/mcp/v1' },
  { name: 'Google Calendar', url: 'https://calendarmcp.googleapis.com/mcp/v1' },
  { name: 'Canva', url: 'https://mcp.canva.com/mcp' },
  { name: 'Figma', url: 'https://mcp.figma.com/mcp' },
  { name: 'Notion', url: 'https://mcp.notion.com/mcp' },
];

function AddCredentialModal({ vaultId, onClose, onSaved }: { vaultId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [authType, setAuthType] = useState<CredentialAuthType>('mcp_oauth');
  const [mcpServerUrl, setMcpServerUrl] = useState('');
  const [variableName, setVariableName] = useState('');
  const [value, setValue] = useState('');
  const [networkType, setNetworkType] = useState<'limited' | 'unrestricted'>('limited');
  const [allowedHosts, setAllowedHosts] = useState('');
  const [injectHeaders, setInjectHeaders] = useState(true);
  const [injectBody, setInjectBody] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [registryQuery, setRegistryQuery] = useState('');

  const filteredRegistry = MCP_REGISTRY_OPTIONS.filter((option) => {
    const q = registryQuery.toLowerCase();
    return option.name.toLowerCase().includes(q) || option.url.toLowerCase().includes(q);
  });
  const needsSecretAcknowledgement = authType !== 'mcp_oauth';
  const canSubmit = authType === 'mcp_oauth'
    ? Boolean(mcpServerUrl.trim())
    : authType === 'bearer_token'
      ? Boolean(value.trim() && acknowledged)
      : Boolean(variableName.trim() && value.trim() && acknowledged);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      await postJson(`/v1/credential-vaults/${vaultId}/credentials`, {
        name: name.trim() || undefined,
        auth_type: authType,
        ...(authType === 'mcp_oauth' ? { mcp_server_url: mcpServerUrl } : {}),
        ...(authType === 'environment_variable' ? { variable_name: variableName } : {}),
        ...(authType !== 'mcp_oauth' ? {
          value,
          network: { type: networkType, allowed_hosts: splitCsv(allowedHosts) },
          injection_locations: [
            ...(injectHeaders ? ['request_headers'] : []),
            ...(injectBody ? ['request_body'] : []),
          ],
        } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add credential" subtitle="Add a credential to this vault for agents to use." onClose={onClose} size="medium">
      <form className="credentialForm" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <label className="editField">
          <span>Name <small className="optionalPill">Optional</small></span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example credential" />
        </label>
        <label className="editField">
          Type
          <select value={authType} onChange={(event) => setAuthType(event.target.value as CredentialAuthType)}>
            <option value="mcp_oauth">MCP OAuth</option>
            <option value="bearer_token">Bearer token</option>
            <option value="environment_variable">Environment variable</option>
          </select>
        </label>

        {authType === 'mcp_oauth' ? (
          <div className="mcpRegistryPanel">
            <div className="pickerSearch registrySearch">
              <Search size={18} />
              <input value={registryQuery} onChange={(event) => setRegistryQuery(event.target.value)} placeholder="Search Anthropic's MCP registry or enter a custom URL" />
            </div>
            <div className="registryList">
              {filteredRegistry.map((option) => (
                <button
                  type="button"
                  key={option.url}
                  onClick={() => {
                    setMcpServerUrl(option.url);
                    if (!name.trim()) setName(option.name);
                  }}
                >
                  <span className="registryIcon">{option.name.slice(0, 1)}</span>
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.url}</small>
                  </span>
                </button>
              ))}
            </div>
            <label className="editField compactField">
              MCP server URL <RequiredMark />
              <input value={mcpServerUrl} onChange={(event) => setMcpServerUrl(event.target.value)} placeholder="https://mcp.example.com" required />
            </label>
          </div>
        ) : null}

        {authType === 'bearer_token' ? (
          <label className="editField">
            Token <RequiredMark />
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Bearer or personal access token" required />
          </label>
        ) : null}

        {authType === 'environment_variable' ? (
          <div className="credentialGrid">
            <label className="editField">
              Variable name <RequiredMark />
              <input value={variableName} onChange={(event) => setVariableName(event.target.value)} placeholder="MY_API_KEY" required />
            </label>
            <label className="editField">
              Value <RequiredMark />
              <input value={value} onChange={(event) => setValue(event.target.value)} required />
            </label>
          </div>
        ) : null}

        {needsSecretAcknowledgement ? (
          <>
            <div className="credentialSection">
              <h3>Networking</h3>
              <div className="segment credentialSegment">
                <button type="button" className={networkType === 'limited' ? 'active' : ''} onClick={() => setNetworkType('limited')}>Limited</button>
                <button type="button" className={networkType === 'unrestricted' ? 'active' : ''} onClick={() => setNetworkType('unrestricted')}>Unrestricted</button>
              </div>
              <label className="editField">
                Allowed hosts
                <textarea value={allowedHosts} onChange={(event) => setAllowedHosts(event.target.value)} placeholder="api.example.com, *.example.com" />
                <small>Separate hosts with commas or newlines.</small>
              </label>
            </div>
            <div className="credentialSection">
              <h3>Injection location</h3>
              <label className="checkboxLine">
                <input type="checkbox" checked={injectHeaders} onChange={(event) => setInjectHeaders(event.target.checked)} />
                Request headers
              </label>
              <label className="checkboxLine">
                <input type="checkbox" checked={injectBody} onChange={(event) => setInjectBody(event.target.checked)} />
                Request body
              </label>
              <p>Limiting to request headers is recommended unless the service reads the secret from the request body.</p>
            </div>
            <div className="warningNotice">
              <Info size={18} />
              <span>This credential will be shared across this workspace. Anyone with API key access can use this credential in an agent session to access the service associated with the credential, including reading data and taking actions on behalf of the credential owner. Learn more <a href="#settings">here</a>.</span>
            </div>
            <label className="checkboxLine acknowledgement">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              I acknowledge this credential is shared and that I am responsible for its storage and use.
            </label>
          </>
        ) : null}

        <div className="modalActions stickyActions">
          <button className="darkButton largeAction" type="submit" disabled={saving || !canSubmit}>Add credential</button>
        </div>
      </form>
    </Modal>
  );
}

function AddMemoryModal({ storeId, onClose, onSaved }: { storeId: string; onClose: () => void; onSaved: () => void }) {
  const [path, setPath] = useState('/');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const normalizedPath = path.trim().replace(/\/+/g, '/');
  const canSubmit = normalizedPath.startsWith('/') && normalizedPath.length > 1 && !normalizedPath.endsWith('/');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      await postJson(`/v1/memory-stores/${storeId}/memories`, { path: normalizedPath, content });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Add memory" onClose={onClose} size="medium">
      <form className="addMemoryForm" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <label className="editField">
          Path
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/note/d" required />
          <small>Folders are derived from the slashes in your path.</small>
        </label>
        <label className="editField">
          Content
          <textarea value={content} onChange={(event) => setContent(event.target.value)} />
        </label>
        <div className="modalActions">
          <button className="darkButton largeAction" type="submit" disabled={saving || !canSubmit}>Add memory</button>
        </div>
      </form>
    </Modal>
  );
}

function createResourceDraft(type: SessionResourceDraft['type']): SessionResourceDraft {
  if (type === 'file') return { type, file_id: '', mount_path: '' };
  if (type === 'github_repository') return { type, url: '', authorization_token: '', checkout: '', mount_path: '' };
  return { type, memory_store_id: '', access: 'read_write', instructions: '' };
}

function toSessionResourcePayload(resource: SessionResourceDraft): Record<string, unknown> {
  if (resource.type === 'file') {
    return {
      type: 'file',
      file_id: resource.file_id,
      mount_path: resource.mount_path,
    };
  }
  if (resource.type === 'github_repository') {
    return {
      type: 'github_repository',
      url: resource.url,
      authorization_token: resource.authorization_token,
      ...(resource.checkout ? { checkout: resource.checkout } : {}),
      ...(resource.mount_path ? { mount_path: resource.mount_path } : {}),
    };
  }
  return {
    type: 'memory_store',
    memory_store_id: resource.memory_store_id,
    access: resource.access,
    ...(resource.instructions ? { instructions: resource.instructions } : {}),
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

function environmentKind(environment: Environment) {
  return hostingLabel(environmentHostingType(environment));
}

function hostingLabel(type: EnvironmentHostingType) {
  return type === 'self_hosted' ? 'Self-hosted' : 'Cloud';
}

function environmentHostingType(environment: Environment): EnvironmentHostingType {
  const hostingType = environment.config.hosting_type;
  const provider = environment.config.sandbox_provider;
  if (hostingType === 'self_hosted' || provider === 'self_hosted' || provider === 'local') return 'self_hosted';
  return 'cloud';
}

function environmentNetwork(environment: Environment) {
  const network = objectValue(environment.config.network);
  const allowedHosts = arrayOfStrings(network.allowed_hosts);
  return {
    type: (network.type === 'unrestricted' ? 'unrestricted' : 'limited') as EnvironmentNetworkType,
    allowMcp: Boolean(network.allow_mcp_server_network_access),
    allowPackageManager: Boolean(network.allow_package_manager_network_access),
    allowedHosts,
  };
}

function environmentPackages(environment: Environment): EnvironmentPackageDraft[] {
  const packages = Array.isArray(environment.config.packages) ? environment.config.packages : [];
  return packages.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const manager = typeof record.manager === 'string' ? record.manager : '';
    const packageName = typeof record.package === 'string' ? record.package : '';
    if (!manager && !packageName) return [];
    return [{ id: `pkg_${index}`, manager, package: packageName }];
  });
}

function environmentMetadataEntries(environment: Environment): string[][] {
  return Object.entries(environment.metadata ?? {}).map(([key, value]) => [key, String(value)]);
}

function environmentKeys(environment: Environment): Array<{ id: string; name: string; created_at: string; expires_at: string }> {
  const raw = environment.metadata.environment_keys;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.name !== 'string') return [];
      return [{
        id: record.id,
        name: record.name,
        created_at: typeof record.created_at === 'string' ? record.created_at : environment.created_at,
        expires_at: typeof record.expires_at === 'string' ? record.expires_at : environment.updated_at,
      }];
    });
  } catch {
    return [];
  }
}

function environmentDraftFromApi(environment: Environment): EnvironmentDraft {
  const network = environmentNetwork(environment);
  return {
    name: environment.name,
    description: environment.description,
    hostingType: environmentHostingType(environment),
    networkType: network.type,
    allowMcpServerNetworkAccess: network.allowMcp,
    allowPackageManagerNetworkAccess: network.allowPackageManager,
    allowedHosts: network.allowedHosts.join(', '),
    packages: environmentPackages(environment).map((item) => ({ ...item, id: newDraftId() })),
    metadata: environmentMetadataEntries(environment)
      .filter(([key]) => key !== 'environment_keys')
      .map(([key, value]) => ({ id: newDraftId(), key, value })),
    preservedMetadata: Object.fromEntries(
      Object.entries(environment.metadata ?? {}).filter(([key]) => key === 'environment_keys'),
    ),
  };
}

function environmentPayloadFromDraft(draft: EnvironmentDraft) {
  const editableMetadata = Object.fromEntries(
    draft.metadata
      .map((item) => [item.key.trim().toLowerCase(), item.value.trim()])
      .filter(([key]) => key),
  );
  const metadata = { ...draft.preservedMetadata, ...editableMetadata };
  return {
    name: draft.name.trim(),
    description: draft.description,
    config: {
      hosting_type: draft.hostingType,
      sandbox_provider: draft.hostingType === 'self_hosted' ? 'self_hosted' : 'cloud',
      network: {
        type: draft.networkType,
        allow_mcp_server_network_access: draft.allowMcpServerNetworkAccess,
        allow_package_manager_network_access: draft.allowPackageManagerNetworkAccess,
        allowed_hosts: splitCsv(draft.allowedHosts),
      },
      packages: draft.packages
        .map((item) => ({ manager: item.manager.trim(), package: item.package.trim() }))
        .filter((item) => item.manager || item.package),
    },
    metadata,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function splitCsv(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function newDraftId() {
  return `draft_${Math.random().toString(36).slice(2, 10)}`;
}

function agentYamlPreview(agent: Template['agent']): string {
  return agentDefinitionYaml(agent);
}

function credentialAuthLabel(type: CredentialAuthType) {
  if (type === 'mcp_oauth') return 'MCP OAuth';
  if (type === 'bearer_token') return 'Bearer token';
  return 'Environment variable';
}

function groupMemoriesByFolder(memories: MemoryRecord[]): Array<{ folder: string; items: MemoryRecord[] }> {
  const folders = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    const segments = memory.path.split('/').filter(Boolean);
    const folder = segments.length > 1 ? segments.slice(0, -1).join('/') : 'root';
    const items = folders.get(folder) ?? [];
    items.push(memory);
    folders.set(folder, items);
  }
  return [...folders.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folder, items]) => ({ folder, items: items.sort((left, right) => left.path.localeCompare(right.path)) }));
}

function memoryName(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function eventKind(event: SessionEvent): 'user' | 'agent' | 'tool' | 'error' | 'system' {
  if (event.type.startsWith('user.')) return 'user';
  if (event.type.startsWith('agent.')) return event.type.includes('tool') ? 'tool' : 'agent';
  if (event.type.includes('tool') || event.type.includes('mcp')) return 'tool';
  if (event.type.includes('error') || event.type.includes('failed')) return 'error';
  return 'system';
}

function eventLabel(event: SessionEvent, mode: 'transcript' | 'debug') {
  if (mode === 'debug') return truncateMiddle(event.type, 22);
  const kind = eventKind(event);
  return kind[0].toUpperCase() + kind.slice(1);
}

function eventTitle(event: SessionEvent) {
  const text = eventText(event);
  if (event.type === 'user.message') return text || 'User message';
  if (event.type === 'agent.message') return text || 'Agent message';
  if (event.type === 'user.interrupt') return 'Interrupted';
  if (event.type === 'session.error') return text || 'Session error';
  if (event.type.includes('model') && event.type.endsWith('start')) return 'Model request start';
  if (event.type.includes('model') && event.type.endsWith('end')) return text ? `Model request stop (${text})` : 'Model request stop';
  return titleCase(event.type.replaceAll('.', ' ').replaceAll('_', ' '));
}

function eventText(event: SessionEvent) {
  if (event.delta) return event.delta;
  if (!event.content || event.content.length === 0) return '';
  return event.content.map((part) => {
    if (part && typeof part === 'object') {
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.message === 'string') return record.message;
      if (typeof record.error === 'string') return record.error;
    }
    return typeof part === 'string' ? part : JSON.stringify(part);
  }).join('\n');
}

function eventTime(event: SessionEvent) {
  const value = event.processed_at ?? event.created_at;
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
