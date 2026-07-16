import { useCallback, useEffect, useState } from 'react';
import { getJson, getPage } from '../api';
import type {
  Agent,
  ApiKey,
  ConsoleData,
  Environment,
  MemoryStore,
  Runtime,
  RuntimeSettings,
  Session,
  Skill,
  Template,
  Vault,
  Workspace,
  WorkspaceFile,
} from '../types';

function emptyConsoleData(): ConsoleData {
  return {
    agents: [], sessions: [], environments: [], vaults: [], memoryStores: [],
    files: [], apiKeys: [], skills: [], templates: [], memoryProviders: [],
    storageProviders: [], runtime: null, workspace: null, settings: null,
  };
}

async function loadBuildDomain(): Promise<Pick<ConsoleData, 'agents' | 'sessions' | 'files' | 'skills' | 'templates'>> {
  const [agents, sessions, files, skills, templates] = await Promise.all([
    getPage<Agent>('/v1/agents'),
    getPage<Session>('/v1/sessions?limit=100'),
    getPage<WorkspaceFile>('/v1/files'),
    getPage<Skill>('/v1/skills'),
    getPage<Template>('/v1/x/templates'),
  ]);
  return {
    agents: agents.data,
    sessions: sessions.data,
    files: files.data,
    skills: skills.data,
    templates: templates.data,
  };
}

async function loadResourceDomain(): Promise<Pick<ConsoleData, 'environments' | 'vaults' | 'memoryStores' | 'memoryProviders' | 'storageProviders'>> {
  const [environments, vaults, memoryStores] = await Promise.all([
    getPage<Environment>('/v1/environments'),
    getPage<Vault>('/v1/credential-vaults'),
    getPage<MemoryStore>('/v1/memory_stores'),
  ]);
  return {
    environments: environments.data,
    vaults: vaults.data,
    memoryStores: memoryStores.data,
    memoryProviders: [],
    storageProviders: [],
  };
}

async function loadAccessDomain(): Promise<Pick<ConsoleData, 'apiKeys'>> {
  const apiKeys = await getPage<ApiKey>('/v1/api-keys');
  return { apiKeys: apiKeys.data };
}

async function loadRuntimeDomain(): Promise<Pick<ConsoleData, 'runtime' | 'workspace' | 'settings'>> {
  const [runtime, workspace, settings] = await Promise.all([
    getJson<Runtime>('/v1/x/runtime'),
    getJson<Workspace>('/v1/x/workspace'),
    getJson<RuntimeSettings>('/v1/x/settings'),
  ]);
  return { runtime, workspace, settings };
}

/** Shared Console bootstrap data and refresh lifecycle. */
export function useConsoleData() {
  const [data, setData] = useState<ConsoleData>(emptyConsoleData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const build = await loadBuildDomain();
      const resources = await loadResourceDomain();
      const access = await loadAccessDomain();
      const runtime = await loadRuntimeDomain();
      setData({
        ...emptyConsoleData(),
        ...build,
        ...resources,
        ...access,
        ...runtime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, error, refresh };
}
