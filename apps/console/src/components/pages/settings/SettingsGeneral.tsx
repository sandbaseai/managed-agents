import { Activity, Box, Brain, Database, FileText, Gauge, Keyboard, KeyRound, Layers, Shield, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { KeyValuePanel, SummaryStrip } from '../../Common';
import { pathName, workspaceConfigDir } from '../../../lib/format';
import type { ConsoleData, ViewId, Workspace } from '../../../types';

export function SettingsGeneral({ data, setView }: { data: ConsoleData; setView: (view: ViewId) => void }) {
  const workspaceLabel = data.workspace?.name && data.workspace.name !== 'managed-agents'
    ? data.workspace.name
    : 'Default';
  const cards: Array<{ id: ViewId; title: string; body: string; icon: ReactNode; meta: string | number }> = [
    { id: 'models', title: 'Models', body: 'One default model vendor, base URL, and credential state.', icon: <Brain size={20} />, meta: data.settings?.effective_config.model.vendor ?? 'not configured' },
    { id: 'loop-engine', title: 'Loop engine', body: 'Default execution engine and step limit for agent turns.', icon: <Gauge size={20} />, meta: data.settings?.effective_config.loop_engine.provider ?? 'builtin' },
    { id: 'storage', title: 'Storage', body: 'Metadata storage and artifact storage for this workspace.', icon: <Database size={20} />, meta: data.settings?.effective_config.storage.metadata.provider ?? 'sqlite' },
    { id: 'memory', title: 'Memory', body: 'One context-memory backend; Memory Stores remain session resources.', icon: <Brain size={20} />, meta: data.settings?.effective_config.memory.enabled ? data.settings.effective_config.memory.provider : 'disabled' },
    { id: 'sandbox', title: 'Sandbox', body: 'Default session isolation; named Environments may override it.', icon: <Shield size={20} />, meta: data.settings?.effective_config.sandbox.provider ?? 'local' },
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
            ['Memory provider', data.runtime?.memory],
          ]} />
        </div>
        <div className="panel subtlePanel">
          <h2>Capabilities</h2>
          <p>Live summary reported by the local runtime.</p>
          <KeyValuePanel rows={[
            ['Models', data.runtime?.models.length ?? 0],
            ['Sandboxes', data.runtime?.sandbox_providers.join(', ') || 'none'],
            ['API auth', data.runtime?.auth_enabled ? 'enabled' : 'disabled'],
            ['Database', runtimeDatabasePath(data.workspace) ? 'SQLite' : 'not resolved'],
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

function runtimeDatabasePath(workspace: Workspace | null) {
  return workspace?.databasePath
    ?? workspace?.directories?.database
    ?? (workspace?.dataDir ? `${workspace.dataDir.replace(/\/$/, '')}/managed-agents.db` : undefined);
}
