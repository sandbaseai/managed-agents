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

/** Shared Console bootstrap data and refresh lifecycle. */
export function useConsoleData() {
  const [data, setData] = useState<ConsoleData>(emptyConsoleData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agents, sessions, environments, vaults, memoryStores, files, apiKeys, skills, templates, runtime, workspace, settings] = await Promise.all([
        getPage<Agent>('/v1/agents'), getPage<Session>('/v1/sessions?limit=100'),
        getPage<Environment>('/v1/environments'), getPage<Vault>('/v1/credential-vaults'),
        getPage<MemoryStore>('/v1/memory_stores'), getPage<WorkspaceFile>('/v1/files'),
        getPage<ApiKey>('/v1/api-keys'), getPage<Skill>('/v1/skills'),
        getPage<Template>('/v1/x/templates'), getJson<Runtime>('/v1/x/runtime'),
        getJson<Workspace>('/v1/x/workspace'), getJson<RuntimeSettings>('/v1/x/settings'),
      ]);
      setData({
        agents: agents.data, sessions: sessions.data, environments: environments.data,
        vaults: vaults.data, memoryStores: memoryStores.data, files: files.data,
        apiKeys: apiKeys.data, skills: skills.data, templates: templates.data,
        memoryProviders: [], storageProviders: [],
        runtime, workspace, settings,
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
