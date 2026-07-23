import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getJson, getPage } from './api';
import { LoadingState } from './components/Common';
import { ConsoleRouteView, NAV_GROUPS, SETTINGS_VIEW_IDS } from './components/ConsoleRoutes';
import { AgentEditModal, AgentModal } from './components/pages/AgentModals';
import { AddMemoryModal, ResourceModal, SessionModal } from './components/pages/SessionModals';
import { AddCredentialModal } from './components/pages/CredentialPages';
import { useHashRoute } from './hooks/useHashRoute';
import type {
  Agent,
  AgentTab,
  ApiKey,
  ConsoleData,
  Environment,
  MemoryStore,
  Runtime,
  RuntimeSettings,
  Outcome,
  ScheduledDeployment,
  Session,
  Skill,
  Template,
  Vault,
  Webhook,
  Workspace,
  WorkspaceFile,
} from './types';

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
    webhooks: [],
    scheduledDeployments: [],
    outcomes: [],
    runtime: null,
    settings: null,
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
        webhooks,
        scheduledDeployments,
        outcomes,
        runtime,
        settings,
        workspace,
      ] = await Promise.all([
        getPage<Agent>('/v1/agents'),
        getPage<Session>('/v1/sessions?limit=100'),
        getPage<Environment>('/v1/environments'),
        getPage<Vault>('/v1/credential-vaults'),
        getPage<MemoryStore>('/v1/memory_stores'),
        getPage<WorkspaceFile>('/v1/files'),
        getPage<ApiKey>('/v1/api-keys'),
        getPage<Skill>('/v1/skills'),
        getPage<Template>('/v1/x/templates'),
        getPage<Webhook>('/v1/webhooks'),
        getPage<ScheduledDeployment>('/v1/scheduled-deployments'),
        getPage<Outcome>('/v1/outcomes'),
        getJson<Runtime>('/v1/x/runtime'),
        getJson<RuntimeSettings>('/v1/x/settings'),
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
        webhooks: webhooks.data,
        scheduledDeployments: scheduledDeployments.data,
        outcomes: outcomes.data,
        runtime,
        settings,
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
          <nav className="nav" aria-label="Primary navigation">
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
                      aria-current={active ? 'page' : undefined}
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
          <ConsoleRouteView
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
