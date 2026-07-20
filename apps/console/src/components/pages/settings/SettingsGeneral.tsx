import { Box, KeyRound, Layers, Terminal } from 'lucide-react';
import { KeyValuePanel, SummaryStrip } from '../../Common';
import { pathName, workspaceConfigDir } from '../../../lib/format';
import type { ConsoleData, ViewId, Workspace } from '../../../types';

export function SettingsGeneral({ data }: { data: ConsoleData; setView: (view: ViewId) => void }) {
  const workspaceLabel = data.workspace?.name && data.workspace.name !== 'managed-agents'
    ? data.workspace.name
    : 'Default';
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
          <p>Workspace config, metadata, logs, and runtime files live under the workspace state directory.</p>
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
    </section>
  );
}

function runtimeDatabasePath(workspace: Workspace | null) {
  return workspace?.databasePath
    ?? workspace?.directories?.database
    ?? (workspace?.dataDir ? `${workspace.dataDir.replace(/\/$/, '')}/data.db` : undefined);
}
