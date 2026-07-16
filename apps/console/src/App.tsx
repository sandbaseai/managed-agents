import {
  Brain,
  ChevronDown,
  Database,
  FileText,
  Info,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Monitor,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { postJson, putJson } from './api';
import { EmptyState, LoadingState, RequiredMark } from './components/Common';
import { Modal } from './components/Modal';
import { AgentEditModal, AgentModal } from './components/modals/AgentModals';
import { SessionModal } from './components/modals/SessionModals';
import { Agents, AgentDetail } from './components/pages/AgentPages';
import { Sessions, SessionDetail } from './components/pages/SessionPages';
import { Files, Skills } from './components/pages/BuildPages';
import { Environments, EnvironmentDetail, environmentKind, sandboxProviderForHostingType, splitCsv } from './components/pages/EnvironmentPages';
import { CredentialVaults, CredentialVaultDetail } from './components/pages/CredentialVaultPages';
import { MemoryStores, MemoryStoreDetail } from './components/pages/MemoryStorePages';
import { SettingsView } from './components/pages/settings/SettingsView';
import { SETTINGS_VIEW_IDS } from './components/pages/settings/navigation';
import { useHashRoute } from './hooks/useHashRoute';
import { useConsoleData } from './hooks/useConsoleData';
import { formatDateShort } from './lib/format';
import type {
  Agent,
  AgentTab,
  ConsoleData,
  CredentialAuthType,
  Environment,
  EnvironmentHostingType,
  MemoryStore,
  Session,
  Template,
  Vault,
  ViewId,
} from './types';

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> }> = [
  {
    label: 'Build',
    items: [
      { id: 'files', label: 'Files', icon: FileText },
      { id: 'skills', label: 'Skills', icon: Zap },
    ],
  },
  {
    label: 'Default',
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
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];


export function App() {
  const [route, setRoute] = useHashRoute();
  const view = route.view;
  const { data, loading, error, refresh } = useConsoleData();
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

  const isSettingsRoute = SETTINGS_VIEW_IDS.includes(view);
  const workspaceLabel = data.workspace?.name && data.workspace.name !== 'managed-agents'
    ? data.workspace.name
    : 'Default';
  const workspaceTarget = data.workspace?.target ?? 'local';

  return (
    <div className={`shell ${isSettingsRoute ? 'settingsMode' : ''}`}>
      {!isSettingsRoute ? (
        <aside className="sidebar">
          <div className="brand">
            <span className="brandMark">▣</span>
            <span>managed-agents</span>
          </div>
          <button className="workspaceSwitch" type="button" onClick={() => setRoute('workspace')}>
            <span className="workspaceAvatar">{workspaceLabel.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{workspaceLabel}</strong>
              <small>{workspaceTarget}</small>
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
                    || (item.id === 'settings' && SETTINGS_VIEW_IDS.includes(view))
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
      ) : null}

      <main className="main">
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
      return <SettingsView data={props.data} section="workspace" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'runtime':
      return <SettingsView data={props.data} section="models" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'models':
      return <SettingsView data={props.data} section="models" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'loop-engine':
      return <SettingsView data={props.data} section="loop-engine" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'storage':
      return <SettingsView data={props.data} section="storage" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'memory':
      return <SettingsView data={props.data} section="memory" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'sandbox':
      return <SettingsView data={props.data} section="sandbox" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'api-keys':
      return <SettingsView data={props.data} section="api-keys" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'api-reference':
      return <SettingsView data={props.data} section="api-reference" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'logs':
      return <SettingsView data={props.data} section="logs" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'monitoring':
      return <SettingsView data={props.data} section="monitoring" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'observability':
      return <SettingsView data={props.data} section="monitoring" onRefresh={props.onRefresh} setView={props.setView} />;
    case 'settings':
      return <SettingsView data={props.data} section="general" onRefresh={props.onRefresh} setView={props.setView} />;
    default:
      return <Agents data={props.data} onNewAgent={() => props.onNewAgent('blank')} onOpenAgent={props.onOpenAgent} />;
  }
}


function ResourceModal({ kind, onClose, onSaved }: { kind: 'environment' | 'credential_vault' | 'memory_store'; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hostingType, setHostingType] = useState<EnvironmentHostingType>('local');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const path = kind === 'environment' ? '/v1/environments' : kind === 'credential_vault' ? '/v1/credential-vaults' : '/v1/memory_stores';
    try {
      await postJson(path, {
        name,
        ...(kind !== 'credential_vault' ? { description } : {}),
        ...(kind === 'environment' ? {
          config: {
            hosting_type: hostingType,
            sandbox_provider: sandboxProviderForHostingType(hostingType),
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
              <option value="local">Local</option>
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
      await postJson(`/v1/memory_stores/${storeId}/memories`, { path: normalizedPath, content });
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
